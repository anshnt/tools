"""Export round trips for Draw Studio (Playwright, the installed Edge). Plan section 9.4 check 7.

Every drawing in the matrix (a generated scene with text, clips, gradients, a picture and groups; two CDR samples; the generated 3-page fixture; and, read-only and local,
the user's invitation) is exported in every format and option set through the same exportDoc the dialog uses. Every output is opened again through the real file
input and compared with the source: page count and sizes, object counts, content boxes, text strings. Pictures (PNG, JPG) are compared by pixel size and content.
Nothing is written into the repo; outputs go to DS_OUT/roundtrip.

    uv run --with playwright --with pillow --with numpy python ds_roundtrip.py [--only scene,cdr,fixture,user] [--quick]

--quick leaves out EPS and the option variants for the two big files.
"""
import argparse, base64, io, json, os, re, sys, time, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ds_browser as B  # noqa: E402
from ds_browser import FIX, SAMPLES, USER_FILE, check, mount, open_file, load_scene  # noqa: E402
from smoke import launch, open_tool  # noqa: E402

OUT = Path(os.environ.get("DS_OUT", r"C:/Projects/tools-packs/draw-studio-scratch/e14")) / "roundtrip"

SCENE_JS = """async () => {
  const ds = document.querySelector('.tool-body').__ds
  const O = await import('/packs/corel/_ds-open.js')
  const P = (name, d, extra) => ({ t: 'path', name, d, fill: '#ff0000', fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0, ...extra })
  const sq = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const k = 0.5523, circ = (cx, cy, r) => [['M', cx + r, cy], ['C', cx + r, cy + r * k, cx + r * k, cy + r, cx, cy + r], ['C', cx - r * k, cy + r, cx - r, cy + r * k, cx - r, cy], ['C', cx - r, cy - r * k, cx - r * k, cy - r, cx, cy - r], ['C', cx + r * k, cy - r, cx + r, cy - r * k, cx + r, cy], ['Z']]
  const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#0a0'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#fa0'; g.fillRect(0, 0, 8, 8)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const href = 'data:image/png;base64,' + btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
  const T = (name, str, x, y, extra) => ({ t: 'text', name, str, family: 'Inter', size: 18, bold: false, italic: false, fill: '#222222', opacity: 1, m: [1, 0, 0, 1, x, y], ...extra })
  const l1 = [
    P('Red', sq(50, 50, 100, 60), { shape: { k: 'rect', w: 100, h: 60, rx: 0, ry: 0 }, sm: [1, 0, 0, 1, 50, 50] }),
    P('Blue', sq(200, 50, 80, 80), { fill: '#0000ff', stroke: '#000000', strokeWidth: 2, dash: [4, 2], cap: 1, join: 1 }),
    P('Disc', circ(330, 90, 30), { fill: '#33aa55', fillOpacity: 0.6 }),
    { t: 'group', name: 'Pair', items: [P('GreenA', sq(50, 180, 40, 40), { fill: '#00aa00' }), P('GreenB', sq(110, 180, 40, 40), { fill: '#00aa00', stroke: '#003300', strokeWidth: 1 })] },
    P('Gradient', sq(300, 150, 60, 60), { fill: { g: 'linear', x1: 300, y1: 150, x2: 360, y2: 150, m: [1, 0, 0, 1, 0, 0], stops: [{ o: 0, c: '#ff0000', a: 1 }, { o: 1, c: '#0000ff', a: 1 }], spread: 'pad' } }),
    { t: 'image', name: 'Photo', href, w: 16, h: 16, m: [60, 0, 0, 60, 200, 180], opacity: 1, clip: [{ d: sq(200, 180, 30, 60), rule: 'nonzero' }] },
    T('Title', 'Round trip', 40, 260), T('Two lines', 'Centre one\\nCentre two longer', 200, 280, { align: 'center', lh: 1.2, size: 14, bold: true })]
  const pages = [{ w: 400, h: 300, name: 'Page 1', layers: [
    { name: 'Layer 1', hidden: false, locked: false, printable: true, items: l1 },
    { name: 'Top', hidden: false, locked: false, printable: true, items: [P('Yellow', sq(170, 100, 40, 40), { fill: '#ffee00' })] }] },
    { w: 300, h: 200, name: 'Second', layers: [{ name: 'Layer 1', hidden: false, locked: false, printable: true, items: [P('Other', sq(10, 10, 50, 50)), T('Second text', 'Page two', 20, 120)] }] }]
  const { doc } = await O.normalizeDoc({ warnings: [], fonts: {}, pages }, { assets: ds.assets, title: 'roundtrip', source: 'new', name: 'roundtrip' })
  await ds.fonts.use(doc.fonts, doc.uid)
  ds.store.load(doc)
  await new Promise((r) => setTimeout(r, 300))
}"""

