"""서버리스 함수 두 개가 같이 쓰는 것 — 키 취급 · 요청 읽기 · 응답 보내기.

**키 취급 (절대 규칙 1)**
  - 요청 본문으로만 받는다. 파일·로그·응답 어디에도 쓰지 않는다.
  - 예외 메시지에 섞여 나올 수 있으니 내보내기 직전에 한 번 더 지운다.

**왜 함수가 둘인가**
  서버리스 함수는 사람을 기다리는 동안에도 실행 시간을 태운다. 우리 파이프라인은
  ② 배정 뒤에 결재를 받으므로 한 번에 돌릴 수 없다. `/api/plan` 이 목차를 돌려주고
  끝내면, 사람이 누르는 동안 함수는 돌지 않는다. 그다음 `/api/run` 이 나머지를 흘린다.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from pathlib import Path

# 저장소 루트를 경로에 얹는다 — Vercel 번들은 api/ 를 작업 폴더로 잡는다
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 한 번에 한 실행만 — 파이프라인이 모듈 전역(설정 · COST · 방문자 키)을 쓰기 때문이다.
# 두 요청이 겹치면 두 번째는 429 로 돌려보낸다.
실행중 = threading.Lock()

MAX_QUESTION = 200

# 방문자가 고를 수 있는 규모. Hobby 함수 상한이 60초라 **기본은 「간단」** 이다.
PRESETS = {
    "간단": {"절수": 3, "절예산": 2, "최대바퀴": 1},
    "정식": {"절수": 5, "절예산": 3, "최대바퀴": 2},
}
SWITCHES = ("역할", "배정", "구역", "재위임")


def 키지우기(text: str) -> str:
    """혹시 섞여 나온 키를 가린다 — 오류 메시지를 그대로 내보내기 전에 거른다.

    ⚠ 예전 정규식은 `[A-Za-z0-9_-]{12,}` 만 봤다. 그런데 OpenAI 가 돌려주는 오류에는
    **자기가 가린 키**가 들어 있다 — `sk-proj-***************************cdef`.
    별표가 섞여 있어 하나도 안 지워졌고, 꼬리 네 글자가 그대로 방문자에게 갔다.
    이제 `sk-` 뒤의 공백 아닌 것은 전부 지운다.
    """
    return re.sub(r"sk-\S+", "sk-…", str(text))


# 밖에서 온 오류를 방문자가 읽을 수 있는 말로 바꾼다.
# 키가 틀렸을 뿐인데 500 과 스택 트레이스를 보여 주면 「고장났다」로 읽힌다.
_인증말 = ("incorrect api key", "invalid api key", "authenticationerror",
           "invalid_api_key", "401")
_한도말 = ("rate limit", "ratelimit", "quota", "insufficient_quota", "429")


def 오류정리(e: Exception) -> tuple:
    """(상태코드, 사람이 읽을 메시지, 트레이스를 붙일까)"""
    쪽 = f"{type(e).__name__}: {e}".lower()
    if any(k in 쪽 for k in _인증말):
        return 401, "키가 올바르지 않습니다 — ⚙ 설정에서 다시 확인해 주세요. (OpenAI 가 거절했습니다)", False
    if any(k in 쪽 for k in _한도말):
        return 429, "OpenAI 쪽 한도에 걸렸습니다 — 잔액이나 분당 한도를 확인해 주세요.", False
    if "timeout" in 쪽 or "timed out" in 쪽:
        return 504, "모델 응답이 너무 늦습니다 — 잠시 뒤에 다시 눌러 주세요.", False
    return 500, 키지우기(f"{type(e).__name__}: {e}"), True


def 본문읽기(handler) -> dict:
    n = int(handler.headers.get("content-length") or 0)
    if n <= 0:
        return {}
    try:
        return json.loads(handler.rfile.read(n).decode("utf-8"))
    except Exception:
        return {}


def 설정뽑기(body: dict) -> dict:
    """요청에서 아는 값만 골라낸다. 모르는 열쇠는 버린다."""
    s = dict(PRESETS.get(str(body.get("preset") or "간단"), PRESETS["간단"]))
    for k in SWITCHES:
        if k in body:
            s[k] = bool(body[k])
    return s


def 질문뽑기(body: dict) -> str:
    return str(body.get("question") or "").strip()[:MAX_QUESTION]


def 키뽑기(body: dict) -> str:
    return str(body.get("key") or "").strip()


def json보내기(handler, code: int, obj: dict) -> None:
    raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def 파이프라인():
    """무거운 것(langgraph · 코퍼스 1.6MB)은 실제로 쓸 때 불러온다 — 콜드 스타트를 줄인다."""
    from server import llm, pipeline
    return llm, pipeline


def 준비(body: dict):
    """키를 끼우고 설정을 돌려준다. 키가 없으면 (None, 오류) 를 돌려준다."""
    key = 키뽑기(body)
    if not key.startswith("sk-"):
        return None, "키가 없습니다 — ⚙ 설정에서 본인 OpenAI 키를 넣어 주세요."
    llm, _ = 파이프라인()
    llm.use_key(key)
    os.environ.pop("OFFICE_LLM", None)     # 방문자 키는 OpenAI 기준
    return 설정뽑기(body), None
