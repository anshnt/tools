"""Browser check for the CDR writer (packs/corel/_cdrout.js), run in the real Edge engine so image decoding, canvas previews and
CompressionStream are the real ones.

    uv run --with playwright python packs/corel/tests/cdrout_browser.py [out_dir]

It builds a drawing with real JPEG and PNG images (made with a canvas), writes it with writeCdr, reads the file back with the site's own reader,
and checks page and object counts, image pixel sizes, the preview bitmap, the compressed variant and the cancel path. With an out_dir the
written files are kept there. The desktop application is not available here, so this does not prove that it opens the files.
"""
import base64, json, sys
from pathlib import Path

sys.path.insert(0, r"C:/Projects/tools-packs/_harness")
from smoke import serve, launch  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None

JS = r"""
async () => {
  const { writeCdr } = await import('/packs/corel/_cdrout.js')
  const { readCdr } = await import('/packs/corel/_cdr.js')
  const { buildDoc, pageModel, leaves } = await import('/packs/corel/_cdrdoc.js')
  const { pathBBox } = await import('/packs/corel/_model.js')
  const out = { errors: [] }
  // real images: a big photo-like JPEG, a PNG with transparency
  const mk = (w, h, draw, type, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); return c.toDataURL(type, q) }
  const jpeg = mk(2400, 1600, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ff3030'); gr.addColorStop(1, '#3030ff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.fillRect(w / 4, h / 4, w / 2, h / 2) }, 'image/jpeg', 0.9)
  const png = mk(200, 100, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#00aa00'; g.beginPath(); g.arc(w / 2, h / 2, 40, 0, 7); g.fill() }, 'image/png')
  const blobUrl = URL.createObjectURL(await (await fetch(png)).blob())
  const rect = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const doc = { pages: [
    { w: 595.28, h: 841.89, name: 'Cover', layers: [
      { name: 'Photos', hidden: false, locked: false, printable: true, items: [
        { t: 'image', href: jpeg, w: 2400, h: 1600, m: [432, 0, 0, 288, 81, 100], opacity: 1, name: 'Big photo' },
        { t: 'image', href: png, w: 200, h: 100, m: [200, 0, 0, 100, 100, 450], opacity: 0.9 },
        { t: 'image', href: blobUrl, w: 200, h: 100, m: [100, 0, 0, 50, 350, 450], opacity: 1 },
        { t: 'image', href: jpeg, w: 2400, h: 1600, m: [300, 0, 0, 200, 150, 560], opacity: 1, clip: [{ d: rect(200, 600, 100, 80), rule: 'nonzero' }] }] },
      { name: 'Art', hidden: false, locked: false, printable: true, items: [
        { t: 'group', name: 'Badge', items: [
          { t: 'path', d: rect(100, 700, 200, 60), fill: { g: 'linear', x1: 100, y1: 700, x2: 300, y2: 760, m: [1, 0, 0, 1, 0, 0], spread: 'pad', stops: [{ o: 0, c: '#ffcc00', a: 1 }, { o: 1, c: '#cc0066', a: 1 }] }, rule: 'nonzero', stroke: '#222222', strokeWidth: 2, dash: [6, 3] },
          { t: 'text', str: 'Invitation', family: 'Arial', size: 28, bold: true, italic: false, fill: '#111111', opacity: 1, m: [1, 0, 0, 1, 110, 745] }] }] }] },
    { w: 300, h: 200, items: [{ t: 'path', d: rect(20, 20, 100, 100), fill: '#336699', rule: 'nonzero' }] }] }
  // 1. default decoder (browser), text kept live
  const prog = []
  const r = await writeCdr(doc, { textToCurves: false, onProgress: (f) => prog.push(f) })
  const bytes = new Uint8Array(await r.blob.arrayBuffer())
  out.size = bytes.length; out.notes = r.notes; out.progressOk = prog[0] === 0 && prog.at(-1) === 1
  const cdr = await readCdr(bytes)
  out.failed = cdr.failed; out.warnings = cdr.warnings; out.version = cdr.version; out.pages = cdr.pages.length
  const d = buildDoc(cdr)
  const real = d.pages.filter((p) => !p.master)
  const m1 = pageModel(real[0], { bitmapHref: (b) => b }).page
  out.kinds = m1.items.map((i) => i.t)
  out.bitmaps = m1.items.filter((i) => i.t === 'image').map((i) => [i.href.w, i.href.h])
  out.imageBoxes = m1.items.filter((i) => i.t === 'image').map((i) => { const b = pathBBox([['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['L', 0, 1], ['Z']].map((c) => c.length === 1 ? c : [c[0], i.m[0] * c[1] + i.m[2] * c[2] + i.m[4], i.m[1] * c[1] + i.m[3] * c[2] + i.m[5]])); return [b.x, b.y, b.w, b.h].map((v) => +v.toFixed(2)) })
  // the big photo decodes to the real pixels: white block in the middle, red top-left, blue bottom-right
  const big = m1.items.find((i) => i.t === 'image').href
  const px = (x, y) => [...big.rgba.subarray((y * big.w + x) * 4, (y * big.w + x) * 4 + 3)]
  out.photo = { w: big.w, h: big.h, tl: px(2, 2), centre: px(big.w >> 1, big.h >> 1), br: px(big.w - 3, big.h - 3) }
  // the png: transparent corner is flattened on white, the disc is green
  const pimg = m1.items.filter((i) => i.t === 'image')[1].href
  const pp = (x, y) => [...pimg.rgba.subarray((y * pimg.w + x) * 4, (y * pimg.w + x) * 4 + 3)]
  out.png = { w: pimg.w, h: pimg.h, corner: pp(1, 1), centre: pp(pimg.w >> 1, pimg.h >> 1) }
  out.preview = null
  if (cdr.preview) {
    const img = new Image(); img.src = URL.createObjectURL(new Blob([cdr.preview.bytes], { type: cdr.preview.mime })); await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const data = g.getImageData(0, 0, c.width, c.height).data
    let nonWhite = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) nonWhite++
    out.preview = { w: c.width, h: c.height, nonWhite }
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  out.b64 = btoa(bin)
  // 2. text to curves on (needs the font CDN, so only reported)
  try {
    const t = await writeCdr({ pages: [{ w: 300, h: 100, items: [{ t: 'text', str: 'Curves', family: 'Arial', size: 30, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 10, 60] }] }] }, {})
    const c2 = await readCdr(new Uint8Array(await t.blob.arrayBuffer()))
    const m2 = pageModel(buildDoc(c2).pages.filter((p) => !p.master)[0], {}).page
    out.curves = { kinds: m2.items.map((i) => i.t), notes: t.notes.filter((n) => /text/i.test(n)) }
  } catch (e) { out.curves = { error: String(e) } }
  // 3. compressed
  const rc = await writeCdr(doc, { textToCurves: false, compress: true })
  const cb = new Uint8Array(await rc.blob.arrayBuffer())
  const cc = await readCdr(cb)
  out.compressed = { size: cb.length, failed: cc.failed, pages: cc.pages.length, objects: pageModel(buildDoc(cc).pages.filter((p) => !p.master)[0], { bitmapHref: (b) => b }).page.items.length }
  // 4. cancel
  const ac = new AbortController()
  try { await writeCdr(doc, { textToCurves: false, signal: ac.signal, onProgress: (f) => { if (f > 0.05) ac.abort() } }); out.abort = 'no error' } catch (e) { out.abort = e.code + ':' + e.message }
  return out
}
"""


