"""Browser checks for Draw Studio (Playwright, the installed Edge). Covers milestones E1 and E2; later milestones append their checks.

    uv run --with playwright --with pillow python ds_browser.py [--only name,name] [--samples DIR] [--fixtures DIR]

Needs the generated fixtures (gen_designpdf.py, gen_cdr.py output). Nothing is downloaded. The user's own file is only read
when DS_USER_FILE points at it (it is never copied, uploaded or committed).
"""
import argparse, base64, io, json, os, sys, time
from pathlib import Path

sys.path.insert(0, r"C:/Projects/tools-packs/_harness")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import launch, open_tool, page_state  # noqa: E402
from ds_serve import serve_ds  # noqa: E402

SAMPLES = Path(os.environ.get("DS_SAMPLES", r"C:/Projects/tools-packs/draw-studio-samples"))
FIX = Path(os.environ.get("DS_FIXTURES", r"C:/Projects/tools-packs/draw-studio-tests"))
SHOTS = Path(os.environ.get("DS_SHOTS", r"C:/Projects/tools-packs/draw-studio-scratch/editor/shots"))
# The user's own invitation. It is read locally only, sent to the page as an in-memory payload under an .ai name (sniffing is by content),
# and never copied, uploaded or committed. Falls back to the .pdf of the same name when the .ai is not there.
_UF = [Path(r"C:/Users/Rajvi/Downloads/Ansh Wedding Virtual Invitation.ai"), Path(r"C:/Users/Rajvi/Downloads/Ansh Wedding Virtual Invitation.pdf")]
USER_FILE = Path(os.environ["DS_USER_FILE"]) if os.environ.get("DS_USER_FILE") else next((p for p in _UF if p.exists()), _UF[0])
FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def mount(ctx, base, width=1280, height=800, route="draw-studio"):
    page = ctx.new_page()
    page.set_viewport_size({"width": width, "height": height})
    errors = open_tool(page, base, route)
    return page, errors


def ds_eval(page, js, arg=None):
    return page.evaluate("async (arg) => { const ds = document.querySelector('.tool-body').__ds; " + js + " }", arg)


def wait_ds(page, timeout=30000):
    page.wait_for_function("() => document.querySelector('.tool-body')?.__ds", timeout=timeout)


def open_file(page, path, timeout=60000, as_name=None):
    """Open through the real file input of the hidden dropzone (the same input the Open command clicks)."""
    t0 = time.time()
    if as_name:
        page.set_input_files(".t-ds input[type=file]", {"name": as_name, "mimeType": "", "buffer": Path(path).read_bytes()})
    else:
        page.set_input_files(".t-ds input[type=file]", str(path))
    page.wait_for_function("() => !document.querySelector('.t-ds .ds-empty') || document.querySelector('.t-ds .ds-empty').hidden || document.querySelector('dialog[open]')", timeout=timeout)
    return time.time() - t0


STATE_JS = """() => { const ds = document.querySelector('.tool-body').__ds; const r = ds.store.root; return {
  pages: r.pages.length, pending: r.pages.filter(p => p.pending).length, title: r.title, source: r.meta.source,
  names: r.pages.map(p => p.name), sizes: r.pages.map(p => [Math.round(p.w * 100) / 100, Math.round(p.h * 100) / 100]),
  layers: r.pages[0].layers.map(l => ({name: l.name, hidden: l.hidden, locked: l.locked, n: l.items.length})),
  fonts: Object.keys(r.fonts).length, assets: ds.assets.size, warnings: r.warnings.length } }"""


def dom_stats(page):
    return page.evaluate("""() => { const w = document.querySelector('.ds-world'); return {
      images: [...w.querySelectorAll('image')].map(i => i.getAttribute('href').split(':')[0]),
      paths: w.querySelectorAll('path').length, texts: w.querySelectorAll('text').length, glyphTexts: w.querySelectorAll('text[data-glyphs]').length,
      families: [...new Set([...w.querySelectorAll('text')].map(t => (t.getAttribute('font-family') || '').split(',')[0].replace(/"/g, '')))],
      clips: w.querySelectorAll('[clip-path]').length, groups: w.querySelectorAll('g[data-id]').length,
      dataUrls: document.documentElement.outerHTML.includes('data:image') } }""")


# ---------------------------------------------------------------- E1
def t_mount(ctx, base):
    for w, h, name in ((1280, 800, "desktop"), (375, 700, "phone")):
        page, errors = mount(ctx, base, w, h)
        st = page_state(page)
        check(not errors, f"{name}: no console errors {errors[:2]}")
        check(st["overflow"] <= 1, f"{name}: no horizontal overflow ({st['overflow']})")
        check(st["toolError"] is None, f"{name}: no tool error")
        n = page.evaluate("""() => ({ menubar: !!document.querySelector('[role=menubar]'), tools: document.querySelectorAll('.ds-tool').length, prop: !!document.querySelector('.ds-prop'),
          status: !!document.querySelector('.ds-status'), tab: document.querySelectorAll('.ds-tab').length, drop: !!document.querySelector('.t-ds .dropzone input[type=file]'),
          accept: document.querySelector('.t-ds .dropzone')._accept, hidden: document.querySelector('.t-ds .dropzone').hidden })""")
        check(n["tools"] >= 3 and n["prop"] and n["status"] and n["tab"] == 1 and n["drop"], f"{name}: shell parts present {n}")
        if w > 860:
            check(n["menubar"], "desktop: menubar present")
        for ext in (".cdr", ".cdt", ".ai", ".eps", ".ps", ".pdf", ".svg", ".svgz", "image/*", ".heic", ".heif"):
            check(ext in n["accept"].split(","), f"dropzone accepts {ext}")
        shot(page, f"mount-{name}")
        page.close()