SUM = """() => { const ds = document.querySelector('.tool-body').__ds, r = ds.store.root
  const leaves = (items) => items.flatMap((n) => n.t === 'group' ? leaves(n.items) : [n])
  const dbox = (d) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const c of d) for (let i = 1; i + 1 < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]) } return x0 <= x1 ? [x0, y0, x1, y1] : null }
  // what is really seen: the object box cut by every clip it has (the editor's own box ignores clips)
  const seen = (n) => { const x = ds.renderer.nodeBox(n); if (!x) return null; let b = [x.x, x.y, x.x + x.w, x.y + x.h]
    for (const c of n.clip || []) { const k = dbox(c.d); if (k) b = [Math.max(b[0], k[0]), Math.max(b[1], k[1]), Math.min(b[2], k[2]), Math.min(b[3], k[3])] }
    return b[0] <= b[2] && b[1] <= b[3] ? b : null }
  const union = (list) => list.reduce((u, b) => (b ? (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b) : u), null)
  return r.pages.map((p) => { const all = p.layers.filter((l) => !l.hidden).flatMap((l) => leaves(l.items)).filter((n) => !n.hidden); const text = all.filter((n) => n.t === 'text')
    return { w: p.w, h: p.h, n: all.length, paths: all.filter((n) => n.t === 'path').length, fs: all.filter((n) => n.t === 'path' && n.fill && n.stroke).length, text: text.length, images: all.filter((n) => n.t === 'image').length,
      strs: text.map((n) => n.str), glyph: text.filter((n) => n.font && n.glyphs).length, anchors: text.map((n) => [n.str, n.m[4], n.m[5]]), box: union(all.filter((n) => n.t !== 'text').map(seen)), tbox: union(text.map(seen)) } }) }"""

EXPORT = """async ([fmt, opts]) => { const ds = document.querySelector('.tool-body').__ds
  const { exportDoc } = await import('/packs/corel/_ds-save.js')
  const res = await exportDoc(fmt, opts, { store: ds.store, assets: ds.assets, fonts: ds.fonts, boxOf: ds.renderer.nodeBox })
  const files = []
  for (const f of res.files) files.push({ name: f.name, b64: await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f.blob) }) })
  return { files, notes: res.notes } }"""

# tolerances: (page size pt, content box pt, object count rule)
TOL = {"cdr": (0.05, 1.0), "ai": (0.05, 1.0), "pdf": (0.05, 1.0), "svg": (0.05, 1.0), "eps": (1.0, 1.5)}  # (page size pt, content box pt)
NOTE_TEXT_BOX = 4.0  # live text against its outlines: the text box is an estimate of the advance box, the outline hugs the glyphs


def reopen(page, path, timeout=180000):
    """Open a file in the checker page and wait until that file (not the one before it) is completely read."""
    page.evaluate("() => { window.__prevRoot = document.querySelector('.tool-body').__ds.store.root }")
    page.set_input_files(".t-ds input[type=file]", str(path))
    page.wait_for_function("() => { const ds = document.querySelector('.tool-body').__ds; return ds.store.root !== window.__prevRoot && document.querySelector('.ds-busy').hidden && ds.store.root.pages.every((p) => !p.pending) }", timeout=timeout)
    page.wait_for_timeout(100)
    return page.evaluate(SUM)


NON_WESTERN = re.compile("[^" + chr(0) + "-" + chr(255) + chr(0x2010) + "-" + chr(0x203a) + chr(0x20ac) + chr(0x2122) + "]")  # PDF, AI and EPS keep only western live text (the export says so in its notes)


def norm_str(s):
    return re.sub(r"\s+", "", s)


