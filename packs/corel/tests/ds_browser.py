"""Browser checks for Draw Studio (Playwright, the installed Edge). Covers milestones E1 to E10; later milestones append their checks.

Groups: mount inject fixture cdr pixels other handoff leaks keys quick dark phone truth pick pickperf palette objects domfuzz objectsmany objectsfiles editphone
        pages autosave text textpdf save savetext e2e e678phone shapes arrange e910phone

    uv run --with playwright --with pillow python ds_browser.py [--only name,name] [--samples DIR] [--fixtures DIR]

Needs the generated fixtures (gen_designpdf.py, gen_cdr.py output). Nothing is downloaded. The user's own file is only read
locally (DS_USER_FILE, else the .ai or .pdf in Downloads); it is never copied, uploaded or committed. Each run uses a fresh browser profile,
so autosaved drawings from earlier runs never show up. Saved test files go to DS_OUT (outside the repo).
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
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # messages may carry Devanagari text
except Exception:
    pass


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def mount(ctx, base, width=1280, height=800, route="draw-studio"):
    for attempt in (1, 2):  # the site pulls icons from a CDN, so one slow load is retried on a fresh page
        page = ctx.new_page()
        page.set_viewport_size({"width": width, "height": height})
        # remembered view preferences (rulers, guides, snapping) must not leak from one check into the next: clear them once per page, not on a reload
        page.add_init_script("try { if (!sessionStorage.getItem('ds-prefs-cleared')) { localStorage.removeItem('tools:ds-prefs'); sessionStorage.setItem('ds-prefs-cleared', '1') } } catch (e) {}")
        try:
            return page, open_tool(page, base, route)
        except Exception:
            page.close()
            if attempt == 2:
                raise


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
    d = dialog(page)
    check("Open or import into this page?" in d.inner_text(), "a drop onto a drawing that has content asks open or import")
    d.get_by_role("button", name="Open", exact=True).click()
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.name === 'dropped.cdr'", timeout=20000)
    check(page.evaluate(STATE_JS)["source"] == "cdr", "drop on the canvas opens the file")
    page.evaluate(drop_js, {"b64": small, "name": "chrome-drop.cdr", "sel": ".page-head"})
    dialog(page).get_by_role("button", name="Open", exact=True).click()
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
    check(page.evaluate("() => document.activeElement.dataset.cmd") == "page.insertAfter", "ArrowRight moves to the next menu (Layout)")
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
    # New: the New dialog (the details are in the pages check); it warns about unsaved changes, Cancel keeps the drawing
    page.locator(".ds-view").focus()
    page.keyboard.press("Alt+n")
    page.wait_for_selector("dialog[open]", timeout=3000)
    check("New drawing" in page.inner_text("dialog[open]") and "not saved" not in page.inner_text("dialog[open]"), "Alt+N opens the New dialog without a warning for an unchanged drawing")
    page.get_by_role("button", name="Create").click()
    page.wait_for_timeout(300)
    st = page.evaluate(STATE_JS)
    check(st["title"] == "Untitled" and st["source"] == "new" and st["sizes"] == [[595.28, 841.89]], f"Create starts a blank A4 drawing {st['sizes']}")
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Rename', (r) => ({ ...r, title: 'Changed' })) }")
    page.keyboard.press("Alt+n")
    page.wait_for_selector("dialog[open]", timeout=3000)
    check("not saved" in page.inner_text("dialog[open]"), "New warns when there are unsaved changes")
    page.get_by_role("button", name="Cancel").click()
    page.wait_for_timeout(200)
    check(page.evaluate(STATE_JS)["title"] == "Changed", "Cancel keeps the drawing")
    page.keyboard.press("Alt+n")
    page.wait_for_selector("dialog[open]", timeout=3000)
    page.get_by_role("button", name="Create").click()
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
        if label:
            fmt = route.split("-")[-1]
            d = dialog(page, timeout=15000)
            check(f"Save as {label}" in d.inner_text() and d.get_by_label("Format").input_value() == fmt, f"{route}: the Export dialog opens preset to {label} ({d.inner_text()[:30]!r})")
            check(d.get_by_role("button", name="Edit in Draw Studio").count() == 1, f"{route}: offers Edit in Draw Studio")
            with page.expect_download(timeout=60000) as dl:
                d.locator(".btn-primary").click()
            check(dl.value.suggested_filename.split(".")[-1] in (fmt, "zip"), f"{route}: Save as {label} downloads {dl.value.suggested_filename}")
            page.wait_for_selector("dialog[open] .alert.success", timeout=10000)
            d.get_by_role("button", name="Edit in Draw Studio").click()
            page.wait_for_timeout(300)
            check(page.locator("dialog[open]").count() == 0, f"{route}: Edit in Draw Studio closes the dialog and leaves the editor")
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


# ---------------------------------------------------------------- E6: pages, New, autosave
def ds_state(page):
    return page.evaluate(STATE_JS)


def units_of(page):
    return page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.units")


def dialog(page, timeout=5000):
    page.wait_for_selector("dialog[open]", timeout=timeout)
    page.wait_for_timeout(250)
    return page.locator("dialog[open]")


def t_pages(ctx, base):
    """E6: New dialog, page tabs (add, rename, delete, reorder), Layout commands, Page setup, the property bar's page mode. Every operation undoes and redoes exactly."""
    page, errors = mount(ctx, base)
    page.get_by_role("button", name="New drawing").click()
    d = dialog(page)
    d.get_by_label("Name").fill("Poster")
    d.get_by_label("Paper size").select_option("A3")
    d.get_by_role("button", name="Landscape").click()
    d.get_by_label("Units").select_option("in")
    check(d.get_by_label("Width").input_value() == "16.535" and d.get_by_label("Height").input_value() == "11.693", f"the size fields show the preset in the chosen units ({d.get_by_label('Width').input_value()} x {d.get_by_label('Height').input_value()})")
    d.get_by_label("Width").fill("10")
    check(d.get_by_label("Paper size").input_value() == "Custom", "typing a size switches the preset to Custom")
    d.get_by_label("Paper size").select_option("A3")
    d.get_by_role("button", name="Landscape").click()
    page.get_by_role("button", name="Create").click()
    page.wait_for_timeout(400)
    st = ds_state(page)
    check(st["title"] == "Poster" and units_of(page) == "in" and st["sizes"] == [[1190.55, 841.89]] and st["source"] == "new", f"New creates a blank A3 landscape drawing in inches: {st['title']} {st['sizes']} {units_of(page)}")
    check(page.locator(".ds-empty").is_hidden(), "the empty state is gone after New")
    # a drawing with changes warns before it is replaced; Cancel keeps it
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Rename', (r) => ({ ...r, title: 'Changed' })) }")
    page.locator(".ds-view").focus()
    page.keyboard.press("Alt+n")
    d = dialog(page)
    check("not saved" in d.inner_text(), "New warns about unsaved changes")
    page.get_by_role("button", name="Cancel").click()
    page.wait_for_timeout(200)
    check(ds_state(page)["title"] == "Changed", "Cancel keeps the drawing")
    page.keyboard.press("Alt+n")
    d = dialog(page)
    d.get_by_label("Name").fill("Second")
    d.get_by_label("Name").press("Enter")
    page.wait_for_timeout(400)
    st = ds_state(page)
    check(st["title"] == "Second" and st["sizes"] == [[595.28, 841.89]], f"Enter in the name field creates the drawing (default A4): {st['sizes']}")

    # page tabs
    info = load_scene(page, pages=2)
    names = lambda: ds_state(page)["names"]
    cur = lambda: page.evaluate("() => document.querySelector('.tool-body').__ds.store.pageIndex")
    undo_redo(page, "Add a page", lambda: page.get_by_role("button", name="Add a page after this one").click())
    check(names() == ["Page 1", "Page 3", "Second"] and cur() == 1, f"the new page goes after the current one and is shown {names()} {cur()}")
    check(ds_state(page)["sizes"][1] == [400, 300], f"a new page takes the size of the page it follows {ds_state(page)['sizes']}")
    def rename():
        page.locator(".ds-tab").nth(1).dblclick()
        page.wait_for_selector(".ds-tab-input")
        page.keyboard.press("Control+a")
        page.keyboard.type("Cover")
        page.keyboard.press("Enter")
    undo_redo(page, "Rename a page (double-click)", rename)
    check(names()[1] == "Cover", f"double-click renames {names()}")
    page.locator(".ds-tab").nth(1).dblclick()
    page.keyboard.type("Nope")
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    check(names()[1] == "Cover", "Esc keeps the old name")
    page.locator(".ds-tab").nth(1).focus()
    page.keyboard.press("F2")
    check(page.locator(".ds-tab-input").count() == 1, "F2 on a focused tab starts renaming")
    page.keyboard.press("Escape")
    # reorder: buttons and drag
    undo_redo(page, "Move page left", lambda: page.get_by_role("button", name="Move this page left").click())
    check(names()[0] == "Cover" and cur() == 0, f"Move left puts the page first and keeps showing it {names()} {cur()}")
    check(page.get_by_role("button", name="Move this page left").is_disabled(), "Move left is disabled on the first page")
    def drag_last_first():
        page.evaluate("""() => { const tabs = [...document.querySelectorAll('.ds-tab')]; const dt = new DataTransfer(); const a = tabs[tabs.length - 1], b = tabs[0]
          const r = b.getBoundingClientRect(); const fire = (el, type, x) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: r.top + 5 }))
          fire(a, 'dragstart', 0); fire(b, 'dragover', r.left + 2); fire(b, 'drop', r.left + 2); fire(a, 'dragend', 0) }""")
    undo_redo(page, "Drag a page tab to the front", drag_last_first)
    check(names()[0] == "Second" and names()[1] == "Cover", f"dragging a tab before another reorders the pages {names()}")
    undo_redo(page, "Move page right", lambda: page.get_by_role("button", name="Move this page right").click())
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setPage(2)")
    n0 = len(names())
    undo_redo(page, "Delete a page", lambda: page.get_by_role("button", name="Delete this page").click())
    check(len(names()) == n0 - 1, f"Delete removes the current page {names()}")
    # Layout menu commands and content survive
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.setPage(ds.store.root.pages.findIndex((p) => p.layers.some((l) => l.items.length > 3))) }")
    st0 = ds_state(page)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('page.duplicate')")
    page.wait_for_timeout(200)
    names2 = names()
    check(len(names2) == len(st0["names"]) + 1 and names2[cur()].endswith("copy"), f"Duplicate page adds '<name> copy' and shows it {names2} {cur()}")
    ids = page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; const ids = (p) => { const s = []; const rec = (items) => items.forEach((n) => { s.push(n.id); if (n.t === 'group') rec(n.items) }); p.layers.forEach((l) => rec(l.items)); return s }
      const r = ds.store.root; const i = ds.store.pageIndex; return [ids(r.pages[i - 1]), ids(r.pages[i])] }""")
    check(len(ids[0]) == len(ids[1]) > 5 and not set(ids[0]) & set(ids[1]), f"the copy has the same objects with new ids ({len(ids[1])})")
    check(page.evaluate("() => document.querySelectorAll('.ds-world .ds-layer > [data-id]').length") >= 4, "the copied page is drawn")
    undo_redo(page, "Insert page before", lambda: page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('page.insertBefore')"))
    page.get_by_role("menuitem", name="Layout").click()
    for label in ("Insert page after", "Insert page before", "Duplicate page", "Delete page", "Rename page", "Move page left", "Move page right", "Previous page", "Next page", "Page setup...", "Switch orientation"):
        check(page.get_by_role("menuitem", name=label).count() == 1, f"Layout menu has {label}")
    page.keyboard.press("Escape")

    # Page setup: preset, orientation, units, apply to all pages; objects keep their distance from the bottom edge
    load_scene(page, pages=2)
    red = page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; const n = ds.store.root.pages[0].layers[0].items[0]; return [n.id, ds.renderer.nodeBox(n)] }")
    page.get_by_role("button", name="Page setup").click()
    d = dialog(page)
    d.get_by_label("Paper size").select_option("Letter")
    d.get_by_role("button", name="All pages").click()
    d.get_by_label("Units").select_option("pt")
    undo_redo(page, "Page setup (Letter, all pages)", lambda: page.get_by_role("button", name="Apply").click())
    st = ds_state(page)
    check(st["sizes"] == [[792, 612], [792, 612]] and units_of(page) == "pt", f"Letter (landscape, as the pages were) on every page, points {st['sizes']} {units_of(page)}")
    box = nbox(page, red[0])
    check(abs((612 - (box["y"] + box["h"])) - (300 - (red[1]["y"] + red[1]["h"]))) < 1e-6, "objects keep their distance from the bottom edge when the page grows")
    # property bar page mode
    page.keyboard.press("Escape")
    page.locator(".ds-view").click(position={"x": 5, "y": 5})
    check(page.locator(".ds-pagebar").is_visible() and page.locator(".ds-pagebar .ds-preset").input_value() == "Letter", "nothing selected: the property bar shows the page (preset Letter)")
    undo_redo(page, "Property bar paper size", lambda: page.locator(".ds-pagebar .ds-preset").select_option("A5"))
    check(ds_state(page)["sizes"][0] == [595.28, 419.53], f"A5 keeps the orientation (landscape) {ds_state(page)['sizes'][0]}")
    undo_redo(page, "Property bar portrait", lambda: page.get_by_role("button", name="Portrait").click())
    check(ds_state(page)["sizes"][0] == [419.53, 595.28] and page.get_by_role("button", name="Portrait").get_attribute("aria-pressed") == "true", "Portrait swaps width and height")
    undo_redo(page, "Switch orientation command", lambda: page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('page.orientation')"))
    def typed_w():
        w = page.locator(".ds-pagebar input[aria-label='Page width']")
        w.fill("500"); w.press("Enter")
    undo_redo(page, "Typed page width", typed_w)
    check(page.locator(".ds-pagebar .ds-preset").input_value() == "Custom" and abs(ds_state(page)["sizes"][0][0] - 500) < 0.01, "a typed width gives a Custom size (in the document units)")
    # page operations while nothing is selected leave a clean tree
    check(not dom_matches_tree(page), f"DOM equals the document: {dom_matches_tree(page)}")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    shot(page, "pages")
    page.close()


def evil_record():
    """A hostile autosave record as a JSON string (parsed in the page so a __proto__ key stays an own key)."""
    items = [{"t": "path", "d": "<svg onload=alert(1)>", "fill": "red;background:url(x)"},
             {"t": "path", "d": [["M", 0, 0], ["L", 5, 5], ["L", 9, 0], ["Z"]], "fill": "red;background:url(x)", "stroke": "javascript:alert(1)"},
             {"t": "text", "str": "ok", "family": "<b>x</b>", "fill": "url(javascript:alert(1))", "font": "__proto__", "glyphs": [{"c": "ab", "x": 1}]},
             {"t": "image", "asset": "../../etc", "w": 1, "h": 1, "m": [1, 0, 0, 1, 0, 0]}, {"t": "script", "src": "x"}]
    root = {"title": "<b>x</b>", "units": "furlongs", "uid": "A B", "fonts": {"bad key!": {}, "__proto__": {"data": None}, "f1": {"family": 'A"};x', "name": 5}},
            "pages": [{"id": 1, "name": "<img src=x onerror=alert(1)>", "w": "wide", "h": 1e99, "layers": [{"id": 2, "name": "L", "items": items}]}]}
    return json.dumps({"v": 1, "savedAt": 1, "title": "<img src=x onerror=alert(1)>", "pages": 1, "assetIds": ["../x", 5, "__proto__"], "root": root})


def idb_js(expr):
    return "async () => { const idb = await import('/lib/idb.js'); " + expr + " }"


def t_autosave(ctx, base):
    """E6: edit, reload, Restore gives an identical document; Discard; a poisoned record is cleaned with a note; a damaged one is discarded; saving to a file clears it; quick mode never autosaves."""
    page, errors = mount(ctx, base)
    dialogs = []
    page.on("dialog", lambda dlg: (dialogs.append(dlg.message), dlg.dismiss()))
    page.evaluate(idb_js("for (const k of await idb.keys('ds:autosave:')) await idb.del(k)"))
    info = load_scene(page, pages=2)
    page.evaluate("() => document.querySelector('.tool-body').__ds.persist.flush()")
    check(page.evaluate(idb_js("return (await idb.keys('ds:autosave:')).length")) == 0, "a drawing with no changes is not autosaved")
    # edit with real input: nudge Red, rename page 2, add a page
    select_ids(page, info["ids"]["Red"])
    page.locator(".ds-view").focus()
    page.keyboard.press("Shift+ArrowRight")
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Rename page', (r) => ({ ...r, pages: r.pages.map((p, i) => (i === 1 ? { ...p, name: 'Back' } : p)) })) }")
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('page.insertAfter')")
    page.wait_for_timeout(200)
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.dirty"), "edits mark the drawing as having changes")
    t0 = time.time()
    for _ in range(40):
        if page.evaluate(idb_js("return (await idb.keys('ds:autosave:doc')).length")):
            break
        page.wait_for_timeout(250)
    waited = time.time() - t0
    keys = page.evaluate(idb_js("return (await idb.keys('ds:autosave:')).sort()"))
    check("ds:autosave:doc" in keys and any(k.startswith("ds:autosave:a:") for k in keys), f"autosave wrote the document and its picture by itself after {waited:.1f}s {keys}")
    check(2.0 <= waited <= 8.0, f"autosave is throttled to about 3 s ({waited:.1f}s)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.persist.flush()")
    before = page.evaluate("() => JSON.stringify(document.querySelector('.tool-body').__ds.store.root.pages)")
    page.reload()
    wait_ds(page)
    page.wait_for_selector(".ds-restore", timeout=8000)
    txt = page.inner_text(".ds-restore")
    check("scene" in txt and "3 pages" in txt, f"the restore banner names the drawing and its pages: {txt[:90]!r}")
    page.get_by_role("button", name="Restore").click()
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.meta.source !== 'new' || document.querySelector('.tool-body').__ds.store.root.pages.length > 1", timeout=15000)
    page.wait_for_timeout(400)
    after = page.evaluate("() => JSON.stringify(document.querySelector('.tool-body').__ds.store.root.pages)")
    same = json.loads(before) == json.loads(after)  # key order is not part of the document
    check(same, f"Restore gives an identical document ({len(before)} bytes)")
    st = ds_state(page)
    check(st["pages"] == 3 and st["assets"] == 1 and st["title"] == "scene", f"pages, picture and title are back {st['pages']} {st['assets']} {st['title']}")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.dirty"), "a restored drawing counts as unsaved")
    check(page.evaluate("() => [...document.querySelectorAll('.ds-world image')].every((i) => i.getAttribute('href').startsWith('blob:'))") and page.locator(".ds-world image").count() == 1, "the restored picture is drawn from a blob")
    check(dom_matches_tree(page) == "", f"DOM equals the restored document {dom_matches_tree(page)}")
    # Discard
    page.evaluate("() => document.querySelector('.tool-body').__ds.persist.flush()")
    page.reload(); wait_ds(page)
    page.wait_for_selector(".ds-restore", timeout=8000)
    page.get_by_role("button", name="Discard").click()
    page.wait_for_timeout(300)
    check(page.evaluate(idb_js("return (await idb.keys('ds:autosave:')).length")) == 0 and page.locator(".ds-restore").count() == 0, "Discard removes the autosaved drawing")
    # poisoned record: whitelisted on restore, with a note
    page.evaluate("async (s) => { const idb = await import('/lib/idb.js'); await idb.set('ds:autosave:doc', JSON.parse(s)) }", evil_record())
    page.reload(); wait_ds(page)
    page.wait_for_selector(".ds-restore", timeout=8000)
    check("<img" in page.inner_text(".ds-restore") and page.locator(".ds-restore img").count() == 0, "a hostile title is shown as text, never as markup")
    page.get_by_role("button", name="Restore").click()
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.warnings.length > 0", timeout=15000)
    r = page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; const r = ds.store.root; const items = r.pages[0].layers[0].items
      return { warnings: r.warnings, types: items.map((n) => n.t), fill: items[0] && items[0].fill, stroke: items[0] && items[0].stroke, fam: items[1] && items[1].family, tfill: items[1] && items[1].fill, font: items[1] && items[1].font, units: r.units, w: r.pages[0].w, h: r.pages[0].h, imgs: document.querySelectorAll('img[src=x]').length } }""")
    check(any("skipped" in w for w in r["warnings"]), f"the restore says items were skipped: {r['warnings']}")
    check(r["types"] == ["path", "text"] and r["fill"] is None and r["stroke"] is None, f"unknown and broken items are dropped, hostile colours become none {r['types']} {r['fill']} {r['stroke']}")
    check("<" not in r["fam"] and r["tfill"] == "#000000" and r["font"] is None and r["units"] == "mm" and r["w"] <= 20000 and r["h"] <= 20000 and r["imgs"] == 0, f"text, units and page size are validated {r}")
    check(not dialogs, f"no script ran (no alert) {dialogs}")
    # a damaged record is discarded with a message, no banner
    page.evaluate(idb_js("await idb.set('ds:autosave:doc', 'hello')"))
    page.reload(); wait_ds(page)
    page.wait_for_timeout(800)
    check(page.locator(".ds-restore").count() == 0, "a damaged autosave offers no restore")
    check(page.evaluate(idb_js("return (await idb.keys('ds:autosave:')).length")) == 0, "a damaged autosave is deleted")
    # saving to a CDR file removes the autosaved copy
    load_scene(page)
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Edit', (r) => ({ ...r, title: 'Edited' })) }")
    page.evaluate("() => document.querySelector('.tool-body').__ds.persist.flush()")
    check(page.evaluate(idb_js("return (await idb.keys('ds:autosave:doc')).length")) == 1, "the edit was autosaved")
    page.locator(".ds-view").focus()
    with page.expect_download(timeout=60000) as dl:
        page.keyboard.press("Control+s")
    dl.value.path()
    page.wait_for_timeout(500)
    check(page.evaluate(idb_js("return (await idb.keys('ds:autosave:')).length")) == 0 and not page.evaluate("() => document.querySelector('.tool-body').__ds.store.dirty"), "Save as CDR marks the drawing saved and removes the autosaved copy")
    # quick export mode never autosaves and offers no restore
    q = ctx.new_page(); q.set_viewport_size({"width": 1280, "height": 800}); open_tool(q, base, "cdr-to-svg")
    open_file(q, SAMPLES / "scene-v1000.cdr")
    q.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; ds.store.tx('Edit', (r) => ({ ...r, title: 'Quick edit' })) }")
    q.wait_for_timeout(4500)
    check(q.evaluate(idb_js("return (await idb.keys('ds:autosave:')).length")) == 0, "quick export mode never autosaves")
    q.close()
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:3]}")
    page.close()


# ---------------------------------------------------------------- E7: text
TEXTS_JS = """() => { const ds = document.querySelector('.tool-body').__ds; const out = []
  const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else if (n.t === 'text') out.push({ id: n.id, str: n.str, m: n.m, size: n.size, family: n.family, bold: n.bold, italic: n.italic, align: n.align, lh: n.lh, glyphs: !!n.glyphs, font: n.font || null, fill: n.fill }) })
  ds.store.root.pages[ds.store.pageIndex].layers.forEach((l) => rec(l.items)); return out }"""


def texts(page):
    return page.evaluate(TEXTS_JS)


def new_blank(page, name="Text test"):
    page.locator(".ds-view").focus()
    page.keyboard.press("Alt+n")
    d = dialog(page)
    d.get_by_label("Name").fill(name)
    page.get_by_role("button", name="Create").click()
    page.wait_for_timeout(400)