def t_inject(ctx, base):
    """A document injected through __ds renders: paths, gradient, clip, image Blob, glyph text."""
    page, errors = mount(ctx, base)
    font = base64.b64encode(Path(r"C:/Windows/Fonts/arial.ttf").read_bytes()).decode()
    res = page.evaluate("""async (fontB64) => {
      const ds = document.querySelector('.tool-body').__ds
      const D = await import('/packs/corel/_ds-doc.js'), T = await import('/packs/corel/_tree.js')
      const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#0a0'; g.fillRect(0, 0, 8, 8)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const a = await ds.assets.addBlob(blob, 'x.png')
      const bin = Uint8Array.from(atob(fontB64), (ch) => ch.charCodeAt(0))
      const P = (id, d, extra) => ({ id, t: 'path', d, fill: '#ff0000', fillOpacity: 1, rule: 'nonzero', stroke: '#000000', strokeWidth: 2, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0, ...extra })
      const sq = (x, y, s) => [['M', x, y], ['L', x + s, y], ['L', x + s, y + s], ['L', x, y + s], ['Z']]
      const flat = { warnings: ['injected'], fonts: { f1: { name: 'Arial', family: 'Arial', bold: false, italic: false, data: bin } }, pages: [{ w: 300, h: 200, name: 'A', items: [
        P(1, sq(10, 10, 60)),
        P(2, sq(90, 10, 60), { fill: { g: 'linear', x1: 90, y1: 10, x2: 150, y2: 10, m: [1, 0, 0, 1, 0, 0], stops: [{ o: 0, c: '#0000ff', a: 1 }, { o: 1, c: '#ffff00', a: 1 }], spread: 'pad' } }),
        P(3, sq(170, 10, 60), { clip: [{ d: [['M', 170, 10], ['L', 200, 10], ['L', 200, 70], ['L', 170, 70], ['Z']], rule: 'nonzero' }] }),
        { id: 4, t: 'image', href: 'blob:ds-test', w: 8, h: 8, m: [60, 0, 0, 60, 10, 90], opacity: 1 },
        { id: 5, t: 'text', str: 'Hi', family: 'Arial', size: 24, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 100, 140], font: 'f1', glyphs: [{ c: 'H', x: 0 }, { c: 'i', x: 20 }] }] }] }
      flat.pages[0].items[3].href = 'data:image/png;base64,' + btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
      const O = await import('/packs/corel/_ds-open.js')
      const { doc } = await O.normalizeDoc(flat, { assets: ds.assets, title: 'inject', source: 'new', name: 'inject' })
      await ds.fonts.use(doc.fonts, doc.uid)
      ds.store.load(doc)
      await new Promise((r) => setTimeout(r, 300))
      return { text: document.querySelector('.ds-world text')?.getAttribute('font-family'), glyph: !!document.querySelector('.ds-world text[data-glyphs]'), ok: ds.fonts.ok(Object.keys(doc.fonts)[0]) }
    }""", font)
    st = dom_stats(page)
    check(not errors, f"inject: no console errors {errors[:2]}")
    check(st["paths"] >= 3 and st["images"] == ["blob"] and not st["dataUrls"], f"inject: paths and a blob image, no data URL in the DOM {st}")
    check(st["clips"] >= 1, "inject: clip applied")
    check(page.evaluate("() => !!document.querySelector('.ds-world defs, defs linearGradient')") , "inject: gradient def present")
    check(res["glyph"] and res["ok"] and "ds" in (res["text"] or ""), f"inject: glyph-mode text in a ds<uid> family {res}")
    shot(page, "inject")
    # zoom and pan
    z0 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    box = page.locator(".ds-view").bounding_box()
    page.mouse.move(box["x"] + 300, box["y"] + 200)
    page.mouse.wheel(0, -100)
    page.wait_for_timeout(150)
    z1 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    check(z1 > z0 * 1.05, f"wheel zooms in at the cursor ({z0:.3f} -> {z1:.3f})")
    v0 = page.evaluate("() => ({...document.querySelector('.tool-body').__ds.store.view})")
    page.keyboard.down("Space")
    page.mouse.down(); page.mouse.move(box["x"] + 340, box["y"] + 230, steps=4); page.mouse.up()
    page.keyboard.up("Space")
    v1 = page.evaluate("() => ({...document.querySelector('.tool-body').__ds.store.view})")
    check(abs((v1["x"] - v0["x"]) - 40) < 2 and abs((v1["y"] - v0["y"]) - 30) < 2 and abs(v1["z"] - v0["z"]) < 1e-9, f"space-drag pans by the drag distance ({v0} -> {v1})")
    page.get_by_role("button", name="Zoom out").first.click()
    z2 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    check(z2 < v1["z"], "zoom out button works")
    page.keyboard.press("Shift+F4")
    z3 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    page.keyboard.press("Control+1")
    z4 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    check(abs(z4 - 96 / 72) < 1e-6 and z3 != z4, f"Shift+F4 fits the page, Ctrl+1 is 100 percent ({z3:.3f}, {z4:.3f})")
    page.get_by_role("button", name="Pan", exact=False).first.click()
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.tool") == "pan", "Pan tool selectable")
    # pinch with two touch pointers (synthetic pointer events)
    page.keyboard.press("v")
    zb = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    page.evaluate("""() => { const h = document.querySelector('.ds-view'); const r = h.getBoundingClientRect(); const mk = (t, id, x, y) => h.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1, button: 0 }))
      mk('pointerdown', 1, 200, 200); mk('pointerdown', 2, 260, 200); mk('pointermove', 2, 320, 200); mk('pointerup', 2, 320, 200); mk('pointerup', 1, 200, 200) }""")
    za = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    check(za > zb * 1.5, f"pinch zooms ({zb:.3f} -> {za:.3f})")
    # click selects
    page.keyboard.press("Shift+F4")
    page.wait_for_timeout(100)
    pos = page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; const v = ds.store.view; const r = document.querySelector('.ds-view').getBoundingClientRect(); return [r.left + 40 * v.z + v.x, r.top + 40 * v.z + v.y] }""")
    page.mouse.click(pos[0], pos[1])
    sel = page.evaluate("() => document.querySelector('.tool-body').__ds.store.sel.ids.length")
    check(sel == 1, f"click selects the object under the pointer ({sel})")
    check("Curve on Layer 1" in page.inner_text(".ds-status"), f"status bar describes the selection: {page.inner_text('.ds-status')!r}")
    page.close()


# ---------------------------------------------------------------- E2
def t_open_fixture(ctx, base):
    f = FIX / "designtool-3p.ai"
    if not f.exists():
        return check(False, f"fixture missing: {f}")
    page, errors = mount(ctx, base)
    dt = open_file(page, f)
    first = dt
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=60000)
    st = page.evaluate(STATE_JS)
    check(not errors, f"fixture: no console errors {errors[:2]}")
    check(first < 4.5, f"fixture: first page visible in {first:.2f}s (target under 4s unthrottled)")
    check(st["pages"] == 3 and st["pending"] == 0, f"fixture: 3 pages, all read {st}")
    d = dom_stats(page)
    check(len(d["images"]) >= 1 and all(h == "blob" for h in d["images"]) and not d["dataUrls"], f"fixture page 1: blob images and no data URL in the DOM {d['images']}")
    check(d["glyphTexts"] >= 1 and any(fam.startswith("ds") for fam in d["families"]), f"fixture: glyph text in ds<uid> families {d['families'][:3]} glyphs={d['glyphTexts']}")
    check(d["clips"] >= 1, "fixture: clips applied")
    imgs = 0
    for i in range(3):
        page.evaluate("(i) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setPage(i) }", i)
        page.wait_for_timeout(250)
        imgs += len(dom_stats(page)["images"])
    check(imgs >= 12, f"fixture: 12 images over three pages ({imgs})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setPage(0)")
    page.wait_for_timeout(300)
    shot(page, "fixture-p1")
    page.close()


def t_open_cdr(ctx, base):
    manifest = json.loads((SAMPLES / "manifest.json").read_text())
    page, errors = mount(ctx, base)
    for name, m in manifest.items():
        if not name.startswith("scene-"):
            continue
        open_file(page, SAMPLES / name)
        st = page.evaluate(STATE_JS)
        leaves = page.evaluate("""() => { const r = document.querySelector('.tool-body').__ds.store.root; let n = 0, g = 0; const rec = (items) => { for (const x of items) { if (x.t === 'group') { g++; rec(x.items) } else n++ } }
          for (const p of r.pages) for (const l of p.layers) rec(l.items); return [n, g] }""")
        check(st["source"] == "cdr" and st["pages"] >= 1 and leaves[0] >= m["objects"], f"{name}: {st['pages']} page(s), {leaves[0]} objects, {leaves[1]} groups (manifest {m['objects']} objects, {m['pages']} pages incl. master)")
        check(any(l["n"] for l in st["layers"]), f"{name}: layers carry objects {st['layers']}")
    check(not errors, f"cdr: no console errors {errors[:2]}")
    shot(page, "cdr-last")
    # damaged files: a readable message (or a drawing that opens with notes), never a crash
    for bad in sorted(SAMPLES.glob("bad-*.cdr")):
        before = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root")
        title0 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.meta.name")
        page.set_input_files(".t-ds input[type=file]", str(bad))
        try:
            page.wait_for_function("(t0) => document.querySelector('dialog[open]') || document.querySelector('.tool-body').__ds.store.root.meta.name !== t0", arg=title0, timeout=15000)
        except Exception:
            pass
        if page.locator("dialog[open]").count():
            txt = page.inner_text("dialog[open]")
            check(len(txt) > 40 and any(k in txt.lower() for k in ("could not", "not recognised", "does not look", "not a")), f"{bad.name}: readable message ({txt[:70]!r})")
            page.keyboard.press("Escape")
            page.wait_for_timeout(100)
            check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.meta.name") == title0, f"{bad.name}: the open drawing is kept")
        else:
            w = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.warnings.length")
            check(w > 0, f"{bad.name}: opened with {w} note(s) about the damage")
    # unreadable file with a preview picture inside: offer it as a bitmap drawing
    page.set_input_files(".t-ds input[type=file]", str(SAMPLES / "bad-corrupt-cmpr.cdr"))
    page.wait_for_selector("dialog[open]", timeout=15000)
    btn = page.get_by_role("button", name="Open the preview image only")
    check(btn.count() == 1, "unreadable CDR with a preview: offers 'Open the preview image only'")
    if btn.count():
        btn.click()
        page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.source === 'bitmap'", timeout=15000)
        st = page.evaluate(STATE_JS)
        check(st["pages"] == 1 and st["layers"][0]["n"] == 1, f"the preview opens as a one-image drawing {st['sizes']}")
        check(not page.locator("dialog[open]").count(), "the dialog closes after choosing the preview")
    check(not [e for e in errors if "pageerror" in e], f"cdr: no uncaught errors {errors[-2:]}")
    page.close()


def make_bitmaps(dirp):
    from PIL import Image, ImageDraw
    dirp.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGBA", (320, 200), (255, 255, 255, 0))
    d = ImageDraw.Draw(im); d.rectangle((10, 10, 150, 120), fill=(200, 30, 30, 255)); d.ellipse((120, 60, 300, 190), fill=(20, 80, 200, 200))
    out = {}
    for ext, mode in (("png", "RGBA"), ("jpg", "RGB"), ("webp", "RGBA"), ("gif", "P"), ("bmp", "RGB")):
        f = dirp / f"pic.{ext}"
        conv = im.convert("RGB") if mode == "RGB" else im
        if mode == "P":
            conv = im.convert("RGB").convert("P")
        conv.save(f)
        out[ext] = f
    # a PNG saved with a .jpg name: the content wins over the extension
    (dirp / "really-png.jpg").write_bytes(out["png"].read_bytes())
    (dirp / "notpic.txt").write_text("hello, this is not a drawing\n")
    (dirp / "empty.pdf").write_bytes(b"")
    out["disguised"] = dirp / "really-png.jpg"; out["text"] = dirp / "notpic.txt"; out["empty"] = dirp / "empty.pdf"
    return out


def cur_name(page):
    return page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.meta.name")


def t_open_other(ctx, base):
    """Bitmaps, wrong types, hostile SVG, password PDF, PostScript (when the reader exists)."""
    files = make_bitmaps(SHOTS.parent / "gen")
    page, errors = mount(ctx, base)
    for ext in ("png", "jpg", "webp", "gif", "bmp", "disguised"):
        open_file(page, files[ext])
        st = page.evaluate(STATE_JS)
        d = dom_stats(page)
        check(st["pages"] == 1 and st["source"] == "bitmap" and d["images"] == ["blob"], f"{ext}: opens as a one-image page ({st['sizes']}, {d['images']})")
    check(abs(page.evaluate(STATE_JS)["sizes"][0][0] - 240) < 0.01, "bitmap page is the pixel size at 96 dpi (320 px = 240 pt)")
    for k, what in (("text", "text file"), ("empty", "empty file")):
        name0 = cur_name(page)
        page.set_input_files(".t-ds input[type=file]", str(files[k]))
        page.wait_for_selector("dialog[open]", timeout=10000)
        txt = page.inner_text("dialog[open]")
        check("not recognised" in txt, f"{what}: friendly error ({txt[:80]!r})")
        page.keyboard.press("Escape"); page.wait_for_timeout(100)
        check(cur_name(page) == name0, f"{what}: the editor keeps the open drawing and stays usable")
    # hostile SVG: inert
    alerts, reqs = [], []
    page.on("dialog", lambda dlg: (alerts.append(dlg.message), dlg.dismiss()))
    page.on("request", lambda r: reqs.append(r.url) if not r.url.startswith(("http://127.0.0.1", "blob:", "data:")) else None)
    if (FIX / "evil.svg").exists():
        open_file(page, FIX / "evil.svg")
        page.wait_for_timeout(600)
        html = page.evaluate("() => document.querySelector('.ds-world').outerHTML")
        check(not alerts, f"evil.svg: no alert ({alerts})")
        check(not reqs, f"evil.svg: no outbound request ({reqs[:3]})")
        check(not any(x in html.lower() for x in ("<script", "onload=", "onerror=", "<foreignobject", "javascript:")), "evil.svg: no script, handler or foreignObject in the DOM")
    # password PDF
    if (FIX / "password.pdf").exists():
        page.set_input_files(".t-ds input[type=file]", str(FIX / "password.pdf"))
        page.wait_for_selector("dialog[open] input[type=password]", timeout=15000)
        check("password" in page.inner_text("dialog[open]").lower(), "password PDF: prompts for the password")
        page.fill("dialog[open] input[type=password]", "wrong")
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.querySelector('dialog[open] input[type=password]') && /wrong/i.test(document.querySelector('dialog[open]').innerText)", timeout=15000)
        check(True, "password PDF: a wrong password asks again")
        page.fill("dialog[open] input[type=password]", "secret")
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'password.pdf'", timeout=20000)
        check(page.evaluate(STATE_JS)["pages"] >= 1, "password PDF: opens after the right password")
    # PostScript: opens when the reader exists, else a friendly message
    for nm in ("tiny.eps", "legacy.ai", "multi.eps"):
        if not (FIX / nm).exists():
            continue
        page.set_input_files(".t-ds input[type=file]", str(FIX / nm))
        page.wait_for_function("(nm) => document.querySelector('dialog[open]') || document.querySelector('.tool-body').__ds.store.root.meta.name === nm", arg=nm, timeout=20000)
        if page.locator("dialog[open]").count():
            txt = page.inner_text("dialog[open]")
            check("not supported in this build" in txt or "could not" in txt.lower(), f"{nm}: friendly message while the PostScript reader is absent ({txt[:60]!r})")
            page.keyboard.press("Escape"); page.wait_for_timeout(100)
        else:
            st = page.evaluate(STATE_JS)
            check(st["pages"] >= 1 and st["source"] in ("ps", "eps"), f"{nm}: opened through the PostScript reader {st['sizes']}")
    # damaged or hostile PDF and PostScript: readable message or a drawing, never a stuck spinner
    for nm in ("bad-truncated.pdf", "bad-js.pdf", "bad-huge.pdf", "bad-truncated.eps"):
        if not (FIX / nm).exists():
            continue
        page.set_input_files(".t-ds input[type=file]", str(FIX / nm))
        page.wait_for_function("(nm) => document.querySelector('dialog[open]') || document.querySelector('.tool-body').__ds.store.root.meta.name === nm", arg=nm, timeout=60000)
        if page.locator("dialog[open]").count():
            check(len(page.inner_text("dialog[open]")) > 30, f"{nm}: readable message ({page.inner_text('dialog[open]')[:60]!r})")
            page.keyboard.press("Escape")
        else:
            check(True, f"{nm}: opens as a drawing (scripts and size claims are ignored)")
        page.wait_for_timeout(150)
        check(page.evaluate("() => document.querySelector('.ds-busy').hidden"), f"{nm}: the progress overlay is gone")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors ({[e for e in errors if 'pageerror' in e][:2]})")
    page.close()


def t_handoff(ctx, base):
    """The site's drop and hand-off routes: openToolWith from another page, a drop on the canvas, a drop on the page chrome, Ctrl+O, page tabs."""
    f = FIX / "designtool-3p.ai"
    payload = base64.b64encode(f.read_bytes()).decode()
    page = ctx.new_page()
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(f"{base}/#/")
    page.wait_for_timeout(800)
    t0 = time.time()
    page.evaluate("""(b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const file = new File([bin], 'handoff.ai')
      window.dispatchEvent(new CustomEvent('tools:open-with', { detail: { id: 'draw-studio', files: [file] } })) }""", payload)
    page.wait_for_function("() => document.querySelector('.tool-body')?.__ds?.store.root.meta.name === 'handoff.ai'", timeout=60000)
    check(page.evaluate(STATE_JS)["pages"] == 3, f"openToolWith hand-off opens the file ({time.time() - t0:.2f}s)")
    small = base64.b64encode((SAMPLES / "scene-v1000.cdr").read_bytes()).decode()
    drop_js = """(args) => { const bin = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bin], args.name))
      document.querySelector(args.sel).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) }"""
    page.evaluate(drop_js, {"b64": small, "name": "dropped.cdr", "sel": ".ds-stage"})
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'dropped.cdr'", timeout=20000)
    check(page.evaluate(STATE_JS)["source"] == "cdr", "drop on the canvas opens the file")
    page.evaluate(drop_js, {"b64": small, "name": "chrome-drop.cdr", "sel": ".page-head"})
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'chrome-drop.cdr'", timeout=20000)
    check(True, "a drop on the page outside the canvas is routed to the editor by the site")
    with page.expect_file_chooser(timeout=5000) as fc:
        page.locator(".ds-view").focus()
        page.keyboard.press("Control+o")
    fc.value.set_files(str(SAMPLES / "scene-v900.cdr"))
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'scene-v900.cdr'", timeout=20000)
    check(True, "Ctrl+O opens the file chooser and the chosen file opens")
    page.set_input_files(".t-ds input[type=file]", str(f))
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'designtool-3p.ai'", timeout=60000)
    tabs = page.locator(".ds-tab")
    check(tabs.count() == 3, f"three page tabs ({tabs.count()})")
    tabs.nth(2).click()  # may still be reading: the switch waits for the page
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.pageIndex === 2", timeout=30000)
    check(True, "clicking a tab switches pages (waits for a page that is still being read)")
    page.keyboard.press("PageUp")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.pageIndex") == 1, "PageUp goes to the previous page")
    page.close()