def count_ok(fmt, a, b, outline):
    """Object counts: CDR and SVG keep them; PDF, AI and EPS readers give one text item per word (a line is several), EPS also adds clipped strips for gradients."""
    words = sum(len(t.split()) for t in a["strs"]) - len(a["strs"])
    if outline:
        return b["text"] == 0 or b["text"] <= max(1, a["text"] // 4)
    if fmt in ("cdr", "svg"):
        return abs(a["n"] - b["n"]) <= max(2, round(a["n"] * 0.02)) + (words if fmt == "svg" else 0)
    if fmt in ("pdf", "ai"):
        return a["n"] - 2 <= b["n"] <= a["n"] + max(0, words) + a["fs"] + 2  # the PDF reader splits a filled and outlined path in two
    return b["n"] >= a["n"] * 0.9 and b["n"] <= a["n"] * 1.5 + 200 + words + a["fs"]


def compare(label, fmt, src, got, outline, whole_pages=True, notes=()):
    """src and got are lists of per-page summaries. Returns nothing; records checks."""
    ps, pb = TOL[fmt]
    if whole_pages:
        check(len(src) == len(got), f"{label}: same page count ({len(got)} of {len(src)})")
    if len(src) != len(got):
        return
    sizes = all(abs(a["w"] - b["w"]) <= ps and abs(a["h"] - b["h"]) <= ps for a, b in zip(src, got))
    check(sizes, f"{label}: same page sizes {[(round(b['w'], 2), round(b['h'], 2)) for b in got][:3]}")
    check(all(count_ok(fmt, a, b, outline) for a, b in zip(src, got)), f"{label}: object counts {[b['n'] for b in got][:4]} vs {[a['n'] for a in src][:4]}" + (" (text became curves)" if outline else ""))
    if outline:
        # text became curves: the new content box must hold the old non-text box and stay near the old text box (the live text box is only an estimate)
        def near(a_, b_):
            if a_["box"] is None and a_["tbox"] is None:
                return b_["box"] is None
            parts = [x for x in (a_["box"], a_["tbox"]) if x]
            u = [min(x[0] for x in parts), min(x[1] for x in parts), max(x[2] for x in parts), max(x[3] for x in parts)]
            g = b_["box"]
            if not g:
                return False
            holds = a_["box"] is None or (g[0] <= a_["box"][0] + pb and g[1] <= a_["box"][1] + pb and g[2] >= a_["box"][2] - pb and g[3] >= a_["box"][3] - pb)
            return holds and g[0] >= u[0] - 20 and g[1] >= u[1] - 20 and g[2] <= u[2] + 20 and g[3] <= u[3] + 20
        bad = [(i, a["box"], a["tbox"], b["box"]) for i, (a, b) in enumerate(zip(src, got)) if not near(a, b)]
        check(not bad, f"{label}: the new content box holds the old drawing and the text stays where it was {bad[:1]}")
    else:
        bad = [(i, a["box"], b["box"]) for i, (a, b) in enumerate(zip(src, got)) if not (a["box"] is None and b["box"] is None) and not (a["box"] and b["box"] and all(abs(x - y) <= pb for x, y in zip(a["box"], b["box"])))]
        check(not bad, f"{label}: content boxes within {pb} pt {bad[:1]}")
    glyph_svg = fmt == "svg" and not outline and any(p["glyph"] for p in src)
    if glyph_svg:
        # glyph text from a PDF is written with the embedded font's own character codes (so the shapes are exact); the export says so
        check(any("odd characters" in n for n in notes), f"{label}: the export notes say that glyph text is stored with the font's own codes")
    if not outline and fmt in ("cdr", "svg") and not glyph_svg:
        one = lambda p: [x for x in p["anchors"] if chr(10) not in x[0]]
        sa = sorted(tuple(x) for p in src for x in one(p)); sb = sorted(tuple(x) for p in got for x in p["anchors"] if any(x[0] == y[0] for q in src for y in one(q)))
        same = len(sa) == len(sb) and all(a_[0].split() == b_[0].split() and abs(a_[1] - b_[1]) <= 2 and abs(a_[2] - b_[2]) <= 2 for a_, b_ in zip(sa, sb))
        check(same, f"{label}: single-line text keeps its words and its anchor within 2 pt {sa[:2]} vs {sb[:2]}")
    if not outline and not glyph_svg and not (fmt in ("pdf", "ai", "eps") and any(NON_WESTERN.search(x) for p in src for x in p["strs"])):
        sa = [sorted(norm_str(s) for s in p["strs"]) for p in src]
        sb = [sorted(norm_str(s) for s in p["strs"]) for p in got]
        if any(sa):
            joined = lambda l: "".join("".join(x) for x in l)
            ok = (sa == sb) or (sorted(joined(sa)) == sorted(joined(sb)))  # a reader may split a line into words: the characters must match
            check(ok, f"{label}: the same text characters ({len(joined(sa))} vs {len(joined(sb))})")


def a_has_text(src):
    return any(p["text"] for p in src)


def export(page, fmt, opts):
    t0 = time.time()
    r = page.evaluate(EXPORT, [fmt, opts])
    OUT.mkdir(parents=True, exist_ok=True)
    files = []
    for f in r["files"]:
        p = OUT / f["name"]
        p.write_bytes(base64.b64decode(f["b64"]))
        files.append(p)
    return files, r["notes"], time.time() - t0


def vector_case(page, chk, name, src, fmt, outline, split=False, pages="all", sizes_note=""):
    label = f"{name} > {fmt}{' curves' if outline else ''}{' split' if split else ''}"
    opts = {"outline": outline, "pages": pages}
    if split:
        opts["split"] = True
    try:
        files, notes, took = export(page, fmt, opts)
    except Exception as e:
        check(False, f"{label}: the export failed ({str(e)[:120]})")
        return
    size = sum(f.stat().st_size for f in files)
    print(f"   {label}: {len(files)} file(s), {size / 1024:.0f} KB in {took:.1f}s, {len(notes)} note(s)")
    if len(files) == 1 and files[0].suffix == ".zip":
        z = zipfile.ZipFile(files[0])
        members = sorted(z.namelist())
        check(len(members) == len(src), f"{label}: one file per page in the ZIP ({len(members)} of {len(src)})")
        for i, m in enumerate(members):
            z.extract(m, OUT)
            got = reopen(chk, OUT / m)
            compare(f"{label} page {i + 1}", fmt, [src[i]], got, outline, whole_pages=True, notes=notes)
        return
    got = reopen(chk, files[0])
    compare(label, fmt, src, got, outline, notes=notes)


def raster_case(page, chk, name, src, fmt, dpi, transparent=True):
    from PIL import Image
    import numpy as np
    label = f"{name} > {fmt} {dpi} dpi"
    try:
        files, notes, took = export(page, fmt, {"dpi": dpi, "transparent": transparent, "pages": "all"})
    except Exception as e:
        check(False, f"{label}: the export failed ({str(e)[:120]})")
        return
    ims = []
    if files[0].suffix == ".zip":
        z = zipfile.ZipFile(files[0])
        ims = [Image.open(io.BytesIO(z.read(n))) for n in sorted(z.namelist())]
        for n in sorted(z.namelist())[:1]:
            z.extract(n, OUT)
    else:
        ims = [Image.open(files[0])]
    print(f"   {label}: {len(ims)} picture(s) in {took:.1f}s, {sum(f.stat().st_size for f in files) / 1024:.0f} KB")
    check(len(ims) == len(src), f"{label}: one picture per page ({len(ims)} of {len(src)})")
    for i, (im, s) in enumerate(zip(ims, src)):
        want = (round(s["w"] * dpi / 72), round(s["h"] * dpi / 72))
        capped = im.size != want and im.size[0] * im.size[1] >= 0.9 * 80e6  # very large pages are saved smaller with a note
        check(capped or all(abs(a - b) <= 1 for a, b in zip(im.size, want)), f"{label}: page {i + 1} is {im.size}, expected {want}")
        a = np.asarray(im.convert("RGBA"))
        if i == 0:
            if fmt == "png" and transparent:
                # a page-sized background shape (design files have one) leaves only a faint edge: the corner is then nearly opaque, which is the drawing, not a bug
                check(a[0, 0, 3] == 0 or a[:3, :3, 3].min() == 0 or name != "generated scene", f"{label}: transparent at the corner (alpha {a[0, 0, 3]})")
            elif fmt == "png":
                check(a[0, 0, 3] == 255, f"{label}: an opaque page when transparency is off (alpha {a[0, 0, 3]})")
            else:
                check(a[0, 0, 3] == 255, f"{label}: no transparency in a JPG (alpha {a[0, 0, 3]})")
            check(im.mode == ("RGB" if fmt == "jpg" else "RGBA"), f"{label}: mode {im.mode}")
        colour = a[..., :3].reshape(-1, 3).astype(float)
        check(colour.std() > 5, f"{label}: page {i + 1} is not blank (spread {colour.std():.0f})")
    got = reopen(chk, files[0] if files[0].suffix != ".zip" else OUT / sorted(zipfile.ZipFile(files[0]).namelist())[0])
    check(len(got) == 1 and got[0]["images"] == 1, f"{label}: the picture opens again as a one-picture drawing ({got[0]['w']:.0f} x {got[0]['h']:.0f} pt)")


def selection_case(page, chk, name):
    from PIL import Image
    ids = page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; const l = ds.store.page().layers[0].items.filter((n) => n.t !== 'group'); return l.slice(0, 2).map((n) => n.id) }")
    if not ids:
        return
    page.evaluate("(ids) => document.querySelector('.tool-body').__ds.store.setSel(ids)", ids)
    box = page.evaluate("(ids) => { const ds = document.querySelector('.tool-body').__ds; let b = null; for (const id of ids) { const x = ds.renderer.nodeBox(ds.store.find(id).node); b = b ? { x: Math.min(b.x, x.x), y: Math.min(b.y, x.y), x2: Math.max(b.x2, x.x + x.w), y2: Math.max(b.y2, x.y + x.h) } : { x: x.x, y: x.y, x2: x.x + x.w, y2: x.y + x.h } } return [b.x2 - b.x, b.y2 - b.y] }", ids)
    for fmt in ("png", "jpg"):
        files, _, _ = export(page, fmt, {"selection": True, "dpi": 144})
        im = Image.open(files[0])
        want = (round(box[0] * 2), round(box[1] * 2))
        check(all(abs(a - b) <= 12 for a, b in zip(im.size, want)), f"{name} > selection as {fmt} (the crop includes the outline): {im.size} for a {want[0]} x {want[1]} selection")
    files, _, _ = export(page, "svg", {"selection": True})
    got = reopen(chk, files[0])
    check(len(got) == 1 and abs(got[0]["w"] - box[0]) <= 3 and abs(got[0]["h"] - box[1]) <= 3, f"{name} > selection as svg: {got[0]['w']:.1f} x {got[0]['h']:.1f} for {box[0]:.1f} x {box[1]:.1f}")
    page.evaluate("() => document.querySelector('.tool-body').__ds.store.setSel([])")


