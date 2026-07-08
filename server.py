#!/usr/bin/env python3
"""Local helper for the Elden Ring - Ultimate Region Tracker.

Serves the static app AND exposes your save file(s) to the page so it can
auto-load and refresh them in ANY browser (Firefox/Zen included) without a
file picker. Runs entirely on your machine; binds to localhost only.

Endpoints:
  GET /api/saves            -> JSON list of detected ER0000.sl2/.co2 files
  GET /api/save?path=<abs>  -> raw bytes of that save (whitelisted paths only)
"""
import http.server, os, json, urllib.parse, webbrowser, threading

HERE = os.path.dirname(os.path.abspath(__file__))
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))


def save_dir():
    appdata = os.environ.get("APPDATA")  # C:\Users\<you>\AppData\Roaming
    if not appdata:
        return None
    d = os.path.join(appdata, "EldenRing")
    return d if os.path.isdir(d) else None


def find_saves():
    base = save_dir()
    if not base:
        return []
    out = []
    for sub in sorted(os.listdir(base)):
        p = os.path.join(base, sub)
        if not os.path.isdir(p):
            continue
        for fn in ("ER0000.sl2", "ER0000.co2"):
            fp = os.path.join(p, fn)
            if os.path.isfile(fp):
                st = os.stat(fp)
                out.append({
                    "path": fp,
                    "account": sub,
                    "file": fn,
                    "mtime": int(st.st_mtime * 1000),
                    "size": st.st_size,
                })
    out.sort(key=lambda x: x["mtime"], reverse=True)
    return out


def is_allowed(path):
    """Only serve real save files that live under %APPDATA%\\EldenRing."""
    base = save_dir()
    if not base:
        return False
    try:
        rp = os.path.realpath(path)
    except Exception:
        return False
    return (rp.startswith(os.path.realpath(base) + os.sep)
            and rp.lower().endswith((".sl2", ".co2")))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/saves":
            return self._json({"saves": find_saves()})
        if parsed.path == "/api/save":
            qs = urllib.parse.parse_qs(parsed.query)
            path = (qs.get("path") or [""])[0]
            if not path:
                saves = find_saves()
                if not saves:
                    return self._json({"error": "no save found"}, 404)
                path = saves[0]["path"]
            if not is_allowed(path) or not os.path.isfile(path):
                return self._json({"error": "not allowed"}, 403)
            try:
                with open(path, "rb") as f:
                    return self._bytes(f.read())
            except Exception as e:
                return self._json({"error": str(e)}, 500)
        return super().do_GET()

    def log_message(self, *a):
        pass  # keep the console quiet


def main():
    try:
        httpd = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        # port already in use -> probably already running; just open the browser
        webbrowser.open(f"http://localhost:{PORT}/")
        print(f"Port {PORT} is already in use - opened the browser to the running copy.")
        return

    url = f"http://localhost:{PORT}/"
    print("  Elden Ring - Ultimate Region Tracker")
    print("  -----------------------------------")
    print("  Serving at", url)
    saves = find_saves()
    if saves:
        print(f"  Auto-detected {len(saves)} save(s); newest: {saves[0]['path']}")
    else:
        print("  No save auto-detected under %APPDATA%\\EldenRing - you can still pick a file manually.")
    print("  KEEP THIS WINDOW OPEN while you use the tracker. Press Ctrl+C to stop.")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