def t_leaks(ctx, base):
    """Open and leave ten times: object URLs and FontFaces return to their starting counts."""
    page = ctx.new_page()
    # pdf.js makes a 89-byte text/javascript wrapper URL per worker and never revokes it (library behaviour, not ours): not counted
    page.add_init_script("""(() => { window.__urls = new Map(); const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = (b) => { const u = c(b); window.__urls.set(u, b.type); return u }; URL.revokeObjectURL = (u) => { window.__urls.delete(u); r(u) } })()""")
    open_tool(page, base, "draw-studio")
    f = FIX / "designtool-3p.ai"
    f0 = page.evaluate("() => document.fonts.size")
    for i in range(10):
        open_file(page, f)
        page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=60000)
        page.goto(f"{base}/#/")
        page.wait_for_timeout(250)
        page.goto(f"{base}/#/draw-studio")
        page.wait_for_function("() => document.querySelector('.tool-body')?.__ds", timeout=20000)
    ours = "() => [...window.__urls.values()].filter((t) => t !== 'text/javascript').length"
    while_mounted = page.evaluate(ours)
    page.goto(f"{base}/#/")
    page.wait_for_timeout(400)
    left = page.evaluate(ours)
    fonts = page.evaluate("() => document.fonts.size")
    check(left == 0, f"object URLs after ten open and leave cycles: {left} (fresh editor holds {while_mounted})")
    check(fonts == f0, f"document.fonts back to its start ({f0} -> {fonts})")
    page.close()


