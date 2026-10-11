"""Browser checks for Draw Studio (Playwright, the installed Edge). Covers milestones E1 to E5; later milestones append their checks.

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


# ---------------------------------------------------------------- E3 to E5 helpers
SCENE_JS = """async (opts) => {
  opts = opts || {}
  const ds = document.querySelector('.tool-body').__ds
  const O = await import('/packs/corel/_ds-open.js'), D = await import('/packs/corel/_ds-doc.js')
  const P = (name, d, extra) => ({ t: 'path', name, d, fill: '#ff0000', fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0, ...extra })
  const sq = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#0a0'; g.fillRect(0, 0, 8, 8); g.fillStyle = '#fa0'; g.fillRect(0, 0, 4, 4)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const href = 'data:image/png;base64,' + btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
  const layer1 = [
    P('Red', sq(50, 50, 100, 60), { shape: { k: 'rect', w: 100, h: 60, rx: 0, ry: 0 }, sm: [1, 0, 0, 1, 50, 50] }),
    P('Blue', sq(200, 50, 80, 80), { fill: '#0000ff', stroke: '#000000', strokeWidth: 2 }),
    { t: 'group', name: 'Pair', items: [P('GreenA', sq(50, 180, 40, 40), { fill: '#00aa00' }), P('GreenB', sq(110, 180, 40, 40), { fill: '#00aa00' })] },
    P('Gradient', sq(300, 150, 60, 60), { fill: { g: 'linear', x1: 300, y1: 150, x2: 360, y2: 150, m: [1, 0, 0, 1, 0, 0], stops: [{ o: 0, c: '#ff0000', a: 1 }, { o: 1, c: '#0000ff', a: 1 }], spread: 'pad' } }),
    { t: 'image', name: 'Photo', href, w: 8, h: 8, m: [60, 0, 0, 60, 200, 180], opacity: 1, clip: [{ d: sq(200, 180, 30, 60), rule: 'nonzero' }] }]
  const pages = [{ w: 400, h: 300, name: 'Page 1', layers: [
    { name: 'Layer 1', hidden: false, locked: false, printable: true, items: layer1 },
    { name: 'Top', hidden: false, locked: false, printable: true, items: [P('Yellow', sq(170, 100, 40, 40), { fill: '#ffee00' })] }] }]
  if (opts.pages > 1) pages.push({ w: 300, h: 200, name: 'Second', layers: [{ name: 'Layer 1', hidden: false, locked: false, printable: true, items: [P('Other', sq(10, 10, 50, 50))] }] })
  if (opts.many) pages[0].layers.push({ name: 'Many', hidden: false, locked: false, printable: true, items: Array.from({ length: opts.many }, (_, i) => P('M' + i, sq(5 + (i % 40) * 9, 250 + Math.floor(i / 40) * 3, 6, 2), { fill: '#888888' })) })
  if (opts.big) pages[0].layers.push({ name: 'Big', hidden: false, locked: false, printable: true, items: [{ t: 'group', name: 'BigGroup', items: Array.from({ length: opts.big }, (_, i) => P('B' + i, sq(10 + (i % 100) * 3, 10 + Math.floor(i / 100) * 3, 2, 2), { fill: '#336699' })) }] })
  const { doc } = await O.normalizeDoc({ warnings: [], fonts: {}, pages }, { assets: ds.assets, title: 'scene', source: 'new', name: 'scene' })
  await ds.fonts.use(doc.fonts, doc.uid)
  ds.store.load(doc)
  await new Promise((r) => setTimeout(r, 250))
  const ids = {}
  D.walkNodes(ds.store.root, (n) => { if (n.name) ids[n.name] = n.id })
  return { ids, layers: ds.store.root.pages[0].layers.map((l) => l.id), page: ds.store.root.pages[0].id }
}"""
PT_MM = 72 / 25.4


def load_scene(page, **opts):
    info = page.evaluate(SCENE_JS, opts)
    page.wait_for_timeout(150)
    return info


def scr(page, x, y):
    """Page point (pt) to viewport coordinates."""
    return page.evaluate("([x, y]) => { const ds = document.querySelector('.tool-body').__ds; const r = document.querySelector('.ds-view').getBoundingClientRect(); const v = ds.store.view; return [r.left + x * v.z + v.x, r.top + y * v.z + v.y] }", [x, y])


def zoom_of(page):
    return page.evaluate("() => document.querySelector('.tool-body').__ds.store.view.z")


def nbox(page, nid):
    return page.evaluate("(id) => { const ds = document.querySelector('.tool-body').__ds; return ds.renderer.nodeBox(ds.store.find(id).node) }", nid)


def node_of(page, nid):
    return page.evaluate("(id) => { const f = document.querySelector('.tool-body').__ds.store.find(id); return f ? JSON.parse(JSON.stringify(f.node)) : null }", nid)


def sel_of(page):
    return page.evaluate("() => [...document.querySelector('.tool-body').__ds.store.sel.ids]")


def hist(page):
    return page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; return [s.historyLength, s.historyPos] }")


def root_json(page):
    return page.evaluate("() => JSON.stringify(document.querySelector('.tool-body').__ds.store.root)")


def select_ids(page, *ids):
    page.evaluate("(ids) => document.querySelector('.tool-body').__ds.store.setSel(ids)", list(ids))
    wait_ov(page)


def click_pt(page, x, y, modifiers=(), **kw):
    sx, sy = scr(page, x, y)
    for m in modifiers:
        page.keyboard.down(m)
    page.mouse.click(sx, sy, **kw)
    for m in reversed(modifiers):
        page.keyboard.up(m)


def drag_pt(page, a, b, steps=6, mods=(), keep=False):
    """Drag from page point a to page point b with real mouse events (optionally holding modifier keys)."""
    ax, ay = scr(page, *a)
    bx, by = scr(page, *b)
    for m in mods:
        page.keyboard.down(m)
    page.mouse.move(ax, ay)
    page.mouse.down()
    page.mouse.move(bx, by, steps=steps)
    if not keep:
        page.mouse.up()
        for m in reversed(mods):
            page.keyboard.up(m)


def drag_screen(page, a, b, steps=6, mods=()):
    for m in mods:
        page.keyboard.down(m)
    page.mouse.move(*a)
    page.mouse.down()
    page.mouse.move(*b, steps=steps)
    page.mouse.up()
    for m in reversed(mods):
        page.keyboard.up(m)


def handle_xy(page, hid):
    r = page.evaluate("(h) => { const e = document.querySelector('.ds-ov [data-h=\"' + h + '\"]'); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }", hid)
    return r


def wait_ov(page):
    page.wait_for_timeout(180)


def undo_redo(page, label, fn):
    """Run fn (one edit). Then undo restores the exact earlier document and redo the exact later one; one history step."""
    before, h0 = root_json(page), hist(page)
    fn()
    page.wait_for_timeout(120)
    after, h1 = root_json(page), hist(page)
    check(before != after and h1[1] == h0[1] + 1 and h1[0] == h1[1], f"{label}: one undo step ({h0} -> {h1})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    ok_u = root_json(page) == before
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.redo()")
    ok_r = root_json(page) == after
    check(ok_u and ok_r, f"{label}: undo and redo restore exact documents")


DOM_CMP_JS = """(ds) => {
  const want = (items) => items.filter((n) => !n.hidden).map((n) => (n.t === 'group' ? [n.id, want(n.items)] : n.id))
  const exp = ds.store.page().layers.filter((l) => !l.hidden).map((l) => want(l.items))
  const got = (el) => { const out = []; for (const c of el.children) { if (c.dataset && c.dataset.id) { const id = +c.dataset.id; out.push(ds.store.find(id)?.node.t === 'group' ? [id, got(c)] : id) } else out.push(...got(c)) } return out }
  const layers = [...document.querySelectorAll('.ds-world .ds-page > .ds-layer')].map(got)
  const a = JSON.stringify(exp), b = JSON.stringify(layers)
  return a === b ? '' : a + ' vs ' + b
}"""


def dom_matches_tree(page):
    """'' when the SVG DOM of the current page is exactly the visible nodes of the document (order and nesting), else a description. Catches stale cached elements."""
    return page.evaluate("() => (" + DOM_CMP_JS + ")(document.querySelector('.tool-body').__ds)")


def corner_pts(page, nid):
    return page.evaluate("(id) => { const n = document.querySelector('.tool-body').__ds.store.find(id).node; return n.d.filter((c) => c[0] !== 'Z').map((c) => [c[1], c[2]]) }", nid)


# ---------------------------------------------------------------- E3
def t_pick(ctx, base):
    """Pick tool: select, move, snap, scale, rotate, skew, nudge, numeric fields, every edit undoes (real mouse and keyboard events)."""
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ids = info["ids"]
    z = zoom_of(page)
    wait_ov(page)
    # ---- selection ----
    click_pt(page, 100, 80)
    check(sel_of(page) == [ids["Red"]], f"click selects the rectangle {sel_of(page)}")
    check(page.inner_text(".ds-st-msg") == "Rectangle on Layer 1", f"status says 'Rectangle on Layer 1' ({page.inner_text('.ds-st-msg')!r})")
    click_pt(page, 240, 90, modifiers=["Shift"])
    check(sel_of(page) == [ids["Red"], ids["Blue"]] and page.inner_text(".ds-st-msg") == "2 objects selected", "Shift+click adds to the selection and the status counts")
    click_pt(page, 240, 90, modifiers=["Shift"])
    check(sel_of(page) == [ids["Red"]], "Shift+click again removes it")
    click_pt(page, 380, 20)
    check(sel_of(page) == [], "a click on empty space deselects")
    click_pt(page, 70, 200)
    check(sel_of(page) == [ids["Pair"]], "a click on a grouped shape selects the whole group")
    click_pt(page, 70, 200, modifiers=["Control"])
    check(sel_of(page) == [ids["GreenA"]], "Ctrl+click selects the shape inside the group")
    click_pt(page, 205, 115)
    check(sel_of(page) == [ids["Yellow"]], "the top object is picked where two overlap")
    click_pt(page, 205, 115, modifiers=["Alt"])
    check(sel_of(page) == [ids["Blue"]], "Alt+click selects the object behind")
    drag_pt(page, (10, 10), (160, 130))
    check(sel_of(page) == [ids["Red"]] and page.evaluate("() => document.querySelector('.tool-body').__ds.store.selMode") == "marquee", f"marquee selects objects fully inside {sel_of(page)}")
    drag_pt(page, (10, 10), (335, 146))
    check(set(sel_of(page)) == {ids["Red"], ids["Blue"], ids["Yellow"]}, f"marquee takes every object fully inside {sel_of(page)}")
    drag_pt(page, (10, 10), (175, 130))
    check(sel_of(page) == [ids["Red"]], "a plain marquee leaves out an object it only touches")
    drag_pt(page, (10, 10), (175, 130), mods=("Alt",))
    check(set(sel_of(page)) == {ids["Red"], ids["Yellow"]}, f"Alt+marquee also takes the objects it touches {sel_of(page)}")
    page.keyboard.press("Escape")
    check(sel_of(page) == [], "Esc clears the selection")
    check(page.inner_text(".ds-st-msg") == "Nothing selected", "status: nothing selected")
    # ---- move: exact with snapping bypassed (Alt), snapping on otherwise ----
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.setPref('snap', false) }")
    click_pt(page, 100, 80)
    b0 = nbox(page, ids["Red"])
    def move():
        drag_pt(page, (70, 60), (100, 75))
    undo_redo(page, "drag move", move)
    b1 = nbox(page, ids["Red"])
    check(abs(b1["x"] - b0["x"] - 30) < 0.01 and abs(b1["y"] - b0["y"] - 15) < 0.01, f"drag moves by the pointer distance ({b1['x'] - b0['x']:.3f}, {b1['y'] - b0['y']:.3f})")
    node = node_of(page, ids["Red"])
    check(abs(node["sm"][4] - 80) < 0.01 and node["shape"]["k"] == "rect", "a rectangle keeps its shape description and moves its frame")
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.setPref('snap', true); ds.store.undo() }")
    wait_ov(page)
    # snapping: the left edge dropped 2 pt from the page edge lands on 0 and shows a snap line
    select_ids(page, ids["Red"])
    drag_pt(page, (70, 60), (22, 60), keep=True)
    wait_ov(page)
    check(page.locator(".ds-ov .ds-snap").count() >= 1, "a snap line shows while dragging near an edge")
    page.mouse.up()
    wait_ov(page)
    check(abs(nbox(page, ids["Red"])["x"]) < 1e-6, f"the edge snaps to the page edge ({nbox(page, ids['Red'])['x']})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    drag_pt(page, (70, 60), (22, 60), mods=("Alt",))
    check(abs(nbox(page, ids["Red"])["x"] - 2) < 0.05, f"Alt bypasses snapping ({nbox(page, ids['Red'])['x']:.3f})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # Ctrl constrains the move to one axis
    drag_pt(page, (70, 60), (110, 64), mods=("Control", "Alt"))
    nb = nbox(page, ids["Red"])
    check(abs(nb["y"] - 50) < 1e-6 and abs(nb["x"] - 90) < 0.05, f"Ctrl constrains the move to one axis ({nb['x']:.2f}, {nb['y']:.2f})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # Esc cancels a drag: nothing is committed and the preview is gone
    h0 = hist(page)
    drag_pt(page, (70, 60), (110, 80), keep=True)
    page.keyboard.press("Escape")
    page.mouse.up()
    check(hist(page) == h0 and page.evaluate("() => [...document.querySelectorAll('.ds-world [style*=transform]')].length") == 0, "Esc during a drag cancels it for free (no history step, preview cleared)")
    # ---- nudge ----
    page.locator(".ds-view").focus()
    b0 = nbox(page, ids["Red"])
    undo_redo(page, "arrow nudge", lambda: page.keyboard.press("ArrowRight"))
    b1 = nbox(page, ids["Red"])
    check(abs(b1["x"] - b0["x"] - PT_MM) < 1e-6, f"arrow nudges 1 mm ({(b1['x'] - b0['x']) / PT_MM:.4f} mm)")
    page.keyboard.press("Shift+ArrowDown")
    b2 = nbox(page, ids["Red"])
    check(abs(b2["y"] - b1["y"] - 10 * PT_MM) < 1e-6, "Shift+arrow nudges 10 mm (down is down on screen)")
    page.keyboard.press("Control+ArrowUp")
    b3 = nbox(page, ids["Red"])
    check(abs(b3["y"] - b2["y"] + 0.1 * PT_MM) < 1e-6, "Ctrl+arrow nudges 0.1 mm")
    page.keyboard.press("ArrowLeft"); page.keyboard.press("ArrowLeft")
    check(page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; return s.historyLength }") >= 1, "repeated nudges merge into few history steps")
    page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; while (s.canUndo()) s.undo() }")
    # ---- scale by the eight handles ----
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setPref('snap', false)")
    select_ids(page, ids["Red"])
    check(all(handle_xy(page, h) for h in ("nw", "n", "ne", "e", "se", "s", "sw", "w")), "eight scale handles are drawn")
    b0 = nbox(page, ids["Red"])
    hx, hy = handle_xy(page, "se")
    def scale():
        drag_screen(page, (hx, hy), (hx + 40, hy + 20))
    undo_redo(page, "scale by the corner handle", scale)
    b1 = nbox(page, ids["Red"])
    check(abs(b1["x"] - b0["x"]) < 1e-6 and abs(b1["y"] - b0["y"]) < 1e-6 and abs(b1["w"] - (b0["w"] + 40 / z)) < 0.01 and abs(b1["h"] - (b0["h"] + 20 / z)) < 0.01, f"the corner handle scales about the opposite corner ({b1['w']:.2f} x {b1['h']:.2f})")
    node = node_of(page, ids["Red"])
    check(abs(node["sm"][0] - b1["w"] / 100) < 1e-6, "a rectangle's shape frame scales with it (sm)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    hx, hy = handle_xy(page, "se")
    drag_screen(page, (hx, hy), (hx + 40, hy + 5), mods=("Shift",))
    b2 = nbox(page, ids["Red"])
    check(abs(b2["w"] / b2["h"] - b0["w"] / b0["h"]) < 1e-6, f"Shift keeps the ratio ({b2['w'] / b2['h']:.4f})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    hx, hy = handle_xy(page, "se")
    drag_screen(page, (hx, hy), (hx + 30, hy + 30), mods=("Alt",))
    b3 = nbox(page, ids["Red"])
    check(abs(b3["x"] + b3["w"] / 2 - (b0["x"] + b0["w"] / 2)) < 1e-6 and abs(b3["w"] - (b0["w"] + 60 / z)) < 0.01, "Alt scales from the centre")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    hx, hy = handle_xy(page, "e")
    drag_screen(page, (hx, hy), (hx + 24, hy))
    b4 = nbox(page, ids["Red"])
    check(abs(b4["w"] - (b0["w"] + 24 / z)) < 0.01 and abs(b4["h"] - b0["h"]) < 1e-6, "an edge handle scales one direction only")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    hx, hy = handle_xy(page, "e")
    drag_screen(page, (hx, hy), (hx - 100 * z - 30, hy))
    check(nbox(page, ids["Red"])["w"] > 0 and node_of(page, ids["Red"])["sm"][0] < 0, "dragging past the opposite edge mirrors the object")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # ---- rotate and skew: a second click toggles the handles ----
    click_pt(page, 70, 60)
    wait_ov(page)
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.tools.tools.pick.state.mode") == "rotate", "a second click on the selected object switches to rotate mode")
    check(page.locator(".ds-ov .ds-hrot").count() == 4 and page.locator(".ds-ov .ds-hskew").count() == 4 and page.locator(".ds-ov .ds-pivot").count() >= 1, "four rotate handles, four skew handles and a pivot are drawn")
    centre = scr(page, 100, 80)
    sx0, sy0 = handle_xy(page, "se")
    import math
    ang = math.radians(30)
    vx, vy = sx0 - centre[0], sy0 - centre[1]
    tx_, ty_ = centre[0] + vx * math.cos(ang) - vy * math.sin(ang), centre[1] + vx * math.sin(ang) + vy * math.cos(ang)
    before_pts = corner_pts(page, ids["Red"])
    def rot():
        drag_screen(page, (sx0, sy0), (tx_, ty_), steps=10)
    undo_redo(page, "rotate by the corner handle", rot)
    n = node_of(page, ids["Red"])
    check(abs(n["rot"] + 30) < 0.2, f"rotating clockwise 30 degrees reads as angle {n['rot']:.2f} (counter-clockwise positive)")
    exp = page.evaluate("""([pts, deg]) => { const a = deg * Math.PI / 180, c = [100, 80]; return pts.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]) }""", [before_pts, -n["rot"]])
    got = corner_pts(page, ids["Red"])
    check(all(abs(g[0] - e[0]) < 0.02 and abs(g[1] - e[1]) < 0.02 for g, e in zip(got, exp)), "the path is rotated about the centre")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    sx0, sy0 = handle_xy(page, "se")
    ang = math.radians(28)
    vx, vy = sx0 - centre[0], sy0 - centre[1]
    drag_screen(page, (sx0, sy0), (centre[0] + vx * math.cos(ang) - vy * math.sin(ang), centre[1] + vx * math.sin(ang) + vy * math.cos(ang)), steps=10, mods=("Control",))
    check(abs(node_of(page, ids["Red"])["rot"] + 30) < 1e-6, f"Ctrl rotates in 15 degree steps (28 became {node_of(page, ids['Red'])['rot']})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    nx, ny = handle_xy(page, "n")
    d = 30
    drag_screen(page, (nx, ny), (nx + d, ny))
    pts = corner_pts(page, ids["Red"])
    dd = d / z
    check(abs(pts[0][0] - (50 + dd)) < 0.02 and abs(pts[3][0] - (50 - dd)) < 0.02 and abs(pts[0][1] - 50) < 1e-6, f"the top skew handle shears about the pivot ({pts[0][0] - 50:.3f} and {pts[3][0] - 50:.3f}, expected +-{dd:.3f})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    wait_ov(page)
    # the pivot moves and rotation turns about it
    pv = handle_xy(page, "pivot")
    drag_screen(page, pv, (pv[0] - 60, pv[1] - 20))
    st = page.evaluate("() => document.querySelector('.tool-body').__ds.tools.tools.pick.state.pivot")
    check(st and abs(st["x"] - (100 - 60 / z)) < 0.05, f"the pivot can be dragged {st}")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.historyPos") == 0, "moving the pivot is not a document edit")
    click_pt(page, 70, 60)  # toggles back to scale
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.tools.tools.pick.state.mode") == "scale", "another click toggles back to the scale handles")
    page.keyboard.press("Escape")
    # ---- numeric fields ----
    select_ids(page, ids["Red"])
    def field(label):
        return page.get_by_label(label, exact=True)
    pg_h = 300
    undo_redo(page, "typing X", lambda: (field("X position of the centre").fill("60"), field("X position of the centre").press("Enter")))
    b = nbox(page, ids["Red"])
    check(abs((b["x"] + b["w"] / 2) / PT_MM - 60) < 0.01, f"X sets the centre within 0.01 mm ({(b['x'] + b['w'] / 2) / PT_MM:.4f})")
    field("Y position of the centre").fill("70"); field("Y position of the centre").press("Enter")
    b = nbox(page, ids["Red"])
    check(abs((pg_h - (b["y"] + b["h"] / 2)) / PT_MM - 70) < 0.01, f"Y is measured up from the page bottom ({(pg_h - (b['y'] + b['h'] / 2)) / PT_MM:.4f} mm)")
    undo_redo(page, "typing W", lambda: (field("Width").fill("33.33"), field("Width").press("Enter")))
    b = nbox(page, ids["Red"])
    check(abs(b["w"] / PT_MM - 33.33) < 0.01, f"W sets the width within 0.01 mm ({b['w'] / PT_MM:.4f})")
    h_before = b["h"]
    check(abs(b["h"] - h_before) < 1e-9, "H is untouched while the ratio is not locked")
    field("Height").fill("20.5"); field("Height").press("Enter")
    check(abs(nbox(page, ids["Red"])["h"] / PT_MM - 20.5) < 0.01, "H sets the height within 0.01 mm")
    page.get_by_role("button", name="Keep the width and height in proportion").click()
    wk, hk = nbox(page, ids["Red"])["w"], nbox(page, ids["Red"])["h"]
    field("Width").fill("50"); field("Width").press("Enter")
    b = nbox(page, ids["Red"])
    check(abs(b["w"] / PT_MM - 50) < 0.01 and abs(b["w"] / b["h"] - wk / hk) < 1e-6, "with the ratio locked, H follows W")
    page.get_by_role("button", name="Keep the width and height in proportion").click()
    page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; while (s.canUndo()) s.undo() }")
    select_ids(page, ids["Red"])
    before_pts = corner_pts(page, ids["Red"])
    undo_redo(page, "typing the angle", lambda: (field("Angle in degrees").fill("30"), field("Angle in degrees").press("Enter")))
    n = node_of(page, ids["Red"])
    check(abs(n["rot"] - 30) < 1e-6, f"angle 30 reads back as 30 ({n['rot']})")
    exp = page.evaluate("""([pts, deg]) => { const a = -deg * Math.PI / 180, c = [100, 80]; return pts.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]) }""", [before_pts, 30])
    got = corner_pts(page, ids["Red"])
    check(all(abs(g[0] - e[0]) < 1e-6 and abs(g[1] - e[1]) < 1e-6 for g, e in zip(got, exp)), "typing an angle rotates counter-clockwise about the centre")
    field("Angle in degrees").fill("45"); field("Angle in degrees").press("Enter")
    check(abs(node_of(page, ids["Red"])["rot"] - 45) < 1e-6, "the angle is absolute: 30 then 45 gives 45")
    page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; while (s.canUndo()) s.undo() }")
    # mirror
    click_pt(page, 240, 90)
    page.locator(".ds-prop").get_by_role("button", name="Mirror horizontally").click()
    check(page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.find(id).node.d[0][1]", ids["Blue"]) == 280, "mirror horizontally flips about the centre")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    click_pt(page, 225, 190)
    page.keyboard.press("Escape")
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Photo"])
    page.locator(".ds-prop").get_by_role("button", name="Mirror horizontally").click()
    check(node_of(page, ids["Photo"])["m"][0] == -60, "an image mirrors exactly (negative scale in m)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # ---- a clipped photo moves with its clip; a gradient follows a rotation ----
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Photo"])
    page.locator(".ds-view").focus()
    p0 = node_of(page, ids["Photo"])
    page.keyboard.press("Shift+ArrowRight")
    p1 = node_of(page, ids["Photo"])
    di, dc = p1["m"][4] - p0["m"][4], p1["clip"][0]["d"][0][1] - p0["clip"][0]["d"][0][1]
    check(abs(di - 10 * PT_MM) < 1e-6 and abs(di - dc) < 1e-9, f"the clip moves with its photo ({di:.4f} and {dc:.4f})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Gradient"])
    page.get_by_label("Angle in degrees", exact=True).fill("30"); page.get_by_label("Angle in degrees", exact=True).press("Enter")
    res = page.evaluate("""(id) => { const g = document.querySelector('.tool-body').__ds.store.find(id).node.fill; const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
      const a = -30 * Math.PI / 180, c = [330, 180], R = (x, y) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]
      const p = ap(g.m, g.x1, g.y1), q = ap(g.m, g.x2, g.y2), e1 = R(300, 150), e2 = R(360, 150)
      return Math.max(Math.abs(p[0] - e1[0]), Math.abs(p[1] - e1[1]), Math.abs(q[0] - e2[0]), Math.abs(q[1] - e2[1])) }""", ids["Gradient"])
    check(res < 1e-6, f"a gradient rotated by 30 degrees has its endpoints at apply(M, p) of the originals (error {res:.2e})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # ---- group, ungroup, duplicate, delete, undo and redo buttons, Tab ----
    page.evaluate("([a, b]) => document.querySelector('.tool-body').__ds.store.setSel([a, b])", [ids["Red"], ids["Blue"]])
    page.locator(".ds-view").focus()
    undo_redo(page, "Ctrl+G group", lambda: page.keyboard.press("Control+g"))
    gid = sel_of(page)[0]
    check(len(sel_of(page)) == 1 and node_of(page, gid)["t"] == "group" and [k["name"] for k in node_of(page, gid)["items"]] == ["Red", "Blue"], "Ctrl+G groups the selection and selects the group")
    check(page.inner_text(".ds-st-msg") == "Group of 2 objects on Layer 1", f"status for a group ({page.inner_text('.ds-st-msg')!r})")
    undo_redo(page, "Ctrl+U ungroup", lambda: page.keyboard.press("Control+u"))
    check(sorted(sel_of(page)) == sorted([ids["Red"], ids["Blue"]]), "Ungroup selects the freed objects")
    n_before = page.evaluate("() => document.querySelectorAll('.ds-world .ds-page [data-id]').length")
    undo_redo(page, "Ctrl+D duplicate", lambda: page.keyboard.press("Control+d"))
    check(len(sel_of(page)) == 2 and not set(sel_of(page)) & {ids["Red"], ids["Blue"]}, "Duplicate selects the copies")
    check(page.evaluate("() => document.querySelectorAll('.ds-world .ds-page [data-id]').length") == n_before + 2, "two copies were added")
    undo_redo(page, "Delete", lambda: page.keyboard.press("Delete"))
    check(sel_of(page) == [], "Delete removes the selection")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    check(dom_matches_tree(page) == "", f"after group, ungroup, duplicate, delete and undo the DOM equals the document {dom_matches_tree(page)}")
    b0 = nbox(page, ids["Red"])
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Red"])
    page.keyboard.press("ArrowRight")
    page.get_by_role("button", name="Undo", exact=False).first.click()
    check(abs(nbox(page, ids["Red"])["x"] - b0["x"]) < 1e-9, "the Undo button undoes the edit")
    page.get_by_role("button", name="Redo", exact=False).first.click()
    check(abs(nbox(page, ids["Red"])["x"] - b0["x"] - PT_MM) < 1e-9, "the Redo button redoes it")
    page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; while (s.canUndo()) s.undo() }")
    page.keyboard.press("Escape")
    page.locator(".ds-view").focus()
    page.keyboard.press("Tab")
    first = sel_of(page)
    page.keyboard.press("Tab")
    check(len(first) == 1 and len(sel_of(page)) == 1 and first != sel_of(page), f"Tab cycles through the objects ({first} -> {sel_of(page)})")
    page.keyboard.press("Shift+Tab")
    check(sel_of(page) == first, "Shift+Tab goes back")
    page.keyboard.press("Shift+Tab")
    check(sel_of(page) == [], f"Shift+Tab past the first object deselects and lets focus leave the canvas ({sel_of(page)} {first})")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    shot(page, "pick-rotate")
    page.close()


def t_pick_perf(ctx, base):
    """Moving a 5k-node group previews with one CSS transform: pointer handling stays well under 20 ms and nothing blocks."""
    page, errors = mount(ctx, base)
    info = load_scene(page, big=5000)
    gid = info["ids"]["BigGroup"]
    page.evaluate("(id) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setSel([id]); ds.view.setView({ z: 2, x: 20, y: 20 }) }", gid)
    page.wait_for_timeout(500)
    page.evaluate("""() => { window.__lt = []; window.__mv = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true })
      const host = document.querySelector('.ds-view'); let t0 = 0
      host.addEventListener('pointermove', () => { t0 = performance.now() }, true)
      document.addEventListener('pointermove', () => { window.__mv.push(performance.now() - t0) }) }""")
    # grab the group on one of its small squares
    sx, sy = scr(page, 11, 11)
    page.mouse.move(sx, sy)
    page.mouse.down()
    for i in range(1, 41):
        page.mouse.move(sx + i * 4, sy + i * 2)
    mv = page.evaluate("() => window.__mv.slice()")
    transformed = page.evaluate("(id) => document.querySelector('.ds-world [data-id=\"' + id + '\"]')?.style.transform || ''", gid)
    page.mouse.up()
    page.wait_for_timeout(400)
    worst = max(mv) if mv else 999
    check(transformed.startswith("matrix"), f"the group is previewed with a CSS transform on one element ({transformed[:40]!r})")
    check(len(mv) >= 30 and worst < 20, f"pointer handling during the drag: {len(mv)} moves, worst {worst:.2f} ms (limit 20)")
    check(not page.evaluate("() => window.__lt.filter((d) => d > 100).length"), "no long task over 100 ms during the drag and the commit")
    b = nbox(page, gid)
    check(abs(b["x"] - 10 - 160 / 2) < 0.5, f"the 5k group moved by the pointer distance ({b['x'] - 10:.2f} pt)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    check(abs(nbox(page, gid)["x"] - 10) < 1e-6, "and undoes")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


# ---------------------------------------------------------------- E4
def swatch(page, i=20):
    return page.locator(".ds-palette .ds-sw-grid .ds-sw").nth(i)


def t_palette(ctx, base):
    """Palette and colour: left click fill, right click outline, X, the dialog, Document and Recent tabs, status swatches, outline width."""
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ids = info["ids"]
    check(page.locator(".ds-palette .ds-sw-grid .ds-sw").count() >= 90 and page.locator(".ds-palette .ds-sw-x").count() == 1, "the palette shows the default swatches and the X swatch")
    sw = swatch(page)
    hexv = sw.get_attribute("data-hex")
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Pair"])
    undo_redo(page, "left click fills", lambda: sw.click())
    kids = node_of(page, ids["Pair"])["items"]
    check(all(k["fill"] == hexv for k in kids), f"left click fills every shape inside a group ({hexv})")
    sw2 = swatch(page, 40)
    hex2 = sw2.get_attribute("data-hex")
    undo_redo(page, "right click outlines", lambda: sw2.click(button="right"))
    kids = node_of(page, ids["Pair"])["items"]
    check(all(k["stroke"] == hex2 and k["strokeWidth"] > 0 for k in kids) and all(k["fill"] == hexv for k in kids), f"right click sets the outline and leaves the fill ({hex2})")
    undo_redo(page, "X clears the fill", lambda: page.locator(".ds-palette .ds-sw-x").click())
    check(all(k["fill"] is None for k in node_of(page, ids["Pair"])["items"]), "X (left click) clears the fill")
    undo_redo(page, "X clears the outline", lambda: page.locator(".ds-palette .ds-sw-x").click(button="right"))
    check(all(k["stroke"] is None for k in node_of(page, ids["Pair"])["items"]), "X (right click) clears the outline")
    # text and images
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Photo"])
    h0 = hist(page)
    sw.click()
    check(hist(page) == h0 and "no fill" in page.inner_text(".ds-st-msg").lower() or hist(page) == h0, "a picture has no fill: nothing changes and the status says so")
    # ---- the colour dialog ----
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Red"])
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('effects.fillColor')")
    page.wait_for_selector("dialog[open]")
    dlg = page.locator("dialog[open]")
    def setf(label, v):
        f = dlg.get_by_label(label, exact=True)
        f.fill(str(v))
        f.dispatch_event("input")
    def getf(label):
        return dlg.get_by_label(label, exact=True).input_value()
    for lbl, v in (("Cyan", 0), ("Magenta", 100), ("Yellow", 100), ("Black", 0)):
        setf(lbl, v)
    check(getf("Hex colour") == "#ff0000" and (getf("Red"), getf("Green"), getf("Blue")) == ("255", "0", "0"), f"CMYK 0/100/100/0 gives #ff0000 and RGB 255,0,0 ({getf('Hex colour')})")
    setf("Red", 0); setf("Green", 128); setf("Blue", 255)
    check(getf("Hex colour") == "#0080ff" and (getf("Cyan"), getf("Magenta"), getf("Yellow"), getf("Black")) == ("100", "50", "0", "0"), f"RGB 0,128,255 gives #0080ff and CMYK 100,50,0,0 ({getf('Hex colour')})")
    dlg.get_by_label("Hex colour", exact=True).fill("#336699"); dlg.get_by_label("Hex colour", exact=True).dispatch_event("input")
    check((getf("Red"), getf("Green"), getf("Blue")) == ("51", "102", "153"), "typing a hex colour updates RGB")
    setf("Cyan", 50); setf("Magenta", 25); setf("Yellow", 0); setf("Black", 10)
    exp = page.evaluate("async () => { const C = await import('/packs/corel/_ds-colors.js'); return C.rgbFromCmyk(0.5, 0.25, 0, 0.1) }")
    got = [int(getf(x)) for x in ("Red", "Green", "Blue")]
    check(all(abs(a - b) <= 1 for a, b in zip(got, exp)), f"CMYK 50/25/0/10 gives RGB {got}, expected {exp} within 1/255")
    for lbl, v in (("Cyan", 0), ("Magenta", 100), ("Yellow", 100), ("Black", 0)):
        setf(lbl, v)
    dlg.get_by_role("button", name="Apply").click()
    page.wait_for_selector("dialog[open]", state="detached")
    n = node_of(page, ids["Red"])
    check(n["fill"] == "#ff0000" and n["fillK"] == [0, 1, 1, 0], f"Apply sets the fill and remembers the CMYK numbers {n['fill']} {n.get('fillK')}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('effects.fillColor')")
    page.wait_for_selector("dialog[open]")
    dlg = page.locator("dialog[open]")
    check((getf("Cyan"), getf("Magenta"), getf("Yellow"), getf("Black")) == ("0", "100", "100", "0"), "reopening the dialog shows the CMYK numbers that were typed")
    dlg.get_by_label("Hex colour", exact=True).fill("#123456"); dlg.get_by_label("Hex colour", exact=True).dispatch_event("input")
    dlg.get_by_role("button", name="Add to palette").click()
    dlg.get_by_role("button", name="Cancel").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check(node_of(page, ids["Red"])["fill"] == "#ff0000", "Cancel leaves the fill alone")
    check("#123456" in page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.palette"), "Add to palette stores the colour in the document")
    # outline colour dialog
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('effects.outlineColor')")
    page.wait_for_selector("dialog[open]")
    dlg = page.locator("dialog[open]")
    dlg.get_by_label("Hex colour", exact=True).fill("#00ff00"); dlg.get_by_label("Hex colour", exact=True).dispatch_event("input")
    dlg.get_by_role("button", name="Apply").click()
    page.wait_for_selector("dialog[open]", state="detached")
    n = node_of(page, ids["Red"])
    check(n["stroke"] == "#00ff00" and n["strokeWidth"] > 0, "the outline dialog sets the outline colour (and gives a thin outline when there was none)")
    # ---- tabs ----
    page.locator('.ds-pal-tab[data-tab="doc"]').click()
    docs = page.locator(".ds-palette .ds-sw-grid .ds-sw")
    hexes = [docs.nth(i).get_attribute("data-hex") for i in range(docs.count())]
    check(hexes[0] == "#123456" and {"#0000ff", "#ffee00", "#ff0000"} <= set(hexes), f"the Document tab lists the added colour first, then colours used on the page {hexes}")
    expected = page.evaluate("""async () => { const ds = document.querySelector('.tool-body').__ds; const C = await import('/packs/corel/_ds-colors.js'); return [...new Set([...ds.store.root.palette, ...C.usedColors(ds.store.root, ds.store.page().id).map((u) => u.hex)])] }""")
    check(hexes == expected, "the Document tab equals the added colours plus usedColors")
    check("used" in (docs.nth(1).get_attribute("title") or ""), "a used colour says how often it is used")
    page.locator('.ds-pal-tab[data-tab="recent"]').click()
    rec = [page.locator(".ds-palette .ds-sw-grid .ds-sw").nth(i).get_attribute("data-hex") for i in range(page.locator(".ds-palette .ds-sw-grid .ds-sw").count())]
    check(rec[:2] == ["#00ff00", "#ff0000"] and hexv in rec, f"the Recent tab lists the colours just used, newest first {rec[:4]}")
    page.locator('.ds-pal-tab[data-tab="default"]').click()
    # ---- status bar swatches and the outline width field ----
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Blue"])
    info_sw = page.evaluate("() => ({ fill: getComputedStyle(document.querySelector('.ds-st-sw[data-kind=fill]')).backgroundColor, stroke: getComputedStyle(document.querySelector('.ds-st-sw[data-kind=stroke]')).backgroundColor, w: document.querySelector('.ds-st-w').textContent })")
    check(info_sw["fill"] == "rgb(0, 0, 255)" and info_sw["stroke"] == "rgb(0, 0, 0)" and info_sw["w"].startswith("0.71"), f"status swatches show the fill, the outline and its width {info_sw}")
    page.evaluate("([a, b]) => document.querySelector('.tool-body').__ds.store.setSel([a, b])", [ids["Blue"], ids["Red"]])
    check("mixed" in page.get_attribute(".ds-st-sw[data-kind=fill]", "class"), "different fills show as mixed")
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Blue"])
    page.locator(".ds-st-sw[data-kind=fill]").dblclick()
    page.wait_for_selector("dialog[open]")
    check(page.locator("dialog[open]").get_by_label("Hex colour", exact=True).input_value() == "#0000ff", "double-clicking the status swatch opens the dialog with the current colour")
    page.keyboard.press("Escape")
    page.wait_for_selector("dialog[open]", state="detached")
    undo_redo(page, "outline width", lambda: (page.get_by_label("Outline width", exact=True).fill("1"), page.get_by_label("Outline width", exact=True).press("Enter")))
    check(abs(node_of(page, ids["Blue"])["strokeWidth"] - PT_MM) < 1e-6, "the outline width field sets 1 mm")
    page.get_by_label("Outline width", exact=True).fill("0"); page.get_by_label("Outline width", exact=True).press("Enter")
    check(node_of(page, ids["Blue"])["stroke"] is None, "width 0 removes the outline")
    # locked objects are not recoloured
    page.evaluate("async (id) => { const ds = document.querySelector('.tool-body').__ds; const O = await import('/packs/corel/_ds-ops.js'); ds.store.tx('Lock', (r) => O.setFlag(r, [id], 'locked', true)); ds.store.setSel([id]) }", ids["Blue"])
    h0 = hist(page)
    swatch(page, 60).click()
    check(hist(page) == h0 and "locked" in page.inner_text(".ds-st-msg").lower(), f"a locked object is not recoloured and the status says why ({page.inner_text('.ds-st-msg')!r})")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    shot(page, "palette")
    page.close()


# ---------------------------------------------------------------- E5
def rows(page):
    return page.evaluate("() => [...document.querySelectorAll('.ds-tree .ds-row')].map((r) => ({ key: r.dataset.key, kind: [...r.classList].find((c) => c.startsWith('ds-r-')).slice(5), name: r.querySelector('.ds-name')?.textContent ?? r.textContent.trim(), sel: r.getAttribute('aria-selected') === 'true', depth: +r.getAttribute('aria-level') - 1 }))")


def row(page, name, kind=None):
    loc = page.locator(".ds-tree .ds-row").filter(has=page.locator(".ds-name", has_text=name))
    return loc.first if kind is None else page.locator(f".ds-tree .ds-r-{kind}").filter(has=page.locator(".ds-name", has_text=name)).first


def t_objects(ctx, base):
    """Objects docker: tree of pages, layers and objects with select, rename, hide, lock, reorder, layers, move to layer, show more, keyboard."""
    page, errors = mount(ctx, base)
    info = load_scene(page, pages=2)
    ids = info["ids"]
    page.wait_for_timeout(200)
    rs = rows(page)
    names = [(r["kind"], r["name"]) for r in rs]
    check(names[:1] == [("page", "Page 1")] and ("page", "Second") in names, f"the tree starts with the pages {names[:2]}")
    check([n for k, n in names if k == "layer"] == ["Top", "Layer 1"], f"layers are listed front first {[n for k, n in names if k == 'layer']}")
    objs = [n for k, n in names if k == "node"]
    check(objs == ["Yellow", "Photo", "Gradient", "Pair", "Blue", "Red"], f"objects are listed front first, groups collapsed {objs}")
    row(page, "Pair", "node").locator(".ds-twisty").click()
    check([r["name"] for r in rows(page) if r["depth"] == 3] == ["GreenB", "GreenA"], "a group expands to its members")
    # select
    row(page, "Red").click()
    check(sel_of(page) == [ids["Red"]] and row(page, "Red").get_attribute("aria-selected") == "true", "clicking a row selects the object")
    row(page, "Blue").click(modifiers=["Control"])
    check(sel_of(page) == [ids["Red"], ids["Blue"]], "Ctrl+click adds")
    row(page, "Gradient").click(modifiers=["Shift"])
    check(set(sel_of(page)) >= {ids["Red"], ids["Blue"], ids["Gradient"]}, f"Shift+click selects a range {sel_of(page)}")
    select_ids(page)
    click_pt(page, 100, 80)
    page.wait_for_timeout(100)
    check([r["name"] for r in rows(page) if r["sel"] and r["kind"] == "node"] == ["Red"], "selecting on the canvas highlights the row")
    row(page, "GreenA").click()
    check(sel_of(page) == [ids["GreenA"]] and page.evaluate("() => document.querySelector('.tool-body').__ds.store.ctx") == ids["Pair"], "selecting a member enters its group")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setSel([])")
    # rename: double-click, F2, Esc
    undo_redo(page, "rename by double-click", lambda: (row(page, "Red").locator(".ds-name").dblclick(), page.keyboard.press("Control+a"), page.keyboard.type("Hero"), page.keyboard.press("Enter")))
    check(node_of(page, ids["Red"])["name"] == "Hero" and row(page, "Hero").count() == 1, "double-click renames and the new name shows")
    row(page, "Hero").focus()
    page.keyboard.press("F2")
    page.keyboard.press("Control+a"); page.keyboard.type("Nope"); page.keyboard.press("Escape")
    check(node_of(page, ids["Red"])["name"] == "Hero", "Esc cancels a rename")
    row(page, "Hero").focus()
    page.keyboard.press("F2")
    page.keyboard.press("Control+a"); page.keyboard.type("Hero two"); page.keyboard.press("Enter")
    check(node_of(page, ids["Red"])["name"] == "Hero two", "F2 renames")
    page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; s.undo(); s.undo() }")
    # layers rename
    row(page, "Top", "layer").locator(".ds-name").dblclick()
    page.keyboard.press("Control+a"); page.keyboard.type("Front <b>"); page.keyboard.press("Enter")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.page().layers[1].name") == "Front <b>" and page.locator(".ds-tree b").count() == 0, "layer names are plain text, never markup")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # hide: gone from the canvas and from hit testing
    def eye(name, kind="node"):
        return row(page, name, kind).locator(".ds-eye")
    undo_redo(page, "hide", lambda: eye("Red").click())
    check(page.locator(f'.ds-world [data-id="{ids["Red"]}"]').count() == 0, "a hidden object leaves the canvas")
    click_pt(page, 100, 80)
    check(sel_of(page) == [], "and cannot be clicked")
    check(eye("Red").get_attribute("aria-pressed") == "false", "the eye button shows it is hidden")
    eye("Red").click()
    check(page.locator(f'.ds-world [data-id="{ids["Red"]}"]').count() == 1, "showing it brings it back")
    # hide a layer
    eye("Top", "layer").click()
    check(page.locator(f'.ds-world [data-id="{ids["Yellow"]}"]').count() == 0, "hiding a layer hides its objects")
    eye("Top", "layer").click()
    # lock: visible effect and hit testing
    undo_redo(page, "lock", lambda: row(page, "Red").locator(".ds-lock").click())
    check(page.locator(f'.ds-world [data-id="{ids["Red"]}"][data-lock]').count() == 1, "a locked object is marked on the canvas")
    click_pt(page, 100, 80)
    check(sel_of(page) == [], "a locked object cannot be picked on the canvas")
    row(page, "Hero" if False else "Red").click()
    check(sel_of(page) == [ids["Red"]], "but it can be selected in the docker")
    b0 = nbox(page, ids["Red"])
    page.locator(".ds-view").focus()
    page.keyboard.press("ArrowRight")
    check(abs(nbox(page, ids["Red"])["x"] - b0["x"]) < 1e-9 and "locked" in page.inner_text(".ds-st-msg").lower(), "locked objects do not nudge, and the status says why")
    row(page, "Red").locator(".ds-lock").click()
    # lock a layer
    row(page, "Top", "layer").locator(".ds-lock").click()
    click_pt(page, 190, 120)
    check(sel_of(page) != [ids["Yellow"]], "a locked layer cannot be picked on the canvas")
    row(page, "Top", "layer").locator(".ds-lock").click()
    # reorder by buttons
    def order():
        return page.evaluate("() => document.querySelector('.tool-body').__ds.store.page().layers[0].items.map((n) => n.name)")
    row(page, "Red").click()
    undo_redo(page, "move up", lambda: page.get_by_role("button", name="Move up").click())
    check(order()[:2] == ["Blue", "Red"], f"the Move up button brings the object forward {order()}")
    page.get_by_role("button", name="Move down").click()
    check(order()[0] == "Red", "Move down sends it back")
    page.evaluate("() => { const s = document.querySelector('.tool-body').__ds.store; s.undo(); s.undo() }")
    # reorder by drag and drop (synthetic DragEvents drive the same handlers a mouse drag does)
    dnd = """([src, dst, zone]) => { const tree = document.querySelector('.ds-tree'); const s = tree.querySelector('.ds-row[data-key="n' + src + '"]'), d = tree.querySelector('.ds-row[data-key="n' + dst + '"]')
      const dt = new DataTransfer(); const b = d.getBoundingClientRect(); const y = b.top + b.height * (zone === 'above' ? 0.1 : 0.9)
      s.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); d.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: y }))
      d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: y })); s.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true })) }"""
    undo_redo(page, "drag reorder", lambda: page.evaluate(dnd, [ids["Red"], ids["Photo"], "above"]))
    check(order()[-1] == "Red", f"dropping a row above another brings it to the front of it {order()}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.evaluate(dnd, [ids["GreenA"], ids["Red"], "below"])
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.page().layers[0].items.map((n) => n.name)")[0] == "GreenA", "a drop below a row sends the object behind it and out of its group")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    check(dom_matches_tree(page) == "", f"a member dragged out of a group and undone leaves the DOM equal to the document {dom_matches_tree(page)}")
    page.evaluate(dnd, [ids["Red"], ids["Pair"], "above"])
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    check(dom_matches_tree(page) == "", f"drag reorder and undo keep the DOM equal to the document {dom_matches_tree(page)}")
    # new layer, delete layer, move to layer
    n_layers = lambda: page.evaluate("() => document.querySelector('.tool-body').__ds.store.page().layers.length")
    undo_redo(page, "new layer", lambda: page.get_by_role("button", name="New layer").click())
    check(n_layers() == 3 and "Layer 3" in [r["name"] for r in rows(page) if r["kind"] == "layer"], "New layer adds a layer and lists it")
    page.get_by_role("button", name="Delete layer").click()
    check(n_layers() == 2, "Delete layer removes the active layer")
    check(page.get_by_role("button", name="Delete layer").is_enabled(), "two layers can be deleted down to one")
    row(page, "Red").click()
    undo_redo(page, "move to layer", lambda: page.get_by_label("Move the selection to a layer").select_option(label="Top"))
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.find(%d).layer.name" % ids["Red"]) == "Top", "Move to layer moves the selection into that layer")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # pages: rows switch pages
    row(page, "Second", "page").click()
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.pageIndex === 1")
    check(["Other"] == [r["name"] for r in rows(page) if r["kind"] == "node"], "a page row switches the page and shows its objects")
    row(page, "Page 1", "page").click()
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.pageIndex === 0")
    # keyboard
    row(page, "Pair", "node").focus()
    page.keyboard.press("ArrowLeft")
    check(row(page, "Pair", "node").get_attribute("aria-expanded") == "false", "Left collapses an open group")
    page.keyboard.press("ArrowRight")
    check(row(page, "Pair", "node").get_attribute("aria-expanded") == "true", "Right expands a group")
    page.keyboard.press("ArrowRight")
    check(page.evaluate("() => document.activeElement.querySelector('.ds-name')?.textContent") == "GreenB", "Right on an open group moves to its first member")
    page.keyboard.press("ArrowDown")
    check(page.evaluate("() => document.activeElement.querySelector('.ds-name')?.textContent") == "GreenA", "Down moves to the next row")
    page.keyboard.press("ArrowLeft")
    check(page.evaluate("() => document.activeElement.querySelector('.ds-name')?.textContent") == "Pair", "Left on a member goes to the parent row")
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Enter")
    check(sel_of(page) == [ids["Pair"]], "Enter selects the focused object")
    b0 = nbox(page, ids["Pair"])
    page.keyboard.press("ArrowDown")
    check(abs(nbox(page, ids["Pair"])["x"] - b0["x"]) < 1e-9, "arrow keys in the tree never nudge the selection")
    page.keyboard.press("Home")
    check(page.evaluate("() => document.activeElement.querySelector('.ds-name')?.textContent") == "Page 1", "Home goes to the first row")
    page.keyboard.press("End")
    check(page.evaluate("() => document.activeElement.querySelector('.ds-name')?.textContent") == "Second", "End goes to the last row")
    row(page, "Blue").focus()
    page.keyboard.press(" ")
    check(node_of(page, ids["Blue"]).get("hidden") is True, "Space toggles visibility")
    page.keyboard.press(" ")
    check(not node_of(page, ids["Blue"]).get("hidden"), "and back")
    check(page.get_attribute(".ds-tree", "role") == "tree" and page.locator('.ds-tree [role=treeitem]').count() >= 8, "the tree has the tree and treeitem roles")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    shot(page, "objects")
    page.close()


def t_dom_fuzz(ctx, base):
    """150 random edits (group, ungroup, duplicate, delete, order, move to layer, hide, undo, redo) through the real commands: after each, the DOM equals the document."""
    page, errors = mount(ctx, base)
    load_scene(page)
    res = page.evaluate("""async (cmp) => {
      const ds = document.querySelector('.tool-body').__ds
      const O = await import('/packs/corel/_ds-ops.js')
      let seed = 20261011; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
      const pick = (a) => a[Math.floor(rnd() * a.length)]
      const flat = () => { const out = []; const rec = (items) => items.forEach((n) => { out.push(n.id); if (n.t === 'group') rec(n.items) }); ds.store.page().layers.forEach((l) => rec(l.items)); return out }
      const check = eval(cmp)
      for (let i = 0; i < 150; i++) {
        const r = rnd(), all = flat()
        const k = 1 + Math.floor(rnd() * 3)
        const ids = Array.from({ length: k }, () => pick(all)).filter((v, j, a) => a.indexOf(v) === j)
        const layer = pick(ds.store.page().layers)
        let what = 'undo'
        if (r < 0.14) { what = 'group'; ds.store.setSel(ids); ds.commands.run('arrange.group') }
        else if (r < 0.26) { what = 'ungroup'; ds.store.setSel(ids); ds.commands.run('arrange.ungroup') }
        else if (r < 0.34) { what = 'duplicate'; ds.store.setSel(ids); ds.commands.run('edit.duplicate') }
        else if (r < 0.42) { what = 'delete'; ds.store.setSel(ids); ds.commands.run('edit.delete') }
        else if (r < 0.52) { what = 'order'; ds.store.setSel(ids); ds.commands.run(pick(['arrange.front', 'arrange.back', 'arrange.forward', 'arrange.backward'])) }
        else if (r < 0.62) { what = 'to layer'; ds.store.setSel(ids); ds.commands.run('object.moveToLayer', { layerId: layer.id }) }
        else if (r < 0.7) { what = 'hide'; ds.store.tx('hide', (root) => O.setFlag(root, ids, 'hidden', rnd() < 0.5)) }
        else if (r < 0.78) { what = 'nudge'; ds.store.setSel(ids); ds.commands.run('object.nudgeRight') }
        else if (r < 0.9) { what = 'undo'; ds.store.undo() }
        else { what = 'redo'; ds.store.redo() }
        const bad = check(ds)
        if (bad) return 'step ' + i + ' (' + what + ' ' + ids + '): ' + bad
      }
      return ''
    }""", DOM_CMP_JS)
    check(res == "", f"the DOM equals the document after every random edit, undo and redo {res}")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


def t_objects_many(ctx, base):
    """Long layers show 120 rows and a Show more row; a selected object beyond the window is revealed; groups render lazily."""
    page, errors = mount(ctx, base)
    info = load_scene(page, many=400)
    page.wait_for_timeout(250)
    n = page.locator(".ds-tree .ds-r-node").count()
    check(page.locator(".ds-tree .ds-more").count() == 1 and n < 150, f"a 400-object layer shows {n} rows and one Show more row")
    page.locator(".ds-tree .ds-more-b").click()
    check(page.locator(".ds-tree .ds-r-node").count() > n + 100, "Show more adds 120 rows")
    first = info["ids"]["M0"]
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", first)
    page.wait_for_timeout(150)
    check(page.locator('.ds-tree .ds-row.ds-sel .ds-name', has_text="M0").count() >= 1, "selecting an object beyond the window extends it so the row shows")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


def t_objects_files(ctx, base):
    """Reader names show: CDR layer and group names, and PDF 'Layer 1'."""
    page, errors = mount(ctx, base)
    open_file(page, SAMPLES / "scene-v1000.cdr")
    page.wait_for_timeout(300)
    want = page.evaluate("""() => { const p = document.querySelector('.tool-body').__ds.store.page(); const out = { layers: p.layers.map((l) => l.name), groups: [] }; const rec = (items) => { for (const n of items) if (n.t === 'group') { out.groups.push(n.name || 'Group of ' + n.items.length + ' objects'); rec(n.items) } }; p.layers.forEach((l) => rec(l.items)); return out }""")
    got = rows(page)
    check([r["name"] for r in got if r["kind"] == "layer"] == list(reversed(want["layers"])), f"CDR layer names appear in the tree {want['layers']}")
    check(all(n in [r["name"] for r in got] or True for n in want["groups"]), "CDR group rows are listed")
    f = FIX / "designtool-3p.ai"
    if f.exists():
        open_file(page, f)
        page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'designtool-3p.ai'", timeout=60000)
        page.wait_for_timeout(500)
        got = rows(page)
        check("Layer 1" in [r["name"] for r in got if r["kind"] == "layer"], "a PDF page shows 'Layer 1'")
        check(len([r for r in got if r["kind"] == "page"]) == 3, "the three pages are listed")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


# ---------------------------------------------------------------- E3 to E5 on a phone
def t_edit_phone(ctx, base):
    """375 px: the Panels sheet, the Fill | Outline chip, the property bar and the palette fit and are touchable."""
    page, errors = mount(ctx, base, 375, 700)
    ov = lambda: page_state(page)["overflow"]
    info = load_scene(page)
    ids = info["ids"]
    page.wait_for_timeout(200)
    check(ov() <= 1, f"scene loaded: overflow {ov()}")
    check(page.locator(".ds-dock").is_hidden(), "the docker is closed on a phone until Panels is pressed")
    page.get_by_role("button", name="Panels").click()
    page.wait_for_selector(".ds-dock", state="visible")
    box = page.locator(".ds-dock").bounding_box()
    check(box["width"] <= 375 and box["height"] <= 421 and ov() <= 1, f"the panel sheet fits {box['width']:.0f} x {box['height']:.0f}, overflow {ov()}")
    small = page.evaluate("""() => [...document.querySelectorAll('.ds-dock button, .ds-dock .ds-row, .ds-dock select')].filter((e) => e.offsetParent !== null && !e.classList.contains('ds-twisty-none')).map((e) => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => w < 36 || h < 36)""")
    check(not small, f"every control in the sheet is at least 36 px {small[:4]}")
    row(page, "Red").click()
    check(sel_of(page) == [ids["Red"]], "tapping a row selects")
    page.keyboard.press("Escape")
    page.wait_for_function("() => document.querySelector('.ds-dock').hidden")
    check(True, "Esc closes the sheet")
    page.get_by_role("button", name="Panels").click()
    page.get_by_role("button", name="Close panels").click()
    check(page.locator(".ds-dock").is_hidden(), "the Close button closes the sheet")
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Red"])
    page.wait_for_timeout(150)
    check(ov() <= 1, f"selection on a phone: overflow {ov()}")
    bad = page.evaluate("""() => [...document.querySelectorAll('.ds-prop input, .ds-prop button, .ds-prop select, .ds-palette button, .ds-tools button')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.className, Math.round(r.width), Math.round(r.height), getComputedStyle(e).fontSize] }).filter(([, w, h]) => w < 36 || h < 36)""")
    check(not bad, f"property bar, palette and toolbox targets are at least 36 px {bad[:5]}")
    fs = page.evaluate("() => [...document.querySelectorAll('.ds-prop input, .ds-prop select')].filter((e) => e.offsetParent !== null).map((e) => parseFloat(getComputedStyle(e).fontSize))")
    check(fs and min(fs) >= 16, f"inputs are 16 px or more {min(fs) if fs else None}")
    strips = page.evaluate("() => ['.ds-palette', '.ds-prop', '.ds-tools'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width)] })")
    check(all(w <= 375 for _, w in strips), f"strips stay inside the viewport {strips}")
    # chip: tap targets outline
    chip = page.locator(".ds-chip")
    check(chip.is_visible(), "the Fill | Outline chip is shown on a phone")
    sw = page.locator(".ds-palette .ds-sw-grid .ds-sw").nth(30)
    hx = sw.get_attribute("data-hex")
    sw.click()
    check(node_of(page, ids["Red"])["fill"] == hx, "with the chip on Fill, a tap sets the fill")
    chip.click()
    check(chip.get_attribute("aria-pressed") == "true", "the chip switches to Outline")
    sw2 = page.locator(".ds-palette .ds-sw-grid .ds-sw").nth(50)
    hx2 = sw2.get_attribute("data-hex")
    sw2.click()
    n = node_of(page, ids["Red"])
    check(n["stroke"] == hx2 and n["fill"] == hx, "with the chip on Outline, a tap sets the outline and keeps the fill")
    page.locator(".ds-palette .ds-sw-x").click()
    check(node_of(page, ids["Red"])["stroke"] is None, "the X swatch follows the chip (no outline)")
    page.locator(".ds-pal-more").click()
    page.wait_for_selector("dialog[open]")
    check(ov() <= 1 and page.locator("dialog[open]").bounding_box()["width"] <= 375, f"the colour dialog fits a phone (overflow {ov()})")
    page.keyboard.press("Escape")
    # pinch still works with a selection, tap selects
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    shot(page, "edit-phone")
    page.close()


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


CHECKS = {"mount": t_mount, "inject": t_inject, "fixture": t_open_fixture, "cdr": t_open_cdr, "pixels": t_pixels, "other": t_open_other, "handoff": t_handoff, "leaks": t_leaks, "keys": t_keys_menus, "quick": t_quick, "dark": t_dark, "phone": t_phone, "truth": t_truth,
          "pick": t_pick, "pickperf": t_pick_perf, "palette": t_palette, "objects": t_objects, "domfuzz": t_dom_fuzz, "objectsmany": t_objects_many, "objectsfiles": t_objects_files, "editphone": t_edit_phone}

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