def run_doc(ctx, base, name, loader, quick=False, big=False):
    print(f"== {name}")
    page, errors = mount(ctx, base)
    chk, cerrors = mount(ctx, base)
    loader(page)
    page.wait_for_function("() => document.querySelector('.tool-body').__ds.store.root.pages.every((p) => !p.pending)", timeout=240000)
    page.wait_for_timeout(300)
    src = page.evaluate(SUM)
    print(f"   source: {len(src)} page(s), objects {[p['n'] for p in src]}, text {[p['text'] for p in src]}, pictures {[p['images'] for p in src]}")
    # a drawing that has live text exports text as text for these (outline False) and as curves for the second pass
    for fmt in ("cdr", "pdf", "ai", "svg") + (() if quick else ("eps",)):
        vector_case(page, chk, name, src, fmt, False, split=fmt in ("eps",) and len(src) > 1)
    if not big or not quick:
        for fmt in ("cdr", "pdf", "svg"):
            if a_has_text(src):
                vector_case(page, chk, name, src, fmt, True)
    if len(src) > 1 and not big:
        for fmt in ("pdf", "svg"):
            vector_case(page, chk, name, src, fmt, False, split=True)
    for fmt, dpi in (("png", 72), ("jpg", 96)):
        raster_case(page, chk, name, src, fmt, dpi, transparent=fmt == "png")
    if not big:
        selection_case(page, chk, name)
    for p, errs in ((page, errors), (chk, cerrors)):
        check(not [e for e in errs if e.startswith("pageerror")], f"{name}: no uncaught errors {[e for e in errs if e.startswith('pageerror')][:2]}")
        p.close()