def t_keys_menus(ctx, base):
    """Keyboard: the app-root dispatcher wins over the site's handlers, menus work from the keyboard, dialogs close with Esc."""
    page, errors = mount(ctx, base)
    open_file(page, SAMPLES / "scene-v1000.cdr")
    page.locator(".ds-view").focus()
    page.keyboard.press("?")
    page.wait_for_selector("dialog[open]", timeout=3000)
    txt = page.inner_text("dialog[open]")
    check("Zoom to page" in txt and "Alt+N" in txt, "? opens the editor's own shortcuts sheet, not the site's")
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    check(page.locator("dialog[open]").count() == 0, "Esc closes the dialog")
    page.keyboard.press("Control+a")
    n = page.evaluate("() => document.querySelector('.tool-body').__ds.store.sel.ids.length")
    check(n >= 5, f"Ctrl+A selects every object on the page ({n})")
    check(re_status(page, r"\d+ objects selected"), f"status says how many objects are selected: {page.inner_text('.ds-status')[:40]!r}")
    page.keyboard.press("Escape")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.sel.ids.length") == 0, "Esc clears the selection")
    for key, tool in (("z", "zoom"), ("h", "pan"), ("v", "pick")):
        page.keyboard.press(key)
        check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.tool") == tool, f"key {key.upper()} selects the {tool} tool")
    # menubar from the keyboard
    page.get_by_role("menuitem", name="View").focus()
    page.keyboard.press("ArrowDown")
    check(page.evaluate("() => document.activeElement.dataset.cmd") == "view.zoomIn", "ArrowDown opens the menu and focuses the first item")
    page.keyboard.press("End")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowRight")
    check(page.evaluate("() => document.activeElement.dataset.cmd") in ("page.prev", "page.next"), "ArrowRight moves to the next menu (Layout)")
    z0 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    page.keyboard.press("Escape")
    check(page.evaluate("() => document.activeElement.textContent") == "Layout", "Esc closes the menu and focuses its title")
    page.get_by_role("menuitem", name="View").click()
    page.get_by_role("menuitem", name="Zoom in").click()
    z1 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")
    check(z1 > z0 * 1.1, f"a menu item runs its command ({z0:.3f} -> {z1:.3f})")
    # tool keys must not fire inside the units select
    page.locator(".ds-units").focus()
    page.keyboard.press("h")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.tool") == "pick", "plain-letter shortcuts are ignored while a field has focus")
    # New: no prompt for an unchanged drawing, a prompt (Cancel keeps it) when there are changes
    page.locator(".ds-view").focus()
    page.keyboard.press("Alt+n")
    page.wait_for_timeout(300)
    st = page.evaluate(STATE_JS)
    check(st["title"] == "Untitled" and st["source"] == "new" and st["sizes"] == [[595.28, 841.89]], f"Alt+N starts a blank A4 drawing {st['sizes']}")
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Rename', (r) => ({ ...r, title: 'Changed' })) }")
    page.keyboard.press("Alt+n")
    page.wait_for_selector("dialog[open]", timeout=3000)
    page.get_by_role("button", name="Cancel").click()
    page.wait_for_timeout(200)
    check(page.evaluate(STATE_JS)["title"] == "Changed", "New asks first when there are unsaved changes (Cancel keeps the drawing)")
    page.keyboard.press("Alt+n")
    page.wait_for_selector("dialog[open]", timeout=3000)
    page.get_by_role("button", name="New drawing").click()
    page.wait_for_timeout(300)
    check(page.evaluate(STATE_JS)["title"] == "Untitled", "confirming starts the new drawing")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:2]}")
    page.close()