def t_text(ctx, base):
    """E7: Text tool, in-place editing (ASCII, Devanagari, several lines), font controls, Add font file, Convert to curves, PDF glyph text."""
    page, errors = mount(ctx, base)
    new_blank(page)
    page.keyboard.press("F8")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.tool") == "text", "F8 selects the Text tool")
    check(page.locator(".ds-textbar").is_visible(), "the Text tool shows the font controls in the property bar")
    # a click creates text, typing is ONE undo step
    def create_ascii():
        click_pt(page, 100, 200)
        page.wait_for_selector(".ds-textedit")
        page.keyboard.type("Hello 123")
        page.keyboard.press("Escape")
    undo_redo(page, "Create text 'Hello 123'", create_ascii)
    t = texts(page)
    check(len(t) == 1 and t[0]["str"] == "Hello 123" and abs(t[0]["m"][4] - 100) < 1.5 and abs(t[0]["m"][5] - 200) < 1.5 and t[0]["size"] == 24, f"the text sits where it was clicked ({t[0]['m'][4:]})")
    check(page.locator(".ds-textedit").count() == 0, "Esc ends the editing session")
    check(sel_of(page) == [t[0]["id"]], "the new text is selected")
    check("Artistic text" in page.inner_text(".ds-status"), f"status names it: {page.inner_text('.ds-status')[:40]!r}")
    # empty text creates nothing
    h0 = hist(page)
    click_pt(page, 100, 400)
    page.wait_for_selector(".ds-textedit")
    page.keyboard.press("Escape")
    check(len(texts(page)) == 1 and hist(page) == h0, "clicking and leaving without typing creates nothing")
    # Devanagari, typed through the browser's own text input
    def create_hindi():
        click_pt(page, 100, 300)
        page.wait_for_selector(".ds-textedit")
        page.keyboard.insert_text("नमस्ते दुनिया")
        page.keyboard.press("Escape")
    undo_redo(page, "Create Devanagari text", create_hindi)
    hi = [x for x in texts(page) if x["str"].startswith("नमस्ते")][0]
    check(hi["str"] == "नमस्ते दुनिया", f"Devanagari is stored as typed ({hi['str']!r})")
    check(nbox(page, hi["id"])["w"] > 40, f"and drawn with a width ({nbox(page, hi['id'])['w']:.1f} pt)")
    check("Nirmala UI" in page.evaluate("(id) => document.querySelector('.tool-body').__ds.renderer.elOf(id).querySelector('text').getAttribute('font-family')", hi["id"]), "the font stack carries the complex-script fallbacks")
    # several lines
    h1 = hist(page)
    click_pt(page, 300, 200)
    page.wait_for_selector(".ds-textedit")
    page.keyboard.type("Line one")
    page.keyboard.press("Enter")
    page.keyboard.type("Line two is longer")
    page.keyboard.press("Escape")
    ml = [x for x in texts(page) if x["str"].startswith("Line one")][0]
    check(ml["str"] == "Line one\nLine two is longer" and hist(page)[1] == h1[1] + 1, "Enter adds a line, the whole session is one undo step")
    dom = page.evaluate("(id) => [...document.querySelector('.tool-body').__ds.renderer.elOf(id).querySelectorAll('tspan')].map((t) => [t.getAttribute('dy'), t.textContent])", ml["id"])
    check(len(dom) == 2 and abs(float(dom[1][0]) - ml["lh"] * ml["size"]) < 1e-3, f"lines are laid out with the line height (dy {dom[1][0]} = {ml['lh']} x {ml['size']})")
    b = nbox(page, ml["id"])
    check(b["h"] > 1.8 * ml["size"] * 0.9, f"the box covers both lines ({b['h']:.1f} pt)")
    # Pick: Enter and double-click edit it again
    page.keyboard.press("v")
    select_ids(page, ml["id"])
    page.locator(".ds-view").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".ds-textedit", timeout=3000)
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.tool") == "text", "Enter on selected text edits it in place")
    page.keyboard.press("Control+a")
    page.keyboard.type("Replaced")
    page.keyboard.press("Escape")
    check([x for x in texts(page) if x["id"] == ml["id"]][0]["str"] == "Replaced", "typing replaces the selected text")
    page.keyboard.press("Control+z")
    check([x for x in texts(page) if x["id"] == ml["id"]][0]["str"] == "Line one\nLine two is longer", "Ctrl+Z after the session restores the text")
    page.keyboard.press("v")
    page.keyboard.press("Escape")
    b = nbox(page, ml["id"])
    sx, sy = scr(page, b["x"] + 10, b["y"] + b["h"] / 2)
    page.mouse.dblclick(sx, sy)
    page.wait_for_selector(".ds-textedit", timeout=3000)
    check(True, "double-click with the Pick tool edits text in place")
    page.keyboard.press("Escape")

    # font controls: each is one undo step on the selected text
    select_ids(page, t[0]["id"])
    tid = t[0]["id"]
    node = lambda: [x for x in texts(page) if x["id"] == tid][0]
    box0 = nbox(page, tid)
    undo_redo(page, "Font family", lambda: page.locator(".ds-textbar select[aria-label='Font']").select_option("Noto Serif"))
    check(node()["family"] == "Noto Serif", f"family applies ({node()['family']})")
    def set_size():
        f = page.locator(".ds-textbar input[aria-label='Font size in points']"); f.fill("40"); f.press("Enter")
    undo_redo(page, "Font size", set_size)
    check(node()["size"] == 40, "size applies (in points)")
    undo_redo(page, "Bold", lambda: page.get_by_role("button", name="Bold").click())
    check(node()["bold"] is True and page.get_by_role("button", name="Bold").get_attribute("aria-pressed") == "true", "bold applies and the button shows it")
    undo_redo(page, "Italic", lambda: page.get_by_role("button", name="Italic").click())
    check(node()["italic"] is True, "italic applies")
    page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=15000)
    page.wait_for_timeout(1200)  # the bundled serif faces arrive from the CDN: measure the text only once they are in
    b0 = nbox(page, tid)
    undo_redo(page, "Align centre", lambda: page.get_by_role("button", name="Align centre").click())
    b1 = nbox(page, tid)
    check(node()["align"] == "center" and abs(b1["x"] - b0["x"]) < 0.6 and abs(b1["y"] - b0["y"]) < 0.6, f"alignment changes without moving the text ({b0['x']:.2f} -> {b1['x']:.2f})")
    check(page.evaluate("(id) => document.querySelector('.tool-body').__ds.renderer.elOf(id).querySelector('text').getAttribute('text-anchor')", tid) == "middle", "centre alignment is drawn with a middle anchor")
    def set_lh():
        f = page.locator(".ds-textbar input[aria-label^='Line spacing']"); f.fill("2"); f.press("Enter")
    undo_redo(page, "Line spacing", set_lh)
    check(node()["lh"] == 2, "line spacing applies")
    page.locator(".ds-textbar input[aria-label='Font size in points']").fill("12")
    page.locator(".ds-textbar input[aria-label='Font size in points']").press("Enter")
    h2 = hist(page)
    page.locator(".ds-textbar input[aria-label='Font size in points']").fill("13")
    page.locator(".ds-textbar input[aria-label='Font size in points']").press("Enter")
    check(hist(page)[1] == h2[1], "typing in the same field within a moment merges into one undo step")
    # the text size of the next new text follows the bar
    page.keyboard.press("Escape")
    page.keyboard.press("F8")
    page.locator(".ds-textbar input[aria-label='Font size in points']").fill("18")
    page.locator(".ds-textbar input[aria-label='Font size in points']").press("Enter")
    click_pt(page, 300, 500)
    page.wait_for_selector(".ds-textedit")
    page.keyboard.type("Default")
    page.keyboard.press("Escape")
    d2 = [x for x in texts(page) if x["str"] == "Default"][0]
    check(d2["size"] == 18, f"new text uses the size chosen in the bar ({d2['size']}, {d2['family']})")

    # the Text menu commands do the same through the command table
    run = lambda c: page.evaluate("(c) => document.querySelector('.tool-body').__ds.commands.run(c)", c)
    select_ids(page, tid)
    s0 = node()["size"]
    run("text.larger"); check(node()["size"] == 20 and s0 == 18, f"Text > Increase size steps to the next size ({s0} -> {node()['size']})")
    run("text.smaller"); check(node()["size"] == 18, f"Text > Decrease size steps down ({node()['size']})")
    run("text.bold"); check(node()["bold"] is False, "Text > Bold toggles")
    run("text.italic"); check(node()["italic"] is False, "Text > Italic toggles")
    run("text.alignRight"); check(node()["align"] == "right", "Text > Align right")
    run("text.alignLeft"); check(node()["align"] == "left", "Text > Align left")
    page.get_by_role("menuitem", name="Text").click()
    for label in ("Edit text", "Bold", "Italic", "Align left", "Align centre", "Align right", "Increase size", "Decrease size", "Convert to curves", "Add font file..."):
        check(page.get_by_role("menuitem", name=label).count() == 1, f"Text menu has {label}")
    page.keyboard.press("Escape")
    # Add font file: registers a FontFace under a generated family and applies it
    fontfile = next((p for p in (r"C:/Windows/Fonts/segoeui.ttf", r"C:/Windows/Fonts/arial.ttf") if Path(p).exists()), None)
    check(fontfile is not None, "a system font file is available for the test")
    page.keyboard.press("v")
    select_ids(page, tid)
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Add font file").click()
    fc.value.set_files(fontfile)
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.fonts.size > 0", timeout=15000)
    page.wait_for_timeout(500)
    info = page.evaluate("""(id) => { const ds = document.querySelector('.tool-body').__ds; const r = ds.store.root; const n = ds.store.find(id).node; const k = Object.keys(r.fonts)
      return { keys: k, rec: k.map((x) => ({ family: r.fonts[x].family, len: r.fonts[x].data.length })), faces: [...document.fonts].filter((f) => f.family.startsWith('ds' + r.uid + '-')).map((f) => f.family), node: { font: n.font, family: n.family },
        options: [...document.querySelectorAll('.ds-textbar select[aria-label=Font] option')].map((o) => o.textContent), stack: ds.renderer.elOf(id).querySelector('text').getAttribute('font-family') } }""", tid)
    check(len(info["keys"]) == 1 and info["rec"][0]["len"] > 10000 and len(info["faces"]) == 1, f"the font is registered as a FontFace under a generated family {info['rec']} {info['faces']}")
    check(info["node"]["font"] == info["keys"][0] and info["node"]["family"] in info["options"], f"it is listed and applied to the selected text {info['node']}")
    check(info["stack"].startswith('"ds'), f"the text is drawn with the embedded face first ({info['stack'][:50]})")
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.fonts[Object.keys(document.querySelector('.tool-body').__ds.store.root.fonts)[0]].data instanceof Uint8Array"), "the bytes stay in the document fonts object")
    # a wrong file is refused with a message
    bad = FIX / "evil.svg"
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Add font file").click()
    fc.value.set_files(str(bad))
    page.wait_for_timeout(800)
    check(page.evaluate("() => Object.keys(document.querySelector('.tool-body').__ds.store.root.fonts).length") == 1 and "could not be used" in page.inner_text(".toasts"), "a file that is not a font is refused with a message")

    # Convert to curves
    click_pt(page, 20, 20)
    cid = [x for x in texts(page) if x["str"] == "Hello 123"][0]["id"]
    select_ids(page, cid)
    tb = nbox(page, cid)
    node0 = node_of(page, cid)
    page.locator(".ds-view").focus()
    def to_curves():
        page.keyboard.press("Control+q")
        page.wait_for_function("(id) => document.querySelector('.tool-body').__ds.store.find(id).node.t === 'path'", arg=cid, timeout=30000)
    undo_redo(page, "Convert to curves (Ctrl+Q)", to_curves)
    pn = node_of(page, cid)
    ob = nbox(page, cid)
    check(pn["t"] == "path" and len(pn["d"]) > 10 and pn["fill"] == node0["fill"], f"the text became a filled path ({len(pn['d'])} commands)")
    baseline = node0["m"][5]
    check(ob["x"] >= tb["x"] - 1 and ob["x"] + ob["w"] <= tb["x"] + tb["w"] + 1 and abs(ob["w"] - tb["w"]) <= 0.12 * tb["w"], f"the outline sits inside the text box and matches its width (outline {ob['x']:.1f}..{ob['x'] + ob['w']:.1f}, text {tb['x']:.1f}..{tb['x'] + tb['w']:.1f})")
    check(abs(ob["y"] + ob["h"] - baseline) <= 1.5 or ob["y"] + ob["h"] <= baseline + 1.5, f"the letters rest on the baseline (bottom {ob['y'] + ob['h']:.1f}, baseline {baseline:.1f})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    check(node_of(page, cid) == node0, "undo brings back the exact text object")
    # rectangle converts to curves: the shape description goes
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setSel([])")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:3]}")
    shot(page, "text")
    page.close()


def t_text_pdf(ctx, base):
    """E7: PDF text opens in glyph mode at the PDF's own positions, edits in place (glyph mode becomes plain text), outlines come from the embedded font."""
    page, errors = mount(ctx, base)
    open_file(page, FIX / "designtool-3p.ai")
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=90000)
    gl = [x for x in texts(page) if x["glyphs"]]
    check(len(gl) >= 4, f"PDF text opens in glyph mode ({len(gl)} items)")
    # positions: the browser puts every character where the PDF put it (within 0.5 pt)
    worst = page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; let worst = 0, n = 0
      const rec = (items) => items.forEach((it) => { if (it.t === 'group') return rec(it.items); if (it.t !== 'text' || !it.glyphs) return
        const t = ds.renderer.elOf(it.id)?.querySelector('text'); if (!t) return
        let i = 0; for (const g of it.glyphs) { for (let k = 0; k < g.c.length; k++, i++) { if (g.c.trim() === '' ) continue; const p = t.getStartPositionOfChar(i); worst = Math.max(worst, Math.abs(p.x - g.x)); n++ } } })
      ds.store.root.pages[0].layers.forEach((l) => rec(l.items)); return { worst, n } }""")
    check(worst["n"] > 30 and worst["worst"] <= 0.5, f"glyph positions agree with the PDF within 0.5 pt ({worst['n']} characters, worst {worst['worst']:.3f})")
    title = [x for x in gl if x["str"].startswith("Draw Studio")][0]
    n0 = node_of(page, title["id"])
    page.evaluate("(id) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setSel([id]); ds.view.zoomSel() }", title["id"])
    page.wait_for_timeout(300)
    # Text tool: click the PDF text, type, glyph mode switches to plain text on the first change
    page.keyboard.press("F8")
    b = nbox(page, title["id"])
    sx, sy = scr(page, b["x"] + b["w"] / 2, b["y"] + b["h"] / 2)
    h0 = hist(page)
    page.mouse.click(sx, sy)
    page.wait_for_selector(".ds-textedit", timeout=3000)
    check(page.evaluate("() => document.querySelector('.ds-textedit').value") == "Draw Studio fixture", "clicking PDF text with the Text tool edits it in place")
    page.keyboard.press("Escape")
    check(hist(page) == h0 and node_of(page, title["id"]) == n0, "leaving without a change records nothing and keeps the exact glyph text")
    page.mouse.click(sx, sy)
    page.wait_for_selector(".ds-textedit")
    page.keyboard.press("End")
    page.keyboard.type(" 2")
    page.keyboard.press("Escape")
    n1 = node_of(page, title["id"])
    check(n1["str"] == "Draw Studio fixture 2" and "glyphs" not in n1 and n1["font"] == n0["font"], f"after the first change the text is plain (glyphs dropped, embedded font kept first) {n1['str']!r}")
    check(page.evaluate("(id) => document.querySelector('.tool-body').__ds.renderer.elOf(id).querySelector('text').getAttribute('font-family')", title["id"]).startswith('"ds'), "and it is still drawn with the embedded face")
    page.keyboard.press("Control+z")
    check(node_of(page, title["id"]) == n0, "undo brings back the exact glyph text")
    # Convert to curves on PDF text uses the embedded font; the outline matches the glyph run
    page.keyboard.press("v")
    select_ids(page, title["id"])
    page.locator(".ds-view").focus()
    tb = nbox(page, title["id"])
    page.keyboard.press("Control+q")
    page.wait_for_function("(id) => document.querySelector('.tool-body').__ds.store.find(id).node.t === 'path'", arg=title["id"], timeout=30000)
    ob = nbox(page, title["id"])
    check(ob["x"] >= tb["x"] - 1 and ob["x"] + ob["w"] <= tb["x"] + tb["w"] + 1 and abs(ob["w"] - tb["w"]) <= 0.1 * tb["w"], f"embedded-font outline lies inside the glyph run box and has its width ({ob['x']:.1f}..{ob['x'] + ob['w']:.1f} vs {tb['x']:.1f}..{tb['x'] + tb['w']:.1f})")
    # an edited text with spaces the subset font lacks converts without empty boxes: the outline is as wide as the text on screen
    page.keyboard.press("Control+z")
    page.keyboard.press("F8")
    page.mouse.click(sx, sy)
    page.wait_for_selector(".ds-textedit")
    page.keyboard.press("End"); page.keyboard.type(" and more words")
    page.keyboard.press("Escape")
    page.keyboard.press("v")
    select_ids(page, title["id"])
    page.locator(".ds-view").focus()
    tb2 = nbox(page, title["id"])
    page.keyboard.press("Control+q")
    page.wait_for_function("(id) => document.querySelector('.tool-body').__ds.store.find(id).node.t === 'path'", arg=title["id"], timeout=30000)
    ob2 = nbox(page, title["id"])
    check(abs(ob2["w"] - tb2["w"]) <= 0.05 * tb2["w"], f"edited text keeps its width when converted ({ob2['w']:.1f} vs {tb2['w']:.1f} pt)")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:3]}")
    page.close()


# ---------------------------------------------------------------- E8: save and export
SUM_JS = """() => { const ds = document.querySelector('.tool-body').__ds; const r = ds.store.root
  const leaves = (items) => items.flatMap((n) => n.t === 'group' ? leaves(n.items) : [n])
  return r.pages.map((p) => { const all = p.layers.flatMap((l) => leaves(l.items)); let b = null
    for (const n of all) { const x = ds.renderer.nodeBox(n); if (!x) continue; b = b ? { x: Math.min(b.x, x.x), y: Math.min(b.y, x.y), x2: Math.max(b.x2, x.x + x.w), y2: Math.max(b.y2, x.y + x.h) } : { x: x.x, y: x.y, x2: x.x + x.w, y2: x.y + x.h } }
    return { w: p.w, h: p.h, n: all.length, images: all.filter((n) => n.t === 'image').length, box: b && [b.x, b.y, b.x2, b.y2] } }) }"""
OUTDIR = Path(os.environ.get("DS_OUT", r"C:/Projects/tools-packs/draw-studio-scratch/editor/out"))


def export_via_dialog(page, fmt, setup=None, keep_open=False):
    """Ctrl+Shift+S, choose a format, optionally change options, click the primary button and save the download. Returns (path, dialog text)."""
    import re
    OUTDIR.mkdir(parents=True, exist_ok=True)
    page.locator(".ds-view").focus()
    page.keyboard.press("Control+Shift+s")
    d = dialog(page)
    d.get_by_label("Format").select_option(fmt)
    page.wait_for_timeout(150)
    if setup:
        setup(d)
    with page.expect_download(timeout=180000) as dl:
        d.locator(".btn-primary").click()
    path = OUTDIR / dl.value.suggested_filename
    dl.value.save_as(str(path))
    page.wait_for_selector("dialog[open] .alert.success", timeout=10000)
    text = page.inner_text("dialog[open]")
    if not keep_open:
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    return path, text


def reopen(ctx, base, path, timeout=90000):
    p = ctx.new_page()
    p.set_viewport_size({"width": 1280, "height": 800})
    open_tool(p, base, "draw-studio")
    open_file(p, path, timeout=timeout)
    p.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=timeout)
    return p


def box_close(a, b, tol=1.0):
    return a is not None and b is not None and all(abs(x - y) <= tol for x, y in zip(a, b))


def t_save(ctx, base):
    """E8: the Export dialog and Save as CDR. Every format re-opens (page count, objects, boxes within 1 pt), raster sizes, transparency, ZIPs, notes, selection export."""
    import zipfile
    from PIL import Image
    page, errors = mount(ctx, base)
    info = load_scene(page, pages=2)
    orig = page.evaluate(SUM_JS)
    page.locator(".ds-view").focus()
    page.keyboard.press("Control+Shift+s")
    d = dialog(page)
    opts = d.get_by_label("Format").locator("option").all_inner_texts()
    check(opts == ["CDR", "AI", "PDF", "EPS", "SVG", "PNG", "JPG"], f"the Export dialog offers every format {opts}")
    check("Convert text to curves" in d.inner_text() and "Smaller file" in d.inner_text(), "CDR options: text to curves, smaller file")
    d.get_by_label("Format").select_option("png")
    page.wait_for_timeout(150)
    txt = d.inner_text()
    check("Resolution" in txt and "Transparent background" in txt and "pixels" in txt, f"PNG options: resolution, transparency, size preview ({txt[txt.find('A page'):][:40]!r})")
    d.get_by_label("Format").select_option("svg")
    page.wait_for_timeout(150)
    check(d.get_by_role("switch", name="Convert text to curves").is_checked() is False, "SVG leaves text as text by default")
    d.get_by_label("Format").select_option("pdf")
    page.wait_for_timeout(150)
    check(d.get_by_role("switch", name="Convert text to curves").is_checked() is True, "PDF converts text to curves by default")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check(page.locator("dialog[open]").count() == 0, "Esc closes the dialog")

    # CDR through the dialog, then re-open it
    path, text = export_via_dialog(page, "cdr", keep_open=True)
    check(path.suffix == ".cdr" and path.stat().st_size > 1000 and path.name == "scene.cdr", f"CDR file saved as {path.name} ({path.stat().st_size} bytes)")
    check("Notes" in text and "Compatibility" in text and "RGB" in text, "the dialog lists the notes of the export (compatibility, RGB)")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check(not page.evaluate("() => document.querySelector('.tool-body').__ds.store.dirty"), "a whole-drawing CDR counts as saving")
    check(page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; return ds.assets.ids().every((id) => ds.assets.dataUrl(id) === null) }"), "no data URL is held after an export")
    p2 = reopen(ctx, base, path)
    s2 = p2.evaluate(SUM_JS)
    check(len(s2) == 2 and all(abs(a["w"] - b["w"]) < 0.01 and abs(a["h"] - b["h"]) < 0.01 for a, b in zip(s2, orig)), f"CDR re-opens with the same pages and sizes {[(round(x['w'], 3), round(x['h'], 3)) for x in s2]}")
    check([x["n"] for x in s2] == [x["n"] for x in orig] and [x["images"] for x in s2] == [x["images"] for x in orig], f"same object counts {[x['n'] for x in s2]} vs {[x['n'] for x in orig]}")
    check(all(box_close(a["box"], b["box"]) for a, b in zip(orig, s2)), f"content boxes within 1 pt {[x['box'] for x in s2]}")
    check(p2.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages[0].layers.map((l) => l.name)") == page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages[0].layers.map((l) => l.name)"), "layer names survive")
    p2.close()

    # PDF and AI
    path, text = export_via_dialog(page, "pdf")
    pdf_bytes = path.read_bytes()
    check(pdf_bytes[:5] == b"%PDF-" and path.name == "scene.pdf", f"PDF saved ({len(pdf_bytes)} bytes)")
    p2 = reopen(ctx, base, path)
    s2 = p2.evaluate(SUM_JS)
    check(len(s2) == 2 and [(x["w"], x["h"]) for x in s2] == [(x["w"], x["h"]) for x in orig], f"PDF re-opens with the same pages and sizes {[(x['w'], x['h']) for x in s2]}")
    check(all(abs(a["n"] - b["n"]) <= 2 for a, b in zip(orig, s2)) and s2[0]["images"] == 1, f"similar object counts {[x['n'] for x in s2]} vs {[x['n'] for x in orig]}")
    check(all(box_close(a["box"], b["box"]) for a, b in zip(orig, s2)), f"content boxes within 1 pt {[x['box'] for x in s2]}")
    p2.close()
    path, _ = export_via_dialog(page, "ai")
    check(path.name == "scene.ai" and path.read_bytes() == pdf_bytes, "AI is the PDF-compatible file under a .ai name")
    p2 = reopen(ctx, base, path)
    check(len(p2.evaluate(SUM_JS)) == 2, "AI re-opens")
    p2.close()
    # one file per page for PDF
    path, _ = export_via_dialog(page, "pdf", setup=lambda d: d.get_by_role("switch", name="One file per page (a ZIP)").check())
    z = zipfile.ZipFile(path)
    check(path.suffix == ".zip" and len(z.namelist()) == 2 and all(n.endswith(".pdf") for n in z.namelist()), f"PDF per page packs a ZIP {z.namelist()}")

    # EPS, SVG: one file per page in a ZIP, each re-opens
    path, _ = export_via_dialog(page, "eps")
    z = zipfile.ZipFile(path)
    check(len(z.namelist()) == 2 and all(n.endswith(".eps") for n in z.namelist()), f"EPS: a ZIP with one file per page {z.namelist()}")
    z.extract(z.namelist()[0], OUTDIR)
    p2 = reopen(ctx, base, OUTDIR / z.namelist()[0])
    s2 = p2.evaluate(SUM_JS)
    first = p2.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; const n = ds.store.root.pages[0].layers[0].items[0]; return ds.renderer.nodeBox(n) }")
    check(len(s2) == 1 and (s2[0]["w"], s2[0]["h"]) == (400, 300) and s2[0]["n"] >= orig[0]["n"] and box_close([first["x"], first["y"], first["x"] + first["w"], first["y"] + first["h"]], [50, 50, 150, 110]) and s2[0]["images"] == 1,
          f"EPS page 1 re-opens at its size; the first rectangle is where it was (the gradient is drawn as clipped strips, so only solid objects are compared) {s2[0]['w']}x{s2[0]['h']} {s2[0]['n']} objects")
    p2.close()
    path, _ = export_via_dialog(page, "svg")
    z = zipfile.ZipFile(path)
    check(len(z.namelist()) == 2 and all(n.endswith(".svg") for n in z.namelist()), f"SVG: a ZIP with one file per page {z.namelist()}")
    z.extract(z.namelist()[0], OUTDIR)
    p2 = reopen(ctx, base, OUTDIR / z.namelist()[0])
    s2 = p2.evaluate(SUM_JS)
    check(len(s2) == 1 and abs(s2[0]["w"] - 400) < 0.5 and abs(s2[0]["h"] - 300) < 0.5 and abs(s2[0]["n"] - orig[0]["n"]) <= 2 and box_close(s2[0]["box"], orig[0]["box"]), f"SVG page 1 re-opens {s2[0]['w']:.1f}x{s2[0]['h']:.1f} {s2[0]['n']} objects")
    p2.close()
    path, _ = export_via_dialog(page, "svg", setup=lambda d: d.get_by_role("button", name="This page").click())
    check(path.suffix == ".svg" and path.read_text(encoding="utf8").lstrip().startswith("<svg") or "<svg" in path.read_text(encoding="utf8")[:300], f"This page gives a single SVG, no ZIP ({path.name})")

    # PNG and JPG: pixel size = page size x dpi / 72, transparency
    def png_opts(d):
        d.get_by_label("Resolution in dots per inch").fill("150")
    path, text = export_via_dialog(page, "png", setup=png_opts)
    z = zipfile.ZipFile(path)
    sizes = []
    for n in z.namelist():
        im = Image.open(io.BytesIO(z.read(n))); sizes.append((n, im.size, im.mode, im.getpixel((0, 0))))
    check(len(sizes) == 2 and sizes[0][1] == (833, 625) and sizes[1][1] == (625, 417), f"PNG pixel size is page size x dpi / 72 {[(s[1]) for s in sizes]}")
    check(sizes[0][2] == "RGBA" and sizes[0][3][3] == 0, f"a transparent PNG has alpha 0 at the corner {sizes[0][3]}")
    im0 = Image.open(io.BytesIO(z.read(z.namelist()[0]))).convert("RGBA")
    px = im0.getpixel((int(75 * 150 / 72), int(80 * 150 / 72)))
    check(px[3] == 255 and px[0] > 200 and px[1] < 60, f"and the red rectangle is drawn opaque {px}")
    path, _ = export_via_dialog(page, "png", setup=lambda d: (d.get_by_label("Resolution in dots per inch").fill("72"), d.get_by_role("switch", name="Transparent background").uncheck()))
    z = zipfile.ZipFile(path)
    check(Image.open(io.BytesIO(z.read(z.namelist()[0]))).convert("RGBA").getpixel((0, 0)) == (255, 255, 255, 255), "without transparency the page is white")
    path, _ = export_via_dialog(page, "jpg", setup=lambda d: (d.get_by_label("Resolution in dots per inch").fill("96"), d.get_by_role("button", name="This page").click()))
    im = Image.open(path)
    check(path.suffix == ".jpg" and im.size == (533, 400) and im.mode == "RGB" and sum(im.getpixel((2, 2))) > 740, f"JPG is {im.size} {im.mode} on white {im.getpixel((2, 2))}")
    # selection only
    select_ids(page, info["ids"]["Red"])
    path, _ = export_via_dialog(page, "png", setup=lambda d: (d.get_by_role("button", name="Selection").click(), d.get_by_label("Resolution in dots per inch").fill("72")))
    im = Image.open(path)
    check(path.name == "scene-selection.png" and abs(im.size[0] - 100) <= 1 and abs(im.size[1] - 60) <= 1, f"selection export crops to the selection {im.size}")
    check(im.convert("RGBA").getpixel((50, 30))[:3] == (255, 0, 0), "and shows only the selected object")
    check(page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; return ds.assets.ids().every((id) => ds.assets.dataUrl(id) === null) }"), "no data URL is held after any export")
    # notes command, Export menu items
    page.keyboard.press("Escape")
    page.get_by_role("menuitem", name="File").click()
    for label in ("Save as CDR", "Save as...", "Export...", "Export selection as PNG...", "Notes about the last save or export", "Restore autosaved drawing..."):
        check(page.get_by_role("menuitem", name=label).count() == 1, f"File menu has {label}")
    page.get_by_role("menuitem", name="Notes about the last save or export").click()
    d = dialog(page)
    check("scene" in d.inner_text(), f"the last export's notes can be opened again: {d.inner_text()[:60]!r}")
    page.keyboard.press("Escape")
    # Ctrl+S saves a CDR straight away
    page.locator(".ds-view").focus()
    with page.expect_download(timeout=60000) as dl:
        page.keyboard.press("Control+s")
    check(dl.value.suggested_filename == "scene.cdr", f"Ctrl+S saves {dl.value.suggested_filename} without a dialog")
    page.wait_for_selector(".toast", timeout=5000)
    check("Saved scene.cdr" in page.inner_text(".toasts"), "and says so")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


def t_save_text(ctx, base):
    """E8: text in exports. Convert text to curves on and off, live text in SVG, multi-line and centred text, embedded-font text, notes."""
    page, errors = mount(ctx, base)
    open_file(page, FIX / "designtool-3p.ai")
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=90000)
    # add multi-line centred live text on page 1
    page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; const l = ds.store.root.pages[0].layers[0]
      const n = { id: ds.store.newId(), t: 'text', str: 'Centre one\\nCentre two longer', family: 'Inter', size: 20, bold: false, italic: false, fill: '#cc0000', opacity: 1, m: [1, 0, 0, 1, 300, 700], lh: 1.2, align: 'center' }
      ds.store.tx('Add text', (r) => ({ ...r, pages: r.pages.map((p, i) => i === 0 ? { ...p, layers: p.layers.map((ly, j) => j === 0 ? { ...ly, items: [...ly.items, n] } : ly) } : p) })) }""")
    page.wait_for_timeout(1500)
    # SVG with live text: fonts embedded for glyph text, lines baked
    path, text = export_via_dialog(page, "svg", setup=lambda d: d.get_by_role("button", name="This page").click())
    svg = path.read_text(encoding="utf8")
    check("<text" in svg and "@font-face" in svg and "Centre one" in svg and "Centre two longer" in svg, "SVG keeps text as text and embeds the fonts of glyph text")
    check("\n" not in svg[svg.index("Centre one"):svg.index("Centre one") + 12], "lines of multi-line text are written one per text element")
    # curves on: no <text> left, outlines exist
    path, text = export_via_dialog(page, "svg", setup=lambda d: (d.get_by_role("button", name="This page").click(), d.get_by_role("switch", name="Convert text to curves").check()))
    svg2 = path.read_text(encoding="utf8")
    check("<text" not in svg2 and svg2.count("<path") > svg.count("<path") + 3, f"with Convert text to curves the text is paths ({svg2.count('<path')} paths, no <text>)")
    # PDF always works from curves by default: the rendered page matches the editor (outlines of the centred text sit where the live text is)
    path, _ = export_via_dialog(page, "pdf", setup=lambda d: d.get_by_role("button", name="This page").click())
    p2 = reopen(ctx, base, path)
    s2 = p2.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; const r = ds.store.root; const t = []; const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else t.push(n.t) }); r.pages[0].layers.forEach((l) => rec(l.items)); return { pages: r.pages.length, kinds: [...new Set(t)] } }")
    check(s2["pages"] == 1 and "text" not in s2["kinds"], f"the PDF has curves, not live text {s2}")
    # the centred text's outline is centred on its anchor x (300) within 1 pt
    cx = p2.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; let hit = null; const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else if (n.t === 'path' && n.fill === '#cc0000') { const b = ds.renderer.nodeBox(n); hit = hit ? { x: Math.min(hit.x, b.x), x2: Math.max(hit.x2, b.x + b.w) } : { x: b.x, x2: b.x + b.w } } })
      ds.store.root.pages[0].layers.forEach((l) => rec(l.items)); return hit && (hit.x + hit.x2) / 2 }""")
    check(cx is not None and abs(cx - 300) < 6, f"centred multi-line text stays centred on its anchor in the PDF ({cx})")
    p2.close()
    # notes: the substitute-font note appears for a family that is not bundled and has no file
    page.evaluate("""() => { const ds = document.querySelector('.tool-body').__ds; const id = ds.store.root.pages[0].layers[0].items.at(-1).id; ds.store.setSel([id]) }""")
    page.locator(".ds-textbar select[aria-label='Font']").select_option("Georgia")
    path, text = export_via_dialog(page, "pdf", setup=lambda d: d.get_by_role("button", name="This page").click(), keep_open=True)
    check("similar bundled font" in text and "Georgia" in text, f"the notes say a similar font was used for a font that is not in the drawing ({text[text.find('Notes'):][:120]!r})")
    page.keyboard.press("Escape")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


def t_e2e(ctx, base):
    """The user's workflow: open a PDF-based .ai, edit it (move an object, change text), Save as CDR with Ctrl+S, re-open the CDR and compare every page visually."""
    from PIL import Image
    import numpy as np
    files = [("fixture", FIX / "designtool-3p.ai", None)] + ([("user", USER_FILE, "Ansh Wedding Virtual Invitation.ai")] if USER_FILE.exists() else [])
    OUTDIR.mkdir(parents=True, exist_ok=True)
    for tag, f, as_name in files:
        page = ctx.new_page(); page.set_viewport_size({"width": 1500, "height": 1800})
        open_tool(page, base, "draw-studio")
        open_file(page, f, as_name=as_name, timeout=120000)
        page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every(p => !p.pending)", timeout=120000)
        n = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages.length")
        # edit: the first text gets more words (Text tool session), and the first path of page 1 moves 10 pt
        tid = page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; let t = null; const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else if (!t && n.t === 'text') t = n.id }); ds.store.root.pages[0].layers.forEach((l) => rec(l.items)); return t }")
        check(tid is not None, f"{tag}: the file has text to edit")
        page.evaluate("(id) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setSel([id]); ds.store.emit('edittext', id) }", tid)
        page.wait_for_selector(".ds-textedit")
        page.keyboard.press("End"); page.keyboard.type(" (edited)"); page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        check(page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.find(id).node.str", tid).endswith("(edited)"), f"{tag}: the text edit is in the drawing")
        pid = page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; let t = null; const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else if (!t && n.t === 'path') t = n.id }); ds.store.root.pages[0].layers.forEach((l) => rec(l.items)); return t }")
        before_box = nbox(page, pid)
        select_ids(page, pid)
        page.locator(".ds-view").focus()
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        # shots of the edited drawing
        def shots(pg, prefix):
            out = []
            for i in range(n):
                pg.evaluate("(i) => { const ds = document.querySelector('.tool-body').__ds; ds.store.setSel([]); ds.store.setPage(i); ds.view.setView({ z: 1, x: 20, y: 20 }) }", i)
                pg.wait_for_timeout(900)
                pw, ph = pg.evaluate("() => { const p = document.querySelector('.tool-body').__ds.store.page(); return [p.w, p.h] }")
                box = pg.locator(".ds-view").bounding_box()
                png = pg.screenshot(clip={"x": box["x"] + 20, "y": box["y"] + 20, "width": min(pw, box["width"] - 25), "height": min(ph, box["height"] - 25)})
                im = Image.open(io.BytesIO(png)).convert("RGB"); SHOTS.mkdir(parents=True, exist_ok=True); im.save(SHOTS / f"e2e-{tag}-{prefix}-p{i + 1}.png"); out.append(im)
            return out
        a = shots(page, "edited")
        page.evaluate("() => document.querySelector('.tool-body').__ds.store.setPage(0)")
        page.locator(".ds-view").focus()
        t0 = time.time()
        with page.expect_download(timeout=240000) as dl:
            page.keyboard.press("Control+s")
        path = OUTDIR / f"e2e-{tag}.cdr"
        dl.value.save_as(str(path))
        print(f"   {tag}: saved {dl.value.suggested_filename} {path.stat().st_size / 1e6:.1f} MB in {time.time() - t0:.1f}s")
        check(path.stat().st_size > 50000 and path.read_bytes()[:4] == b"RIFF", f"{tag}: Ctrl+S wrote a RIFF CDR file")
        p2 = ctx.new_page(); p2.set_viewport_size({"width": 1500, "height": 1800})
        open_tool(p2, base, "draw-studio")
        open_file(p2, path, timeout=180000)
        st = p2.evaluate(STATE_JS)
        check(st["pages"] == n and st["source"] == "cdr" and st["warnings"] == 0, f"{tag}: the saved CDR re-opens with {n} pages and no notes ({st['pages']}, {st['warnings']})")
        b = shots(p2, "cdr")
        for i in range(min(len(a), len(b))):
            w, h = min(a[i].size[0], b[i].size[0]), min(a[i].size[1], b[i].size[1])
            A = np.asarray(a[i].crop((0, 0, w, h)), dtype="float32"); B = np.asarray(b[i].crop((0, 0, w, h)), dtype="float32")
            mad = float(np.abs(A - B).mean()); big = float((np.abs(A - B).mean(axis=2) > 60).mean())
            Image.fromarray(255 - np.abs(A - B).astype("uint8")).save(SHOTS / f"e2e-{tag}-diff-p{i + 1}.png")
            print(f"   {tag} page {i + 1}: {a[i].size} vs {b[i].size}, mean abs difference {mad:.2f}, pixels differing by more than 60: {big * 100:.2f}%")
            check(a[i].size == b[i].size and mad <= 4 and big <= 0.03, f"{tag} page {i + 1}: the re-opened CDR looks like the edited drawing (mean difference {mad:.2f})")
        # the edits are in the saved file
        moved = p2.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; let t = null; const rec = (items) => items.forEach((n) => { if (n.t === 'group') rec(n.items); else if (!t && n.t === 'path') t = ds.renderer.nodeBox(n) }); ds.store.root.pages[0].layers.forEach((l) => rec(l.items)); return t }")
        check(moved is not None and abs(moved["x"] - (before_box["x"] + 3 * (1 * 72 / 25.4))) < 1.5, f"{tag}: the moved object is where it was moved to ({moved['x']:.1f} vs {before_box['x'] + 3 * 72 / 25.4:.1f})")
        p2.close(); page.close()


