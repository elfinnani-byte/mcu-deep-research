"""POST /api/run — 승인된 목차를 받아 **③ 조사부터 끝까지** 흘린다 (SSE).

배정은 다시 돌리지 않는다 — 사람이 승인한 시작 문서가 바뀌면 결재가 헛것이 된다.

요청  {"question":"…", "key":"sk-…", "plan":{축,제목,목차}, "preset":"간단|정식", …}
응답  text/event-stream — `data: {의미 이벤트}` 한 줄씩. 마지막에 `data: {"type":"done"}`

이벤트를 만드는 쪽(파이프라인)은 동기 코드라 **일꾼 실타래에서 돌리고**, 이쪽은 큐에서
꺼내 흘린다. 그래야 한 건 나올 때마다 바로 화면에 뜬다 — 다 끝나고 한꺼번에 오지 않는다.
"""
import json
import queue
import threading
from http.server import BaseHTTPRequestHandler

from _common import 본문읽기, 실행중, 준비, 질문뽑기, 키지우기, json보내기, 파이프라인

끝 = object()


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-methods", "POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_POST(self):
        body = 본문읽기(self)
        question = 질문뽑기(body)
        plan = body.get("plan") or {}
        if not question or not plan.get("목차"):
            return json보내기(self, 400, {"error": "질문이나 목차가 비어 있습니다."})

        settings, 오류 = 준비(body)
        if 오류:
            return json보내기(self, 401, {"error": 오류})

        if not 실행중.acquire(blocking=False):
            return json보내기(self, 429, {"error": "지금 다른 실행이 돌고 있습니다. 잠시 뒤에 다시 눌러 주세요."})

        self.send_response(200)
        self.send_header("content-type", "text/event-stream; charset=utf-8")
        self.send_header("cache-control", "no-cache, no-transform")
        self.send_header("x-accel-buffering", "no")      # 프록시가 모아 두지 않게
        self.end_headers()

        q: queue.Queue = queue.Queue()
        _, P = 파이프라인()

        def 일꾼():
            try:
                P.on_event(q.put)
                P.run_from(question, plan, settings)
            except Exception as e:
                q.put({"type": "error", "message": 키지우기(f"{type(e).__name__}: {e}")})
            finally:
                P.on_event(None)
                q.put(끝)

        t = threading.Thread(target=일꾼, daemon=True)
        t.start()
        try:
            while True:
                ev = q.get()
                if ev is 끝:
                    break
                self.wfile.write(f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
            self.wfile.write(b'data: {"type":"done"}\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass                                          # 방문자가 탭을 닫았다
        finally:
            실행중.release()
