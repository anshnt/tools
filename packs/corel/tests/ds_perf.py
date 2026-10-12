"""Performance checks for Draw Studio (Playwright, the installed Edge). Plan section 8.1 budgets, section 9.4 "Performance".

Measures, with the generated 3-page, 21 MB fixture (designtool-3p.ai) and, read-only and local only, the user's own invitation:
  time to the first editable page, time until every page is read, long tasks (over 50 ms) after the first page is up, JS heap, DOM size,
  wheel-zoom and drag frame times, undo time, autosave write time, and the same first-page run at 4x CPU throttle.
A budget fails when it is missed by more than 25 percent (section 8.1). The user's file is read from disk by the browser and never copied or uploaded.

    uv run --with playwright --with pillow python ds_perf.py [--only open,throttle,interact,big,leaks] [--runs 2]
"""
import argparse, os, statistics, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ds_browser as B  # noqa: E402
from ds_browser import FIX, USER_FILE, check, mount, select_ids  # noqa: E402
from smoke import launch  # noqa: E402

MARGIN = 1.25
BUDGET = {"first_s": 4.0, "first_throttled_s": 8.0, "long_task_ms": 200, "drag_frame_ms": 20, "zoom_frame_ms": 32, "pan_long_ms": 100, "undo_ms": 100}
ROWS = []  # (label, value, budget, unit)

INSTALL = """() => {
  window.__lt = []; window.__t0 = null; window.__ready = null; window.__first = null
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch (e) {}
  const tick = () => {
    if (window.__t0 != null && window.__ready == null) {
      const ds = document.querySelector('.tool-body')?.__ds, busy = document.querySelector('.ds-busy')
      const seen = document.querySelector('.ds-world path, .ds-world image, .ds-world text')
      if (seen && window.__first == null) window.__first = performance.now()
      const empty = document.querySelector('.ds-empty')
      if (ds && seen && busy && busy.hidden && empty && empty.hidden && ds.store.root.pages[0] && !ds.store.root.pages[0].pending) window.__ready = performance.now()
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}"""

STATS = """() => { const ds = document.querySelector('.tool-body').__ds
  const imgs = [...document.querySelectorAll('.ds-world image')]
  return { heapMB: (performance.memory?.usedJSHeapSize || 0) / 1048576, dom: document.getElementsByTagName('*').length, world: document.querySelector('.ds-world')?.getElementsByTagName('*').length || 0,
    images: imgs.length, nonBlob: imgs.filter((i) => !(i.getAttribute('href') || '').startsWith('blob:')).length, dataUrls: [...document.querySelectorAll('[href^="data:"], [src^="data:"]')].length,
    pages: ds.store.root.pages.length, pending: ds.store.root.pages.filter((p) => p.pending).length } }"""


def row(label, value, budget=None, unit="ms", lower_is_better=True, hard=True):
    ROWS.append((label, value, budget, unit))
    if budget is None:
        print(f"   {label}: {value:.1f} {unit}")
        return
    limit = budget * MARGIN
    ok = value <= limit
    print(f"   {label}: {value:.1f} {unit} (budget {budget}, fails above {limit:.0f})")
    if hard:
        check(ok, f"{label}: {value:.1f} {unit} within the {budget} {unit} budget plus 25 percent")


