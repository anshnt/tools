"""Browser tests for the PDF importer (_pdfin.js), text outlines (_text.js) and SVG output (_svgout.js).

    uv run --with playwright --with reportlab --with pillow --with pypdf --with pymupdf --with numpy python packs/corel/tests/pdfin_browser.py [--real PATH]

What runs
  * the generated fixture (pdfin_fixture.py, no downloads): page and font counts, FontFace loading of every font, glyph runs,
    hidden text dropped, JPEG pass-through byte for byte (RGB, grey, progressive) and no pass-through for CMYK or EXIF-tagged files,
    images:'blob', pixel diff of page 1 (SVG from pageToSvg, embedded fonts) against a PyMuPDF render, outlineDoc exactness and
    tolerance, esc() hardening of pageToSvg, no leaked pdf.js workers (also after a wrong password and an abort).
  * the real user file (local only, never copied anywhere; skipped when missing): page count, image count and pixel diff of page 1.
Exits with status 1 when a check fails.
"""
import base64, functools, hashlib, http.server, io, json, socket, subprocess, sys, tempfile, threading
from pathlib import Path

import fitz
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, r"C:/Projects/tools-packs/_harness")
from smoke import _Handler  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
REAL = Path(sys.argv[sys.argv.index("--real") + 1]) if "--real" in sys.argv else next((q for q in map(Path, (r"C:/Users/Rajvi/Downloads/Ansh Wedding Virtual Invitation.ai", r"C:/Users/Rajvi/Downloads/Ansh Wedding Virtual Invitation.pdf")) if q.exists()), Path("missing"))
FAILS = []


def check(ok, msg):
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok:
        FAILS.append(msg)


def serve(files):
    class H(_Handler):
        def do_GET(self):
            p = self.path.split("?")[0]
            if p in files:
                data = files[p].read_bytes()
                self.send_response(200); self.send_header("Content-Type", "application/octet-stream"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
                return
            super().do_GET()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=str(REPO)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"


def reference(pdf_path, pageno, w, h):
    """PyMuPDF render of one page scaled to exactly w x h pixels -> float array."""
    d = fitz.open(str(pdf_path))
    pg = d[pageno - 1]
    pix = pg.get_pixmap(matrix=fitz.Matrix(w / pg.rect.width, h / pg.rect.height), alpha=False)
    return np.asarray(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")).astype(float)


def png_array(b64):
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(b64.split(",")[1]))).convert("RGB")).astype(float)


def mad(a, b):
    return float(np.abs(a - b).mean())


# Shared browser helpers: summary of a converted Doc, SVG -> canvas pixels.
HELPERS = r"""
window.__pt = {
  async bytes(url) { return new Uint8Array(await (await fetch(url)).arrayBuffer()) },
  async sha(href) { const b = await (await fetch(href)).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('') },
  async summary(d) {
    const pages = []
    for (const p of d.pages) {
      const n = { path: 0, image: 0, text: 0 }
      for (const it of p.items) n[it.t] = (n[it.t] || 0) + 1
      const imgs = p.items.filter(i => i.t === 'image')
      const jpegs = []
      for (const i of imgs) if (i.href.startsWith('data:image/jpeg') || i.href.startsWith('blob:')) { const h = await this.sha(i.href); if ((await (await fetch(i.href)).blob()).type === 'image/jpeg') jpegs.push(h) }
      const texts = p.items.filter(i => i.t === 'text')
      pages.push({ w: p.w, h: p.h, n, jpegs, hrefKinds: [...new Set(imgs.map(i => i.href.split(':')[0]))], strs: texts.map(t => t.str),
        glyphTexts: texts.filter(t => t.glyphs).length, badGlyphs: texts.filter(t => t.glyphs && (!t.font || !d.fonts[t.font] || t.glyphs.some((g, k) => typeof g.c !== 'string' || !Number.isFinite(g.x) || (k && g.x < t.glyphs[k - 1].x - 1e-6)))).length,
        badFontKeys: texts.filter(t => t.font && !(t.font in d.fonts)).length })
    }
    const fonts = {}
    for (const [k, f] of Object.entries(d.fonts)) {
      let loads = null
      if (f.data) { try { const ff = new FontFace('pt' + k, f.data.slice().buffer); await ff.load(); loads = true } catch { loads = false } }
      fonts[k] = { name: f.name, family: f.family, bold: f.bold, italic: f.italic, len: f.data ? f.data.length : 0, loads, isU8: f.data ? f.data instanceof Uint8Array : null }
    }
    return { pages, fonts, numPages: d.numPages, warnings: d.warnings, keys: Object.keys(d).sort() }
  },
  /** page -> {png (data url), W, H}: the SVG made by pageToSvg drawn on a white canvas. */
  async svgPng(page, fonts) {
    const { pageToSvg } = await import('/packs/corel/_svgout.js')
    const svg = pageToSvg(page, { unit: 'pt', background: '#ffffff', fonts })
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image(); img.src = url; await img.decode()
    const W = Math.round(page.w), H = Math.round(page.h)
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H)
    URL.revokeObjectURL(url)
    return { png: c.toDataURL('image/png'), W, H, svgLen: svg.length }
  },
}
"""


