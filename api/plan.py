"""POST /api/plan — ① 기획 + ② 배정까지 돌리고 **결재 직전에서 멈춘다.**

사람이 승인/반려를 누르는 동안 함수는 돌지 않는다. 그래서 Hobby(60초)에서도 된다.
반려되면 `사유` 를 실어 다시 부르면 된다 — 편집장이 그 사유를 반영해 목차를 다시 짠다.

요청  {"question":"…", "key":"sk-…", "preset":"간단|정식", "역할":true, …, "사유":"…"}
응답  {"events":[…], "plan":{축,제목,목차}, "settings":{…}}
      events 는 run.start · plan.done · assign.done · approval.request 순서 그대로다.
"""
from http.server import BaseHTTPRequestHandler

from _common import 본문읽기, 실행중, 준비, 질문뽑기, 키지우기, json보내기, 파이프라인


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-methods", "POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_POST(self):
        body = 본문읽기(self)
        question = 질문뽑기(body)
        if not question:
            return json보내기(self, 400, {"error": "질문이 비어 있습니다."})

        settings, 오류 = 준비(body)
        if 오류:
            return json보내기(self, 401, {"error": 오류})

        if not 실행중.acquire(blocking=False):
            return json보내기(self, 429, {"error": "지금 다른 실행이 돌고 있습니다. 잠시 뒤에 다시 눌러 주세요."})
        try:
            _, P = 파이프라인()
            events = []
            P.on_event(events.append)
            사유 = str(body.get("사유") or "").strip()[:200]
            out = P.plan_only(question, settings) if not 사유 \
                else P.plan_only(question, settings, 사유)
            json보내기(self, 200, {"events": events, "plan": out["plan"], "settings": settings})
        except Exception as e:
            json보내기(self, 500, {"error": 키지우기(f"{type(e).__name__}: {e}")})
        finally:
            _, P = 파이프라인()
            P.on_event(None)
            실행중.release()