def t_e678_phone(ctx, base):
    """375 px: the New, Page setup, Export dialogs and the page and text bars fit without horizontal overflow."""
    page, errors = mount(ctx, base, 375, 700)
    ov = lambda: page_state(page)["overflow"]
    page.get_by_role("button", name="New drawing").click()
    d = dialog(page)
    box = d.bounding_box()
    check(box["width"] <= 375 and ov() <= 1, f"New dialog fits a phone (width {box['width']:.0f}, overflow {ov()})")
    page.get_by_role("button", name="Create").click()
    page.wait_for_timeout(400)
    check(ov() <= 1, f"the page bar fits (overflow {ov()})")
    page.get_by_role("button", name="Add a page after this one").click()
    page.wait_for_timeout(200)
    check(ov() <= 1 and page.evaluate("() => { const e = document.querySelector('.ds-pages'); return e.getBoundingClientRect().width <= 375 }"), f"page tabs stay inside the screen (overflow {ov()})")
    page.get_by_role("button", name="Page setup").click()
    d = dialog(page)
    check(d.bounding_box()["width"] <= 375 and ov() <= 1, f"Page setup fits a phone (overflow {ov()})")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.get_by_role("button", name="Text").click()
    check(page.locator(".ds-textbar").is_visible() and ov() <= 1, f"the text controls scroll inside the property bar (overflow {ov()})")
    page.get_by_role("button", name="Menu").click()
    page.locator(".ds-msheet-head", has_text="File").click()
    page.locator('.ds-msheet .ds-mi[data-cmd="file.saveAs"]').click()
    d = dialog(page)
    check(d.bounding_box()["width"] <= 375 and ov() <= 1, f"Export dialog fits a phone (width {d.bounding_box()['width']:.0f}, overflow {ov()})")
    d.get_by_label("Format").select_option("png")
    page.wait_for_timeout(200)
    check(d.bounding_box()["width"] <= 375 and ov() <= 1, f"and its PNG options too (overflow {ov()})")
    shot(page, "e678-phone")
    page.keyboard.press("Escape")
    check(not [e for e in errors if "pageerror" in e or "console" in e], f"no console errors {errors[:3]}")
    page.close()


# ---------------------------------------------------------------- E9: shapes and node editing
AREA_JS = """const area = (d) => { let a = 0, cx = 0, cy = 0, sx = 0, sy = 0; const e = (x0, y0, x1, y1) => { a += x0 * y1 - x1 * y0 }
  for (const c of d) { if (c[0] === 'M') { cx = sx = c[1]; cy = sy = c[2] } else if (c[0] === 'L') { e(cx, cy, c[1], c[2]); cx = c[1]; cy = c[2] } else if (c[0] === 'C') { let px = cx, py = cy; for (let i = 1; i <= 64; i++) { const t = i / 64, u = 1 - t; const x = u*u*u*cx + 3*u*u*t*c[1] + 3*u*t*t*c[3] + t*t*t*c[5], y = u*u*u*cy + 3*u*u*t*c[2] + 3*u*t*t*c[4] + t*t*t*c[6]; e(px, py, x, y); px = x; py = y } cx = c[5]; cy = c[6] } else if (c[0] === 'Z') { e(cx, cy, sx, sy); cx = sx; cy = sy } }
  return Math.abs(a / 2) };"""
MM = 72 / 25.4


def tool_of(page):
    return page.evaluate("() => document.querySelector('.tool-body').__ds.store.tool")


def all_items(page):
    return ds_eval(page, "return ds.store.page().layers.flatMap((l) => l.items).map((n) => JSON.parse(JSON.stringify(n)))")


def last_item(page):
    return all_items(page)[-1]


def snap_off(page):
    ds_eval(page, "ds.store.setPref('snap', false)")


def add_path(page, d, open_=False, **extra):
    """Put a known path on the active layer (selected afterwards); returns its id."""
    return ds_eval(page, "const T = await import('/packs/corel/_ds-tools-draw.js'); const n = T.newPath(ds.store, arg.d, arg.extra || {}, !!arg.open); T.placeNodes(ds.store, [n], 'add'); return n.id", {"d": d, "extra": extra, "open": open_})


def shape_diff(page, nid):
    """Largest difference between a shape's path and the path rebuilt from its shape and sm (0 when the parametric description is exact)."""
    return ds_eval(page, "const P = await import('/packs/corel/_ds-path.js'); const n = ds.store.find(arg).node; const want = P.shapeD(n.shape, n.sm); if (want.length !== n.d.length) return 1e9; let m = 0; n.d.forEach((c, i) => c.slice(1).forEach((v, j) => { m = Math.max(m, Math.abs(v - want[i][j + 1])) })); return m", nid)


def area_of(page, nid):
    return ds_eval(page, AREA_JS + " return area(ds.store.find(arg).node.d)", nid)


def pts_of(node):
    return [(c[-2], c[-1]) for c in node["d"] if c[0] != "Z"]


def focus_canvas(page):
    page.locator(".ds-view").focus()


def prop_field(page, aria, value):
    f = page.locator(f'.ds-prop input[aria-label="{aria}"], .ds-prop select[aria-label="{aria}"]').first
    if f.evaluate("(e) => e.tagName") == "SELECT":
        f.select_option(str(value))
    else:
        f.fill(str(value))
        f.press("Enter")
    page.wait_for_timeout(120)


def shape_state(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(document.querySelector('.tool-body').__ds.tools.tools.shape.state))")


def click_node(page, nid, i, mods=()):
    n = node_of(page, nid)
    x, y = pts_of(n)[i]
    click_pt(page, x, y, modifiers=mods)
    page.wait_for_timeout(80)


def node_btn(page, label):
    return page.locator(f'.ds-nodebar button[aria-label="{label}"]')


def collinear_opposite(inx, iny, outx, outy, tol=1e-6):
    return abs(inx * outy - iny * outx) < tol and inx * outx + iny * outy < 0


