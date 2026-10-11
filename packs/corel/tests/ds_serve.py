"""Serve the site with Draw Studio mounted before the integration step adds its catalog entry (plan section 9.1).

The handler rewrites ONLY the response for GET /packs/corel/catalog.js (the repo file is untouched):
  - adds the draw-studio entry right after `export default [` (skipped when it already exists)
  - points the old cdr-viewer, cdr-to-svg, cdr-to-pdf, cdr-to-png and cdr-to-eps entries at module 'draw-studio'
After integration the rewrite is a no-op, so the same helper keeps working.

    uv run --with playwright python ds_serve.py            # serve and print the URL
In tests:
    sys.path.insert(0, r"C:/Projects/tools-packs/draw-studio/packs/corel/tests"); from ds_serve import serve_ds
    base = serve_ds()                                      # then smoke.open_tool(page, base, "draw-studio")
"""
import functools, http.server, re, socket, sys, threading
from pathlib import Path

sys.path.insert(0, r"C:/Projects/tools-packs/_harness")
from smoke import _Handler  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
ENTRY = ("{ id: 'draw-studio', name: 'Draw Studio', desc: 'Open CDR, AI, PDF, EPS, SVG and images, edit them, and save CDR or any format.', "
         "icon: 'vector-square', layout: 'app', also: ['image', 'pdf'], tags: 'draw studio cdr ai eps pdf svg vector editor', ready: true },\n")


def patch_catalog(src: str) -> str:
    if "id: 'draw-studio'" not in src:
        src = src.replace("export default [\n", "export default [\n  " + ENTRY, 1)
    src = src.replace("module: 'cdr-viewer'", "module: 'draw-studio'")
    src = re.sub(r"(\{ id: 'cdr-viewer', )(?!module)", r"\1module: 'draw-studio', ", src)
    return src


class DsHandler(_Handler):
    def do_GET(self):
        if self.path.split("?")[0] == "/packs/corel/catalog.js":
            body = patch_catalog((REPO / "packs/corel/catalog.js").read_text(encoding="utf8")).encode("utf8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def serve_ds(root=None):
    """Serve `root` (default: this repo checkout) on a free localhost port. Returns the base URL."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(DsHandler, directory=str(root or REPO)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"


if __name__ == "__main__":
    print(serve_ds())
    threading.Event().wait()
