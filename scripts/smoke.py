"""CI smoke test: mounts every ready tool at desktop (1280px) and phone (375px) widths in headless Chromium and fails on
console errors, uncaught exceptions, mount failures, tool error alerts or horizontal overflow.

    pip install playwright==1.63.0 && python -m playwright install --with-deps chromium
    python scripts/smoke.py              # all ready tools
    python scripts/smoke.py merge-pdf    # just these ids
Locally you can pass --channel msedge to use the installed Edge instead of downloading Chromium.
"""
import argparse, asyncio, functools, http.server, json, socket, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGNORE = ("favicon", "Download the React DevTools")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm"}

    def log_message(self, *a):
        pass


def serve():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"


async def check(ctx, base, tid, width, sem):
    async with sem:
        page = await ctx.new_page()
        await page.set_viewport_size({"width": width, "height": 800})
        errors = []
        page.on("console", lambda m: m.type == "error" and not any(i in m.text for i in IGNORE) and errors.append(m.text[:300]))
        page.on("pageerror", lambda e: errors.append(f"uncaught: {str(e)[:300]}"))
        try:
            await page.goto(f"{base}/#/{tid}")
            await page.wait_for_function("() => { const b = document.querySelector('.tool-body'); return b && b.childElementCount && !b.querySelector(':scope > .empty .spinner') }", timeout=30000)
            await page.wait_for_timeout(600)
            st = await page.evaluate("""() => ({
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              toolError: document.querySelector('.tool-body > .alert.error')?.textContent || null })""")
            if st["overflow"] > 1:
                errors.append(f"horizontal overflow of {st['overflow']}px")
            if st["toolError"]:
                errors.append(f"tool error: {st['toolError'][:300]}")
        except Exception as e:
            errors.append(f"did not mount: {str(e).splitlines()[0][:200]}")
        finally:
            await page.close()
        return f"{tid} @{width}px", errors


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--channel", default=None)
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()
    from playwright.async_api import async_playwright
    base = serve()
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel=args.channel) if args.channel else await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        await page.goto(base + "/")
        ids = args.ids or await page.evaluate("async () => (await import('/assets/catalog.js')).TOOLS.filter((t) => t.ready).map((t) => t.id)")
        await page.close()
        sem = asyncio.Semaphore(args.concurrency)
        results = await asyncio.gather(*[check(ctx, base, t, w, sem) for t in ids for w in (1280, 375)])
        await browser.close()
    bad = [(k, e) for k, e in results if e]
    for k, e in bad:
        print(f"FAIL {k}\n  " + "\n  ".join(e))
    print(f"\n{len(results) - len(bad)}/{len(results)} views clean ({len(ids)} ready tools).")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    asyncio.run(main())
