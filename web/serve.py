# 개발용 정적 서버 — 캐시를 끈다. 모듈을 고쳐도 새로고침이면 바로 반영된다.
#
# POST /_shot/<이름>  ← 브라우저가 캔버스를 base64 로 보내면 _shots/<이름>.png 로 저장한다.
# 화면을 파일로 꺼내 확인할 때 쓴다. 개발 전용이고 배포판(Vercel)에는 올라가지 않는다.
import base64, http.server, pathlib, socketserver

SHOTS = pathlib.Path(__file__).parent / "_shots"

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_POST(self):
        if not self.path.startswith("/_shot/"):
            self.send_error(404); return
        name = pathlib.Path(self.path[len("/_shot/"):]).name or "shot"
        if not name.endswith(".png"): name += ".png"
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            SHOTS.mkdir(exist_ok=True)
            (SHOTS / name).write_bytes(base64.b64decode(raw))
        except Exception as e:
            self.send_error(500, str(e)); return
        self.send_response(200); self.send_header("Content-Type", "text/plain")
        self.end_headers(); self.wfile.write(f"saved _shots/{name}".encode())

    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8765), H) as s:
    print("http://127.0.0.1:8765 (no-cache · POST /_shot/<이름> 으로 캡처 저장)")
    s.serve_forever()
