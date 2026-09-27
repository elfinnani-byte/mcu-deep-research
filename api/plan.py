"""POST /api/plan — ① 기획 + ② 배정까지 돌리고 **결재 직전에서 멈춘다.**

사람이 승인/반려를 누르는 동안 함수는 돌지 않는다. 그래서 Hobby(60초)에서도 된다.
반려되면 `사유` 를 실어 다시 부르면 된다 — 편집장이 그 사유를 반영해 목차를 다시 짠다.

요청  {"question":"…","key":"sk-…","preset":"간단|정식","역할":true,…,"사유":"…","attempt":1}
응답  {"events":[…], "plan":{축,제목,목차}, "settings":{…}}
"""
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler

# Vercel 은 api/ 를 경로에 넣어 주지 않는다 — _common 을 부르기 전에 직접 넣는다.
# (로컬 web/serve.py 는 넣어 줬기 때문에 여기서만 터졌다)
_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.dirname(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _오류(handler, code, obj):
    """_common 조차 못 불렀을 때를 위한 최소 응답 — 이유를 감추지 않는다."""
    raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-methods", "POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_POST(self):
        # **무거운 것은 여기서 부른다.** 모듈 맨 위에서 부르면 실패가
        # FUNCTION_INVOCATION_FAILED 로만 보이고 왜 죽었는지 알 수 없다.
        try:
            from _common import (json보내기, 본문읽기, 실행중, 오류정리, 준비, 질문뽑기, 키지우기, 파이프라인)
        except Exception as e:
            return _오류(self, 500, {"error": f"함수 적재 실패 — {type(e).__name__}: {e}",
                                     "trace": traceback.format_exc()[-700:]})

        body = 본문읽기(self)
        question = 질문뽑기(body)
        if not question:
            return json보내기(self, 400, {"error": "질문이 비어 있습니다."})

        settings, 오류 = 준비(body)
        if 오류:
            return json보내기(self, 401, {"error": 오류})

        if not 실행중.acquire(blocking=False):
            return json보내기(self, 429, {"error": "지금 다른 실행이 돌고 있습니다. 잠시 뒤에 다시 눌러 주세요."})
        P = None
        try:
            _, P = 파이프라인()
            events = []
            P.on_event(events.append)
            사유 = str(body.get("사유") or "").strip()[:200]
            attempt = max(1, min(3, int(body.get("attempt") or 1)))
            out = P.plan_only(question, settings, 사유, attempt)
            json보내기(self, 200, {"events": events, "plan": out["plan"], "settings": settings})
        except Exception as e:
            # 키가 틀렸을 뿐인데 500 + 스택 트레이스를 보여 주면 방문자는 「고장났다」로 읽는다
            코드, 말, 트레이스 = 오류정리(e)
            몸 = {"error": 말}
            if 트레이스:
                몸["trace"] = 키지우기(traceback.format_exc()[-700:])
            json보내기(self, 코드, 몸)
        finally:
            if P is not None:
                P.on_event(None)
            실행중.release()