def main():
    base = serve(REPO)
    with launch("cdrout") as ctx:
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/favicon.ico", lambda r: r.fulfill(status=204))
        page.goto(f"{base}/sw.js")
        out = page.evaluate(JS)
    data = base64.b64decode(out.pop("b64"))
    if OUT:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "writer-browser.cdr").write_bytes(data)
    print(json.dumps({k: v for k, v in out.items() if k != "notes"}, indent=1))
    print("notes:", *out["notes"], sep="\n  - ")
    problems = []
    if errors: problems.append(f"console errors: {errors}")
    if out["failed"]: problems.append("reader failed: " + "; ".join(out["warnings"]))
    if out["pages"] != 3 or out["version"] != 1300: problems.append("page count or version")
    if out["kinds"] != ["image", "image", "image", "image", "path", "text"]: problems.append(f"kinds {out['kinds']}")
    # 432 x 288 pt placed, 300 ppi cap -> 1800 x 1200
    if out["bitmaps"][0] != [1800, 1200]: problems.append(f"photo pixels {out['bitmaps'][0]}")
    ph = out["photo"]
    if not (ph["tl"][0] > 200 and ph["tl"][2] < 80): problems.append(f"photo top-left {ph['tl']}")
    if not all(v > 240 for v in ph["centre"]): problems.append(f"photo centre {ph['centre']}")
    if not (ph["br"][2] > 200 and ph["br"][0] < 80): problems.append(f"photo bottom-right {ph['br']}")
    pg = out["png"]
    if not all(v > 240 for v in pg["corner"]): problems.append(f"png corner {pg['corner']}")
    if not (pg["centre"][1] > 120 and pg["centre"][0] < 60): problems.append(f"png centre {pg['centre']}")
    if not out["preview"] or out["preview"]["nonWhite"] < 500: problems.append(f"preview {out['preview']}")
    if out["compressed"]["failed"] or out["compressed"]["pages"] != 3 or out["compressed"]["objects"] != 6: problems.append(f"compressed {out['compressed']}")
    if out["abort"] != "ABORT:Cancelled": problems.append(f"abort {out['abort']}")
    if not out["progressOk"]: problems.append("progress")
    if problems:
        print("PROBLEMS:", *problems, sep="\n  - ")
        sys.exit(1)
    print("ok - browser check passed")


if __name__ == "__main__":
    main()