GROUPS = ("scene", "cdr", "fixture", "user")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    base = B.serve_ds()
    profile = f"dsrt-{os.getpid()}"
    with launch(profile) as ctx:
        for g in GROUPS:
            if a.only and g not in a.only.split(","):
                continue
            t0 = time.time()
            try:
                if g == "scene":
                    run_doc(ctx, base, "generated scene", lambda p: p.evaluate(SCENE_JS), a.quick)
                elif g == "cdr":
                    for n in ("scene-v1000.cdr", "scene-v1600.cdr"):
                        run_doc(ctx, base, n, lambda p, n=n: open_file(p, SAMPLES / n), a.quick)
                elif g == "fixture":
                    run_doc(ctx, base, "designtool-3p.ai", lambda p: open_file(p, FIX / "designtool-3p.ai", timeout=120000), a.quick, big=True)
                elif g == "user" and USER_FILE.exists():
                    run_doc(ctx, base, "invitation", lambda p: open_file(p, USER_FILE, timeout=120000, as_name="Ansh Wedding Virtual Invitation.ai"), a.quick, big=True)
            except Exception as e:
                import traceback; traceback.print_exc()
                B.FAILS.append(f"{g} crashed: {e}")
            print(f"   ({g}: {time.time() - t0:.0f}s)")
    import shutil
    shutil.rmtree(Path(r"C:/Projects/tools-packs/_profiles") / profile, ignore_errors=True)
    print(f"\n{len(B.FAILS)} failure(s)")
    for f in B.FAILS:
        print(" -", f)
    sys.exit(1 if B.FAILS else 0)