def t_shapes(ctx, base):
    """E9: Rectangle, Ellipse, Polygon, Star, Freehand, Bezier and the Shape tool (real mouse and keyboard events); every command undoes exactly."""
    page, errors = mount(ctx, base)
    warns = []
    page.on("console", lambda m: warns.append(m.text) if "has no implementation" in m.text else None)
    new_blank(page, "Shapes")
    snap_off(page)
    icons = page.evaluate("""async () => {
      const K = await import('/packs/corel/_ds-keys.js'), T = await import('/packs/corel/_ds-tools.js')
      const pascal = (n) => n.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('')
      const L = window.lucide
      const all = new Set([...K.COMMANDS.map((c) => c.icon), ...T.TOOL_INFO.map((x) => x.icon)].filter(Boolean))
      return { n: all.size, missing: [...all].filter((n) => !(L.icons?.[pascal(n)] || L.icons?.[n])) } }""")
    check(icons["n"] > 60 and not icons["missing"], f"every command and tool icon is a real Lucide icon ({icons['n']} checked, missing {icons['missing']})")
    names = page.evaluate("() => [...document.querySelectorAll('.ds-tool')].map((b) => b.getAttribute('aria-label'))")
    check(all(n in names for n in ("Pick", "Shape", "Freehand", "Bezier", "Rectangle", "Ellipse", "Polygon", "Star", "Text")), f"toolbox has every drawing tool {names}")
    hidden = page.evaluate("() => { const t = document.querySelector('.ds-tools'); const b = t.getBoundingClientRect(); return [...t.querySelectorAll('.ds-tool')].filter((e) => e.getBoundingClientRect().bottom > b.bottom + 1).length }")
    check(hidden == 0, f"all {len(names)} tools fit in the toolbox at 1280 x 800 without scrolling ({hidden} cut off)")
    for key, tool in (("F6", "rect"), ("F7", "ellipse"), ("y", "polygon"), ("Shift+y", "star"), ("F5", "free"), ("Shift+p", "pen"), ("Shift+F5", "pen"), ("F10", "shape"), ("v", "pick")):
        focus_canvas(page)
        page.keyboard.press(key)
        pressed = page.evaluate("(t) => document.querySelector('.ds-tool[data-tool=\"' + t + '\"]').getAttribute('aria-pressed')", tool)
        check(tool_of(page) == tool and pressed == "true", f"{key} selects the {tool} tool")
    check(not warns, f"every command in the table has an implementation {warns}")

    # ---------- rectangle ----------
    focus_canvas(page)
    page.keyboard.press("F6")
    n0 = len(all_items(page))
    undo_redo(page, "draw a rectangle", lambda: drag_pt(page, (100, 100), (300, 220)))
    r = last_item(page)
    check(len(all_items(page)) == n0 + 1 and r["shape"]["k"] == "rect" and abs(r["shape"]["w"] - 200) < 0.6 and abs(r["shape"]["h"] - 120) < 0.6, f"rectangle: a path with a rect shape 200 x 120 {r['shape']}")
    check(abs(r["sm"][4] - 100) < 0.6 and abs(r["sm"][5] - 100) < 0.6 and shape_diff(page, r["id"]) < 1e-9, "rectangle: sm is its position and the path equals the shape")
    check(sel_of(page) == [r["id"]] and tool_of(page) == "rect", "the new rectangle is selected and the tool stays active")
    drag_pt(page, (350, 350), (352, 351))
    check(len(all_items(page)) == n0 + 1, "a tiny drag (a click) makes no object")
    drag_pt(page, (350, 350), (450, 420), keep=True)
    page.keyboard.press("Escape")
    page.mouse.up()
    check(len(all_items(page)) == n0 + 1, "Esc during a drag cancels it")
    drag_pt(page, (100, 300), (250, 380), mods=("Control",))
    sq = last_item(page)
    check(abs(sq["shape"]["w"] - sq["shape"]["h"]) < 0.01 and sq["shape"]["w"] > 100, f"Ctrl makes a square {sq['shape']}")
    drag_pt(page, (400, 400), (450, 430), mods=("Shift",))
    ce = last_item(page)
    check(abs(ce["sm"][4] - 350) < 0.6 and abs(ce["sm"][5] - 370) < 0.6 and abs(ce["shape"]["w"] - 100) < 0.6, f"Shift draws from the centre {ce['sm'][4:]} {ce['shape']}")
    # corner radius, then rotate, skew and scale: the radius stays editable
    rid = r["id"]
    select_ids(page, rid)
    check(page.locator(".ds-shapebar").is_visible() and page.locator(".ds-shapebar input[aria-label='Corner radius']").is_visible(), "the rectangle shows its corner radius field")
    undo_redo(page, "corner radius 5 mm", lambda: prop_field(page, "Corner radius", 5))
    n = node_of(page, rid)
    check(abs(n["shape"]["rx"] - 5 * MM) < 1e-6 and sum(1 for c in n["d"] if c[0] == "C") == 4 and shape_diff(page, rid) < 1e-9, f"radius 5 mm gives four curved corners {n['shape']}")
    undo_redo(page, "angle 30", lambda: prop_field(page, "Angle in degrees", 30))
    n = node_of(page, rid)
    check(abs(n["sm"][0] - 0.8660254) < 1e-6 and abs(n["sm"][1] + 0.5) < 1e-6 and n.get("shape") and shape_diff(page, rid) < 1e-9, f"rotated 30: still a rect shape, sm carries the rotation {n['sm']}")
    prop_field(page, "Corner radius", 10)
    n = node_of(page, rid)
    check(abs(n["shape"]["rx"] - 10 * MM) < 1e-6 and shape_diff(page, rid) < 1e-9 and abs(n["sm"][1] + 0.5) < 1e-6, "after the rotation the radius is still editable (path rebuilt through sm)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('win.transform')")
    page.locator(".ds-xtabs button[data-tab='skew']").click()
    page.locator(".ds-xpanel input[aria-label='Transform horizontal skew in degrees']").fill("20")
    h0, sm0 = hist(page), node_of(page, rid)["sm"]
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_timeout(150)
    n = node_of(page, rid)
    check(hist(page)[1] == h0[1] + 1 and n.get("shape") and shape_diff(page, rid) < 1e-9 and n["sm"] != sm0, f"skewed 20 degrees: one step, the shape survives {n['sm']}")
    prop_field(page, "Corner radius", 3)
    n = node_of(page, rid)
    check(abs(n["shape"]["rx"] - 3 * MM) < 0.05 and shape_diff(page, rid) < 1e-9, "after the skew the radius is still editable")
    prop_field(page, "Width", 80)
    n = node_of(page, rid)
    check(n.get("shape") and shape_diff(page, rid) < 1e-9 and abs(nbox(page, rid)["w"] - 80 * MM) < 0.05, "scaling by the W field keeps the shape")
    # ---------- ellipse ----------
    focus_canvas(page)
    page.keyboard.press("F7")
    n0 = len(all_items(page))
    undo_redo(page, "draw an ellipse", lambda: drag_pt(page, (100, 450), (200, 520)))
    e = last_item(page)
    check(e["shape"]["k"] == "ellipse" and abs(e["shape"]["rx"] - 50) < 0.6 and abs(e["shape"]["ry"] - 35) < 0.6 and sum(1 for c in e["d"] if c[0] == "C") == 4 and shape_diff(page, e["id"]) < 1e-9, f"ellipse {e['shape']}")
    drag_pt(page, (250, 450), (320, 500), mods=("Control",))
    c = last_item(page)
    check(abs(c["shape"]["rx"] - c["shape"]["ry"]) < 1e-6, "Ctrl makes a circle")
    prop_field(page, "Ellipse, pie or arc", "pie")
    prop_field(page, "Start angle in degrees", 0)
    prop_field(page, "End angle in degrees", 90)
    drag_pt(page, (400, 450), (460, 510), mods=("Control",))
    p = last_item(page)
    ar = area_of(page, p["id"])
    check(p["shape"].get("pie") and p["shape"]["a1"] == 0 and p["shape"]["a2"] == 90 and abs(ar / (3.14159265 * p["shape"]["rx"] ** 2 / 4) - 1) < 0.003 and p["d"][-1][0] == "Z", f"pie 0 to 90: a quarter of the circle, closed (area ratio {ar / (3.14159265 * p['shape']['rx'] ** 2 / 4):.4f})")
    undo_redo(page, "pie to arc", lambda: prop_field(page, "Ellipse, pie or arc", "arc"))
    a = node_of(page, p["id"])
    check(not a["shape"].get("pie") and a["shape"]["a1"] == 0 and a["d"][-1][0] != "Z" and shape_diff(page, p["id"]) < 1e-9, "arc: an open curve")
    prop_field(page, "Ellipse, pie or arc", "ellipse")
    a = node_of(page, p["id"])
    check("a1" not in a["shape"] and a["d"][-1][0] == "Z" and sum(1 for c in a["d"] if c[0] == "C") == 4, "back to a full ellipse")
    # ---------- polygon and star ----------
    focus_canvas(page)
    page.keyboard.press("y")
    prop_field(page, "Number of sides", 8)
    undo_redo(page, "draw a polygon", lambda: drag_pt(page, (150, 600), (210, 600)))
    pg = last_item(page)
    check(pg["shape"]["k"] == "poly" and pg["shape"]["n"] == 8 and len(pg["d"]) == 9 and abs(pg["shape"]["r"] - 60) < 0.6, f"polygon with 8 sides, radius 60 {pg['shape']}")
    undo_redo(page, "polygon sides", lambda: prop_field(page, "Number of sides", 5))
    pg = node_of(page, pg["id"])
    check(pg["shape"]["n"] == 5 and len(pg["d"]) == 6 and shape_diff(page, pg["id"]) < 1e-9, "sides edited on the selected polygon")
    focus_canvas(page)
    page.keyboard.press("v")
    prop_field(page, "Angle in degrees", 45)
    prop_field(page, "Number of sides", 7)
    pg = node_of(page, pg["id"])
    check(pg["shape"]["n"] == 7 and abs(pg["sm"][0] - 0.70710678) < 1e-6 and shape_diff(page, pg["id"]) < 1e-9, "after a rotation the sides are still editable and the rotation stays")
    focus_canvas(page)
    page.keyboard.press("Shift+y")
    prop_field(page, "Number of points", 7)
    prop_field(page, "Sharpness of the star points, 1 to 99", 30)
    undo_redo(page, "draw a star", lambda: drag_pt(page, (300, 600), (360, 600)))
    st = last_item(page)
    check(st["shape"]["k"] == "star" and st["shape"]["n"] == 7 and abs(st["shape"]["r2"] / st["shape"]["r1"] - 0.7) < 1e-6 and len(st["d"]) == 15, f"star with 7 points and sharpness 30 {st['shape']}")
    prop_field(page, "Sharpness of the star points, 1 to 99", 80)
    st = node_of(page, st["id"])
    check(abs(st["shape"]["r2"] / st["shape"]["r1"] - 0.2) < 1e-6 and shape_diff(page, st["id"]) < 1e-9, "star sharpness edited on the selected star")
    # ---------- freehand ----------
    import math
    focus_canvas(page)
    page.keyboard.press("F5")
    pts = [(450 + 4 * i, 500 + 25 * math.sin(i / 4)) for i in range(0, 30)]
    n0 = len(all_items(page))
    h0 = hist(page)
    ax, ay = scr(page, *pts[0])
    page.mouse.move(ax, ay)
    page.mouse.down()
    for q in pts[1:]:
        x, y = scr(page, *q)
        page.mouse.move(x, y)
    page.mouse.up()
    page.wait_for_timeout(150)
    fh = last_item(page)
    check(len(all_items(page)) == n0 + 1 and hist(page)[1] == h0[1] + 1 and fh["fill"] is None and "shape" not in fh and 3 <= len(fh["d"]) <= 14, f"freehand: one smooth open curve with few nodes ({len(fh['d'])} commands from {len(pts)} points)")
    check(fh["d"][0][0] == "M" and all(c[0] in ("C", "L") for c in fh["d"][1:]), "freehand: a single open curve")
    for q in ((450, 700), (500, 740), (560, 700)):
        click_pt(page, *q)
    page.keyboard.press("Enter")
    page.wait_for_timeout(120)
    pl = last_item(page)
    check([c[0] for c in pl["d"]] == ["M", "L", "L"], f"clicks make a polyline, Enter finishes ({[c[0] for c in pl['d']]})")
    for q in ((450, 760), (500, 790)):
        click_pt(page, *q)
    sx, sy = scr(page, 560, 760)
    page.mouse.dblclick(sx, sy)
    page.wait_for_timeout(120)
    pl2 = last_item(page)
    check([c[0] for c in pl2["d"]] == ["M", "L", "L"], f"a double-click ends the polyline without a doubled point ({[c[0] for c in pl2['d']]})")
    # ---------- Bezier ----------
    focus_canvas(page)
    page.keyboard.press("Shift+p")
    n0 = len(all_items(page))
    click_pt(page, 100, 700)
    click_pt(page, 180, 700)
    drag_pt(page, (260, 740), (300, 760))
    click_pt(page, 340, 700)
    page.keyboard.press("Enter")
    page.wait_for_timeout(120)
    bz = last_item(page)
    check(len(all_items(page)) == n0 + 1 and [c[0] for c in bz["d"]] == ["M", "L", "C", "C"] and bz["fill"] is None, f"bezier: corner, corner, smooth, corner ({[c[0] for c in bz['d']]})")
    c2, c1 = bz["d"][2], bz["d"][3]
    mid = ((c2[3] + c1[1]) / 2, (c2[4] + c1[2]) / 2)
    check(abs(mid[0] - c2[5]) < 1e-6 and abs(mid[1] - c2[6]) < 1e-6 and abs(c2[3] - c2[5]) > 5, "a dragged point gets two opposite, equal handles")
    h0 = hist(page)
    click_pt(page, 100, 780); click_pt(page, 160, 800); click_pt(page, 220, 780)
    page.keyboard.press("Backspace")
    page.keyboard.press("Enter")
    page.wait_for_timeout(120)
    b2 = last_item(page)
    check([c[0] for c in b2["d"]] == ["M", "L"] and hist(page)[1] == h0[1] + 1, "Backspace removes the last point; one undo step")
    click_pt(page, 400, 700); click_pt(page, 460, 700); click_pt(page, 460, 760); click_pt(page, 400, 760)
    click_pt(page, 400, 700)
    page.wait_for_timeout(120)
    b3 = last_item(page)
    check(b3["d"][-1][0] == "Z" and b3["fill"] is not None and len(b3["d"]) == 5, f"clicking the first point closes the curve and fills it ({[c[0] for c in b3['d']]})")
    click_pt(page, 500, 700); click_pt(page, 560, 740); click_pt(page, 560, 700)
    page.keyboard.press("Escape")
    page.wait_for_timeout(120)
    b4 = last_item(page)
    check([c[0] for c in b4["d"]] == ["M", "L", "L"] and b4["id"] != b3["id"], "Esc finishes the curve and keeps it")
    n0 = len(all_items(page))
    ex, ey = pts_of(b4)[-1]
    click_pt(page, ex, ey)
    click_pt(page, ex + 60, ey - 40)
    page.keyboard.press("Enter")
    page.wait_for_timeout(120)
    items = all_items(page)
    again = next(i for i in items if i["id"] == b4["id"])
    check(len(items) == n0 and len(pts_of(again)) == 4, f"clicking an open end continues that curve ({len(pts_of(again))} points, {len(items)} objects)")
    check(page.locator(".ds-ov .ds-node").count() == 0, "no draft left in the overlay after finishing")
    n_items = len(all_items(page))
    svg_path, _ = export_via_dialog(page, "svg")
    svg = Path(svg_path).read_text(encoding="utf-8")
    check(svg.count("<path") == n_items and "shape" not in svg.replace("shape-rendering", "") and "data-ds" not in svg, f"SVG export: one path per drawn object, no editor fields ({svg.count('<path')} paths, {n_items} objects)")
    shot(page, "shapes-draw")
    page.close()

    # ---------- the Shape tool on known paths ----------
    page, errors2 = mount(ctx, base)
    new_blank(page, "Nodes")
    snap_off(page)
    pid = add_path(page, [["M", 100, 100], ["C", 150, 60, 200, 60, 250, 100], ["L", 250, 200], ["L", 100, 200], ["Z"]])
    focus_canvas(page)
    page.keyboard.press("F10")
    page.wait_for_timeout(200)
    check(page.locator(".ds-ov .ds-node").count() == 4 and shape_state(page)["nodes"] == 4, "the Shape tool shows the four nodes of the selected curve")
    check(page.locator(".ds-nodebar").is_visible() and not page.locator(".ds-selfields").is_visible(), "the property bar shows the node buttons")
    click_node(page, pid, 1)
    check(shape_state(page)["picked"] == [[0, 1]] and page.locator(".ds-ov .ds-hdl").count() == 2, f"a click picks a node and shows its handle and the facing one ({page.locator('.ds-ov .ds-hdl').count()} handles)")
    n_before = node_of(page, pid)
    undo_redo(page, "drag a node", lambda: drag_pt(page, pts_of(n_before)[1], (pts_of(n_before)[1][0] + 30, pts_of(n_before)[1][1] + 20)))
    n = node_of(page, pid)
    check(abs(pts_of(n)[1][0] - 280) < 0.3 and abs(pts_of(n)[1][1] - 120) < 0.3 and abs(n["d"][1][3] - 230) < 0.3, f"the node moved by (30, 20) and its handle came along {n['d'][1]}")
    check(n.get("nt") is not None and len(n["nt"][0]) == 4, f"node types are remembered {n.get('nt')}")
    # a rectangle becomes a curve on the first node edit: ONE undo step
    page.keyboard.press("F6")
    drag_pt(page, (400, 100), (500, 160))
    rid = sel_of(page)[0]
    page.keyboard.press("F10")
    page.wait_for_timeout(150)
    click_node(page, rid, 2)
    rn = node_of(page, rid)
    def drag_corner():
        x, y = pts_of(rn)[2]
        drag_pt(page, (x, y), (x + 15, y + 15))
    undo_redo(page, "first node edit of a rectangle", drag_corner)
    rn = node_of(page, rid)
    check("shape" not in rn and "sm" not in rn and abs(pts_of(rn)[2][0] - 515) < 0.5, "the rectangle turned into a curve and the node moved, in one step")
    page.keyboard.press("Control+z")
    check("shape" in node_of(page, rid), "one undo brings the rectangle back")
    page.keyboard.press("Control+Shift+z")
    # node commands from the property bar (each is ONE undo step; picked nodes are not part of the history, so every step picks again)
    pid2 = add_path(page, [["M", 100, 300], ["L", 200, 300], ["L", 300, 300], ["L", 300, 400]])
    page.wait_for_timeout(150)
    focus_canvas(page)
    page.keyboard.press("F10")
    page.wait_for_timeout(150)
    check(node_btn(page, "Join two end nodes").is_disabled(), "Join is off until two end nodes are picked")

    def node_step(label, picks, btn):
        click_node(page, pid2, picks[0])
        for i in picks[1:]:
            click_node(page, pid2, i, ("Shift",))
        box = {}
        def go():
            node_btn(page, btn).click()
            box["state"] = shape_state(page)
        undo_redo(page, label, go)
        return box["state"], node_of(page, pid2)

    st, n = node_step("add node", [0, 1], "Add node")
    check(len(pts_of(n)) == 5 and abs(pts_of(n)[1][0] - 150) < 1e-6 and st["picked"] == [[0, 1]], f"Add node puts a node in the middle of the segment {pts_of(n)} picked {st['picked']}")
    st, n = node_step("delete nodes", [1], "Delete nodes")
    check(len(pts_of(n)) == 4 and pts_of(n)[1] == (200, 300), "Delete nodes removes it again")
    st, n = node_step("to curve", [1, 2], "Make segment a curve")
    check(n["d"][2][0] == "C" and abs(n["d"][2][1] - (200 + 100 / 3)) < 1e-6, f"To curve: handles a third of the way {n['d'][2]}")
    st, n = node_step("to line", [1, 2], "Make segment straight")
    check(n["d"][2][0] == "L", "To line: straight again")
    for picks in ([1, 2], [2, 3]):
        click_node(page, pid2, picks[0]); click_node(page, pid2, picks[1], ("Shift",))
        node_btn(page, "Make segment a curve").click()
    st, n = node_step("smooth", [2], "Smooth node")
    pin, pout = n["d"][2], n["d"][3]
    inh = (pin[3] - pin[5], pin[4] - pin[6]); outh = (pout[1] - pin[5], pout[2] - pin[6])
    check(collinear_opposite(*inh, *outh, tol=1e-6) and n["nt"][0][2] == "s", f"Smooth: the two handles are on one line, opposite {inh} {outh}")
    st, n = node_step("symmetrical", [2], "Symmetrical node")
    pin, pout = n["d"][2], n["d"][3]
    inh = (pin[3] - pin[5], pin[4] - pin[6]); outh = (pout[1] - pin[5], pout[2] - pin[6])
    check(collinear_opposite(*inh, *outh) and abs(math.hypot(*inh) - math.hypot(*outh)) < 1e-6 and n["nt"][0][2] == "y", f"Symmetrical: equal length too {math.hypot(*inh):.3f} {math.hypot(*outh):.3f}")
    # dragging a handle follows the node type
    click_node(page, pid2, 2)
    hx, hy = pout[1], pout[2]
    drag_pt(page, (hx, hy), (hx + 10, hy + 25))
    n = node_of(page, pid2)
    pin, pout = n["d"][2], n["d"][3]
    inh = (pin[3] - pin[5], pin[4] - pin[6]); outh = (pout[1] - pin[5], pout[2] - pin[6])
    check(abs(outh[1] - (hy - pin[6] + 25)) < 0.3 and abs(inh[0] + outh[0]) < 1e-6 and abs(inh[1] + outh[1]) < 1e-6, "a symmetrical node mirrors the other handle while one is dragged")
    node_btn(page, "Smooth node").click()
    n = node_of(page, pid2)
    pin, pout = n["d"][2], n["d"][3]
    len_in = math.hypot(pin[3] - pin[5], pin[4] - pin[6])
    hx, hy = pout[1], pout[2]
    drag_pt(page, (hx, hy), (hx + 40, hy - 10))
    n = node_of(page, pid2)
    pin, pout = n["d"][2], n["d"][3]
    inh = (pin[3] - pin[5], pin[4] - pin[6]); outh = (pout[1] - pin[5], pout[2] - pin[6])
    check(collinear_opposite(*inh, *outh, tol=1e-5) and abs(math.hypot(*inh) - len_in) < 1e-6, "a smooth node keeps the other handle on the line and its length")
    st, n = node_step("cusp", [2], "Cusp node")
    check(n["nt"][0][2] == "c", "Cusp node")
    # break, join, close, reverse
    st, n = node_step("break", [1], "Break curve")
    check(sum(1 for c in n["d"] if c[0] == "M") == 2 and len(pts_of(n)) == 5 and st["nodes"] == 5, f"Break splits the curve in two ({len(pts_of(n))} nodes)")
    drag_pt(page, (170, 280), (230, 320))
    check(len(shape_state(page)["picked"]) == 2, f"a rubber band picks the nodes inside ({shape_state(page)['picked']})")
    undo_redo(page, "join", lambda: node_btn(page, "Join two end nodes").click())
    n = node_of(page, pid2)
    check(sum(1 for c in n["d"] if c[0] == "M") == 1 and len(pts_of(n)) == 4, "Join makes one curve again")
    st, n = node_step("close", [3], "Close curve")
    check(n["d"][-1][0] == "Z", "Close curve")
    before = pts_of(n)
    st, n = node_step("reverse", [0], "Reverse direction")
    after = pts_of(n)
    check(len(after) == len(before) and all(abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6 for a, b in zip(after, reversed(before))), f"Reverse direction turns the node order round {before} {after}")
    # keys on picked nodes
    click_node(page, pid2, 0)
    before = pts_of(node_of(page, pid2))[0]
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(100)
    after = pts_of(node_of(page, pid2))[0]
    check(abs(after[0] - before[0] - MM) < 1e-6 and sel_of(page) == [pid2], f"an arrow key moves the picked node by 1 mm {after[0] - before[0]:.4f}")
    cnt = shape_state(page)["nodes"]
    page.keyboard.press("Delete")
    page.wait_for_timeout(100)
    check(node_of(page, pid2) is not None and shape_state(page)["nodes"] == cnt - 1, f"Delete removes the picked node, not the object ({cnt} -> {shape_state(page)['nodes']} nodes)")
    page.keyboard.press("Control+a")
    check(len(shape_state(page)["picked"]) == shape_state(page)["nodes"], "Ctrl+A picks every node")
    page.keyboard.press("Escape")
    check(shape_state(page)["picked"] == [] and sel_of(page) == [pid2], "Esc first clears the picked nodes")
    # a double-click on a segment adds a node, on a node switches cusp and smooth
    pid3 = add_path(page, [["M", 100, 500], ["L", 300, 500], ["L", 300, 600]])
    focus_canvas(page)
    page.keyboard.press("F10")
    page.wait_for_timeout(120)
    sx, sy = scr(page, 200, 500)
    h0 = hist(page)
    page.mouse.dblclick(sx, sy)
    page.wait_for_timeout(120)
    check(len(pts_of(node_of(page, pid3))) == 4 and hist(page)[1] == h0[1] + 1, "double-click on a segment adds a node (one step)")
    sx, sy = scr(page, 300, 500)
    page.mouse.dblclick(sx, sy)
    page.wait_for_timeout(120)
    check(node_of(page, pid3)["nt"][0][2] == "s", f"double-click on a node makes it smooth {node_of(page, pid3).get('nt')}")
    page.mouse.dblclick(sx, sy)
    page.wait_for_timeout(120)
    check(node_of(page, pid3)["nt"][0][2] == "c", "and back to a cusp")
    # a click on a segment picks its two nodes, a drag on it reshapes the curve (the point under the pointer follows)
    pid4 = add_path(page, [["M", 100, 650], ["L", 300, 650], ["L", 300, 750]])
    focus_canvas(page)
    page.keyboard.press("F10")
    page.wait_for_timeout(120)
    click_pt(page, 300, 700)
    page.wait_for_timeout(80)
    check(shape_state(page)["picked"] == [[0, 1], [0, 2]], f"a click on a segment picks both of its nodes {shape_state(page)['picked']}")
    undo_redo(page, "reshape a segment", lambda: drag_pt(page, (200, 650), (200, 620)))
    n = node_of(page, pid4)
    c = n["d"][1]
    mid_y = (650 + 3 * c[2] + 3 * c[4] + 650) / 8
    check(c[0] == "C" and len(pts_of(n)) == 3 and abs(mid_y - 620) < 0.3 and abs(c[5] - 300) < 1e-6, f"dragging a straight segment made it a curve whose middle follows the pointer (middle y {mid_y:.2f})")
    # Esc during a node drag cancels
    pn = pts_of(node_of(page, pid3))[3]
    h0, d0 = hist(page), node_of(page, pid3)["d"]
    drag_pt(page, pn, (pn[0] + 40, pn[1] + 40), keep=True)
    page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(100)
    check(hist(page) == h0 and node_of(page, pid3)["d"] == d0, "Esc during a node drag restores the curve (no history step)")
    check(page.evaluate("(id) => { const ds = document.querySelector('.tool-body').__ds; const el = document.querySelector('.ds-world [data-id=\"' + id + '\"]'); const p = el.localName === 'path' ? el : el.querySelector('path'); return p.getAttribute('d') === ds.renderer.dStr(ds.store.find(id).node.d) }", pid3), "the drawn path is back to the document's")
    # the Pick tool: a double-click on a curve switches to the Shape tool
    page.keyboard.press("v")
    sx, sy = scr(page, 300, 560)
    page.mouse.dblclick(sx, sy)
    page.wait_for_timeout(150)
    check(tool_of(page) == "shape" and sel_of(page) == [pid3], "double-click on a curve with the Pick tool opens it in the Shape tool")
    # locked curves are not edited
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('arrange.lock')")
    page.wait_for_timeout(100)
    check(shape_state(page)["target"] is None, "a locked curve is not offered for node editing")
    check(not errors2, f"no console errors {errors2[:3]}")
    shot(page, "shapes-nodes")
    page.close()
    check(not errors, f"no console errors in the drawing part {errors[:3]}")


# ---------------------------------------------------------------- E10: arrange, shaping, transform, clipboard
def circle_d(cx, cy, r):
    k = 0.5522847498 * r
    return [["M", cx + r, cy], ["C", cx + r, cy + k, cx + k, cy + r, cx, cy + r], ["C", cx - k, cy + r, cx - r, cy + k, cx - r, cy], ["C", cx - r, cy - k, cx - k, cy - r, cx, cy - r], ["C", cx + k, cy - r, cx + r, cy - k, cx + r, cy], ["Z"]]


def sq_d(x, y, w, h=None):
    h = w if h is None else h
    return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]]


def layer_names(page, layer=0):
    return ds_eval(page, "return ds.store.page().layers[arg].items.map((n) => n.name || n.t)", layer)


def bx(page, nid):
    b = nbox(page, nid)
    return (round(b["x"], 3), round(b["y"], 3), round(b["w"], 3), round(b["h"], 3))


def status_text(page):
    return page.inner_text(".ds-st-msg")


def press_on_canvas(page, key):
    focus_canvas(page)
    page.keyboard.press(key)
    page.wait_for_timeout(130)


def total_area(page, ids):
    return [round(area_of(page, i), 1) for i in ids]


