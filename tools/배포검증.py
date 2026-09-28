#!/usr/bin/env python3
"""배포된 사이트가 **실제로 살아 있는지** 묻는다. 빌드가 초록이어도 함수는 죽어 있을 수 있다.

    python tools/배포검증.py                          # 배포판
    python tools/배포검증.py http://127.0.0.1:8765    # 로컬 개발 서버

왜 필요했나 — 한 번 `FUNCTION_INVOCATION_FAILED` 로 /api/plan 이 통째로 죽은 적이 있다.
로컬 `web/serve.py` 는 api/ 를 sys.path 에 넣어 줘서 멀쩡했고 배포판만 죽었다.
정적 파일만 확인했다면 못 잡았을 것이다. 그래서 **함수까지** 두드린다.

키는 넣지 않는다. 키 없이 기대하는 것은 「401 키가 없습니다」 라는 **정직한 거절**이다.
그 응답이 왔다면 요청이 함수 안까지 들어갔다는 뜻이고, 그게 여기서 보려는 전부다.
(bash 로 쓰지 않는다 — 한글 변수명을 못 쓰고, Windows 에 bash 가 없을 수 있다.)
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

# Windows 기본 콘솔은 cp949 라 「—」 같은 글자에서 죽는다.
# 검사 도구가 검사 결과 대신 인코딩 오류를 뱉으면 안 되므로 출력만 UTF-8 로 돌린다.
for _스트림 in (sys.stdout, sys.stderr):
    if hasattr(_스트림, "reconfigure"):
        _스트림.reconfigure(encoding="utf-8", errors="replace")

기본기준 = "https://mcu-deep-research.vercel.app"
시간제한 = 25


def 두드리기(url: str, body: dict | None = None):
    """(상태코드, 본문앞부분) — 4xx/5xx 도 예외가 아니라 값으로 돌려받는다."""
    데이터 = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=데이터, method="POST" if 데이터 else "GET",
        headers={"content-type": "application/json"} if 데이터 else {})
    try:
        with urllib.request.urlopen(req, timeout=시간제한) as r:
            return r.status, r.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(400).decode("utf-8", "replace")
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


class 검사기:
    def __init__(self, 기준):
        self.기준 = 기준.rstrip("/")
        self.실패 = 0

    def 확인(self, 설명, 기대, 경로, body=None):
        코드, 본문 = 두드리기(self.기준 + 경로, body)
        if 코드 == 기대:
            print(f"  OK  {설명:<32s} {코드}")
        else:
            self.실패 += 1
            print(f"  X   {설명:<32s} {코드} (기대 {기대})")
            print(f"      {본문[:180].strip()}")


def 인코딩(경로: str) -> str:
    return urllib.parse.quote(경로, safe="/?=&")


def main():
    기준 = sys.argv[1] if len(sys.argv) > 1 else 기본기준
    c = 검사기(기준)
    print(f"기준: {c.기준}\n")

    print("── 정적 파일 ──")
    c.확인("첫 화면", 200, "/")
    c.확인("모듈 main.js", 200, "/js/main.js")
    c.확인("서고 racks.json", 200, "/racks.json")
    c.확인("녹화 목록", 200, "/replay/index.json")
    c.확인("녹화 q1-기본", 200, 인코딩("/replay/q1-기본.json"))

    print("\n── 서버리스 함수 (키 없이 — 거절이 정답) ──")
    c.확인("/api/plan 키 없음 → 401", 401, "/api/plan", {"question": "살아 있나"})
    c.확인("/api/run 목차 없음 → 400", 400, "/api/run", {"question": "살아 있나"})

    # ⚠ 여기서 보는 것은 **주소가 열린다**는 것뿐이다. 파라미터가 실제로 먹었는지는
    #    스크립트가 자바스크립트를 돌리지 않으므로 모른다 — 그건 브라우저로 봐야 한다.
    print("\n── 화면 (주소가 열리는가 — 파라미터가 먹었는지는 아님) ──")
    c.확인("?replay=…&report=1", 200, 인코딩("/?replay=q4-역할끔&report=1"))

    print()
    print("모두 통과" if not c.실패 else f"{c.실패}개 실패")
    sys.exit(c.실패)


if __name__ == "__main__":
    main()