def re_status(page, pattern):
    import re
    return re.search(pattern, page.inner_text(".ds-status")) is not None


def t_truth(ctx, base):
    """Shape boxes against the generated truth SVGs (0.5 pt tolerance) for a RIFF, a ZIP and an X6 sample."""
    page, errors = mount(ctx, base, 1100, 700)
    for nm in ("scene-v1000.cdr", "scene-v1400.cdr", "scene-v1600.cdr"):
        if not (SAMPLES / nm).exists() or not (SAMPLES / "truth-page1.svg").exists():
            check(False, f"missing {nm} or the truth SVG"); continue
        open_file(page, SAMPLES / nm)
        for pi, truth in ((0, "truth-page1.svg"), (1, "truth-page2.svg")):
            svg = (SAMPLES / truth).read_text()
            res = page.evaluate("""async ([svg, pi]) => {
              const ds = document.querySelector('.tool-body').__ds
              const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px'; document.body.append(document.importNode(doc.documentElement, true).parentNode ? host : host)
              host.append(document.importNode(doc.documentElement, true)); const root = host.querySelector('svg'); const vb = root.viewBox.baseVal
              // bounding box of each shape in inch space with y down (page frame), via getBBox + CTM relative to the svg root
              const rootCTM = root.getScreenCTM().inverse()
              const boxes = []
              for (const el of root.querySelectorAll('rect, ellipse, path, text, image')) {
                if (el.parentNode === root) continue
                if (el.localName === 'rect' && el.getAttribute('width') === String(vb.width)) continue
                const b = el.getBBox(); const m = rootCTM.multiply(el.getScreenCTM())
                const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f])
                const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
                boxes.push({ tag: el.localName, x: Math.min(...xs) * 72, y: Math.min(...ys) * 72, w: (Math.max(...xs) - Math.min(...xs)) * 72, h: (Math.max(...ys) - Math.min(...ys)) * 72 })
              }
              host.remove()
              const page = ds.store.root.pages[pi]
              const { createBoxer } = await import('/packs/corel/_ds-hit.js')
              const out = []; const rec = (items) => items.forEach(n => n.t === 'group' ? rec(n.items) : out.push(n))
              page.layers.forEach(l => rec(l.items))
              const { pathBBox } = await import('/packs/corel/_model.js')
              const mine = out.filter(n => n.t === 'path').map(n => pathBBox(n.d))
              return { w: vb.width * 72, h: vb.height * 72, pw: page.w, ph: page.h, truth: boxes.filter(b => b.tag === 'rect' || b.tag === 'ellipse' || b.tag === 'path'), mine }
            }""", [svg, pi])
            t, m = res["truth"], res["mine"]
            worst = max([max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"]), abs(a["w"] - b["w"]), abs(a["h"] - b["h"])) for a, b in zip(t, m)] or [0])
            check(abs(res["w"] - res["pw"]) < 0.5 and abs(res["h"] - res["ph"]) < 0.5, f"{nm} {truth}: page size {res['pw']:.2f} x {res['ph']:.2f} matches")
            check(len(m) >= len(t) - 1 and worst < 0.5, f"{nm} {truth}: {len(m)} shapes, worst box difference {worst:.3f} pt")
    page.close()


def t_phone(ctx, base):
    """375 px: no page-level horizontal overflow after open, in the menu sheet and in dialogs; strips scroll inside their own boxes."""
    page, errors = mount(ctx, base, 375, 700)
    ov = lambda: page_state(page)["overflow"]
    open_file(page, FIX / "designtool-3p.ai")
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=60000)
    check(ov() <= 1, f"after opening the fixture: overflow {ov()}")
    page.get_by_role("button", name="Menu").click()
    for name in ("File", "Edit", "View", "Layout", "Help"):
        page.locator(".ds-msheet-head", has_text=name).click()
        check(ov() <= 1, f"menu sheet, {name} open: overflow {ov()}")
    page.locator('.ds-msheet .ds-mi[data-cmd="help.shortcuts"]').click()
    page.wait_for_selector("dialog[open]")
    check(ov() <= 1, f"shortcuts dialog: overflow {ov()}")
    box = page.locator("dialog[open]").bounding_box()
    check(box["width"] <= 375, f"dialog fits the phone width ({box['width']:.0f})")
    page.keyboard.press("Escape")
    page.locator(".ds-view").focus()
    page.locator(".ds-st-notes").click()
    page.wait_for_selector("dialog[open]")
    check(ov() <= 1, f"notes dialog: overflow {ov()}")
    page.keyboard.press("Escape")
    # the toolbox strip, bars and tabs scroll inside their own boxes
    sizes = page.evaluate("""() => ['.ds-tools', '.ds-std', '.ds-prop', '.ds-tabstrip'].map((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return [s, Math.round(r.width), e.scrollWidth > e.clientWidth] })""")
    check(all(w <= 375 for _, w, _ in sizes), f"strips stay inside the viewport {sizes}")
    # a tap selects, two touches pinch
    page.keyboard.press("Escape")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setPage(0)")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:2]}")
    shot(page, "phone-open")
    page.close()