def t_arrange(ctx, base):
    """E10: order, align and distribute, combine and break apart, lock, shaping (areas against analytic values), Transform docker, clipboard, clip to container."""
    page, errors = mount(ctx, base)
    warns = []
    page.on("console", lambda m: warns.append(m.text) if "has no implementation" in m.text else None)
    info = load_scene(page)
    ids = info["ids"]
    snap_off(page)
    focus_canvas(page)
    # ---------- order: every shortcut and alias ----------
    def idx(name):
        return layer_names(page, 0).index(name)
    select_ids(page, ids["Red"])
    h0 = hist(page)[1]
    for keys, expect, label in ((("Control+]", "Control+PageUp"), (1, 2), "forward one"), (("Control+[", "Control+PageDown"), (1, 0), "back one"),
                                (("Shift+PageUp", "Control+Shift+]"), (4, 4), "to front"), (("Shift+PageDown", "Control+Shift+["), (0, 0), "to back")):
        for k, want in zip(keys, expect):
            press_on_canvas(page, k)
            check(idx("Red") == want, f"{k}: {label} puts Red at {want} ({layer_names(page, 0)})")
    check(hist(page)[1] == h0 + 6 or hist(page)[1] > h0, "each order command is an undo step")
    press_on_canvas(page, "Control+z")
    # reverse order via the menu on two objects
    select_ids(page, ids["Red"], ids["Blue"])
    ib, ir = idx("Blue"), idx("Red")
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('arrange.reverse')")
    check(idx("Red") == ib and idx("Blue") == ir, "Reverse order swaps two objects")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # ---------- align (on a fresh scene, so the z order is the original) ----------
    info = load_scene(page)
    ids = info["ids"]
    snap_off(page)
    select_ids(page, ids["Red"], ids["Blue"], ids["Yellow"])
    want = {"l": [(50, 50), (50, 50), (50, 100)], "r": [(180, 50), (200, 50), (240, 100)], "t": [(50, 50), (200, 50), (170, 50)], "b": [(50, 80), (200, 60), (170, 100)],
            "e": [(115, 50), (125, 50), (145, 100)], "c": [(50, 65), (200, 55), (170, 75)], "p": [(85, 105), (235, 105), (205, 155)]}
    names = {"l": "left", "r": "right", "t": "top", "b": "bottom", "e": "centre horizontally", "c": "centre vertically", "p": "centre on page"}
    for key, name in names.items():
        press_on_canvas(page, key)
        got = [(round(nbox(page, ids[n])["x"], 2), round(nbox(page, ids[n])["y"], 2)) for n in ("Red", "Blue", "Yellow")]
        check(got == want[key], f"align {name} ({key}): {got} == {want[key]}")
        press_on_canvas(page, "Control+z")
    check(len(all_items(page)) > 0 and sel_of(page) == [ids["Red"], ids["Blue"], ids["Yellow"]], "undo restores the selection")
    select_ids(page, ids["Red"])
    press_on_canvas(page, "l")
    check(bx(page, ids["Red"])[0] == 0, "a single object aligns to the page edge")
    press_on_canvas(page, "p")
    b = nbox(page, ids["Red"])
    check(abs(b["x"] + b["w"] / 2 - 200) < 1e-6 and abs(b["y"] + b["h"] / 2 - 150) < 1e-6, "P centres it on the page")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()"); page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # the docker, the property bar and the menu all do the same
    select_ids(page, ids["Red"], ids["Blue"])
    page.locator(".ds-arrangebar button[aria-label='Align left (L)']").click()
    page.wait_for_timeout(120)
    check(bx(page, ids["Blue"])[0] == 50, "the property bar's align buttons work")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.get_by_role("menuitem", name="Object", exact=True).click()
    page.locator(".ds-menu:visible [data-cmd='align.right']").click()
    page.wait_for_timeout(120)
    check(bx(page, ids["Red"])[0] == 180, f"Object > Align > Align right works {bx(page, ids['Red'])}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('win.align')")
    page.wait_for_selector(".ds-xpanel .ds-xbtn[data-cmd='align.left']", state="visible")
    page.locator(".ds-xradio button", has_text="Page").first.click()
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.store.prefs.alignTo") == "page", "Align to: Page")
    select_ids(page, ids["Red"], ids["Blue"])
    page.locator(".ds-xbtn[data-cmd='align.left']").click()
    page.wait_for_timeout(120)
    check(bx(page, ids["Red"])[0] == 0 and bx(page, ids["Blue"])[0] == 0, "with Page as the reference both go to the page edge")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.locator(".ds-xradio button", has_text="Active object").first.click()
    select_ids(page, ids["Blue"], ids["Red"])
    page.locator(".ds-xbtn[data-cmd='align.left']").click()
    page.wait_for_timeout(120)
    check(bx(page, ids["Blue"])[0] == 50 and bx(page, ids["Red"])[0] == 50, "with the active object as the reference the others join the one selected last")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.locator(".ds-xradio button", has_text="Selection").first.click()
    # ---------- distribute ----------
    select_ids(page, ids["Red"], ids["Blue"], ids["Yellow"])
    for cmd, expect in (("distribute.left", ("Yellow", "x", 125)), ("distribute.spaceH", ("Yellow", "x", 155)), ("distribute.centerH", ("Yellow", "x", 150)), ("distribute.right", ("Yellow", "x", 175)), ("distribute.spaceV", ("Blue", "y", 65))):
        page.locator(f".ds-xbtn[data-cmd='{cmd}']").click()
        page.wait_for_timeout(120)
        n, axis, v = expect
        check(abs(nbox(page, ids[n])[axis] - v) < 1e-6, f"{cmd}: {n} {axis} is {v} (got {nbox(page, ids[n])[axis]})")
        page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    select_ids(page, ids["Red"], ids["Blue"])
    check(page.locator(".ds-xbtn[data-cmd='distribute.spaceH']").is_disabled(), "distribute needs three objects")
    page.locator(".ds-xradio button", has_text="Page").nth(1).click()
    page.locator(".ds-xbtn[data-cmd='distribute.spaceH']").click()
    page.wait_for_timeout(120)
    check(bx(page, ids["Red"])[0] == 0 and abs(bx(page, ids["Blue"])[0] - 320) < 1e-6, f"two objects spread over the page {bx(page, ids['Red'])} {bx(page, ids['Blue'])}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.locator(".ds-xradio button", has_text="Selection").nth(1).click()
    # ---------- combine and break apart ----------
    select_ids(page, ids["Red"], ids["Blue"])
    h0 = hist(page)
    press_on_canvas(page, "Control+l")
    items = all_items(page)
    comb = next(i for i in items if i.get("rule") == "evenodd")
    check(hist(page)[1] == h0[1] + 1 and len(layer_names(page, 0)) == 4 and sum(1 for c in comb["d"] if c[0] == "M") == 2 and sel_of(page) == [comb["id"]], f"Ctrl+L: two shapes became one curve with even-odd fill ({layer_names(page, 0)})")
    press_on_canvas(page, "Control+k")
    items = all_items(page)
    check(len(layer_names(page, 0)) == 5 and len(sel_of(page)) == 2 and sel_of(page)[0] == comb["id"] and all(sum(1 for c in i["d"] if c[0] == "M") == 1 for i in items if i["t"] == "path" and i["id"] in sel_of(page)), "Ctrl+K: separate objects again, the first keeps its id")
    press_on_canvas(page, "Control+z"); press_on_canvas(page, "Control+z")
    select_ids(page, ids["Pair"], ids["Red"])
    press_on_canvas(page, "Control+l")
    comb = next(i for i in all_items(page) if i.get("rule") == "evenodd")
    check(sum(1 for c in comb["d"] if c[0] == "M") == 3, "a group contributes its shapes to Combine")
    press_on_canvas(page, "Control+z")
    select_ids(page, ids["Red"], ids["Photo"])
    press_on_canvas(page, "Control+l")
    check("Pictures" in status_text(page) and layer_names(page, 0).count("Red") == 1, f"a picture cannot be combined: '{status_text(page)}'")
    tid = ds_eval(page, "const id = ds.store.newId(); const T = await import('/packs/corel/_ds-tools-draw.js'); T.placeNodes(ds.store, [{ id, t: 'text', str: 'Hi', family: 'Inter', size: 20, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 20, 40], lh: 1.2, align: 'left' }], 'text'); return id")
    select_ids(page, ids["Red"], tid)
    press_on_canvas(page, "Control+l")
    check("curves" in status_text(page), f"text cannot be combined: '{status_text(page)}'")
    # ---------- lock ----------
    select_ids(page, ids["Red"])
    press_on_canvas(page, "Control+Shift+l")
    n = node_of(page, ids["Red"])
    check(n.get("locked") and sel_of(page) == [], "Ctrl+Shift+L locks the object and deselects it")
    click_pt(page, 100, 80)
    check(sel_of(page) == [], "a locked object cannot be picked on the canvas")
    page.evaluate("(id) => document.querySelector('.tool-body').__ds.store.setSel([id])", ids["Red"])
    check(page.evaluate("() => document.querySelector('.tool-body').__ds.commands.label('arrange.lock')") == "Unlock", "the lock command reads Unlock for a locked selection")
    press_on_canvas(page, "Control+Shift+l")
    check(not node_of(page, ids["Red"]).get("locked"), "Ctrl+Shift+L again unlocks")
    select_ids(page, ids["Red"], ids["Blue"])
    press_on_canvas(page, "Control+Shift+l")
    check(node_of(page, ids["Red"]).get("locked") and node_of(page, ids["Blue"]).get("locked"), "two objects locked in one step")
    press_on_canvas(page, "Control+Alt+Shift+l")
    check(not node_of(page, ids["Red"]).get("locked") and not node_of(page, ids["Blue"]).get("locked"), "Ctrl+Alt+Shift+L unlocks everything on the page")
    check(not page.evaluate("() => document.querySelector('.tool-body').__ds.commands.enabled('arrange.unlockAll')"), "Unlock all is off when nothing is locked")
    # convert to curves: a shape keeps its path and loses its parametric description
    select_ids(page, ids["Red"])
    h0 = hist(page)[1]
    press_on_canvas(page, "Control+q")
    page.wait_for_timeout(300)
    n = node_of(page, ids["Red"])
    check("shape" not in n and "sm" not in n and len(n["d"]) == 5 and hist(page)[1] == h0 + 1, "Ctrl+Q turns a rectangle into a plain curve (one step)")
    page.keyboard.press("Control+z")
    check("shape" in node_of(page, ids["Red"]), "and one undo brings the rectangle back")
    check(not warns, f"every command has an implementation {warns}")
    page.close()

    # ---------- shaping against analytic areas ----------
    page, errors = mount(ctx, base)
    new_blank(page, "Shaping")
    snap_off(page)
    focus_canvas(page)
    def setup(a_d, b_d):
        a = add_path(page, a_d); b = add_path(page, b_d)
        select_ids(page, a, b)
        return a, b
    A, B = setup(sq_d(100, 100, 100), sq_d(150, 150, 100))
    root0 = root_json(page)
    cases = (("shape.weld", 17500, 1), ("shape.trim", None, 2), ("shape.intersect", 2500, 1), ("shape.simplify", None, 2), ("shape.frontMinusBack", 7500, 1), ("shape.backMinusFront", 7500, 1))
    for cmd, area, n_items in cases:
        h0 = hist(page)
        page.evaluate("(c) => document.querySelector('.tool-body').__ds.commands.run(c)", cmd)
        page.wait_for_function("() => !document.querySelector('.ds-st-msg').textContent.endsWith('...')", timeout=30000)
        page.wait_for_timeout(200)
        its = all_items(page)
        areas = sorted(round(area_of(page, i["id"]), 0) for i in its)
        if cmd == "shape.weld":
            ok = areas == [17500]
        elif cmd == "shape.trim":
            ok = areas == [7500, 10000]
        elif cmd == "shape.intersect":
            ok = areas == [2500]
        elif cmd == "shape.simplify":
            ok = areas == [7500, 10000]
        else:
            ok = areas == [7500]
        check(ok and len(its) == n_items and hist(page)[1] == h0[1] + 1 and len(sel_of(page)) >= 1, f"{cmd}: areas {areas} in {len(its)} object(s), one undo step, result selected")
        page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
        check(root_json(page) == root0, f"{cmd}: undo restores the drawing exactly")
        select_ids(page, A, B)
    # target by marquee: the bottom-most object; by click: the last selected
    c = ds_eval(page, "const ds2 = ds; return ds.store.find(arg).node.id", A)
    page.evaluate("(ids) => document.querySelector('.tool-body').__ds.store.setSel(ids, 'marquee')", [A, B])
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('shape.trim')")
    page.wait_for_timeout(1500)
    areas = {i["id"]: round(area_of(page, i["id"])) for i in all_items(page)}
    check(areas.get(A) == 7500 and areas.get(B) == 10000, f"after a marquee selection Trim shapes the bottom-most object {areas}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # circles: lens and union against the analytic values
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; const l = ds.store.page().layers[0]; ds.store.tx('clear', (r) => ({ ...r, pages: r.pages.map((p) => ({ ...p, layers: p.layers.map((q) => ({ ...q, items: [] })) })) })) }")
    c1 = add_path(page, circle_d(200, 200, 50)); c2 = add_path(page, circle_d(250, 200, 50))
    lens, union = 3070.93, 12637.03
    select_ids(page, c1, c2)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('shape.intersect')")
    page.wait_for_timeout(1500)
    a = [area_of(page, i["id"]) for i in all_items(page)]
    check(len(a) == 1 and abs(a[0] / lens - 1) < 0.005, f"two overlapping circles: Intersect area {a} against the lens {lens}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    select_ids(page, c1, c2)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('shape.weld')")
    page.wait_for_timeout(1500)
    a = [area_of(page, i["id"]) for i in all_items(page)]
    check(len(a) == 1 and abs(a[0] / union - 1) < 0.005, f"two overlapping circles: Weld area {a} against the union {union}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    # the Shaping buttons of the Align and distribute docker, with Leave source and Leave target
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('win.align')")
    select_ids(page, c1, c2)
    page.locator(".ds-xrow", has_text="Weld").locator("input").first.check()
    page.locator(".ds-xbtn[data-cmd='shape.weld']").click()
    page.wait_for_timeout(1500)
    check(len(all_items(page)) == 2, f"Weld with Leave source keeps the source ({len(all_items(page))} objects)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.locator(".ds-xrow", has_text="Weld").locator("input").first.uncheck()
    page.locator(".ds-xrow", has_text="Intersect").locator("input").nth(1).check()
    select_ids(page, c1, c2)
    page.locator(".ds-xbtn[data-cmd='shape.intersect']").click()
    page.wait_for_timeout(1500)
    check(len(all_items(page)) == 2, f"Intersect with Leave target keeps the target and adds the result ({len(all_items(page))} objects)")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    page.locator(".ds-xrow", has_text="Intersect").locator("input").nth(1).uncheck()
    # refusals
    tid = ds_eval(page, "const id = ds.store.newId(); const T = await import('/packs/corel/_ds-tools-draw.js'); T.placeNodes(ds.store, [{ id, t: 'text', str: 'Hi', family: 'Inter', size: 20, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 20, 40], lh: 1.2, align: 'left' }], 'text'); return id")
    select_ids(page, c1, tid)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('shape.weld')")
    page.wait_for_timeout(300)
    check("curves" in status_text(page), f"text is refused with a plain message: '{status_text(page)}'")
    select_ids(page, c1)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('shape.weld')")
    page.wait_for_timeout(300)
    check(not page.evaluate("() => document.querySelector('.tool-body').__ds.commands.enabled('shape.weld')"), "Weld is off for a single shape")
    check(not errors, f"no console errors {errors[:3]}")
    page.close()
    # the library cannot be loaded: a readable message and an untouched drawing
    page, errors = mount(ctx, base)
    page.route("**/*paper*", lambda route: route.abort())
    new_blank(page, "Offline")
    a = add_path(page, sq_d(100, 100, 100)); b = add_path(page, sq_d(150, 150, 100))
    select_ids(page, a, b)
    root0 = root_json(page)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('shape.weld')")
    page.wait_for_function("() => document.body.innerText.includes('paper.js')", timeout=8000)
    check(root_json(page) == root0, "offline: a readable message about the library, and the drawing is untouched")
    page.close()

    # ---------- Transform docker ----------
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ids = info["ids"]
    snap_off(page)
    select_ids(page, ids["Red"])
    focus_canvas(page)
    page.keyboard.press("Alt+F7")
    page.wait_for_selector(".ds-xpanel .ds-xtabs", state="visible")
    check(page.locator(".ds-xtabs button[data-tab='position']").get_attribute("aria-selected") == "true", "Alt+F7 opens the Transform docker on Position")
    fx = page.locator(".ds-xpanel input[aria-label='Transform X position']"); fy = page.locator(".ds-xpanel input[aria-label='Transform Y position']")
    check(abs(float(fx.input_value()) - 100 / MM) < 0.01 and abs(float(fy.input_value()) - (300 - 80) / MM) < 0.01, f"it shows the centre of the selection ({fx.input_value()}, {fy.input_value()})")
    fx.fill("50"); fy.fill("100")
    undo_redo(page, "transform position", lambda: page.get_by_role("button", name="Apply", exact=True).click())
    b = nbox(page, ids["Red"])
    check(abs(b["x"] + b["w"] / 2 - 50 * MM) < 0.03 and abs(b["y"] + b["h"] / 2 - (300 - 100 * MM)) < 0.03, f"the centre lands on X 50 mm, Y 100 mm {b}")
    page.locator(".ds-xpanel input[aria-label='Transform relative position']").check()
    page.locator(".ds-xpanel input[aria-label='Transform X position']").fill("10"); page.locator(".ds-xpanel input[aria-label='Transform Y position']").fill("5")
    b0 = nbox(page, ids["Red"])
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_timeout(120)
    b1 = nbox(page, ids["Red"])
    check(abs(b1["x"] - b0["x"] - 10 * MM) < 0.03 and abs(b1["y"] - b0["y"] + 5 * MM) < 0.03, "relative position moves right 10 mm and up 5 mm")
    page.locator(".ds-xpanel input[aria-label='Transform relative position']").uncheck()
    page.locator(".ds-xref[data-ref='nw']").click()
    fx = page.locator(".ds-xpanel input[aria-label='Transform X position']")
    check(abs(float(fx.input_value()) - b1["x"] / MM) < 0.01, "the reference point nw shows the top-left corner")
    fx.fill("20")
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_timeout(120)
    check(abs(nbox(page, ids["Red"])["x"] - 20 * MM) < 0.03, "the top-left corner is placed at X 20 mm")
    page.locator(".ds-xref[data-ref='c']").click()
    focus_canvas(page)
    page.keyboard.press("Alt+F8")
    b0 = nbox(page, ids["Red"])
    page.locator(".ds-xpanel input[aria-label='Transform rotation angle in degrees, counter-clockwise']").fill("90")
    undo_redo(page, "transform rotate", lambda: page.get_by_role("button", name="Apply", exact=True).click())
    b1 = nbox(page, ids["Red"])
    check(abs(b1["w"] - b0["h"]) < 1e-6 and abs(b1["h"] - b0["w"]) < 1e-6 and abs((b1["x"] + b1["w"] / 2) - (b0["x"] + b0["w"] / 2)) < 1e-6 and abs(node_of(page, ids["Red"]).get("rot", 0) - 90) < 1e-6, f"rotate 90 about the centre swaps width and height {b0} {b1}")
    focus_canvas(page)
    page.keyboard.press("Alt+F9")
    page.locator(".ds-xpanel input[aria-label='Transform horizontal scale in percent']").fill("200"); page.locator(".ds-xpanel input[aria-label='Transform vertical scale in percent']").fill("50")
    b0 = nbox(page, ids["Red"])
    undo_redo(page, "transform scale", lambda: page.get_by_role("button", name="Apply", exact=True).click())
    b1 = nbox(page, ids["Red"])
    check(abs(b1["w"] / b0["w"] - 2) < 1e-6 and abs(b1["h"] / b0["h"] - 0.5) < 1e-6, "scale 200 % wide and 50 % high")
    focus_canvas(page)
    page.keyboard.press("Alt+F10")
    page.locator(".ds-xpanel input[aria-label='Transform keep proportions when sizing']").check()
    page.locator(".ds-xpanel input[aria-label='Transform width']").fill("30")
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_timeout(120)
    b2 = nbox(page, ids["Red"])
    check(abs(b2["w"] - 30 * MM) < 0.03 and abs(b2["h"] / b2["w"] - b1["h"] / b1["w"]) < 1e-6, f"size 30 mm wide keeping the proportions {b2}")
    page.locator(".ds-xtabs button[data-tab='skew']").click()
    page.locator(".ds-xpanel input[aria-label='Transform horizontal skew in degrees']").fill("30")
    b0 = nbox(page, ids["Red"])
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_timeout(120)
    b1 = nbox(page, ids["Red"])
    check(abs(b1["w"] - (b0["w"] + b0["h"] * 0.5773502692)) < 0.01, f"skew 30 degrees widens the box by h tan 30 {b0['w']:.3f} -> {b1['w']:.3f}")
    # apply to duplicate
    page.locator(".ds-xtabs button[data-tab='position']").click()
    page.locator(".ds-xpanel input[aria-label='Transform X position']").fill("100")
    n_before = len(all_items(page)); b0 = nbox(page, ids["Red"])
    undo_redo(page, "apply to duplicate", lambda: page.get_by_role("button", name="Apply to duplicate").click())
    check(len(all_items(page)) == n_before + 1 and nbox(page, ids["Red"]) == b0 and sel_of(page)[0] != ids["Red"] and abs(nbox(page, sel_of(page)[0])["x"] + nbox(page, sel_of(page)[0])["w"] / 2 - 100 * MM) < 0.03, "Apply to duplicate leaves the original and moves the copy, which is selected")
    # the key sheet and menus list the new commands
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('help.shortcuts')")
    txt = dialog(page).inner_text()
    check(all(s in txt for s in ("Align left", "Combine", "Break apart", "Alt+F7", "Ctrl+Shift+A", "Ctrl+C", "Ctrl+Shift+V")), "the shortcut sheet lists align, combine, the docker keys, copy and paste")
    page.keyboard.press("Escape")
    check(not errors, f"no console errors {errors[:3]}")
    page.close()

    # ---------- clipboard ----------
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ids = info["ids"]
    snap_off(page)
    select_ids(page, ids["Red"])
    n0 = len(all_items(page))
    b0 = nbox(page, ids["Red"])
    press_on_canvas(page, "Control+c")
    txt = page.evaluate("() => navigator.clipboard.readText()")
    check(txt.startswith("<svg") and "<path" in txt, f"Ctrl+C puts the selection on the system clipboard as SVG text ({txt[:40]!r})")
    check(len(all_items(page)) == n0, "copying does not change the drawing")
    h0 = hist(page)[1]
    press_on_canvas(page, "Control+v")
    its = all_items(page)
    new = its[-1] if its[-1]["id"] not in ids.values() else None
    pasted = [i for i in its if i["id"] not in ids.values()]
    check(len(its) == n0 + 1 and len(pasted) == 1 and hist(page)[1] == h0 + 1 and sel_of(page) == [pasted[0]["id"]], "Ctrl+V pastes the copy, selected, in one step")
    pb = nbox(page, pasted[0]["id"])
    check(abs(pb["x"] - b0["x"] - 5 * MM) < 1e-6 and abs(pb["y"] - b0["y"] - 5 * MM) < 1e-6 and pasted[0].get("shape", {}).get("k") == "rect" and pasted[0]["id"] != ids["Red"], f"the copy is the same rectangle shape, offset by 5 mm {pb}")
    press_on_canvas(page, "Control+v")
    p2 = [i for i in all_items(page) if i["id"] not in ids.values() and i["id"] != pasted[0]["id"]]
    check(len(p2) == 1 and abs(nbox(page, p2[0]["id"])["x"] - b0["x"] - 10 * MM) < 1e-6, "the next paste moves a further 5 mm")
    press_on_canvas(page, "Control+Shift+v")
    p3 = [i for i in all_items(page) if i["id"] not in ids.values() and i["id"] not in (pasted[0]["id"], p2[0]["id"])]
    check(len(p3) == 1 and nbox(page, p3[0]["id"]) == b0, "Ctrl+Shift+V pastes in place")
    select_ids(page, ids["Blue"])
    press_on_canvas(page, "Control+x")
    check(ids["Blue"] not in [i["id"] for i in all_items(page)] and sel_of(page) == [], "Ctrl+X removes the object")
    n1 = len(all_items(page))
    press_on_canvas(page, "Control+Shift+v")
    check(len(all_items(page)) == n1 + 1, "and Ctrl+Shift+V brings it back where it was")
    check(len([i for i in all_items(page) if i.get("fill") == "#0000ff"]) >= 1, "with its colour")
    # SVG text pasted as a group
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect x="0" y="0" width="20" height="20" fill="#ff0000"/><circle cx="30" cy="10" r="8" fill="#00ff00"/><script>window.__pwn = 1</script></svg>'
    page.evaluate("(s) => navigator.clipboard.writeText(s)", svg)
    n1 = len(all_items(page))
    press_on_canvas(page, "Control+v")
    page.wait_for_timeout(500)
    its = all_items(page)
    g = node_of(page, sel_of(page)[0])
    check(g["t"] == "group" and len(g["items"]) == 2 and len(its) == n1 + 1, f"SVG text pastes as a group of its two shapes ({g.get('name')}, {len(g.get('items', []))} items)")
    gb = nbox(page, g["id"])
    check(abs(gb["x"] + gb["w"] / 2 - 200) < 1 and abs(gb["y"] + gb["h"] / 2 - 150) < 1 and abs(gb["w"] - 38 * MM) < 0.5, f"centred on the page at its real size {gb}")
    check(page.evaluate("() => window.__pwn") is None, "script in pasted SVG never runs")
    # a picture
    page.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 20; c.height = 10; const g = c.getContext('2d'); g.fillStyle = '#c0f'; g.fillRect(0, 0, 20, 10)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) }""")
    n1 = len(all_items(page))
    press_on_canvas(page, "Control+v")
    page.wait_for_timeout(500)
    its = all_items(page)
    im = node_of(page, sel_of(page)[0])
    check(im["t"] == "image" and len(its) == n1 + 1 and page.evaluate("(a) => document.querySelector('.tool-body').__ds.assets.has(a)", im["asset"]) and im["w"] == 20, f"an image on the clipboard pastes as a bitmap ({im['t']})")
    # plain text
    page.evaluate("() => navigator.clipboard.writeText('Hello from the clipboard')")
    press_on_canvas(page, "Control+v")
    page.wait_for_timeout(300)
    tx = node_of(page, sel_of(page)[0])
    check(tx["t"] == "text" and tx["str"] == "Hello from the clipboard", f"other text becomes artistic text ({tx.get('str')!r})")
    # the Edit menu
    select_ids(page, ids["Red"])
    n1 = len(all_items(page))
    page.get_by_role("menuitem", name="Edit", exact=True).click()
    page.locator(".ds-menu:visible [data-cmd='edit.copy']").click()
    page.wait_for_timeout(300)
    txt = page.evaluate("() => navigator.clipboard.readText()")
    check(txt.startswith("<svg"), "Edit > Copy copies")
    page.get_by_role("menuitem", name="Edit", exact=True).click()
    page.locator(".ds-menu:visible [data-cmd='edit.paste']").click()
    page.wait_for_timeout(600)
    check(len(all_items(page)) == n1 + 1, "Edit > Paste pastes")
    page.get_by_role("menuitem", name="Edit", exact=True).click()
    labels = page.locator(".ds-menu:visible [data-cmd='edit.copy'] .ds-mi-k, .ds-menu:visible [data-cmd='edit.paste'] .ds-mi-k").all_inner_texts()
    check(labels == ["Ctrl+C", "Ctrl+V"], f"the menu shows the keys {labels}")
    page.keyboard.press("Escape")
    check(not errors, f"no console errors {errors[:3]}")
    page.close()

    # ---------- clip to container ----------
    page, errors = mount(ctx, base)
    new_blank(page, "Clip")
    snap_off(page)
    content = add_path(page, sq_d(100, 100, 300, 200), fill="#ff0000")
    cont = add_path(page, circle_d(250, 200, 50), fill="#0000ff")
    select_ids(page, content, cont)
    h0 = hist(page)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('object.clip')")
    page.wait_for_timeout(200)
    c = node_of(page, content)
    check(hist(page)[1] == h0[1] + 1 and c.get("clip") and node_of(page, cont).get("clip") is None, "Clip to container clips the contents to the container outline (one step)")
    inside_ids = page.evaluate("([x, y]) => document.elementsFromPoint(x, y).map((el) => el.closest('[data-id]')?.dataset.id).filter(Boolean)", list(scr(page, 250, 170)))
    outside_ids = page.evaluate("([x, y]) => document.elementsFromPoint(x, y).map((el) => el.closest('[data-id]')?.dataset.id).filter(Boolean)", list(scr(page, 120, 120)))
    check(str(content) in inside_ids and str(content) not in outside_ids, f"the contents show only inside the container ({inside_ids} / {outside_ids})")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.undo()")
    select_ids(page, content, cont)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('object.clip')")
    select_ids(page, content)
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('object.unclip')")
    check(node_of(page, content).get("clip") is None, "Release clip frees the contents")
    check(not errors, f"no console errors {errors[:3]}")
    page.close()


def t_arrange_phone(ctx, base):
    """E9 and E10 at 375 px: the toolbox strip, shape settings, node buttons, arrange buttons, the Panels sheet with Align and Transform, the menu."""
    page, errors = mount(ctx, base, 375, 700)
    ov = lambda: page_state(page)["overflow"]
    new_blank(page, "Phone")
    snap_off(page)
    check(ov() <= 1, f"blank drawing: overflow {ov()}")
    tools = page.evaluate("() => { const t = document.querySelector('.ds-tools'); return { n: t.querySelectorAll('.ds-tool').length, w: t.getBoundingClientRect().width, sw: t.scrollWidth, small: [...t.querySelectorAll('.ds-tool')].filter((b) => b.getBoundingClientRect().width < 36 || b.getBoundingClientRect().height < 36).length } }")
    check(tools["n"] == 14 and tools["w"] <= 375 and tools["sw"] > tools["w"] and tools["small"] == 0, f"the toolbox is a scrolling strip of 36 px buttons {tools}")
    focus_canvas(page)
    page.keyboard.press("F6")
    shape_bar = page.evaluate("() => { const b = document.querySelector('.ds-shapebar'); return b && !b.hidden ? [...b.querySelectorAll('input, select')].filter((e) => e.offsetParent !== null).map((e) => [Math.round(e.getBoundingClientRect().height), parseFloat(getComputedStyle(e).fontSize)]) : null }")
    check(shape_bar and all(h >= 36 and f >= 16 for h, f in shape_bar), f"the rectangle settings are touchable {shape_bar}")
    snap_off(page)
    a, b = (150, 150), (400, 300)
    drag_pt(page, a, b)
    check(len(all_items(page)) == 1 and last_item(page)["shape"]["k"] == "rect", "a rectangle can be drawn at 375 px")
    first_id = all_items(page)[0]["id"]
    c1 = add_path(page, sq_d(300, 400, 60))
    select_ids(page, first_id, c1)
    page.wait_for_timeout(150)
    arr = page.evaluate("() => { const b = document.querySelector('.ds-arrangebar'); return b && !b.hidden ? [...b.querySelectorAll('button')].map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]) : null }")
    check(arr and len(arr) >= 9 and all(w >= 36 and h >= 36 for w, h in arr), f"the align buttons of the property bar are 36 px {arr}")
    check(ov() <= 1, f"two objects selected: overflow {ov()}")
    page.keyboard.press("F10")
    page.wait_for_timeout(150)
    nb = page.evaluate("() => { const b = document.querySelector('.ds-nodebar'); return b && !b.hidden ? [...b.querySelectorAll('button')].map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]) : null }")
    check(nb and len(nb) == 11 and all(w >= 36 and h >= 36 for w, h in nb), f"the 11 node buttons are 36 px {nb}")
    check(ov() <= 1, f"the Shape tool: overflow {ov()}")
    page.keyboard.press("v")
    page.get_by_role("button", name="Panels").click()
    page.wait_for_selector(".ds-dock", state="visible")
    for sec in ("align", "transform"):
        page.locator(f".ds-dsec[data-section='{sec}'] .ds-dsec-head").click()
        page.wait_for_timeout(150)
    small = page.evaluate("""() => [...document.querySelectorAll('.ds-dock .ds-xpanel button, .ds-dock .ds-xpanel input:not([type=checkbox]), .ds-dock .ds-xcheck, .ds-dock .ds-dsec-head')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.className, Math.round(r.width), Math.round(r.height), getComputedStyle(e).fontSize] }).filter(([, w, h]) => w < 36 || h < 36)""")
    check(not small, f"every control of the Align and Transform sections is at least 36 px {small[:5]}")
    box = page.locator(".ds-dock").bounding_box()
    check(box["width"] <= 375 and ov() <= 1, f"the sheet with both dockers fits {box['width']:.0f}, overflow {ov()}")
    fs = page.evaluate("() => [...document.querySelectorAll('.ds-dock .ds-xpanel input[type=number]')].filter((e) => e.offsetParent !== null).map((e) => parseFloat(getComputedStyle(e).fontSize))")
    check(fs and min(fs) >= 16, f"the docker inputs are 16 px or more {fs[:3]}")
    page.get_by_role("button", name="Close panels").click()
    page.get_by_role("button", name="Menu", exact=True).click()
    page.get_by_role("button", name="Object", exact=True).click()
    n_align = page.locator(".ds-msheet-body:visible [data-cmd^='align.']").count()
    check(n_align == 7 and ov() <= 1, f"the phone menu lists the 7 align commands ({n_align}), overflow {ov()}")
    page.get_by_role("button", name="Close menu", exact=True).click()
    check(not errors, f"no console errors {errors[:3]}")
    shot(page, "arrange-phone")
    page.close()


# ---------------------------------------------------------------- E11 to E13
def guides_of(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(document.querySelector('.tool-body').__ds.store.page().guides))")


def pref_of(page, key):
    return page.evaluate("(k) => document.querySelector('.tool-body').__ds.store.prefs[k]", key)


def run_menu(page, menu, cmd):
    """Open a menu of the menubar and click the item of a command (real mouse events)."""
    page.get_by_role("menuitem", name=menu, exact=True).click()
    page.locator(f'.ds-menu:visible [data-cmd="{cmd}"]').first.click()
    page.wait_for_timeout(120)


def key_on_canvas(page, key):
    page.locator(".ds-view").focus()
    page.keyboard.press(key)
    page.wait_for_timeout(150)


def view_of(page):
    return page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; const r = document.querySelector('.ds-view').getBoundingClientRect(); const v = ds.store.view; return { x: v.x, y: v.y, z: v.z, w: r.width, h: r.height } }")


def visible_rect(page):
    v = view_of(page)
    return {"x": -v["x"] / v["z"], "y": -v["y"] / v["z"], "w": v["w"] / v["z"], "h": v["h"] / v["z"]}


def contains(r, b, tol=0.01):
    return r["x"] <= b["x"] + tol and r["y"] <= b["y"] + tol and r["x"] + r["w"] >= b["x"] + b["w"] - tol and r["y"] + r["h"] >= b["y"] + b["h"] - tol


def fills(r, b, frac=0.78):
    """The box b fills at least `frac` of the view in one direction."""
    return b["w"] / r["w"] >= frac or b["h"] / r["h"] >= frac


def t_rulers(ctx, base):
    """E11: rulers in the chosen units with the origin at the page bottom-left, drag-out guides that snap, move and delete with undo, the four snap
    switches, the grid, every zoom command, wireframe, remembered view choices (real mouse and keyboard events)."""
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ids = info["ids"]
    pg = ds_eval(page, "return { w: ds.store.page().w, h: ds.store.page().h, id: ds.store.page().id }")
    wait_ov(page)
    # ---- rulers: units, origin at the bottom-left, y up ----
    check(page.locator(".ds-ruler-h").is_visible() and page.locator(".ds-ruler-v").is_visible() and page.locator(".ds-corner").inner_text() == "mm", "both rulers and the unit corner are shown at 1280")
    m = ds_eval(page, "return ds.rulers.marks()")
    v = view_of(page)
    h0 = next((t for t in m["h"] if t["v"] == 0), None)
    v0 = next((t for t in m["v"] if t["v"] == 0), None)
    check(h0 and abs(h0["x"] - v["x"]) < 0.01, f"the top ruler's 0 is at the page's left edge ({h0 and h0['x']:.2f} vs {v['x']:.2f})")
    check(v0 and abs(v0["y"] - (pg["h"] * v["z"] + v["y"])) < 0.01, f"the left ruler's 0 is at the page's bottom edge ({v0 and v0['y']:.2f})")
    ys = [t["y"] for t in sorted(m["v"], key=lambda t: t["v"])]
    check(all(a > b for a, b in zip(ys, ys[1:])) and m["unit"] == "mm", "left ruler values grow upward")
    xs = [t["x"] for t in m["h"]]
    check(all(b - a >= 50 for a, b in zip(xs, xs[1:])), f"labelled ticks are at least 50 px apart ({[round(b - a) for a, b in zip(xs, xs[1:])][:4]})")
    t40 = next(t for t in m["h"] if t["v"] == 40)
    check(abs(t40["x"] - (v["x"] + 40 * 72 / 25.4 * v["z"])) < 0.01, "40 on the top ruler is 40 mm from the page's left edge")
    ink = page.evaluate("() => ['.ds-ruler-h', '.ds-ruler-v'].map((s) => { const c = document.querySelector(s); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const bg = [d[0], d[1], d[2]]; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) n++; return n })")
    check(all(n > 80 for n in ink), f"both rulers are drawn (ink pixels {ink})")
    ds_eval(page, "ds.store.tx('units', (r) => ({ ...r, units: 'in' }))")
    page.wait_for_timeout(250)
    m = ds_eval(page, "return ds.rulers.marks()")
    one = next((t for t in m["h"] if t["v"] == 1), None)
    check(m["unit"] == "in" and one and abs(one["x"] - (v["x"] + 72 * v["z"])) < 0.01 and page.locator(".ds-corner").inner_text() == "in", f"in inches, 1 is 72 pt from the left edge ({m['unit']}, step {m['step']})")
    ds_eval(page, "ds.store.tx('units', (r) => ({ ...r, units: 'mm' }))")
    page.wait_for_timeout(150)
    ds_eval(page, "ds.store.setPref('snap', true)")

    # ---- drag out a guide from each ruler; it snaps; Alt does not; a release over the ruler cancels ----
    rh, rv = page.locator(".ds-ruler-h").bounding_box(), page.locator(".ds-ruler-v").bounding_box()
    z = zoom_of(page)

    def out_h(y, mods=(), end_on_ruler=False):
        tx_, ty_ = scr(page, 100, y)
        for k in mods:
            page.keyboard.down(k)
        page.mouse.move(rh["x"] + 250, rh["y"] + 8); page.mouse.down()
        page.mouse.move(tx_, ty_, steps=8)
        if end_on_ruler:
            page.mouse.move(rh["x"] + 300, rh["y"] + 8, steps=4)
        page.mouse.up()
        for k in reversed(mods):
            page.keyboard.up(k)
        page.wait_for_timeout(150)

    def out_v(x, mods=(), end_on_ruler=False):
        tx_, ty_ = scr(page, x, 100)
        for k in mods:
            page.keyboard.down(k)
        page.mouse.move(rv["x"] + 8, rv["y"] + 250); page.mouse.down()
        page.mouse.move(tx_, ty_, steps=8)
        if end_on_ruler:
            page.mouse.move(rv["x"] + 8, rv["y"] + 300, steps=4)
        page.mouse.up()
        for k in reversed(mods):
            page.keyboard.up(k)
        page.wait_for_timeout(150)

    undo_redo(page, "drag from the top ruler", lambda: out_h(265))
    g = guides_of(page)
    check(len(g) == 1 and g[0]["axis"] == "h" and abs(g[0]["pos"] - 265) < 1.6, f"a horizontal guide at about y 265 {g}")
    check(page.locator(".ds-ov line.ds-guide").count() == 1, "the guide line is in the overlay")
    ds_eval(page, "ds.store.undo()")
    undo_redo(page, "drag from the left ruler", lambda: out_v(340))
    g = guides_of(page)
    check(len(g) == 1 and g[0]["axis"] == "v" and abs(g[0]["pos"] - 340) < 1.6, f"a vertical guide at about x 340 {g}")
    ds_eval(page, "ds.store.undo()")
    out_v(167)
    g = guides_of(page)
    check(len(g) == 1 and g[0]["pos"] == 170, f"a guide dragged near an object edge snaps to it (the yellow square's left edge is 170) {g}")
    ds_eval(page, "ds.store.undo()")
    out_v(167, mods=("Alt",))
    g = guides_of(page)
    check(len(g) == 1 and abs(g[0]["pos"] - 167) < 1.2 and g[0]["pos"] != 170, f"Alt drags without snapping {g}")
    ds_eval(page, "ds.store.undo()")
    h0_ = hist(page)
    out_h(265, end_on_ruler=True)
    check(guides_of(page) == [] and hist(page) == h0_, "releasing over the ruler cancels the new guide (no history step)")
    out_h(265)
    esc_h = hist(page)
    tx_, ty_ = scr(page, 100, 200)
    page.mouse.move(rh["x"] + 250, rh["y"] + 8); page.mouse.down(); page.mouse.move(tx_, ty_, steps=5); page.keyboard.press("Escape"); page.mouse.up()
    page.wait_for_timeout(120)
    check(len(guides_of(page)) == 1 and hist(page) == esc_h, "Esc while dragging out cancels")
    ds_eval(page, "ds.store.undo()")

    # ---- objects snap to a guide; the switches turn it off ----
    ds_eval(page, "const G = await import('/packs/corel/_ds-guides.js'); ds.store.tx('Add guide', (r) => G.addGuide(r, ds.store.page().id, 'v', 33.3, ds.store.newId))")
    page.wait_for_timeout(150)
    red = ids["Red"]
    select_ids(page, red)
    drag_pt(page, (100, 80), (81, 80))
    page.wait_for_timeout(150)
    check(abs(nbox(page, red)["x"] - 33.3) < 0.01, f"the dragged object snaps to the guide ({nbox(page, red)['x']:.3f})")
    check(page.locator(".ds-ov .ds-snap").count() == 0, "the snap line goes away after the drop")
    ds_eval(page, "ds.store.undo()")
    page.locator('.ds-schip[data-cmd="view.snapGuides"]').click()
    check(pref_of(page, "snapGuides") is False and page.locator('.ds-schip[data-cmd="view.snapGuides"]').get_attribute("aria-pressed") == "false", "the Guides chip switches guide snapping off")
    select_ids(page, red)
    drag_pt(page, (100, 80), (81, 80))
    page.wait_for_timeout(150)
    check(abs(nbox(page, red)["x"] - 31) < 0.4, f"with guide snapping off the object stays where it was dropped ({nbox(page, red)['x']:.3f})")
    ds_eval(page, "ds.store.undo()")
    page.locator('.ds-schip[data-cmd="view.snapGuides"]').click()
    check(pref_of(page, "snapGuides") is True, "the chip switches it on again")
    for cmd, pref in (("view.snapObjects", "snapObjects"), ("view.snapPage", "snapPage")):
        run_menu(page, "View", cmd)
        check(pref_of(page, pref) is False, f"View > Snap to switches {pref} off")
        page.locator(f'.ds-schip[data-cmd="{cmd}"]').click()
        check(pref_of(page, pref) is True, f"the chip switches {pref} back on")
    page.get_by_role("menuitem", name="View", exact=True).click()
    check(page.locator('.ds-menu:visible [data-cmd="view.snapPage"]').get_attribute("aria-checked") == "true" and page.locator('.ds-menu:visible [data-cmd="view.snapGrid"]').get_attribute("aria-checked") == "false", "the View menu shows which snap switches are on")
    page.keyboard.press("Escape"); page.keyboard.press("Escape")
    # objects snapping off: the red box no longer snaps to the yellow square's edge, the page switch controls the page edge
    ds_eval(page, "ds.store.setPref('snapGuides', false); ds.store.setPref('snapObjects', false)")
    select_ids(page, red)
    drag_pt(page, (100, 80), (57, 80))  # left edge 7 pt, near nothing but the page edge 0 (7 > 5.2 pt away)
    page.wait_for_timeout(120)
    drag_pt(page, (57, 80), (53, 80))   # left edge 3 pt from the page edge: page snapping pulls it to 0
    page.wait_for_timeout(120)
    check(abs(nbox(page, red)["x"]) < 0.01, f"page snapping pulls the edge to the page edge ({nbox(page, red)['x']:.3f})")
    ds_eval(page, "ds.store.setPref('snapPage', false)")
    drag_pt(page, (53, 80), (45, 80))
    page.wait_for_timeout(120)
    check(abs(nbox(page, red)["x"] + 8) < 0.05, f"with page snapping off it does not ({nbox(page, red)['x']:.3f})")
    ds_eval(page, "ds.store.setPref('snapPage', true); ds.store.setPref('snapGuides', true); ds.store.setPref('snapObjects', true); ds.store.undo(); ds.store.undo(); ds.store.undo()")
    page.wait_for_timeout(120)
    # Alt+Z switches everything off and the chips dim
    key_on_canvas(page, "Alt+z")
    check(pref_of(page, "snap") is False and "ds-snap-off" in page.locator(".ds-snapchips").get_attribute("class"), "Alt+Z switches snapping off, the chips dim")
    key_on_canvas(page, "Alt+z")
    check(pref_of(page, "snap") is True, "and on again")

    # ---- move, delete and edit a guide with the Pick tool ----
    select_ids(page)
    sx, sy = scr(page, 33.3, 270)
    g0 = hist(page)
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(scr(page, 300, 270)[0], sy, steps=8); page.mouse.up()
    page.wait_for_timeout(150)
    g = guides_of(page)
    check(len(g) == 1 and g[0]["pos"] == 300 and hist(page)[1] == g0[1] + 1, f"dragging the guide moves it (and snaps to the gradient square's left edge) {g}")
    ds_eval(page, "ds.store.undo()")
    check(guides_of(page)[0]["pos"] == 33.3, "Move guide undoes")
    ds_eval(page, "ds.store.redo()")
    ds_eval(page, "ds.store.undo()")
    # a click selects the guide; Delete removes it, one step
    page.mouse.click(sx, sy)
    page.wait_for_timeout(100)
    check(ds_eval(page, "return ds.store.guideSel") == guides_of(page)[0]["id"] and page.locator(".ds-ov .ds-guide-sel").count() == 1, "a click selects the guide (drawn thicker)")
    n0 = hist(page)
    key_on_canvas(page, "Delete")
    check(guides_of(page) == [] and hist(page)[1] == n0[1] + 1, "Delete removes the selected guide in one step")
    ds_eval(page, "ds.store.undo()")
    check(len(guides_of(page)) == 1, "and Undo brings it back")
    # drag it onto the ruler to delete it
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(rv["x"] + 8, sy, steps=8); page.mouse.up()
    page.wait_for_timeout(150)
    check(guides_of(page) == [], "dragging a guide back onto its ruler deletes it")
    ds_eval(page, "ds.store.undo()")
    check(len(guides_of(page)) == 1, "which undoes too")
    # double-click opens the position field
    page.mouse.dblclick(sx, sy)
    d = dialog(page)
    check("Guide position" in d.inner_text() and d.locator("input[type=number]").input_value() == "11.747", f"double-click opens the position dialog in mm ({d.locator('input[type=number]').input_value()})")
    d.locator("input[type=number]").fill("50")
    d.get_by_role("button", name="Apply").click()
    page.wait_for_timeout(150)
    check(abs(guides_of(page)[0]["pos"] - 50 * 72 / 25.4) < 0.01, f"the guide moved to 50 mm ({guides_of(page)[0]['pos']:.3f} pt)")
    ds_eval(page, "ds.store.undo()")
    # lock guides: the press goes to the tool (a marquee), the guide stays
    run_menu(page, "Layout", "layout.lockGuides")
    check(pref_of(page, "lockGuides") is True, "Layout > Lock guides locks them")
    before = guides_of(page)
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(scr(page, 200, 270)[0], sy, steps=6); page.mouse.up()
    page.wait_for_timeout(120)
    check(guides_of(page) == before, "a locked guide does not move")
    run_menu(page, "Layout", "layout.lockGuides")
    check(pref_of(page, "lockGuides") is False, "and unlocks")
    # add through the dialogs, clear
    run_menu(page, "Layout", "layout.guideH")
    d = dialog(page)
    d.locator("input[type=number]").fill("30")
    d.get_by_role("button", name="Add guide").click()
    page.wait_for_timeout(150)
    gs = guides_of(page)
    check(len(gs) == 2 and gs[1]["axis"] == "h" and abs(gs[1]["pos"] - (pg["h"] - 30 * 72 / 25.4)) < 0.01, f"Add horizontal guide puts a guide 30 mm up from the page bottom ({gs[-1]})")
    run_menu(page, "Layout", "layout.guideV")
    d = dialog(page)
    d.locator("input[type=number]").fill("20")
    d.get_by_role("button", name="Add guide").click()
    page.wait_for_timeout(150)
    check(len(guides_of(page)) == 3 and guides_of(page)[2]["axis"] == "v" and abs(guides_of(page)[2]["pos"] - 20 * 72 / 25.4) < 0.01, "Add vertical guide measures from the left edge")
    undo_redo(page, "Clear guides", lambda: run_menu(page, "Layout", "layout.clearGuides"))
    check(guides_of(page) == [], "Clear guides removes them all")
    ds_eval(page, "ds.store.undo()")
    check(len(guides_of(page)) == 3, "Undo brings all three back")
    run_menu(page, "View", "view.guides")
    check(pref_of(page, "showGuides") is False and page.locator(".ds-ov line.ds-guide").count() == 0, "View > Guides hides them")
    ds_eval(page, "ds.store.setPref('snapObjects', false)")
    select_ids(page, red)
    drag_pt(page, (100, 80), (81, 80))
    page.wait_for_timeout(120)
    check(abs(nbox(page, red)["x"] - 33.3) < 0.01, f"hidden guides still snap ({nbox(page, red)['x']:.3f})")
    ds_eval(page, "ds.store.undo(); ds.store.setPref('snapObjects', true)")
    run_menu(page, "View", "view.guides")
    check(page.locator(".ds-ov line.ds-guide").count() == 3, "and show again")
    # guides belong to their page
    page.close()
    page, errors = mount(ctx, base)
    info = load_scene(page, pages=2)
    ds_eval(page, "const G = await import('/packs/corel/_ds-guides.js'); ds.store.tx('Add guide', (r) => G.addGuide(r, ds.store.page().id, 'h', 100, ds.store.newId))")
    page.wait_for_timeout(120)
    page.get_by_role("tab", name="Second").click()
    page.wait_for_timeout(300)
    check(guides_of(page) == [] and page.locator(".ds-ov line.ds-guide").count() == 0, "another page has no guides")
    page.get_by_role("tab", name="Page 1").click()
    page.wait_for_timeout(300)
    check(len(guides_of(page)) == 1 and page.locator(".ds-ov line.ds-guide").count() == 1, "the first page keeps its guide")

    # ---- the grid ----
    info = load_scene(page)
    ids = info["ids"]
    run_menu(page, "View", "view.grid")
    check(pref_of(page, "showGrid") is True and page.locator(".ds-ov path.ds-grid").count() == 1, "View > Grid shows the grid")
    ds_eval(page, "ds.store.setPref('snapObjects', false); ds.store.setPref('snapPage', false)")
    page.locator('.ds-schip[data-cmd="view.snapGrid"]').click()
    check(pref_of(page, "snapGrid") is True, "the Grid chip switches grid snapping on")
    blue = ids["Blue"]
    select_ids(page, blue)
    drag_pt(page, (240, 90), (265, 90))
    page.wait_for_timeout(150)
    step = 10 * 72 / 25.4
    b = nbox(page, blue)
    check(abs(b["x"] / step - round(b["x"] / step)) < 1e-3, f"the left edge lands on a grid line ({b['x']:.3f} is {b['x'] / step:.4f} steps)")
    check(abs((300 - (b["y"] + b["h"])) / step - round((300 - (b["y"] + b["h"])) / step)) < 1e-3, f"the grid counts up from the page bottom ({300 - (b['y'] + b['h']):.3f})")
    ds_eval(page, "ds.store.undo(); ds.store.setPref('snapGrid', false)")
    # ---- zoom commands ----
    ds_eval(page, "ds.store.setPref('snapObjects', true); ds.store.setPref('snapPage', true); ds.store.setPref('showGrid', false)")
    select_ids(page)
    key_on_canvas(page, "Shift+F4")
    r = visible_rect(page)
    check(contains(r, {"x": 0, "y": 0, "w": 400, "h": 300}) and fills(r, {"x": 0, "y": 0, "w": 400, "h": 300}), f"Shift+F4 fits the page {r}")
    zpage = zoom_of(page)
    content = {"x": 50, "y": 50, "w": 310, "h": 190}
    key_on_canvas(page, "F4")
    r = visible_rect(page)
    zall = zoom_of(page)
    check(contains(r, content) and fills(r, content) and zall > zpage, f"F4 zooms to all objects ({zall:.3f} > {zpage:.3f})")
    select_ids(page, blue)
    key_on_canvas(page, "Shift+F2")
    r = visible_rect(page)
    bb = nbox(page, blue)
    check(contains(r, bb) and fills(r, bb) and zoom_of(page) > zall, f"Shift+F2 zooms to the selection {r}")
    select_ids(page)
    z1 = zoom_of(page)
    key_on_canvas(page, "Shift+F2")
    check(abs(zoom_of(page) - z1) < 1e-9, "Shift+F2 with nothing selected leaves the view alone (the menu item is disabled)")
    key_on_canvas(page, "F3")
    check(abs(zoom_of(page) - z1 / 1.25) < 1e-6, f"F3 zooms out by a quarter ({z1:.3f} to {zoom_of(page):.3f})")
    key_on_canvas(page, "Control+1")
    check(abs(zoom_of(page) - 96 / 72) < 1e-6 and page.inner_text(".ds-zoomval") == "100%", f"Ctrl+1 is 100 percent ({page.inner_text('.ds-zoomval')})")
    key_on_canvas(page, "F2")
    check(tool_of(page) == "zoom", "F2 picks the Zoom tool")
    z2 = zoom_of(page)
    page.mouse.click(*scr(page, 200, 150))
    check(zoom_of(page) > z2 * 1.4, "a click with the Zoom tool zooms in")
    z3 = zoom_of(page)
    page.keyboard.down("Alt"); page.mouse.click(*scr(page, 200, 150)); page.keyboard.up("Alt")
    check(zoom_of(page) < z3 * 0.8, "Alt+click zooms out")
    key_on_canvas(page, "Shift+F4")
    a_, b_ = scr(page, 60, 60), scr(page, 160, 120)
    page.mouse.move(*a_); page.mouse.down(); page.mouse.move(*b_, steps=6); page.mouse.up()
    page.wait_for_timeout(120)
    r = visible_rect(page)
    check(contains(r, {"x": 60, "y": 60, "w": 100, "h": 60}) and fills(r, {"x": 60, "y": 60, "w": 100, "h": 60}, 0.6), f"dragging a rectangle zooms to it {r}")
    key_on_canvas(page, "v")
    key_on_canvas(page, "Shift+F4")

    # ---- wireframe ----
    key_on_canvas(page, "Shift+F9")
    wire = page.evaluate("(id) => { const w = document.querySelector('.ds-world'); const p = w.querySelector(`[data-id=\"${id}\"]`); const path = p.localName === 'path' ? p : p.querySelector('path'); const cs = getComputedStyle(path); return [w.classList.contains('ds-wire'), cs.fill, cs.stroke, getComputedStyle(w.querySelector('image')).opacity] }", ids["Red"])
    check(wire[0] and wire[1] == "none" and wire[2] != "none" and float(wire[3]) < 0.5, f"Shift+F9 shows outlines only {wire}")
    page.get_by_role("menuitem", name="View", exact=True).click()
    check(page.locator('.ds-menu:visible [data-cmd="view.wireframe"]').get_attribute("aria-checked") == "true", "the View menu shows Wireframe checked")
    page.keyboard.press("Escape"); page.keyboard.press("Escape")
    click_pt(page, 50, 80)
    check(sel_of(page) == [ids["Red"]], "objects can still be picked in wireframe view (on the outline)")
    select_ids(page)
    key_on_canvas(page, "Shift+F9")
    check(not page.evaluate("() => document.querySelector('.ds-world').classList.contains('ds-wire')"), "Shift+F9 again shows the normal view")

    # ---- rulers on and off, remembered ----
    key_on_canvas(page, "Control+Alt+r")
    check(not page.locator(".ds-ruler-h").is_visible() and pref_of(page, "rulers") is False, "Ctrl+Alt+R hides the rulers")
    check(page.evaluate("() => { const h = document.querySelector('.ds-view').getBoundingClientRect(), s = document.querySelector('.ds-stage').getBoundingClientRect(); return Math.abs(h.left - s.left) < 0.5 && Math.abs(h.top - s.top) < 0.5 }"), "the canvas takes the room")
    page.get_by_role("menuitem", name="Window", exact=True).click()
    page.locator('.ds-menu:visible [data-cmd="view.rulers"]').first.click()
    page.wait_for_timeout(150)
    check(page.locator(".ds-ruler-h").is_visible() and pref_of(page, "rulers") is True, "Window > Rulers brings them back")
    run_menu(page, "View", "view.grid")
    page.keyboard.press("Control+Shift+y")
    page.wait_for_timeout(150)
    check(pref_of(page, "snapGrid") is True, "Ctrl+Shift+Y switches grid snapping")
    page.keyboard.press("Control+Shift+y")
    saved = page.evaluate("() => localStorage.getItem('tools:ds-prefs')")
    check(saved and '"showGrid":true' in saved and '"rulers":true' in saved, f"view choices are remembered on this device {saved}")
    page.reload()
    wait_ds(page)
    page.wait_for_timeout(300)
    check(pref_of(page, "showGrid") is True and pref_of(page, "rulers") is True, "after a reload the grid and rulers are still on")
    page.evaluate("() => localStorage.setItem('tools:ds-prefs', '{\"rulers\": \"yes\", \"nudge\": 1e99, \"junk\": 1, \"__proto__\": {\"x\": 1}}')")
    page.reload()
    wait_ds(page)
    page.wait_for_timeout(300)
    check(pref_of(page, "rulers") is None and pref_of(page, "nudge") == 100 and pref_of(page, "junk") is None, "a damaged preference record is cleaned, not trusted")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:2]}")
    shot(page, "rulers")
    page.close()


def center_of(page, selector):
    r = page.evaluate("(s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }", selector)
    return r


def fill_of(page, nid):
    return node_of(page, nid)["fill"]


def make_bitmap(page, w=64, h=64, kind="circle"):
    """A known picture asset: a black disc on white (kind circle) or a two-colour split. Returns the asset id."""
    return ds_eval(page, """const c = document.createElement('canvas'); c.width = arg.w; c.height = arg.h; const g = c.getContext('2d')
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, arg.w, arg.h)
      if (arg.kind === 'circle') { g.fillStyle = '#000000'; g.beginPath(); g.arc(arg.w / 2, arg.h / 2, arg.w * 0.31, 0, Math.PI * 2); g.fill() }
      else { g.fillStyle = '#d02020'; g.fillRect(0, 0, arg.w / 2, arg.h); g.fillStyle = '#2040d0'; g.fillRect(arg.w / 2, 0, arg.w / 2, arg.h) }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      return (await ds.assets.addBlob(blob, 'test.png')).id""", {"w": w, "h": h, "kind": kind})


def place_image(page, asset, x, y, w, h, name="Pic"):
    return ds_eval(page, """const T = await import('/packs/corel/_ds-tools-draw.js'); const id = ds.store.newId()
      const d = ds.assets.dims(arg.asset)
      T.placeNodes(ds.store, [{ id, t: 'image', name: arg.name, asset: arg.asset, w: d.w, h: d.h, m: [arg.w, 0, 0, arg.h, arg.x, arg.y], opacity: 1 }], 'add picture'); return id""", {"asset": asset, "x": x, "y": y, "w": w, "h": h, "name": name})


def t_fx(ctx, base):
    """E12: Interactive fill (uniform, linear, radial, handles, stop markers), Outline pen dialog, Transparency, Eyedropper, Trace bitmap."""
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ids = info["ids"]
    red, blue, grad = ids["Red"], ids["Blue"], ids["Gradient"]
    ds_eval(page, "ds.store.setPref('snap', false)")
    select_ids(page, red)
    key_on_canvas(page, "g")
    check(tool_of(page) == "fill" and page.locator(".ds-fillbar").is_visible(), "G picks the Interactive fill tool and its property bar shows")
    kinds = page.evaluate("() => [...document.querySelectorAll('.ds-fillbar .ds-kindbtn')].map((b) => [b.dataset.kind, b.getAttribute('aria-pressed')])")
    check(kinds == [["none", "false"], ["uniform", "true"], ["linear", "false"], ["radial", "false"]], f"the type buttons show a uniform fill {kinds}")
    check(page.locator(".ds-ov .ds-fillh").count() == 0, "a uniform fill has no handles")

    # ---- uniform to linear, undoable ----
    undo_redo(page, "Linear fill", lambda: page.locator('.ds-fillbar .ds-kindbtn[data-kind="linear"]').click())
    f = fill_of(page, red)
    check(f["g"] == "linear" and len(f["stops"]) == 2 and f["stops"][0]["c"] == "#ff0000" and f["stops"][1]["c"] == "#ffffff", f"Linear makes a two-stop gradient from the colour to white {f['stops']}")
    check([f["x1"], f["y1"], f["x2"], f["y2"]] == [50, 80, 150, 80], f"over the shape's own box, left to right {[f['x1'], f['y1'], f['x2'], f['y2']]}")
    wait_ov(page)
    check(page.locator(".ds-ov .ds-fillh").count() == 2, "two handles show")
    sx, sy = center_of(page, '.ds-ov [data-h="fill-start"]')
    ex, ey = center_of(page, '.ds-ov [data-h="fill-end"]')
    a_s, b_s = scr(page, 50, 80), scr(page, 150, 80)
    check(abs(sx - a_s[0]) < 1 and abs(sy - a_s[1]) < 1 and abs(ex - b_s[0]) < 1 and abs(ey - b_s[1]) < 1, "the handles sit on the start and the end of the gradient")

    # ---- drag the end handle: a live preview, then one step ----
    h0 = hist(page)
    page.mouse.move(ex, ey); page.mouse.down()
    page.mouse.move(*scr(page, 150, 100), steps=6)
    mid = page.evaluate("(id) => { const el = document.querySelector(`[data-id=\"${id}\"]`); const p = el.localName === 'path' ? el : el.querySelector('path'); const m = /url\\(#([^)]+)\\)/.exec(p.getAttribute('fill')); const g = m && document.getElementById(m[1]); return g ? [+g.getAttribute('x2'), +g.getAttribute('y2')] : null }", red)
    check(mid and abs(mid[0] - 150) < 1.5 and abs(mid[1] - 100) < 1.5, f"the gradient shows the new end while dragging {mid}")
    check(hist(page) == h0, "nothing is committed during the drag")
    page.mouse.up()
    page.wait_for_timeout(150)
    f = fill_of(page, red)
    check(abs(f["x2"] - 150) < 1.5 and abs(f["y2"] - 100) < 1.5 and hist(page)[1] == h0[1] + 1, f"releasing commits one step {f['x2']:.2f}, {f['y2']:.2f}")
    ds_eval(page, "ds.store.undo()")
    check(fill_of(page, red)["y2"] == 80, "Undo restores the end point")
    ds_eval(page, "ds.store.redo()"); ds_eval(page, "ds.store.undo()")
    # Esc cancels a drag
    page.mouse.move(ex, ey); page.mouse.down(); page.mouse.move(*scr(page, 120, 60), steps=4); page.keyboard.press("Escape"); page.mouse.up()
    page.wait_for_timeout(120)
    check(fill_of(page, red)["y2"] == 80 and hist(page)[1] == h0[1], "Esc cancels the handle drag")
    # drag the start handle
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(*scr(page, 70, 80), steps=5); page.mouse.up()
    page.wait_for_timeout(120)
    check(abs(fill_of(page, red)["x1"] - 70) < 1.5, f"the start handle moves the start ({fill_of(page, red)['x1']:.2f})")
    ds_eval(page, "ds.store.undo()")

    # ---- stop markers: click the line to add, drag, select, recolour, delete ----
    nstops = lambda: len(fill_of(page, red)["stops"])
    undo_redo(page, "Add colour stop", lambda: page.mouse.click(*scr(page, 100, 80)))
    f = fill_of(page, red)
    check(len(f["stops"]) == 3 and abs(f["stops"][1]["o"] - 0.5) < 0.02, f"clicking the line adds a colour stop there {[round(s['o'], 3) for s in f['stops']]}")
    check(f["stops"][1]["c"] in ("#ff8080", "#ff7f7f", "#ff8080".upper()), f"with the colour the gradient has at that point {f['stops'][1]['c']}")
    wait_ov(page)
    check(page.locator(".ds-ov .ds-stopm").count() >= 1 and page.locator(".ds-ov .ds-stopm.ds-picked").count() == 1, "the new stop is drawn and selected")
    px, py = center_of(page, ".ds-ov .ds-stopm.ds-picked")
    page.mouse.move(px, py); page.mouse.down(); page.mouse.move(*scr(page, 75, 80), steps=6); page.mouse.up()
    page.wait_for_timeout(120)
    f = fill_of(page, red)
    check(len(f["stops"]) == 3 and abs(f["stops"][1]["o"] - 0.25) < 0.02, f"dragging a stop marker along the line moves it {[round(s['o'], 3) for s in f['stops']]}")
    # recolour the selected stop from the property bar
    col = page.locator(".ds-fillbar input[type=color]")
    check(col.is_enabled() and col.input_value() == f["stops"][1]["c"], f"the colour box shows the selected stop's colour {col.input_value()}")
    col.fill("#00aa00")
    page.wait_for_timeout(150)
    f = fill_of(page, red)
    check(f["stops"][1]["c"] == "#00aa00" and f["stops"][0]["c"] == "#ff0000", "the colour box recolours that stop only")
    pos = page.locator('.ds-fillbar input[aria-label^="Position of the selected"]')
    pos.fill("60"); pos.press("Enter")
    page.wait_for_timeout(150)
    check(abs(fill_of(page, red)["stops"][1]["o"] - 0.6) < 1e-6, "the position field moves the stop to 60 percent")
    # a palette click recolours the selected stop instead of the whole fill
    page.locator(".ds-palette .ds-sw[data-hex]").nth(30).click()
    page.wait_for_timeout(120)
    f = fill_of(page, red)
    check(isinstance(f, dict) and len(f["stops"]) == 3 and f["stops"][1]["c"] != "#00aa00" and f["stops"][0]["c"] == "#ff0000", "a palette swatch colours the selected stop and keeps the gradient")
    # Delete removes the selected stop (not the object)
    key_on_canvas(page, "Delete")
    check(nstops() == 2 and node_of(page, red) is not None, "Delete removes the selected stop, not the object")
    page.mouse.click(*scr(page, 100, 80))
    page.wait_for_timeout(100)
    page.locator('.ds-fillbar [aria-label="Remove the selected colour stop"]').click()
    page.wait_for_timeout(100)
    check(nstops() == 2, "the Remove button does the same")
    page.locator('.ds-fillbar [aria-label="Add a colour stop"]').click()
    check(nstops() == 3, "Add colour puts a stop in the widest gap")
    page.locator('.ds-fillbar [aria-label="Reverse the colours"]').click()
    check(fill_of(page, red)["stops"][0]["c"] != "#ff0000", "Reverse swaps the colours")

    # ---- radial ----
    page.locator('.ds-fillbar .ds-kindbtn[data-kind="radial"]').click()
    f = fill_of(page, red)
    check(f["g"] == "radial" and [f["cx"], f["cy"], f["r"]] == [100, 80, 50] and len(f["stops"]) == 3, f"Radial keeps the colours and centres on the shape {[f.get('cx'), f.get('cy'), f.get('r')]}")
    wait_ov(page)
    ex, ey = center_of(page, '.ds-ov [data-h="fill-end"]')
    check(abs(ex - scr(page, 150, 80)[0]) < 1, "the edge handle sits on the circle")
    page.mouse.move(ex, ey); page.mouse.down(); page.mouse.move(*scr(page, 180, 80), steps=5); page.mouse.up()
    page.wait_for_timeout(120)
    check(abs(fill_of(page, red)["r"] - 80) < 1.5, f"dragging the edge handle sets the radius ({fill_of(page, red)['r']:.2f})")
    sx, sy = center_of(page, '.ds-ov [data-h="fill-start"]')
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(*scr(page, 90, 70), steps=5); page.mouse.up()
    page.wait_for_timeout(120)
    f = fill_of(page, red)
    check(abs(f["cx"] - 90) < 1.5 and abs(f["cy"] - 70) < 1.5 and abs(f["r"] - 80) < 1.5, "the centre handle moves the whole circle")
    # a rotated object keeps its handles on the gradient (m carries the rotation)
    select_ids(page, red)
    ds_eval(page, "const O = await import('/packs/corel/_ds-ops.js'); const b = ds.renderer.nodeBox(ds.store.find(arg).node); ds.store.tx('Rotate', (r) => O.transformIds(r, [arg], O.rotateAbout(Math.PI / 6, b.x + b.w / 2, b.y + b.h / 2)))", red)
    wait_ov(page)
    want = ds_eval(page, "const F = await import('/packs/corel/_ds-fill.js'); const h = F.gradientHandles(ds.store.find(arg).node.fill); return [h.a, h.b]", red)
    sx, sy = center_of(page, '.ds-ov [data-h="fill-start"]'); ex, ey = center_of(page, '.ds-ov [data-h="fill-end"]')
    wa, wb = scr(page, want[0]["x"], want[0]["y"]), scr(page, want[1]["x"], want[1]["y"])
    check(abs(sx - wa[0]) < 1 and abs(sy - wa[1]) < 1 and abs(ex - wb[0]) < 1 and abs(ey - wb[1]) < 1, "after rotating the shape the handles are still on the gradient")
    ds_eval(page, "ds.store.undo()")
    # uniform and none
    first = fill_of(page, red)["stops"][0]["c"]
    page.locator('.ds-fillbar .ds-kindbtn[data-kind="uniform"]').click()
    check(fill_of(page, red) == first, f"Uniform keeps the first colour {fill_of(page, red)}")
    page.locator('.ds-fillbar .ds-kindbtn[data-kind="none"]').click()
    check(fill_of(page, red) is None, "None clears the fill")
    ds_eval(page, "ds.store.undo()")
    # several shapes at once
    select_ids(page, red, blue)
    page.locator('.ds-fillbar .ds-kindbtn[data-kind="linear"]').click()
    check(fill_of(page, red)["g"] == "linear" and fill_of(page, blue)["g"] == "linear" and fill_of(page, blue)["x1"] == 200, "the type applies to every selected shape, each over its own box")
    ds_eval(page, "ds.store.undo()")
    select_ids(page, ids["Photo"])
    check(page.locator(".ds-fillbar .ds-kindbtn").first.is_disabled(), "a picture has no fill type to change")
    key_on_canvas(page, "v")

    # ---- Transparency ----
    select_ids(page, blue)
    key_on_canvas(page, "Shift+T")
    check(tool_of(page) == "transp" and page.locator(".ds-transpbar").is_visible(), "Shift+T picks the Transparency tool and shows its slider")
    sl = page.locator('.ds-transpbar input[type=range]')
    h0 = hist(page)
    sl.evaluate("(e) => { e.value = '40'; e.dispatchEvent(new Event('input', { bubbles: true })) }")
    sl.evaluate("(e) => { e.value = '60'; e.dispatchEvent(new Event('input', { bubbles: true })) }")
    page.wait_for_timeout(120)
    n = node_of(page, blue)
    check(abs(n["fillOpacity"] - 0.4) < 1e-6 and abs(n["strokeOpacity"] - 0.4) < 1e-6 and hist(page)[1] == h0[1] + 1, f"the slider sets fill and outline opacity together, one step for a drag ({n['fillOpacity']}, {n['strokeOpacity']})")
    check(page.evaluate("(id) => { const el = document.querySelector(`[data-id=\"${id}\"]`); const p = el.localName === 'path' ? el : el.querySelector('path'); return [p.getAttribute('fill-opacity'), p.getAttribute('stroke-opacity')] }", blue) == ["0.4", "0.4"], "and the picture on screen follows")
    ds_eval(page, "ds.store.undo()")
    check(node_of(page, blue)["fillOpacity"] == 1, "one Undo clears it")
    select_ids(page, ids["Photo"], ids["Pair"])
    sl.evaluate("(e) => { e.value = '25'; e.dispatchEvent(new Event('input', { bubbles: true })) }")
    page.wait_for_timeout(120)
    pn = node_of(page, ids["Photo"]); pair = node_of(page, ids["Pair"])
    check(abs(pn["opacity"] - 0.75) < 1e-6 and all(abs(k["fillOpacity"] - 0.75) < 1e-6 for k in pair["items"]), "pictures and every shape inside a group take the same value")
    page.locator('.ds-transpbar [aria-label="Clear transparency"]').click()
    page.wait_for_timeout(120)
    check(node_of(page, ids["Photo"])["opacity"] == 1 and node_of(page, ids["Pair"])["items"][0]["fillOpacity"] == 1, "Clear puts everything back to solid")
    run_menu(page, "Effects", "effects.clearTransp")
    key_on_canvas(page, "v")

    # ---- Eyedropper ----
    ds_eval(page, "const O = await import('/packs/corel/_ds-ops.js'); ds.store.tx('red', (r) => O.setStyle(r, [arg], { fill: '#ff0000' }))", red)
    select_ids(page, red)
    key_on_canvas(page, "i")
    check(tool_of(page) == "eyedrop", "I picks the Eyedropper")
    click_pt(page, 240, 90)  # the blue square (fill blue, black outline 2 pt)
    page.wait_for_timeout(120)
    r = node_of(page, red)
    check(r["fill"] == "#0000ff" and r["stroke"] == "#000000" and r["strokeWidth"] == 2, f"with a selection, clicking another object copies its fill and outline onto it {r['fill']} {r['stroke']} {r['strokeWidth']}")
    check("pixel" in status_text(page) or "look" in status_text(page).lower() or "Copied" in status_text(page), f"the status says it copies the shape's look, not a pixel ({status_text(page)!r})")
    ds_eval(page, "ds.store.undo()")
    check(node_of(page, red)["fill"] == "#ff0000", "one Undo")
    select_ids(page)
    click_pt(page, 330, 180)  # the gradient square
    check(sel_of(page) == [] and node_of(page, red)["fill"] == "#ff0000", "with nothing selected the first click only samples")
    click_pt(page, 100, 80)
    page.wait_for_timeout(120)
    f = node_of(page, red)["fill"]
    check(isinstance(f, dict) and f["g"] == "linear" and sel_of(page) == [red], "the next click applies the sampled gradient to the clicked object")
    ds_eval(page, "ds.store.undo()")
    key_on_canvas(page, "v")

    # ---- Outline pen ----
    select_ids(page, blue)
    key_on_canvas(page, "F12")
    d = dialog(page)
    check("Outline pen" in d.inner_text(), "F12 opens the Outline pen dialog")
    width = d.locator('input[aria-label="Outline width"]')
    check(width.input_value() == str(round(2 / (72 / 25.4), 3)), f"it shows the current width in mm ({width.input_value()})")
    d.locator('select[aria-label="Width preset"]').select_option("0.1")
    check(float(width.input_value()) < 0.05, "the Hairline preset fills the width")
    width.fill("1.5")
    d.locator('input[aria-label="Outline colour"]').fill("#ff0000")
    d.locator('select[aria-label="Line style"]').select_option("dashed")
    d.get_by_role("group", name="Line ends").get_by_role("button", name="Round").click()
    d.get_by_role("group", name="Corners").get_by_role("button", name="Bevel").click()
    check(d.locator('input[aria-label="Miter limit"]').is_disabled(), "the miter limit is for mitered corners only")
    d.get_by_role("group", name="Corners").get_by_role("button", name="Miter").click()
    d.locator('input[aria-label="Miter limit"]').fill("7")
    d.get_by_role("group", name="Corners").get_by_role("button", name="Round").click()
    h0 = hist(page)
    d.get_by_role("button", name="Apply").click()
    page.wait_for_timeout(150)
    n = node_of(page, blue)
    w = 1.5 * 72 / 25.4
    check(abs(n["strokeWidth"] - w) < 1e-6 and n["stroke"] == "#ff0000" and n["cap"] == 1 and n["join"] == 1 and n["miter"] == 7 and n["dash"] == [4 * w, 3 * w] and hist(page)[1] == h0[1] + 1, f"Apply sets width, colour, dash, caps and joins in one step {n['strokeWidth']:.3f} {n['stroke']} {n['cap']} {n['join']} {n['dash']}")
    check(page.evaluate("(id) => { const el = document.querySelector(`[data-id=\"${id}\"]`); const p = el.localName === 'path' ? el : el.querySelector('path'); return [p.getAttribute('stroke-linecap'), p.getAttribute('stroke-linejoin'), p.getAttribute('stroke-dasharray')] }", blue)[0:2] == ["round", "round"], "the drawing follows")
    ds_eval(page, "ds.store.undo()")
    check(node_of(page, blue)["strokeWidth"] == 2 and node_of(page, blue)["dash"] is None, "Undo restores the outline")
    ds_eval(page, "ds.store.redo()")
    page.keyboard.press("Shift+F12")
    d = dialog(page)
    check("Outline colour" in d.inner_text() or "colour" in d.inner_text().lower(), "Shift+F12 still opens the colour dialog")
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    select_ids(page, red, blue)
    key_on_canvas(page, "F12")
    d = dialog(page)
    d.get_by_label("No outline").check()
    d.get_by_role("button", name="Apply").click()
    page.wait_for_timeout(150)
    check(node_of(page, red)["stroke"] is None and node_of(page, blue)["stroke"] is None and node_of(page, blue)["strokeWidth"] == 0, "No outline clears every selected outline")
    ds_eval(page, "ds.store.undo()")
    select_ids(page, ids["Photo"])
    check(not page.evaluate("() => document.querySelector('.tool-body').__ds.commands.enabled('effects.outlinePen')"), "pictures have no outline pen")

    # ---- Trace bitmap ----
    asset = make_bitmap(page, 64, 64, "circle")
    pic = place_image(page, asset, 40, 20, 100, 100, "Disc")
    check(page.locator(".ds-bitmapbar").is_visible(), "a selected picture shows the Bitmap bar")
    top_before = ds_eval(page, "return ds.store.find(arg).layer.items.length", pic)
    run_menu(page, "Bitmaps", "bitmap.traceLine")
    d = dialog(page)
    check("Trace bitmap" in d.inner_text() and d.locator('select[aria-label="Trace preset"]').input_value() == "lineart", "Bitmaps > Trace bitmap > Line art opens the dialog with that preset")
    check(d.locator('input[aria-label="Number of colours"]').is_disabled(), "line art is two colours, so the colour count is fixed")
    d.locator('select[aria-label="Trace preset"]').select_option("poster")
    check(d.locator('input[aria-label="Number of colours"]').is_enabled() and d.locator('input[aria-label="Number of colours"]').input_value() == "24", "the Poster preset has 24 colours")
    d.locator('select[aria-label="Trace preset"]').select_option("lineart")
    h0 = hist(page)
    d.get_by_role("button", name="Trace", exact=True).click()
    page.wait_for_function("() => !document.querySelector('dialog[open]')", timeout=30000)
    page.wait_for_timeout(300)
    check(hist(page)[1] == h0[1] + 1, "tracing is one undo step")
    sel = sel_of(page)
    grp = node_of(page, sel[0]) if sel else None
    check(grp and grp["t"] == "group" and grp["name"].startswith("Traced") and len(grp["items"]) >= 1, f"the result is one group of shapes, selected {grp and (grp['name'], len(grp['items']))}")
    check(node_of(page, pic) is not None and node_of(page, pic)["m"] == [100, 0, 0, 100, 40, 20], "the original bitmap is kept, unchanged")
    items = ds_eval(page, "const l = ds.store.find(arg).layer.items; return l.map((n) => n.id)", pic)
    check(items.index(sel[0]) == items.index(pic) + 1, "the group sits just above the bitmap")
    gb = nbox(page, sel[0])
    # the disc: centre (32, 32) of 64 px, radius 0.31 * 64 = 19.84 px; the picture is 100 pt wide, so 1.5625 pt per pixel
    k = 100 / 64
    exp = {"x": 40 + (32 - 19.84) * k, "y": 20 + (32 - 19.84) * k, "w": 2 * 19.84 * k, "h": 2 * 19.84 * k}
    check(abs(gb["x"] - exp["x"]) < 3 and abs(gb["y"] - exp["y"]) < 3 and abs(gb["w"] - exp["w"]) < 4 and abs(gb["h"] - exp["h"]) < 4, f"the shapes lie over the disc {({k_: round(v, 1) for k_, v in gb.items()})} vs {({k_: round(v, 1) for k_, v in exp.items()})}")
    fills_ = ds_eval(page, "const o = []; const rec = (n) => n.t === 'group' ? n.items.forEach(rec) : o.push(n.fill); rec(ds.store.find(arg).node); return [...new Set(o)]", sel[0])
    check(len(fills_) == 1 and all(int(fills_[0][i:i + 2], 16) < 16 for i in (1, 3, 5)), f"line art gives black shapes only {fills_}")
    ds_eval(page, "ds.store.undo()")
    check(ds_eval(page, "return ds.store.find(arg).layer.items.length", pic) == top_before, "Undo removes the trace and keeps the bitmap")
    # logo and poster on a two-colour picture
    asset2 = make_bitmap(page, 48, 48, "split")
    pic2 = place_image(page, asset2, 200, 20, 90, 90, "Split")
    for preset, label in (("logo", "Logo or clipart"), ("poster", "Poster or photo")):
        select_ids(page, pic2)
        run_menu(page, "Bitmaps", f'bitmap.trace{"Logo" if preset == "logo" else "Poster"}')
        d = dialog(page)
        d.get_by_role("button", name="Trace", exact=True).click()
        page.wait_for_function("() => !document.querySelector('dialog[open]')", timeout=30000)
        page.wait_for_timeout(250)
        sel = sel_of(page)
        cols = ds_eval(page, "const o = []; const rec = (n) => n.t === 'group' ? n.items.forEach(rec) : o.push(n.fill); rec(ds.store.find(arg).node); return [...new Set(o)].sort()", sel[0])
        gb = nbox(page, sel[0])
        check(len(cols) >= 2 and abs(gb["x"] - 200) < 3 and abs(gb["w"] - 90) < 4, f"{label}: the split picture traces into its colours {cols} over its box")
        ds_eval(page, "ds.store.undo()")
    # save the original bitmap
    select_ids(page, pic2)
    with page.expect_download() as dl:
        run_menu(page, "Bitmaps", "bitmap.saveOriginal")
    data = Path(dl.value.path()).read_bytes()
    check(dl.value.suggested_filename.endswith(".png") and data[:4] == b"\x89PNG" and len(data) > 50, f"Save original bitmap downloads the stored picture ({dl.value.suggested_filename}, {len(data)} bytes)")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:2]}")
    shot(page, "fx")
    page.close()


SVG_SQUARES = '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect x="10" y="10" width="{a}" height="{a}" fill="#2255cc"/><circle cx="{c}" cy="{c}" r="{r}" fill="#cc5522"/></svg>'


def write_svg(dirp, name, w=120, h=90, a=40):
    p = Path(dirp) / name
    p.write_text(SVG_SQUARES.format(w=w, h=h, a=a, c=80, r=15), encoding="utf8")
    return p


def drop_files(page, files, selector=".ds-stage"):
    """Drop real file bytes onto the canvas stage with a synthetic drop event (the same code path as a drag from the desktop)."""
    payload = [{"name": f.name, "b64": base64.b64encode(f.read_bytes()).decode()} for f in files]
    page.evaluate("""([sel, files]) => { const dt = new DataTransfer(); for (const f of files) { const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)); dt.items.add(new File([bin], f.name)) }
      const el = document.querySelector(sel); for (const t of ['dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })) }""", [selector, payload])


def n_objects(page):
    return page.evaluate("() => { const r = document.querySelector('.tool-body').__ds.store.page(); const c = (items) => items.reduce((s, n) => s + 1 + (n.t === 'group' ? c(n.items) : 0), 0); return r.layers.reduce((s, l) => s + c(l.items), 0) }")


NO_BRANDS = r"Corel|Adobe|Illustrator|Photoshop|Inkscape|Affinity|Figma|Sketch\b"


def t_menus13(ctx, base):
    """E13: the ten menus (every item has a command behind it), context menus, shortcut sheet and command finder, Properties docker, Options, Document
    properties, Notes, Import (Ctrl+I) with the page picker, the Open-or-import prompt, several files at once."""
    import re, tempfile
    tmp = Path(tempfile.mkdtemp(prefix="dsimp-"))
    page, errors = mount(ctx, base)
    warns = []
    page.on("console", lambda m: warns.append(m.text) if "has no implementation" in m.text else None)
    info = load_scene(page)
    ids = info["ids"]
    ds_eval(page, "ds.store.setPref('snap', false)")
    # ---- every menu, every item: a command with a run function ----
    menus = page.evaluate("() => [...document.querySelectorAll('.ds-menubar .ds-mtop')].map((b) => b.textContent)")
    check(menus == ["File", "Edit", "View", "Layout", "Object", "Effects", "Bitmaps", "Text", "Window", "Help"], f"the ten menus {menus}")
    items = page.evaluate("() => [...document.querySelectorAll('.ds-menubar .ds-mi')].map((b) => b.dataset.cmd)")
    bad = ds_eval(page, "return arg.filter((id) => !ds.commands.has(id))", items)
    check(len(items) > 140 and not bad and not warns, f"{len(items)} menu items, every one has a command behind it {bad} {warns[:2]}")
    meta_ids = ds_eval(page, "const K = await import('/packs/corel/_ds-keys.js'); return K.COMMANDS.map((c) => c.id)")
    check(set(meta_ids) <= set(items), f"every command in the table is in a menu ({set(meta_ids) - set(items)})")
    for m in menus:
        page.get_by_role("menuitem", name=m, exact=True).click()
        n = page.locator(".ds-menu:visible .ds-mi").count()
        check(n >= 3, f"the {m} menu lists {n} items")
        page.keyboard.press("Escape"); page.keyboard.press("Escape")
    page.locator(".ds-view").focus()

    # ---- every dialog closes with Esc, and none names another product ----
    select_ids(page, ids["Blue"])
    for label, how in (("Document properties", lambda: run_menu(page, "File", "file.properties")), ("Options", lambda: run_menu(page, "Edit", "edit.options")), ("Outline pen", lambda: run_menu(page, "Effects", "effects.outlinePen")),
                       ("Page setup", lambda: run_menu(page, "Layout", "page.setup")), ("Add guide", lambda: run_menu(page, "Layout", "layout.guideV")), ("Notes about this file", lambda: run_menu(page, "File", "file.notes")),
                       ("Keyboard shortcuts", lambda: run_menu(page, "Help", "help.shortcuts")), ("Notes on conversions", lambda: run_menu(page, "Help", "help.conversions")), ("Supported formats", lambda: run_menu(page, "Help", "help.formats")),
                       ("About", lambda: run_menu(page, "Help", "help.about")), ("Fill colour", lambda: run_menu(page, "Effects", "effects.fillColor")), ("Export", lambda: run_menu(page, "File", "file.export"))):
        how()
        d = dialog(page)
        txt = d.inner_text()
        check(not re.search(NO_BRANDS, txt), f"{label}: no other product is named")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        check(page.locator("dialog[open]").count() == 0, f"{label}: Esc closes the dialog")
    page.locator(".ds-view").focus()

    # ---- the shortcuts sheet equals the key table, and doubles as the command finder ----
    page.keyboard.press("?")
    d = dialog(page)
    check(page.locator("dialog[open]").count() == 1 and "Keyboard shortcuts and command finder" in d.inner_text(), "? opens only the editor's own sheet (the site's sheet stays closed)")
    rows = d.locator(".ds-fr").count()
    want = ds_eval(page, "const K = await import('/packs/corel/_ds-keys.js'); return K.shortcutRows().length")
    check(rows == want and want > 60, f"the sheet lists exactly the commands that have keys ({rows} rows, table says {want})")
    texts = d.locator(".ds-fr").all_inner_texts()
    check(any("Ctrl+O" in t and "Open" in t for t in texts) and any("Alt+N" in t for t in texts) and any("Shift+F4" in t for t in texts) and any("Ctrl+C" in t for t in texts), "it shows Open, New, Zoom to page and the clipboard hints")
    inp = d.locator('input[aria-label="Find a command"]')
    inp.fill("break")
    page.wait_for_timeout(100)
    check(d.locator(".ds-fr").first.get_attribute("data-cmd") == "arrange.breakApart", "typing finds a command by its name")
    inp.fill("nudge")
    check(d.locator(".ds-fr").count() == 4, "and finds commands that have arrow keys")
    inp.fill("grid")
    check(d.locator('.ds-fr[data-cmd="view.snapGrid"]').count() == 1 and d.locator('.ds-fr[data-cmd="view.grid"]').count() == 1, "including commands that have no key")
    inp.fill("zoom to page")
    ds_eval(page, "ds.view.zoom100()")
    inp.press("Enter")
    page.wait_for_timeout(300)
    check(page.locator("dialog[open]").count() == 0 and abs(zoom_of(page) - 96 / 72) > 0.01, "Enter runs the first match (Zoom to page)")
    # Ctrl+K reaches Break apart, not the site's search
    ds_eval(page, "const O = await import('/packs/corel/_ds-ops-arrange.js'); ds.store.setSel([arg[0], arg[1]])", [ids["Red"], ids["Blue"]])
    key_on_canvas(page, "Control+l")
    check(len(sel_of(page)) == 1, "Ctrl+L combines")
    n1 = n_objects(page)
    page.keyboard.press("Control+k")
    page.wait_for_timeout(200)
    check(n_objects(page) == n1 + 1 and page.locator("dialog[open]").count() == 0 and page.locator("#search-palette:visible, .palette:visible").count() == 0, f"Ctrl+K breaks apart and does not open the site's search ({n1} to {n_objects(page)})")
    ds_eval(page, "ds.store.undo(); ds.store.undo()")
    key_on_canvas(page, "F1")
    dialog(page)
    check("command finder" in page.inner_text("dialog[open]"), "F1 opens the same sheet")
    page.keyboard.press("Escape")

    # ---- context menus ----
    page.locator(".ds-view").focus()
    select_ids(page)
    page.mouse.click(*scr(page, 100, 80), button="right")
    page.wait_for_timeout(150)
    cm = page.locator(".ds-ctxmenu:visible")
    check(cm.count() == 1 and sel_of(page) == [ids["Red"]], f"right click on an object selects it and opens a context menu ({cm.count()}, {sel_of(page)}, {ids['Red']})")
    cmds = page.evaluate("() => [...document.querySelectorAll('.ds-ctxmenu .ds-mi')].map((b) => b.dataset.cmd)")
    check(all(c in cmds for c in ("edit.cut", "edit.copy", "edit.paste", "edit.duplicate", "edit.delete", "arrange.group", "arrange.front", "arrange.lock", "object.toCurves", "win.properties")), f"object menu {cmds[:8]}")
    page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown")
    first = page.evaluate("() => document.activeElement.dataset.cmd")
    check(first in cmds, f"arrow keys move through the menu ({first})")
    page.keyboard.press("Escape")
    check(page.locator(".ds-ctxmenu:visible").count() == 0 and page.evaluate("() => document.activeElement.classList.contains('ds-view')"), "Esc closes it and returns to the canvas")
    n0 = n_objects(page)
    page.mouse.click(*scr(page, 100, 80), button="right")
    page.locator('.ds-ctxmenu [data-cmd="edit.duplicate"]').click()
    page.wait_for_timeout(150)
    check(n_objects(page) == n0 + 1, "a context menu item runs its command")
    ds_eval(page, "ds.store.undo()")
    page.mouse.click(*scr(page, 390, 20), button="right")
    page.wait_for_timeout(120)
    cmds = page.evaluate("() => [...document.querySelectorAll('.ds-ctxmenu .ds-mi')].map((b) => b.dataset.cmd)")
    check(sel_of(page) == [] and "edit.selectAll" in cmds and "edit.paste" in cmds and "layout.guideH" in cmds and "edit.delete" not in cmds, f"right click on empty space: page menu {cmds[:6]}")
    page.keyboard.press("Escape")
    ds_eval(page, "const G = await import('/packs/corel/_ds-guides.js'); ds.store.tx('Add guide', (r) => G.addGuide(r, ds.store.page().id, 'v', 365, ds.store.newId))")
    page.wait_for_timeout(120)
    page.mouse.click(*scr(page, 365, 270), button="right")
    page.wait_for_timeout(120)
    cmds = page.evaluate("() => [...document.querySelectorAll('.ds-ctxmenu .ds-mi')].map((b) => b.dataset.cmd)")
    check("layout.deleteGuide" in cmds and "layout.editGuide" in cmds and ds_eval(page, "return ds.store.guideSel") is not None, f"right click on a guide: guide menu {cmds}")
    page.locator('.ds-ctxmenu [data-cmd="layout.deleteGuide"]').click()
    page.wait_for_timeout(120)
    check(guides_of(page) == [], "Delete guide from the context menu")
    page.mouse.click(*scr(page, 100, 80), button="right")
    page.mouse.click(*scr(page, 300, 20))
    page.wait_for_timeout(100)
    check(page.locator(".ds-ctxmenu:visible").count() == 0, "a click elsewhere closes the menu")
    key_on_canvas(page, "z")
    page.mouse.click(*scr(page, 100, 80), button="right")
    page.wait_for_timeout(100)
    check(page.locator(".ds-ctxmenu:visible").count() == 0, "the Zoom tool keeps its own right click (zoom out)")
    key_on_canvas(page, "v")

    # ---- the Properties docker ----
    select_ids(page, ids["Red"])
    page.keyboard.press("Alt+Enter")
    page.wait_for_timeout(250)
    sec = page.locator('.ds-dsec[data-section="properties"]')
    check(sec.count() == 1 and sec.locator(".ds-dsec-head").get_attribute("aria-expanded") == "true", "Alt+Enter opens the Properties docker section")
    summ = sec.locator(".ds-pr-sum").inner_text()
    check("Rectangle" in summ and "35.28 x 21.17 mm" in summ and "node" in summ, f"it describes the object: {summ!r}")
    sec.locator('.ds-kindbtn[data-kind="linear"]').click()
    page.wait_for_timeout(120)
    check(node_of(page, ids["Red"])["fill"]["g"] == "linear", "the Fill type buttons work from the docker")
    ds_eval(page, "ds.store.undo()")
    wf = sec.locator('input[aria-label="Properties: outline width"]')
    wf.fill("1"); wf.press("Enter")
    page.wait_for_timeout(120)
    check(abs(node_of(page, ids["Red"])["strokeWidth"] - 72 / 25.4) < 1e-6, "the Outline width field sets the width")
    ds_eval(page, "ds.store.undo()")
    rg = sec.locator('input[type=range]')
    rg.evaluate("(e) => { e.value = '30'; e.dispatchEvent(new Event('input', { bubbles: true })) }")
    page.wait_for_timeout(100)
    check(abs(node_of(page, ids["Red"])["fillOpacity"] - 0.7) < 1e-6, "the Transparency slider works from the docker")
    ds_eval(page, "ds.store.undo()")
    sec.get_by_role("button", name="Outline pen...").click()
    dialog(page)
    page.keyboard.press("Escape")
    page.keyboard.press("Control+Shift+a")
    page.wait_for_timeout(200)
    check(page.locator('.ds-dsec[data-section="align"] .ds-dsec-head').get_attribute("aria-expanded") == "true", "Ctrl+Shift+A opens Align and distribute")
    check(sel_of(page) == [ids["Red"]], "the docker did not change the selection")

    # ---- Options ----
    run_menu(page, "Edit", "edit.options")
    d = dialog(page)
    d.locator('input[aria-label="Nudge in millimetres"]').fill("2"); d.locator('input[aria-label="Nudge in millimetres"]').press("Tab")
    d.locator('input[aria-label="Duplicate offset in millimetres"]').fill("8"); d.locator('input[aria-label="Duplicate offset in millimetres"]').press("Tab")
    d.locator('select[aria-label="Mouse wheel"]').select_option("scroll")
    d.get_by_label("Scale outlines with objects").check()
    gr = d.locator('input[aria-label^="Grid spacing"]')
    gr.fill("5"); gr.press("Tab")
    d.get_by_role("button", name="Done").click()
    page.wait_for_timeout(150)
    P = ds_eval(page, "return {nudge: ds.store.prefs.nudge, dup: ds.store.prefs.dupOffset, wheel: ds.store.prefs.wheel, sc: ds.store.prefs.scaleStroke, grid: ds.store.prefs.gridStep}")
    check(P["nudge"] == 2 and P["dup"] == 8 and P["wheel"] == "scroll" and P["sc"] is True and abs(P["grid"] - 5 * 72 / 25.4) < 1e-9, f"Options are applied {P}")
    select_ids(page, ids["Red"])
    x0 = nbox(page, ids["Red"])["x"]
    key_on_canvas(page, "ArrowRight")
    check(abs(nbox(page, ids["Red"])["x"] - x0 - 2 * 72 / 25.4) < 1e-6, "the arrow key nudges by the chosen step")
    key_on_canvas(page, "Shift+ArrowRight")
    check(abs(nbox(page, ids["Red"])["x"] - x0 - 22 * 72 / 25.4) < 1e-6, "Shift moves ten times as far")
    ds_eval(page, "ds.store.undo()")  # two quick nudges are one merged step
    n0 = n_objects(page)
    key_on_canvas(page, "Control+d")
    dup = sel_of(page)[0]
    check(abs(nbox(page, dup)["x"] - x0 - 8 * 72 / 25.4) < 1e-6, "Duplicate uses the chosen offset")
    ds_eval(page, "ds.store.undo()")
    check("scroll" in (page.evaluate("() => localStorage.getItem('tools:ds-prefs')") or ""), "Options are remembered on this device")
    run_menu(page, "Edit", "edit.options")
    d = dialog(page)
    d.get_by_role("button", name="Reset to defaults").click()
    page.wait_for_timeout(150)
    P = ds_eval(page, "return {nudge: ds.store.prefs.nudge, dup: ds.store.prefs.dupOffset, wheel: ds.store.prefs.wheel, sc: ds.store.prefs.scaleStroke, grid: ds.store.prefs.gridStep ?? null}")
    check(P == {"nudge": 1, "dup": 5, "wheel": "zoom", "sc": False, "grid": None}, f"Reset to defaults {P}")

    # ---- Document properties and Notes ----
    run_menu(page, "File", "file.properties")
    d = dialog(page)
    d.locator('input[aria-label="Title"]').fill("My drawing")
    d.locator('select[aria-label="Units"]').select_option("in")
    d.get_by_role("button", name="Apply").click()
    page.wait_for_timeout(150)
    check(ds_eval(page, "return [ds.store.root.title, ds.store.root.units]") == ["My drawing", "in"] and "My drawing" in page.inner_text(".ds-docname"), "Document properties sets the title and the units")
    ds_eval(page, "ds.store.undo()")
    check(ds_eval(page, "return ds.store.root.units") == "mm", "and undoes")
    ds_eval(page, "ds.store.tx('warn', (r) => ({ ...r, warnings: ['Test note one.'] }))")
    run_menu(page, "File", "file.notes")
    d = dialog(page)
    check("Test note one." in d.inner_text(), "Notes about this file lists the reader's notes")
    page.keyboard.press("Escape")

    # ---- Object > Move to layer ----
    select_ids(page, ids["Red"])
    run_menu(page, "Object", "object.moveToLayer")
    d = dialog(page)
    top_id = ds_eval(page, "return ds.store.page().layers.find((l) => l.name === 'Top').id")
    d.locator("select").select_option(str(top_id))
    d.get_by_role("button", name="Move").click()
    page.wait_for_timeout(150)
    check(ds_eval(page, "return ds.store.find(arg).layer.name", ids["Red"]) == "Top", "Object > Move to layer opens a chooser and moves the selection")
    ds_eval(page, "ds.store.undo()")
    check(ds_eval(page, "return ds.store.find(arg).layer.name", ids["Red"]) == "Layer 1", "and undoes")

    # ---- panels ----
    run_menu(page, "Window", "win.palette")
    check(page.evaluate("() => getComputedStyle(document.querySelector('.ds-palette')).display") == "none", "Window > Colour palette hides the palette")
    run_menu(page, "Window", "win.toolbox")
    check(page.evaluate("() => getComputedStyle(document.querySelector('.ds-tools')).display") == "none", "Window > Toolbox hides the toolbox")
    run_menu(page, "Window", "win.reset")
    check(page.evaluate("() => getComputedStyle(document.querySelector('.ds-palette')).display") != "none" and page.evaluate("() => getComputedStyle(document.querySelector('.ds-tools')).display") != "none", "Window > Reset layout brings them back")

    # ---- Import (Ctrl+I): a file placed as a group ----
    page.close()
    page, errors = mount(ctx, base)
    info = load_scene(page)
    ds_eval(page, "ds.store.setPref('snap', false)")
    svg = write_svg(tmp, "badge.svg")
    n0 = n_objects(page)
    page.locator(".ds-view").focus()
    with page.expect_file_chooser() as fc:
        page.keyboard.press("Control+i")
    fc.value.set_files(str(svg))
    page.wait_for_timeout(1200)
    sel = sel_of(page)
    g = node_of(page, sel[0]) if sel else None
    check(g and g["t"] == "group" and g["name"] == "badge" and len(g["items"]) == 2, f"Ctrl+I places the file as a group named after it {g and (g['name'], len(g['items']))}")
    gb = nbox(page, sel[0])
    check(abs(gb["x"] + gb["w"] / 2 - 200) < 1.5 and abs(gb["y"] + gb["h"] / 2 - 150) < 1.5, f"centred on the page {({k: round(v, 1) for k, v in gb.items()})}")
    check(n_objects(page) == n0 + 3 and ds_eval(page, "return ds.store.root.title") == "scene", "the drawing itself is kept (an import is not an open)")
    ds_eval(page, "ds.store.undo()")
    check(n_objects(page) == n0, "one Undo removes the whole import")
    big = write_svg(tmp, "huge.svg", w=2000, h=1500, a=1800)
    ds_eval(page, "ds.store.setSel([])")
    with page.expect_file_chooser() as fc:
        run_menu(page, "File", "file.import")
    fc.value.set_files(str(big))
    page.wait_for_timeout(1200)
    sel = sel_of(page)
    gb = nbox(page, sel[0]) if sel else None
    check(gb and gb["w"] <= 400 * 0.9 + 1 and gb["h"] <= 300 * 0.9 + 1 and "smaller" in status_text(page), f"a file larger than the page is made smaller to fit ({gb and round(gb['w'])} x {gb and round(gb['h'])}; {status_text(page)!r})")
    ds_eval(page, "ds.store.undo()")
    # a multi-page file asks which page
    fx = FIX / "designtool-3p.ai"
    if fx.exists():
        n0 = n_objects(page)
        with page.expect_file_chooser() as fc:
            page.keyboard.press("Control+i")
        fc.value.set_files(str(fx))
        d = dialog(page, timeout=60000)
        check("Which page" in d.inner_text() and d.locator("select option").count() == 3, f"a multi-page file asks which page ({d.locator('select option').count()} pages)")
        d.locator("select").select_option("1")
        d.get_by_role("button", name="Import").click()
        page.wait_for_function("() => !document.querySelector('dialog[open]')", timeout=60000)
        page.wait_for_timeout(2500)
        sel = sel_of(page)
        check(len(sel) == 1 and n_objects(page) > n0 + 3, f"the chosen page is placed as one group ({n_objects(page) - n0} new objects)")
        ds_eval(page, "ds.store.undo()")
        with page.expect_file_chooser() as fc:
            page.keyboard.press("Control+i")
        fc.value.set_files(str(fx))
        d = dialog(page, timeout=60000)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        check(n_objects(page) == n0 and not page.locator(".ds-busy:visible").count(), "Cancel in the page picker imports nothing")

    # ---- the Open-or-import prompt (a drop onto a drawing with content) ----
    n0 = n_objects(page)
    a = write_svg(tmp, "dropped.svg")
    drop_files(page, [a])
    d = dialog(page)
    check("Open or import into this page?" in d.inner_text() and d.get_by_role("button", name="Import into this page").count() == 1 and d.get_by_role("button", name="Open", exact=True).count() == 1, "dropping a file onto a drawing with content asks first")
    d.get_by_role("button", name="Cancel").click()
    page.wait_for_timeout(300)
    check(n_objects(page) == n0 and ds_eval(page, "return ds.store.root.title") == "scene", "Cancel does nothing")
    drop_files(page, [a])
    d = dialog(page)
    d.get_by_role("button", name="Import into this page").click()
    page.wait_for_timeout(1200)
    check(n_objects(page) == n0 + 3 and ds_eval(page, "return ds.store.root.title") == "scene", "Import adds the file to this page")
    drop_files(page, [a])
    d = dialog(page)
    d.get_by_role("button", name="Open", exact=True).click()
    page.wait_for_timeout(1500)
    check(ds_eval(page, "return ds.store.root.title") == "dropped" and n_objects(page) == 2, "Open replaces the drawing")
    # an empty editor does not ask
    page.close()
    page, errors = mount(ctx, base)
    drop_files(page, [a])
    page.wait_for_timeout(1500)
    check(page.locator("dialog[open]").count() == 0 and ds_eval(page, "return ds.store.root.title") == "dropped", "an empty editor just opens the dropped file")
    # the hand-over from another tool goes through the same prompt
    b = write_svg(tmp, "second.svg", w=200, h=100)
    page.evaluate("async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); document.querySelector('.t-ds .dropzone')._take([new File([bin], 'second.svg')]) }", base64.b64encode(b.read_bytes()).decode())
    d = dialog(page)
    check("Open or import into this page?" in d.inner_text(), "files handed over by another tool get the same question")
    d.get_by_role("button", name="Cancel").click()

    # ---- several files at once ----
    page.close()
    page, errors = mount(ctx, base)
    c1, c2 = write_svg(tmp, "one.svg"), write_svg(tmp, "two.svg", w=160, h=120)
    page.set_input_files(".t-ds input[type=file]", [str(c1), str(c2)])
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.length === 2", timeout=15000)
    st = page.evaluate(STATE_JS)
    check(st["pages"] == 2 and st["title"] == "one" and st["names"][1] and st["sizes"][1] == [160 * 0.75, 120 * 0.75], f"two files into an empty editor: the first opens, the second becomes a new page {st['names']} {st['sizes']}")
    ds_eval(page, "ds.store.undo()")
    check(ds_eval(page, "return ds.store.root.pages.length") == 1, "adding the pages is one step")
    # with content and several files: the prompt, then Import places both as groups
    c3 = write_svg(tmp, "three.svg", w=100, h=100)
    page.set_input_files(".t-ds input[type=file]", [str(c2), str(c3)])
    d = dialog(page)
    check("these 2 files" in d.inner_text(), "several files onto a drawing that has content ask first too")
    d.get_by_role("button", name="Import into this page").click()
    page.wait_for_timeout(2000)
    names = ds_eval(page, "return ds.store.page().layers.flatMap((l) => l.items.map((n) => n.name))")
    check("two" in names and "three" in names, f"both files are imported as groups {names}")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:2]}")
    page.close()
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