def main():
    tmp = Path(tempfile.mkdtemp(prefix="pdfin-"))
    subprocess.run([sys.executable, str(Path(__file__).with_name("pdfin_fixture.py")), str(tmp)], check=True)
    fx = tmp / "pdfin-fixture.pdf"
    truth = json.loads((tmp / "pdfin-truth.json").read_text())
    files = {"/__fx.pdf": fx}
    # encrypted copy for the wrong-password path
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter(clone_from=PdfReader(str(fx)))
    try:
        w.encrypt("secret", algorithm="RC4-128")
        with open(tmp / "enc.pdf", "wb") as f:
            w.write(f)
        files["/__enc.pdf"] = tmp / "enc.pdf"
    except Exception as e:  # cryptography missing etc.
        print("note: no encrypted fixture:", e)
    if REAL.exists():
        files["/__real.ai"] = REAL
    else:
        print("note: real file not found, skipping:", REAL)
    # raw DCT streams of the fixture (what pass-through must reproduce), by pypdf
    dct = {}
    for pg in PdfReader(str(fx)).pages:
        xo = pg["/Resources"].get("/XObject")
        for k, v in (xo.get_object() if xo else {}).items():
            o = v.get_object()
            if o.get("/Subtype") == "/Image" and list(o["/Filter"] if isinstance(o.get("/Filter"), list) else [o.get("/Filter")]) == ["/DCTDecode"]:
                dct[k] = (hashlib.sha256(o._data).hexdigest(), str(o.get("/ColorSpace")), o["/Width"], o["/Height"])
    print("fixture DCT streams:", {k: v[1:] for k, v in dct.items()})

    base = serve(files)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge")
        pg = b.new_context().new_page()
        pg.add_init_script("""(() => { const N = window.Worker; window.__workers = { made: 0, ended: 0 };
          window.Worker = class extends N { constructor(...a) { super(...a); window.__workers.made++; const t = this.terminate.bind(this); let done = false; this.terminate = () => { if (!done) { done = true; window.__workers.ended++ } return t() } } } })()""")
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(base + "/index.html")
        pg.evaluate(HELPERS)
        live = lambda: pg.evaluate("window.__workers.made - window.__workers.ended")

        # ---------------- fixture ----------------
        r = pg.evaluate("""async () => {
          const { pdfToDoc } = await import('/packs/corel/_pdfin.js')
          const buf = await __pt.bytes('/__fx.pdf')
          const d = await pdfToDoc(buf)
          const sum = await __pt.summary(d)
          const db = await pdfToDoc(buf, { pages: [1], images: 'blob' })
          const blobs = db.pages[0].items.filter(i => i.t === 'image').map(i => i.href)
          const dataDoc = await pdfToDoc(buf, { pages: [2] })
          const out = { sum, blobKinds: [...new Set(blobs.map(h => h.split(':')[0]))], blobFetch: (await (await fetch(blobs[0])).blob()).size > 0,
            subset: { pages: dataDoc.pages.length, numPages: dataDoc.numPages, fonts: Object.keys(dataDoc.fonts).length, kinds: [...new Set(dataDoc.pages[0].items.filter(i => i.t === 'image').map(i => i.href.split(':')[0]))] },
            bufIntact: buf.byteLength > 0 }
          blobs.forEach(u => URL.revokeObjectURL(u))
          return out
        }""")
        s = r["sum"]
        check(len(s["pages"]) == truth["pages"] and s["numPages"] == truth["pages"], f"fixture: {len(s['pages'])} pages, numPages {s['numPages']}")
        check(s["keys"] == ["fonts", "numPages", "pages", "warnings"], f"result keys {s['keys']}")
        sizes = [(q.rect.width, q.rect.height) for q in fitz.open(str(fx))]
        check(all(abs(p["w"] - w) < 0.5 and abs(p["h"] - h) < 0.5 for p, (w, h) in zip(s["pages"], sizes)), f"page sizes match PyMuPDF (incl. the /Rotate 90 page): {[(round(p['w']), round(p['h'])) for p in s['pages']]}")
        withdata = [f for f in s["fonts"].values() if f["len"]]
        check(len(s["fonts"]) >= truth["fonts_min"], f"{len(s['fonts'])} fonts used (at least {truth['fonts_min']})")
        check(all(f["loads"] and f["isU8"] for f in withdata) and len(withdata) >= 5, f"all {len(withdata)} embedded fonts are Uint8Array and load with FontFace")
        check(all(f["name"] and f["family"] for f in s["fonts"].values()), "every font has name and family")
        check(any(not f["len"] for f in s["fonts"].values()), "the non-embedded standard font is listed with data null")
        allstr = " | ".join(" | ".join(p["strs"]) for p in s["pages"])
        for t in truth["strings"]:
            check(t in allstr, f"text present: {t!r}")
        check(truth["invisible"] not in allstr, "invisible (render mode 3) text dropped")
        for i, p in enumerate(s["pages"]):
            check(p["badGlyphs"] == 0 and p["badFontKeys"] == 0, f"page {i + 1}: glyph runs well formed ({p['glyphTexts']} glyph items of {p['n']['text']})")
        check(s["pages"][0]["glyphTexts"] >= 8, "page 1 has glyph text items")
        # JPEG pass-through, byte for byte
        got = set(h for p in s["pages"] for h in p["jpegs"])
        want = {k: v for k, v in dct.items()}
        for k, v in want.items():
            dev = ("RGB" in v[1] or "Gray" in v[1]) and v[2] != 300  # 300 wide is the EXIF-rotated file: browsers would rotate it, so it is re-encoded
            check((v[0] in got) == dev, f"JPEG {k} {v[1]} {v[2]}x{v[3]}: {'passed through unchanged' if dev else 'not passed through'} -> {v[0] in got}")
        check(len(s["pages"][1]["jpegs"]) == 3 + 1, f"page 2 reuses one JPEG: {len(s['pages'][1]['jpegs'])} jpeg images (3 + 1 clipped)")
        check(s["pages"][0]["n"]["image"] >= 9, f"page 1 images: {s['pages'][0]['n']['image']}")
        check(r["blobKinds"] == ["blob"] and r["blobFetch"], "images:'blob' returns blob: URLs")
        check(r["subset"]["pages"] == 1 and r["subset"]["numPages"] == 3 and r["subset"]["fonts"] >= 1 and r["subset"]["kinds"] == ["data"], f"pages option and data: default {r['subset']}")
        print("warnings:", s["warnings"])
        check(not any("re-created as live text" in w for w in s["warnings"]) and any("letter shapes" in w for w in s["warnings"]) and any("not embedded" in w for w in s["warnings"]), "updated font warnings")

        # pixel diff, page 1 of the fixture
        def pixel(path_url, local_path, pageno, tag, shift=0):
            q = pg.evaluate("""async ([url, pageno, shift]) => {
              const { pdfToDoc } = await import('/packs/corel/_pdfin.js')
              const d = await pdfToDoc(await __pt.bytes(url), { pages: [pageno] })
              const items = d.pages[0].items.filter(i => i.t === 'text' && i.glyphs).map(i => ({ m: i.m, size: i.size, w: i.glyphs[i.glyphs.length - 1].x + i.size }))
              if (shift) for (const i of d.pages[0].items) if (i.t === 'text') i.m = [i.m[0], i.m[1], i.m[2], i.m[3], i.m[4] + shift, i.m[5]]
              const r = await __pt.svgPng(d.pages[0], d.fonts)
              return { ...r, items, nImages: d.pages[0].items.filter(i => i.t === 'image').length, nText: d.pages[0].items.filter(i => i.t === 'text').length }
            }""", [path_url, pageno, shift])
            mine = png_array(q["png"])
            ref = reference(local_path, pageno, q["W"], q["H"])
            m = mad(mine, ref)
            frac = float((np.abs(mine - ref).mean(axis=2) > 40).mean())
            Image.fromarray(np.abs(mine - ref).clip(0, 255).astype("uint8")).save(tmp / f"{tag}-diff.png")
            # text regions only: the box of every unrotated glyph item (a text-position error shows up here, not in the page average)
            tot, cnt = 0.0, 0
            for it in q["items"]:
                m6 = it["m"]
                if abs(m6[1]) > 1e-6 or abs(m6[2]) > 1e-6:
                    continue
                x0, x1 = int(max(0, m6[4] - 1)), int(min(q["W"], m6[4] + m6[0] * it["w"] + 1))
                y0, y1 = int(max(0, m6[5] - abs(m6[3]) * it["size"] * 0.95)), int(min(q["H"], m6[5] + abs(m6[3]) * it["size"] * 0.3))
                if x1 > x0 and y1 > y0:
                    tot += mad(mine[y0:y1, x0:x1], ref[y0:y1, x0:x1]); cnt += 1
            return m, frac, (tot / cnt if cnt else None), cnt, q

        m, frac, tm, tc, q = pixel("/__fx.pdf", fx, 1, "fx1")
        print(f"fixture page 1: mad {m:.2f}, big-diff fraction {frac:.4f}, text-region mad {tm}, {tc} text boxes, {q['nImages']} images")
        check(m < 6, f"fixture page 1 pixel diff vs PyMuPDF (mean abs diff {m:.2f} < 6)")
        check(frac < 0.03, f"fixture page 1 pixels differing by more than 40: {frac:.4f} < 0.03")
        check(tm is not None and tm < 25, f"fixture page 1 glyph text regions mean diff {tm} < 25 over {tc} boxes")

        for pn in (2, 3):
            m, frac, tm, tc, q = pixel("/__fx.pdf", fx, pn, f"fx{pn}")
            print(f"fixture page {pn}: mad {m:.2f}, big-diff fraction {frac:.4f}, text-region mad {tm}")
            check(m < 8 and frac < 0.05, f"fixture page {pn} pixel diff vs PyMuPDF (mean {m:.2f} < 8, differing {frac:.4f} < 0.05)")

        # outlineDoc: exact outlines from the embedded fonts, tolerant of missing fonts
        o = pg.evaluate("""async () => {
          const { pdfToDoc } = await import('/packs/corel/_pdfin.js')
          const { outlineDoc } = await import('/packs/corel/_text.js')
          const d = await pdfToDoc(await __pt.bytes('/__fx.pdf'), { pages: [1] })
          const nText = d.pages[0].items.filter(i => i.t === 'text').length
          const res = await outlineDoc(d)
          const left = d.pages[0].items.filter(i => i.t === 'text').length
          const r = await __pt.svgPng(d.pages[0], null)
          const tol = {}
          const t0 = { t: 'text', str: 'Hello', family: 'sans-serif', size: 12, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 10, 10] }
          const a = { pages: [{ items: [{ ...t0, font: 'nope', glyphs: [{ c: 'H', x: 0 }] }] }] }
          tol.unknownKey = [await outlineDoc(a), a.pages[0].items[0].t]
          const b = { pages: [{ items: [{ ...t0 }] }], fonts: undefined }
          tol.noFonts = [await outlineDoc(b), b.pages[0].items[0].t]
          const c = { pages: [{ items: [{ ...t0, font: 'f', glyphs: [{ c: 'H', x: 0 }] }] }], fonts: { f: { name: 'x', family: 'x', bold: false, italic: false, data: null } } }
          tol.nullData = [await outlineDoc(c), c.pages[0].items[0].t]
          const e = { pages: [{ items: [{ ...t0, font: 'f', glyphs: [{ c: 'H', x: 0 }] }] }], fonts: { f: { name: 'x', family: 'x', bold: false, italic: false, data: new Uint8Array(200) } } }
          tol.junkData = [await outlineDoc(e), e.pages[0].items[0].t]
          const multi = { pages: [{ items: [{ ...t0, str: 'Hi\\nthere', align: 'center' }] }] }
          tol.multi = [await outlineDoc(multi), multi.pages[0].items.map(i => i.t)]
          const empty = await outlineDoc({ pages: [{ items: [] }, {}] })
          return { nText, res, left, png: r.png, W: r.W, H: r.H, tol, empty }
        }""")
        check(o["res"]["done"] == o["nText"] and o["res"]["kept"] == 0 and o["left"] == 0, f"outlineDoc fixture page 1: {o['res']} of {o['nText']} text items")
        om = mad(png_array(o["png"]), reference(fx, 1, o["W"], o["H"]))
        check(om < 6, f"outlined page 1 pixel diff vs PyMuPDF {om:.2f} < 6")
        for k, v in o["tol"].items():
            check(v[0]["done"] + v[0]["kept"] >= 1, f"outlineDoc tolerates {k}: {v}")
        check(o["tol"]["junkData"][1] == "path" and o["tol"]["nullData"][1] == "path", "bad font data falls back to the bundled fonts")
        check(o["empty"] == {"done": 0, "kept": 0}, "outlineDoc on empty pages")

        # esc() hardening
        h = pg.evaluate("""async () => {
          const { pageToSvg } = await import('/packs/corel/_svgout.js')
          const bad = '"/><script>window.__pwn=1</script><x a="'
          const page = { w: 100, h: 100, items: [
            { t: 'path', d: [['M', 0, 0], ['L', 10, 10]], fill: bad, stroke: bad, strokeWidth: 1 },
            { t: 'path', d: [['M', 0, 0], ['L', 10, 10]], fill: { g: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, m: [1, 0, 0, 1, 0, 0], stops: [{ o: 0, c: bad, a: 1 }, { o: 1, c: '#fff', a: 1 }], spread: bad } },
            { t: 'image', href: bad, w: 1, h: 1, m: [10, 0, 0, 10, 0, 0] },
            { t: 'text', str: bad, family: bad, size: 10, fill: bad, m: [1, 0, 0, 1, 0, 10] },
            { t: 'text', str: 'x', family: bad, size: 10, fill: bad, m: [1, 0, 0, 1, 0, 10], font: bad, glyphs: [{ c: 'x', x: 0 }] },
          ] }
          const svg = pageToSvg(page, { background: bad, title: bad, fonts: { [bad]: { data: new Uint8Array([0, 1, 0, 0, 1, 2, 3, 4]) } } })
          const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
          const walk = (n) => [n, ...[...n.children].flatMap(walk)]
          const els = walk(doc.documentElement)
          return { parseError: !!doc.querySelector('parsererror'), scripts: els.filter(e => e.localName === 'script' || e.localName === 'x').length,
            badAttrs: els.flatMap(e => [...e.attributes]).filter(a => a.name === 'a' || /^on/i.test(a.name)).length, raw: svg.includes('<script') }
        }""")
        check(not h["parseError"] and h["scripts"] == 0 and h["badAttrs"] == 0 and not h["raw"], f"pageToSvg escapes hostile strings {h}")

        # worker leaks
        l = pg.evaluate("""async () => {
          const { pdfToDoc } = await import('/packs/corel/_pdfin.js')
          const { openPdf } = await import('/lib/pdf.js')
          const buf = await __pt.bytes('/__fx.pdf')
          const w0 = { ...window.__workers }
          for (let i = 0; i < 3; i++) await pdfToDoc(buf, { pages: [1] })
          const after = { ...window.__workers }
          // abort part way
          const ac = new AbortController(); setTimeout(() => ac.abort(), 5)
          let code = null
          try { await pdfToDoc(buf, { signal: ac.signal }) } catch (e) { code = e.code }
          const ac2 = new AbortController(); ac2.abort()
          let code2 = null
          try { await pdfToDoc(buf, { signal: ac2.signal }) } catch (e) { code2 = e.code }
          // garbage
          let bad = null
          try { await pdfToDoc(new Uint8Array([1, 2, 3, 4])) } catch (e) { bad = e.message }
          const end = { ...window.__workers }
          // control: the old route (openPdf without destroy) does leave a live worker, so the counter is meaningful
          await openPdf(buf.slice())
          const ctl = { ...window.__workers }
          return { w0, after, end, ctl, code, code2, bad }
        }""")
        d = lambda x: x["made"] - x["ended"]
        check(d(l["after"]) - d(l["w0"]) == 0 and l["after"]["made"] - l["w0"]["made"] == 3, f"3 conversions made 3 workers and ended them all {l['w0']} -> {l['after']}")
        check(l["code"] == "ABORT" or l["code"] is None, f"abort mid conversion -> {l['code']}")
        check(l["code2"] == "ABORT", f"already aborted signal -> {l['code2']}")
        check(bool(l["bad"]), f"garbage input gives a readable error: {l['bad']}")
        check(d(l["end"]) == d(l["w0"]), f"no leaked workers after abort and garbage input (live {d(l['end'])})")
        check(d(l["ctl"]) == d(l["end"]) + 1, "control: a document that is not destroyed leaves one live worker (counter works)")
        if "/__enc.pdf" in files:
            e = pg.evaluate("""async () => {
              const { pdfToDoc } = await import('/packs/corel/_pdfin.js')
              const buf = await __pt.bytes('/__enc.pdf'); const out = {}
              const w0 = window.__workers.made - window.__workers.ended
              try { await pdfToDoc(buf) } catch (e) { out.none = e.code }
              try { await pdfToDoc(buf, { password: 'nope' }) } catch (e) { out.wrong = e.code }
              out.ok = (await pdfToDoc(buf, { password: 'secret', pages: [1] })).pages.length
              out.live = window.__workers.made - window.__workers.ended - w0
              return out
            }""")
            check(e["none"] == "PASSWORD" and e["wrong"] == "PASSWORD" and e["ok"] == 1 and e["live"] == 0, f"password handling and no leaked worker {e}")

        # ---------------- real file (local only) ----------------
        if "/__real.ai" in files:
            real = fitz.open(str(REAL))
            want_pages = real.page_count
            want_imgs = [len(real[i].get_image_info()) for i in range(want_pages)]
            r = pg.evaluate("""async () => {
              const { pdfToDoc } = await import('/packs/corel/_pdfin.js')
              const buf = await __pt.bytes('/__real.ai')
              const d = await pdfToDoc(buf, { images: 'blob' })
              const sum = await __pt.summary(d)
              d.pages.forEach(p => p.items.forEach(i => i.t === 'image' && URL.revokeObjectURL(i.href)))
              return sum
            }""")
            check(len(r["pages"]) == want_pages and r["numPages"] == want_pages, f"real file: {len(r['pages'])} pages (PyMuPDF {want_pages})")
            got_imgs = [p["n"]["image"] for p in r["pages"]]
            check(got_imgs == want_imgs, f"real file image count per page {got_imgs} (PyMuPDF {want_imgs})")
            check(all(f["loads"] for f in r["fonts"].values() if f["len"]) and any(f["len"] for f in r["fonts"].values()), f"real file fonts load: {[(f['name'], f['len']) for f in r['fonts'].values()]}")
            check(all(p["badGlyphs"] == 0 for p in r["pages"]) and r["pages"][0]["glyphTexts"] > 20, f"real file glyph runs: {[p['glyphTexts'] for p in r['pages']]} of {[p['n']['text'] for p in r['pages']]}")
            m, frac, tm, tc, q = pixel("/__real.ai", REAL, 1, "real1")
            print(f"real page 1: mad {m:.2f}, big-diff fraction {frac:.4f}, text-region mad {tm}, {tc} text boxes, diff image {tmp / 'real1-diff.png'}")
            check(m < 6, f"real page 1 pixel diff vs PyMuPDF (mean abs diff {m:.2f} < 6)")
            check(frac < 0.02, f"real page 1 differing pixels {frac:.4f} < 0.02")
            check(tm is not None and tm < 30, f"real page 1 glyph text regions mean diff {tm:.2f} < 30 over {tc} boxes")
            sm = pixel("/__real.ai", REAL, 1, "real1s", shift=2)[2]
            check(sm > 1.3 * tm, f"control: moving every text item 2 pt raises the text-region diff {tm:.2f} -> {sm:.2f}, so a wrong glyph position would be caught")
            lv = pg.evaluate("window.__workers.made - window.__workers.ended")
            check(lv == 1, f"live workers after everything: {lv} (only the control document is left)")

        check(not errs, f"no page errors {errs[:2]}")
        b.close()
    print("\n%d failed" % len(FAILS) if FAILS else "\nall passed")
    sys.exit(1 if FAILS else 0)


main()