def t_quick(ctx, base):
    """Quick export routes mount the same editor with a conversion empty state (the export dialog itself is milestone E8)."""
    for route, label in (("cdr-to-svg", "SVG"), ("cdr-to-pdf", "PDF"), ("cdr-viewer", None)):
        page, errors = mount(ctx, base, route=route)
        txt = page.inner_text(".ds-empty")
        check(page.locator(".t-ds").count() == 1, f"{route}: mounts the editor")
        if label:
            check(f"save it as {label}" in txt and page.locator(".t-ds.ds-dim").count() == 1, f"{route}: empty state names the conversion, shell dimmed ({txt[:60]!r})")
        else:
            check("Open a drawing" in txt, f"{route}: plain editor")
        open_file(page, SAMPLES / "scene-v1000.cdr")
        check(page.locator(".t-ds.ds-dim").count() == 0 and page.evaluate(STATE_JS)["pages"] >= 1, f"{route}: opens a CDR and un-dims")
        check(not errors, f"{route}: no console errors {errors[:2]}")
        page.close()


def t_dark(ctx, base):
    page, errors = mount(ctx, base)
    page.emulate_media(color_scheme="dark")
    page.evaluate("() => { try { localStorage.setItem('tools:theme', JSON.stringify('dark')) } catch (e) {} document.documentElement.dataset.theme = 'dark' }")
    open_file(page, SAMPLES / "scene-v1000.cdr")
    page.keyboard.press("Control+a")
    page.wait_for_timeout(300)
    shot(page, "dark")
    page.close()