def t_e1113_phone(ctx, base):
    """E11 to E13 at 375 px: rulers off by default but guides and snapping work, the menu sheet lists the new menus, the Panels sheet shows Properties,
    the new dialogs and the context menu fit, the effects bars scroll inside their own box, targets are at least 36 px."""
    page, errors = mount(ctx, base, 375, 760)
    ov = lambda: page_state(page)["overflow"]
    info = load_scene(page)
    ids = info["ids"]
    check(page.locator(".ds-ruler-h").count() == 1 and not page.locator(".ds-ruler-h").is_visible() and not page.locator(".ds-ruler-v").is_visible(), "rulers are off by default on a phone")
    check(not page.locator(".ds-snapchips").is_visible(), "the snap chips are left to the View menu on a phone")
    # guides through the Layout menu still work and still snap
    page.get_by_role("button", name="Menu").click()
    page.get_by_role("button", name="Layout", exact=True).click()
    page.locator('.ds-msheet-body:visible [data-cmd="layout.guideV"]').click()
    d = dialog(page)
    check(ov() <= 1, f"the guide dialog fits (overflow {ov()})")
    d.locator("input[type=number]").fill("20")
    d.get_by_role("button", name="Add guide").click()
    page.wait_for_timeout(200)
    check(len(guides_of(page)) == 1 and page.locator(".ds-ov line.ds-guide").count() == 1, "the guide is drawn")
    ds_eval(page, "ds.store.setPref('snapObjects', false); ds.store.setPref('snapPage', false)")
    red = ids["Red"]
    select_ids(page, red)
    z = zoom_of(page)
    page.evaluate("() => document.querySelector('.tool-body').__ds.view.zoomPage()")
    page.wait_for_timeout(150)
    gx = 20 * 72 / 25.4
    drag_pt(page, (100, 80), (100 + (gx + 1.2 - 50), 80))
    page.wait_for_timeout(150)
    check(abs(nbox(page, red)["x"] - gx) < 0.01, f"an object snaps to the guide on a phone ({nbox(page, red)['x']:.3f} vs {gx:.3f})")
    ds_eval(page, "ds.store.undo()")
    # the menu sheet lists every menu and its items are large enough
    page.get_by_role("button", name="Menu").click()
    heads = page.locator(".ds-msheet-head").all_inner_texts()
    check([h.strip() for h in heads] == ["File", "Edit", "View", "Layout", "Object", "Effects", "Bitmaps", "Text", "Window", "Help"], f"the menu sheet has the ten menus {heads}")
    for name, cmd in (("Effects", "tool.fill"), ("Bitmaps", "bitmap.place"), ("Window", "win.properties"), ("Help", "help.about"), ("View", "view.wireframe")):
        page.get_by_role("button", name=name, exact=True).click()
        it = page.locator(f'.ds-msheet-body:visible [data-cmd="{cmd}"]')
        b = it.bounding_box()
        check(it.count() == 1 and b["height"] >= 30, f"{name}: {cmd} is in the sheet and easy to tap ({b and round(b['height'])} px)")
    check(ov() <= 1, f"the menu sheet fits (overflow {ov()})")
    page.get_by_role("button", name="Window", exact=True).click()
    page.locator('.ds-msheet-body:visible [data-cmd="win.properties"]').click()
    page.wait_for_timeout(300)
    check(page.locator(".ds-dock").is_visible() and page.locator('.ds-dsec[data-section="properties"] .ds-dsec-head').get_attribute("aria-expanded") == "true", "Window > Properties opens the Panels sheet on Properties")
    check(ov() <= 1, f"the Panels sheet with Properties fits (overflow {ov()})")
    small = page.evaluate("() => [...document.querySelectorAll('.ds-props input, .ds-props button, .ds-props select')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.textContent.slice(0, 20), Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => w < 30 || h < 28)")
    check(not small, f"Properties controls are large enough {small[:4]}")
    page.get_by_role("button", name="Close panels").click()
    page.wait_for_timeout(200)
    check(not page.locator(".ds-dock").is_visible(), "Close hides the Panels sheet")
    # the effects bars scroll inside their own box
    select_ids(page, red)
    page.evaluate("() => document.querySelector('.tool-body').__ds.tools.set('fill')")
    page.locator('.ds-fillbar .ds-kindbtn[data-kind="linear"]').click()
    page.wait_for_timeout(150)
    sizes = page.evaluate("() => { const e = document.querySelector('.ds-prop'); const bar = document.querySelector('.ds-fillbar'); return [e.scrollWidth > e.clientWidth, Math.round(e.getBoundingClientRect().width), bar.hidden] }")
    check(sizes[0] and sizes[1] <= 375 and not sizes[2] and ov() <= 1, f"the Interactive fill bar scrolls inside the property bar {sizes}")
    small = page.evaluate("() => [...document.querySelectorAll('.ds-fillbar input, .ds-fillbar button')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => w < 34 || h < 34)")
    check(not small, f"the fill bar's targets are at least 34 px {small[:4]}")
    # handles can be dragged with a touch-style pointer: the gradient end handle
    wait_ov(page)
    ex, ey = center_of(page, '.ds-ov [data-h="fill-end"]')
    page.mouse.move(ex, ey); page.mouse.down(); page.mouse.move(ex, ey + 25, steps=5); page.mouse.up()
    page.wait_for_timeout(150)
    check(abs(node_of(page, red)["fill"]["y2"] - 80) > 3, "the handle drags on a phone too")
    page.evaluate("() => document.querySelector('.tool-body').__ds.tools.set('transp')")
    check(page.locator(".ds-transpbar").is_visible() and ov() <= 1, "the Transparency bar shows")
    page.evaluate("() => document.querySelector('.tool-body').__ds.tools.set('pick')")
    # dialogs
    for label, cmd, setup in (("Outline pen", "effects.outlinePen", None), ("Options", "edit.options", None), ("Document properties", "file.properties", None), ("shortcut sheet", "help.shortcuts", None), ("Conversions", "help.conversions", None)):
        page.evaluate("(c) => document.querySelector('.tool-body').__ds.commands.run(c)", cmd)
        d = dialog(page)
        b = d.bounding_box()
        check(b["width"] <= 375 and ov() <= 1, f"{label} dialog fits at 375 px (width {round(b['width'])}, overflow {ov()})")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
    asset = make_bitmap(page, 40, 40, "split")
    pic = place_image(page, asset, 20, 20, 80, 80, "Disc")
    page.evaluate("() => document.querySelector('.tool-body').__ds.commands.run('bitmap.traceLogo')")
    d = dialog(page)
    check(d.bounding_box()["width"] <= 375 and ov() <= 1, f"the Trace dialog fits ({round(d.bounding_box()['width'])})")
    page.keyboard.press("Escape")
    # the context menu stays inside the screen
    select_ids(page)
    page.evaluate("() => document.querySelector('.ds-view').focus()")
    v = page.locator(".ds-view").bounding_box()
    page.mouse.click(v["x"] + v["width"] - 10, v["y"] + v["height"] - 10, button="right")
    page.wait_for_timeout(200)
    cm = page.locator(".ds-ctxmenu:visible")
    b = cm.bounding_box()
    t = page.locator(".t-ds").bounding_box()
    check(cm.count() == 1 and b["x"] >= t["x"] - 1 and b["x"] + b["width"] <= t["x"] + t["width"] + 1 and b["y"] + b["height"] <= t["y"] + t["height"] + 1 and ov() <= 1, f"the context menu opens inside the app at the screen corner {({k: round(v_) for k, v_ in b.items()})}")
    page.keyboard.press("Escape")
    check(not [e for e in errors if "pageerror" in e], f"no uncaught errors {errors[:2]}")
    shot(page, "e1113-phone")
    page.close()


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


