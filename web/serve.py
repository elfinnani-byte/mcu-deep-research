# 개발용 서버 — 캐시를 끄고, 배포판의 서버리스 함수를 **같은 코드로** 로컬에서도 태운다.
#
#   GET  /…              정적 파일 (no-cache — 모듈을 고쳐도 새로고침이면 반영)
#   POST /api/plan       api/plan.py 의 handler 를 그대로 부른다
#   POST /api/run        api/run.py  의 handler 를 그대로 부른다 (SSE)
#   POST /_shot/<이름>   캔버스를 base64 로 받아 _shots/<이름>.png 로 저장 (개발 전용)
#
# 함수 코드를 복사하지 않고 **불러서 쓴다.** 그래야 로컬에서 되는 것이 배포에서도 된다.
# Vercel 은 api/*.py 의 `handler`(BaseHTTPRequestHandler) 를 같은 방식으로 부른다.
import base64
import http.server
import pathlib
import socketserver
import sys
import threading

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SHOTS = HERE / "_shots"
for p in (str(ROOT), str(ROOT / "api")):          # api/_common.py 를 함수들이 평평하게 부른다
    if p not in sys.path:
        sys.path.insert(0, p)

_함수 = {}
_자물쇠 = threading.Lock()


def 함수(이름):
    """api/<이름>.py 의 handler 클래스를 가져온다 (처음 부를 때만 읽는다)."""
    with _자물쇠:
        if 이름 not in _함수:
            import importlib
            _함수[이름] = importlib.import_module(이름).handler
    return _함수[이름]


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if not self.path.startswith("/api/"):     # 함수는 제 헤더를 스스로 붙인다
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api()
        if self.path.startswith("/_shot/"):
            return self._shot()
        self.send_error(404)

    def _api(self):
        이름 = self.path[len("/api/"):].split("?")[0].strip("/")
        try:
            cls = 함수(이름)
        except ModuleNotFoundError:
            return self.send_error(404, f"api/{이름}.py 없음")
        except Exception as e:                    # 함수 안의 import 오류를 그대로 보여 준다
            return self.send_error(500, f"{type(e).__name__}: {e}")
        # 진짜 요청 객체를 넘겨 함수가 제 손으로 응답하게 둔다 (Vercel 과 같은 모양)
        얇은 = cls.__new__(cls)
        얇은.rfile, 얇은.wfile, 얇은.headers = self.rfile, self.wfile, self.headers
        얇은.request_version, 얇은.requestline, 얇은.command = self.request_version, self.requestline, "POST"
        얇은.send_response = self.send_response
        얇은.send_header = self.send_header
        얇은.end_headers = self.end_headers
        얇은.send_error = self.send_error
        얇은.log_request = lambda *a, **k: None
        try:
            얇은.do_POST()
        except Exception as e:
            try:
                self.send_error(500, f"{type(e).__name__}: {e}")
            except Exception:
                pass

    def _shot(self):
        name = pathlib.Path(self.path[len("/_shot/"):]).name or "shot"
        if not name.endswith(".png"):
            name += ".png"
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            SHOTS.mkdir(exist_ok=True)
            (SHOTS / name).write_bytes(base64.b64decode(raw))
        except Exception as e:
            self.send_error(500, str(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(f"saved _shots/{name}".encode())

    def log_message(self, *a):
        pass


class 서버(socketserver.ThreadingTCPServer):      # SSE 한 건이 돌아도 다른 요청을 받는다
    allow_reuse_address = True
    daemon_threads = True


with 서버(("127.0.0.1", 8765), H) as s:
    print("http://127.0.0.1:8765  (no-cache · /api/plan · /api/run · POST /_shot/<이름>)")
    s.serve_forever()