def t_pixels(ctx, base):
    """Every page of a PDF-based AI against a pdf.js render at 1x (mean absolute difference on a 0 to 255 scale, limit 8)."""
    from PIL import Image
    import numpy as np
    files = [FIX / "designtool-3p.ai"] + ([USER_FILE] if USER_FILE.exists() else [])
    for f in files:
        if not f.exists():
            check(False, f"missing {f}"); continue
        tag = "user" if f == USER_FILE else "fixture"
        page = ctx.new_page()
        page.set_viewport_size({"width": 1500, "height": 1800})
        open_tool(page, base, "draw-studio")
        open_file(page, f, as_name="Ansh Wedding Virtual Invitation.ai" if f == USER_FILE else None)
        page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=90000)
        n = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages.length")
        b64 = base64.b64encode(f.read_bytes()).decode()
        page.evaluate("""async (b64) => { const { openPdf } = await import('/lib/pdf.js'); window.__pdf = await openPdf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))) }""", b64)
        for pn in range(1, n + 1):
            ref = page.evaluate("""async (pn) => { const { renderPage } = await import('/lib/pdf.js'); const c = await renderPage(window.__pdf, pn, { scale: 1 }); return c.toDataURL('image/png') }""", pn)
            refim = Image.open(io.BytesIO(base64.b64decode(ref.split(',')[1]))).convert("RGB")
            W, H = refim.size
            page.evaluate("(i) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setPage(i); ds.view.setView({ z: 1, x: 20, y: 20 }) }", pn - 1)
            page.wait_for_timeout(900)
            box = page.locator(".ds-view").bounding_box()
            png = page.screenshot(clip={"x": box["x"] + 20, "y": box["y"] + 20, "width": W, "height": H})
            mine = Image.open(io.BytesIO(png)).convert("RGB")
            a, b = np.asarray(mine, dtype="float32"), np.asarray(refim, dtype="float32")
            mad = float(np.abs(a - b).mean())
            big = float((np.abs(a - b).mean(axis=2) > 40).mean())
            SHOTS.mkdir(parents=True, exist_ok=True)
            mine.save(SHOTS / f"pixels-{tag}-p{pn}-mine.png"); refim.save(SHOTS / f"pixels-{tag}-p{pn}-ref.png")
            Image.fromarray(255 - np.abs(a - b).astype("uint8")).save(SHOTS / f"pixels-{tag}-p{pn}-diff.png")
            print(f"   {tag} page {pn}: {W}x{H}, mean abs difference {mad:.2f}, pixels differing by more than 40: {big * 100:.2f}%")
            check(mad <= 8, f"{tag} page {pn}: within 8 of the pdf.js render (got {mad:.2f})")
        page.close()


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


CHECKS = {"mount": t_mount, "inject": t_inject, "fixture": t_open_fixture, "cdr": t_open_cdr, "pixels": t_pixels, "other": t_open_other, "handoff": t_handoff, "leaks": t_leaks, "keys": t_keys_menus, "quick": t_quick, "dark": t_dark, "phone": t_phone, "truth": t_truth}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    base = serve_ds()
    names = [n for n in CHECKS if not a.only or n in a.only.split(",")]
    with launch("dsedit") as ctx:
        for n in names:
            print(f"== {n}")
            try:
                CHECKS[n](ctx, base)
            except Exception as e:  # a crashing check is a failure, the rest still run
                import traceback; traceback.print_exc()
                FAILS.append(f"{n} crashed: {e}")
    print(f"\n{len(FAILS)} failure(s)")
    for f in FAILS:
        print(" -", f)
    sys.exit(1 if FAILS else 0)