def throttle(ctx, page, rate):
    cdp = ctx.new_cdp_session(page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
    return cdp


def open_timed(ctx, base, path, rate=1, as_name=None):
    """Mount, start the clock, choose the file, and wait for the first editable page and then for every page. Returns (page, metrics)."""
    page, errors = mount(ctx, base)
    page.evaluate(INSTALL)
    cdp = throttle(ctx, page, rate) if rate != 1 else None
    page.wait_for_timeout(300)
    page.evaluate("() => { window.__lt.length = 0; window.__t0 = performance.now() }")
    if as_name:
        page.set_input_files(".t-ds input[type=file]", {"name": as_name, "mimeType": "", "buffer": Path(path).read_bytes()})
    else:
        page.set_input_files(".t-ds input[type=file]", str(path))
    page.wait_for_function("() => window.__ready != null", timeout=180000)
    m = page.evaluate("() => ({ first: window.__first - window.__t0, ready: window.__ready - window.__t0, t0: window.__t0, ready_abs: window.__ready })")
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every((p) => !p.pending)", timeout=240000)
    m["all"] = page.evaluate("() => performance.now() - window.__t0")
    page.wait_for_timeout(1500)  # let background work and the autosave timer settle, then look at the main thread
    lt = page.evaluate("() => window.__lt.slice()")
    m["long_before"] = [d for s, d in lt if s < m["ready_abs"]]
    m["long_after"] = [d for s, d in lt if s >= m["ready_abs"]]
    m["stats"] = page.evaluate(STATS)
    m["errors"] = [e for e in errors if e.startswith("pageerror")]
    if cdp:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    return page, m


def report_open(label, m, rate, hard=True):
    s = m["stats"]
    print(f"   {label}: first element {m['first'] / 1000:.2f}s, editable {m['ready'] / 1000:.2f}s, every page {m['all'] / 1000:.2f}s, heap {s['heapMB']:.0f} MB, DOM {s['dom']} ({s['world']} in the drawing), "
          f"{s['images']} pictures ({s['nonBlob']} not blob), long tasks before ready {len(m['long_before'])} (max {max(m['long_before'], default=0):.0f} ms), after {len(m['long_after'])} (max {max(m['long_after'], default=0):.0f} ms)")
    mx = max(m["long_after"], default=0)
    check(mx <= BUDGET["long_task_ms"] * MARGIN * (rate if rate > 1 else 1), f"{label}: no main-thread task over {BUDGET['long_task_ms']} ms after the first page is up (worst {mx:.0f} ms)")
    check(s["nonBlob"] == 0 and s["dataUrls"] == 0, f"{label}: every picture is a blob URL and no data URL is in the DOM")
    check(not m["errors"], f"{label}: no uncaught errors {m['errors'][:2]}")


def open_series(ctx, base, label, path, rate, runs, as_name=None):
    """The first run of a session also downloads pdf.js, so the budget is judged on the best of the runs (the cold time is printed too)."""
    times = []
    for i in range(runs):
        page, m = open_timed(ctx, base, path, rate, as_name)
        report_open(f"{label} run {i + 1}{' (cold)' if i == 0 else ''}", m, rate)
        times.append(m["ready"] / 1000)
        page.close()
    best = min(times)
    budget = BUDGET["first_throttled_s"] if rate > 1 else BUDGET["first_s"]
    ROWS.append((f"{label} first page, best of {runs}", best, budget, "s"))
    check(best <= budget * MARGIN, f"{label}: the first page is editable in {best:.2f}s, best of {runs} (budget {budget}s plus 25 percent; all runs {[round(t, 2) for t in times]})")


def t_open(ctx, base, runs):
    """Unthrottled: the fixture and the invitation."""
    for label, path, as_name in (("fixture", FIX / "designtool-3p.ai", None), ("invitation", USER_FILE, None)):
        if not Path(path).exists():
            print(f"   {label}: not found, skipped")
            continue
        open_series(ctx, base, label, path, 1, runs, as_name)


def t_throttle(ctx, base, runs):
    """4x CPU throttle (plan 8.1: the first page in under 8 s)."""
    for label, path, as_name in (("fixture at 4x CPU", FIX / "designtool-3p.ai", None), ("invitation at 4x CPU", USER_FILE, None)):
        if not Path(path).exists():
            print(f"   {label}: not found, skipped")
            continue
        open_series(ctx, base, label, path, 4, max(2, runs), as_name)


FRAMES_JS = """() => { window.__fr = []; window.__frun = true; let last = performance.now(); const f = (t) => { if (!window.__frun) return; window.__fr.push(t - last); last = t; requestAnimationFrame(f) }; requestAnimationFrame(f) }"""


def pct(values, p):
    v = sorted(values)
    return v[min(len(v) - 1, int(len(v) * p))] if v else 0


def t_interact(ctx, base, runs):
    """Zoom, pan, drag, undo and autosave on the opened fixture."""
    page, m = open_timed(ctx, base, FIX / "designtool-3p.ai")
    page.evaluate("() => document.querySelector('.tool-body').__ds.view.zoomPage()")
    page.wait_for_timeout(400)
    # wheel zoom: one event per frame, in and out
    d = page.evaluate("""async () => { const host = document.querySelector('.ds-view'), r = host.getBoundingClientRect(), out = []; let last = performance.now()
      for (let i = 0; i < 80; i++) { host.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 40 ? -30 : 30, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
        await new Promise(requestAnimationFrame); const t = performance.now(); out.push(t - last); last = t } return out.slice(2) }""")
    row("wheel zoom frame, 95th percentile", pct(d, 0.95), BUDGET["zoom_frame_ms"])
    print(f"   wheel zoom: {len(d)} frames, median {statistics.median(d):.1f} ms, worst {max(d):.1f} ms")
    # wheel pan (trackpad style) with the long-task observer
    page.evaluate("() => { window.__lt.length = 0 }")
    page.evaluate("""async () => { const host = document.querySelector('.ds-view'), r = host.getBoundingClientRect()
      for (let i = 0; i < 60; i++) { host.dispatchEvent(new WheelEvent('wheel', { deltaX: 12, deltaY: i < 30 ? 25 : -25, clientX: r.left + 100, clientY: r.top + 100, bubbles: true, cancelable: true })); await new Promise(requestAnimationFrame) } }""")
    lt = page.evaluate("() => window.__lt.map((x) => x[1])")
    row("longest task while panning", max(lt, default=0), BUDGET["pan_long_ms"])
    page.evaluate("() => document.querySelector('.tool-body').__ds.view.zoomPage()")
    # drag the largest picture of page 1, ten times, with real mouse events
    big = page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; let best = null
      const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else { const b = ds.renderer.nodeBox(n); if (b && (!best || b.w * b.h > best.a)) best = { id: n.id, a: b.w * b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, t: n.t } } })
      ds.store.page().layers.forEach((l) => rec(l.items)); return best }""")
    print(f"   largest object on page 1: {big['t']} #{big['id']}")
    B.select_ids(page, big["id"])
    page.evaluate("() => { document.querySelector('.tool-body').__ds.store.setPref('snap', false) }")
    page.evaluate(FRAMES_JS)
    x0, y0 = B.scr(page, big["cx"], big["cy"])
    for i in range(10):
        page.mouse.move(x0, y0)
        page.mouse.down()
        for k in range(1, 31):
            page.mouse.move(x0 + k * 3, y0 + k * 2)
        page.mouse.up()
        page.wait_for_timeout(60)
        page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.evaluate("() => { window.__frun = false }")
    fr = page.evaluate("() => window.__fr.slice(3)")
    row("drag frame, 95th percentile", pct(fr, 0.95), BUDGET["drag_frame_ms"])
    print(f"   drag: {len(fr)} frames, median {statistics.median(fr):.1f} ms, worst {max(fr):.1f} ms")
    # undo and redo time after a nudge
    times = []
    for i in range(6):
        page.locator(".ds-view").focus()
        B.select_ids(page, big["id"])
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(50)
        t = page.evaluate("""async () => { const ds = document.querySelector('.tool-body').__ds; const t0 = performance.now(); ds.store.undo(); await new Promise(requestAnimationFrame); const a = performance.now() - t0
          const t1 = performance.now(); ds.store.redo(); await new Promise(requestAnimationFrame); return [a, performance.now() - t1] }""")
        times += t
        page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    row("undo or redo, worst of 12", max(times), BUDGET["undo_ms"])
    # autosave write time: the first write stores the 12 pictures, the next ones only the document
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Edit', (r) => ({ ...r, title: 'perf edit' })) }")
    w1 = page.evaluate("async () => { const t = performance.now(); await document.querySelector('.tool-body').__ds.persist.flush(); return performance.now() - t }")
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Edit', (r) => ({ ...r, title: 'perf edit 2' })) }")
    w2 = page.evaluate("async () => { const t = performance.now(); await document.querySelector('.tool-body').__ds.persist.flush(); return performance.now() - t }")
    row("autosave, first write (pictures and document)", w1, None)
    row("autosave, document only", w2, 1500)
    # switching pages is instant once they are read
    t = page.evaluate("async () => { const ds = document.querySelector('.tool-body').__ds; const t0 = performance.now(); ds.store.setPage(1); await new Promise(requestAnimationFrame); ds.store.setPage(2); await new Promise(requestAnimationFrame); ds.store.setPage(0); await new Promise(requestAnimationFrame); return performance.now() - t0 }")
    row("three page switches", t, 400, hard=True)
    s = page.evaluate(STATS)
    print(f"   after interaction: heap {s['heapMB']:.0f} MB, DOM {s['dom']}")
    page.close()


def t_big(ctx, base, runs):
    """A page with 5,000 objects: dragging a group stays a CSS transform, undo is fast, the page opens quickly."""
    page, errors = mount(ctx, base)
    t0 = time.time()
    info = B.load_scene(page, big=5000)
    print(f"   building the 5k scene: {time.time() - t0:.1f}s")
    gid = info["ids"]["BigGroup"]
    page.evaluate("(id) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setSel([id]); ds.view.setView({ z: 2, x: 20, y: 20 }); ds.store.setPref('snap', false) }", gid)
    page.wait_for_timeout(500)
    page.evaluate(FRAMES_JS)
    sx, sy = B.scr(page, 11, 11)
    for i in range(10):
        page.mouse.move(sx, sy)
        page.mouse.down()
        for k in range(1, 31):
            page.mouse.move(sx + k * 4, sy + k * 2)
        page.mouse.up()
        page.wait_for_timeout(80)
        page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.evaluate("() => { window.__frun = false }")
    fr = page.evaluate("() => window.__fr.slice(3)")
    row("5k-node group drag frame, 95th percentile", pct(fr, 0.95), BUDGET["drag_frame_ms"])
    d = page.evaluate("""async () => { const host = document.querySelector('.ds-view'), r = host.getBoundingClientRect(), out = []; let last = performance.now()
      for (let i = 0; i < 60; i++) { host.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 30 ? -30 : 30, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true })); await new Promise(requestAnimationFrame); const t = performance.now(); out.push(t - last); last = t } return out.slice(2) }""")
    row("5k-node page wheel zoom frame, 95th percentile", pct(d, 0.95), BUDGET["zoom_frame_ms"])
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setSel([])")
    t = page.evaluate("""async () => { const ds = document.querySelector('.tool-body').__ds; const id = [...ds.store.sel.ids][0]; ds.store.setSel([]); ds.store.tx('Edit', (r) => ({ ...r, title: 'x' })); const t0 = performance.now(); ds.store.undo(); await new Promise(requestAnimationFrame); return performance.now() - t0 }""")
    row("undo on a 5k-node page", t, BUDGET["undo_ms"])
    check(not [e for e in errors if e.startswith("pageerror")], "no uncaught errors")
    page.close()


LEAK_HOOK = """(() => { window.__urls = new Map(); const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = (b) => { const u = c(b); window.__urls.set(u, b.type); return u }; URL.revokeObjectURL = (u) => { window.__urls.delete(u); r(u) } })()"""
OURS = "() => [...window.__urls.values()].filter((t) => t !== 'text/javascript').length"  # pdf.js makes one 89-byte wrapper per worker and never revokes it (library behaviour)


def t_leaks(ctx, base, runs):
    """Ten open-and-leave cycles, then exports (pictures, PDF, SVG, ZIP) and a PostScript, SVG and bitmap open: object URLs and FontFaces return to the start."""
    B.t_leaks(ctx, base)
    page = ctx.new_page()
    page.add_init_script(LEAK_HOOK)
    B.open_tool(page, base, "draw-studio")
    f0 = page.evaluate("() => document.fonts.size")
    for i in range(3):
        info = B.load_scene(page, pages=2)
        for fmt, opts in (("png", {"dpi": 96}), ("jpg", {"dpi": 72}), ("pdf", {}), ("svg", {}), ("eps", {}), ("cdr", {})):
            page.evaluate("""async ([fmt, opts]) => { const ds = document.querySelector('.tool-body').__ds; const { exportDoc } = await import('/packs/corel/_ds-save.js')
              await exportDoc(fmt, opts, { store: ds.store, assets: ds.assets, fonts: ds.fonts, boxOf: ds.renderer.nodeBox }) }""", [fmt, opts])
        for name in ("tiny.eps", "evil.svg"):
            if (B.FIX / name).exists():
                B.open_file(page, B.FIX / name)
    during = page.evaluate(OURS)
    page.goto(f"{base}/#/")
    page.wait_for_timeout(500)
    left = page.evaluate(OURS)
    fonts = page.evaluate("() => document.fonts.size")
    check(left == 0, f"object URLs after exports and opens, then leaving the editor: {left} (the mounted editor held {during})")
    check(fonts == f0, f"document.fonts back to its start after exports ({f0} -> {fonts})")
    page.close()


GROUPS = {"open": t_open, "throttle": t_throttle, "interact": t_interact, "big": t_big, "leaks": t_leaks}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--runs", type=int, default=2)
    a = ap.parse_args()
    base = B.serve_ds()
    profile = f"dsperf-{os.getpid()}"
    with launch(profile) as ctx:
        for g, fn in GROUPS.items():
            if a.only and g not in a.only.split(","):
                continue
            print(f"== {g}")
            t0 = time.time()
            try:
                fn(ctx, base, a.runs)
            except Exception as e:
                import traceback; traceback.print_exc()
                B.FAILS.append(f"{g} crashed: {e}")
            print(f"   ({g}: {time.time() - t0:.0f}s)")
    import shutil
    shutil.rmtree(Path(r"C:/Projects/tools-packs/_profiles") / profile, ignore_errors=True)
    print("\nSummary (value, budget):")
    for label, v, b, u in ROWS:
        print(f"  {label}: {v:.2f} {u}" + (f"  (budget {b})" if b is not None else ""))
    print(f"\n{len(B.FAILS)} failure(s)")
    for f in B.FAILS:
        print(" -", f)
    sys.exit(1 if B.FAILS else 0)