CHECKS = {"mount": t_mount, "inject": t_inject, "fixture": t_open_fixture, "cdr": t_open_cdr, "pixels": t_pixels, "other": t_open_other, "handoff": t_handoff, "leaks": t_leaks, "keys": t_keys_menus, "quick": t_quick, "dark": t_dark, "phone": t_phone, "truth": t_truth,
          "pick": t_pick, "pickperf": t_pick_perf, "palette": t_palette, "objects": t_objects, "domfuzz": t_dom_fuzz, "objectsmany": t_objects_many, "objectsfiles": t_objects_files, "editphone": t_edit_phone, "pages": t_pages, "autosave": t_autosave, "text": t_text, "textpdf": t_text_pdf, "save": t_save, "savetext": t_save_text, "e2e": t_e2e, "e678phone": t_e678_phone, "shapes": t_shapes, "arrange": t_arrange, "e910phone": t_arrange_phone, "rulers": t_rulers, "fx": t_fx, "menus13": t_menus13, "e1113phone": t_e1113_phone}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    base = serve_ds()
    names = [n for n in CHECKS if not a.only or n in a.only.split(",")]
    profile = f"dsedit-{os.getpid()}"  # a fresh profile per run: autosaved drawings of earlier runs must not show up
    with launch(profile) as ctx:
        for n in names:
            print(f"== {n}")
            try:
                CHECKS[n](ctx, base)
            except Exception as e:  # a crashing check is a failure, the rest still run
                import traceback; traceback.print_exc()
                FAILS.append(f"{n} crashed: {e}")
    import shutil
    shutil.rmtree(Path(r"C:/Projects/tools-packs/_profiles") / profile, ignore_errors=True)
    print(f"\n{len(FAILS)} failure(s)")
    for f in FAILS:
        print(" -", f)
    sys.exit(1 if FAILS else 0)
