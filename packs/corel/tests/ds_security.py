"""Security and robustness checks for Draw Studio (Playwright, the installed Edge). Plan section 9.4 "Security" and section 11.

Hostile inputs of every kind the editor reads: SVG (script, handlers, remote images, foreignObject, entity bombs, deep nesting), the SVG paste path, PDF (actions,
loops, giant claims), PostScript (infinite loops, runaway recursion, giant arrays and strings, bad DOS headers), CDR (bad samples, random mutations, a ZIP bomb) and
poisoned autosave records (prototype keys, javascript: links, Infinity numbers, 10 MB names, 300k nodes, deep groups, 300+ pages).
Pass criteria for each input: no script runs (no alert, nothing stored on window), no request leaves the machine except to the pinned CDNs, no markup or event
handler appears in the app DOM, limits are enforced, the answer is a readable message or a cleaned drawing within a time budget, the progress overlay goes away,
there is no uncaught exception, and the editor still opens a good file afterwards.

    uv run --with playwright --with pillow python ds_security.py [--only svg,paste,pdf,ps,cdr,autosave,limits,static] [--quick]

--quick skips the two slow PostScript cases (a loop that has to hit the 60 s wall clock). Generated files live in DS_OUT/hostile (outside the repo).
"""
import argparse, io, json, os, random, re, struct, sys, time, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ds_browser as B  # noqa: E402
from ds_browser import FIX, SAMPLES, check, mount, open_tool, ds_eval  # noqa: E402
from smoke import launch  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
OUT = Path(os.environ.get("DS_OUT", r"C:/Projects/tools-packs/draw-studio-scratch/e14")) / "hostile"
ALLOWED_HOSTS = ("127.0.0.1", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com", "code.jquery.com", "cdn.tailwindcss.com")
BAD_WORDS = re.compile(r"undefined|NaN|\[object|TypeError|ReferenceError|RangeError|Cannot read|is not a function|Unexpected token|at https?://|\.js:\d+")

# ---------------------------------------------------------------- the page-side inspectors
DOM_AUDIT = """() => {
  const bad = []
  const roots = [document.querySelector('.t-ds'), ...document.querySelectorAll('dialog')].filter(Boolean)
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase()
    if (['script', 'iframe', 'object', 'embed', 'foreignobject', 'link', 'meta', 'base', 'form', 'img', 'video', 'audio', 'style'].includes(tag)) bad.push('<' + tag + '>')
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) bad.push(tag + '@' + a.name)
      if (/^\\s*(javascript|vbscript|data:text\\/html)/i.test(a.value)) bad.push(tag + '@' + a.name + '=' + a.value.slice(0, 30))
      if ((a.name === 'href' || a.name === 'xlink:href' || a.name === 'src') && /^(https?:|file:|ftp:|\\/\\/)/i.test(a.value)) bad.push(tag + '@' + a.name + '=' + a.value.slice(0, 40))
    }
  }
  return { bad: [...new Set(bad)], pwned: window.__pwned ?? null, polluted: ({}).polluted ?? null, protoKeys: Object.keys(Object.prototype).filter((k) => !['__proto__'].includes(k)).length }
}"""

# every colour, number, string and size of a restored or opened document must have passed the whitelist
DOC_AUDIT = """() => {
  const ds = document.querySelector('.tool-body').__ds, r = ds.store.root, bad = []
  const hex = /^#[0-9a-f]{6}$/
  const num = (v, what) => { if (v != null && (typeof v !== 'number' || !Number.isFinite(v))) bad.push(what + '=' + String(v).slice(0, 20)) }
  const colour = (c, what) => { if (c == null || typeof c === 'object') return; if (!hex.test(c)) bad.push(what + ' colour ' + String(c).slice(0, 30)) }
  let nodes = 0
  const walk = (items, depth) => { if (depth > 41) bad.push('depth ' + depth)
    for (const n of items) { nodes++
      if (typeof n.name === 'string' && n.name.length > 200) bad.push('name length ' + n.name.length)
      colour(n.fill, 'fill'); colour(n.stroke, 'stroke'); num(n.strokeWidth, 'strokeWidth'); num(n.opacity, 'opacity')
      if (n.m) { if (!Array.isArray(n.m) || n.m.length !== 6) bad.push('matrix shape'); else n.m.forEach((v) => num(v, 'm')) }
      if (n.t === 'path') { if (!Array.isArray(n.d) || n.d.length > 500000) bad.push('path d size'); else for (const c of n.d.slice(0, 2000)) for (let i = 1; i < c.length; i++) num(c[i], 'd') }
      if (n.t === 'text') { if (/[<>{};"\\\\]/.test(n.family || '')) bad.push('family ' + n.family); if ((n.str || '').length > 20000) bad.push('str'); if (n.font != null && !Object.hasOwn(r.fonts || {}, n.font)) bad.push('font ref ' + n.font) }
      if (n.t === 'image') { if (n.href) bad.push('href on image'); if (n.asset && !ds.assets.has(n.asset)) bad.push('asset ' + String(n.asset).slice(0, 20)) }
      if (n.t === 'group') walk(n.items, depth + 1)
      if (!['path', 'text', 'image', 'group'].includes(n.t)) bad.push('type ' + n.t) } }
  if (r.pages.length > 300) bad.push('pages ' + r.pages.length)
  const ids = new Set()
  for (const p of r.pages) { num(p.w, 'page w'); num(p.h, 'page h'); if (p.w > 20000 || p.h > 20000 || p.w < 1 || p.h < 1) bad.push('page size ' + p.w + 'x' + p.h); if (p.layers.length > 200) bad.push('layers')
    for (const l of p.layers) { if (ids.has(l.id)) bad.push('dup layer id'); ids.add(l.id); walk(l.items, 1) } }
  if (!['mm', 'in', 'pt', 'px', 'cm'].includes(r.units)) bad.push('units ' + r.units)
  return { bad: [...new Set(bad)].slice(0, 12), nodes, pages: r.pages.length }
}"""


def page_errors(errors):
    return [e for e in errors if e.startswith("pageerror")]


class Watch:
    """Alerts, outbound requests and uncaught errors seen on one page."""

    def __init__(self, page, errors):
        self.alerts, self.reqs, self.errors = [], [], errors
        page.on("dialog", lambda d: (self.alerts.append(d.message), d.dismiss()) if d.type in ("alert", "confirm", "prompt", "beforeunload") else None)
        page.on("request", self._request)

    def _request(self, r):
        u = r.url
        if u.startswith(("blob:", "data:", "about:")):
            return
        host = u.split("/")[2] if "//" in u else ""
        if not any(h in host for h in ALLOWED_HOSTS):
            self.reqs.append(u)

    def clean(self, what):
        check(not self.alerts, f"{what}: no alert, confirm or prompt ({self.alerts[:2]})")
        check(not self.reqs, f"{what}: no request left the machine ({self.reqs[:3]})")
        check(not page_errors(self.errors), f"{what}: no uncaught exception ({page_errors(self.errors)[:2]})")


def audit(page, what):
    a = page.evaluate(DOM_AUDIT)
    check(not a["bad"], f"{what}: no script, handler, remote link or injected markup in the app DOM ({a['bad'][:4]})")
    check(a["pwned"] is None and a["polluted"] is None and a["protoKeys"] == 0, f"{what}: nothing ran and the prototype is clean (pwned={a['pwned']}, polluted={a['polluted']}, keys={a['protoKeys']})")


def settle(page, timeout=150000):
    """Wait until the progress overlay is gone. Returns False when it never went away."""
    try:
        page.wait_for_function("() => document.querySelector('.ds-busy')?.hidden !== false", timeout=timeout)
        return True
    except Exception:
        return False


def try_open(page, path, timeout=150000, name=None):
    """Open a file through the real file input. Returns ('dialog', text) | ('opened', None) | ('hang', None). A password prompt is cancelled."""
    page.evaluate("() => { const ds = document.querySelector('.tool-body').__ds; window.__prevRoot = ds.store.root }")
    t0 = time.time()
    if name:
        page.set_input_files(".t-ds input[type=file]", {"name": name, "mimeType": "", "buffer": Path(path).read_bytes()})
    else:
        page.set_input_files(".t-ds input[type=file]", str(path))
    try:
        page.wait_for_function("() => { const ds = document.querySelector('.tool-body').__ds; return document.querySelector('dialog[open]') || (ds.store.root !== window.__prevRoot && document.querySelector('.ds-busy').hidden) }", timeout=timeout)
    except Exception:
        return "hang", None, time.time() - t0
    took = time.time() - t0
    if page.locator("dialog[open]").count():
        text = page.inner_text("dialog[open]")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        if page.locator("dialog[open]").count():
            page.locator("dialog[open]").get_by_role("button").first.click()
        return "dialog", text, took
    return "opened", None, took


def usable(page, what):
    """After a hostile input the editor must still work: the overlay is gone, no dialog is stuck, and a good file opens."""
    check(settle(page, 5000), f"{what}: the progress overlay is gone")
    check(page.locator("dialog[open]").count() == 0, f"{what}: no dialog is left open")
    kind, _, _ = try_open(page, SAMPLES / "scene-v1000.cdr", timeout=60000)
    n = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages.length")
    check(kind == "opened" and n >= 1, f"{what}: the editor still opens a good file afterwards ({kind}, {n} page(s))")


def friendly(text, what):
    check(len(text or "") > 25 and not BAD_WORDS.search(text or ""), f"{what}: the message is plain words ({(text or '')[:90]!r})")


# ---------------------------------------------------------------- generated hostile files
def gen_files():
    OUT.mkdir(parents=True, exist_ok=True)
    f = {}

    def put(name, data):
        p = OUT / name
        p.write_bytes(data if isinstance(data, bytes) else data.encode("utf8"))
        f[name] = p
    ns = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    put("svg-bomb.svg", '<?xml version="1.0"?><!DOCTYPE s [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;"><!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;"><!ENTITY x SYSTEM "file:///c:/windows/win.ini">]>'
        f'<svg {ns} width="100" height="100"><text x="5" y="50">&e;&x;</text></svg>')
    put("svg-deep.svg", f'<svg {ns} width="100" height="100">' + "<g>" * 6000 + '<rect width="10" height="10"/>' + "</g>" * 6000 + "</svg>")
    put("svg-use-loop.svg", f'<svg {ns} width="100" height="100"><defs><g id="a"><use xlink:href="#b"/></g><g id="b"><use xlink:href="#a"/></g></defs><use xlink:href="#a"/><use href="#b"/></svg>')
    put("svg-links.svg", f'<?xml-stylesheet href="https://evil.invalid/x.css"?><svg {ns} width="100" height="100" onload="window.__pwned=1"><style>@import url(https://evil.invalid/i.css); rect {{ fill: url(https://evil.invalid/f) }}</style>'
        '<a xlink:href="javascript:window.__pwned=1"><rect width="40" height="40" fill="#f00"/></a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="fill" values="#f00;#00f" dur="1s" onbegin="window.__pwned=2"/>'
        '<image xlink:href="file:///c:/windows/win.ini" width="10" height="10"/><image href="http://evil.invalid/a.png" width="10" height="10"/><image href="javascript:alert(1)" width="10" height="10"/>'
        '<image href="data:image/svg+xml;base64,' + __import__("base64").b64encode(b'<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=3" width="10" height="10"><script>window.__pwned=4</script><image href="https://evil.invalid/z.png" width="5" height="5"/></svg>').decode() + '" x="50" y="50" width="20" height="20"/>'
        '<foreignObject width="50" height="50"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.invalid/f"></iframe></foreignObject></svg>')
    put("svg-hugepath.svg", f'<svg {ns} width="100" height="100"><path d="M0 0 ' + "L1e308 -1e308 " * 200000 + 'Z" fill="#00f"/><path d="M0 0 L1e999 1e999" stroke="#000" stroke-width="1e999"/><rect width="1e30" height="1e30" fill="#0f0"/></svg>')
    put("svg-manyshapes.svg", f'<svg {ns} width="500" height="500">' + "".join(f'<rect x="{i % 400}" y="{i // 400}" width="2" height="2" fill="#{i % 4096:03x}"/>' for i in range(60000)) + "</svg>")
    put("svg-bigsize.svg", f'<svg {ns} width="1e12" height="1e12" viewBox="0 0 1e12 1e12"><rect width="50" height="50"/></svg>')
    # PDF
    def pdf(objs, trailer="/Root 1 0 R"):
        body = "%PDF-1.4\n" + "".join(f"{i} 0 obj\n{o}\nendobj\n" for i, o in objs) + f"trailer\n<</Size 9 {trailer}>>\n%%EOF\n"
        return body.encode("latin1")
    put("pdf-kids-loop.pdf", pdf([(1, "<</Type/Catalog/Pages 2 0 R>>"), (2, "<</Type/Pages/Kids[2 0 R 2 0 R]/Count 1>>")]))
    put("pdf-mediabox-huge.pdf", pdf([(1, "<</Type/Catalog/Pages 2 0 R>>"), (2, "<</Type/Pages/Kids[3 0 R]/Count 1>>"), (3, "<</Type/Page/Parent 2 0 R/MediaBox[0 0 1e9 1e9]/Contents 4 0 R>>"), (4, "<</Length 20>>\nstream\n0 0 100 100 re f\nendstream")]))
    put("pdf-count-claim.pdf", pdf([(1, "<</Type/Catalog/Pages 2 0 R>>"), (2, "<</Type/Pages/Kids[3 0 R]/Count 99999999>>"), (3, "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>"), (4, "<</Length 20>>\nstream\n0 0 100 100 re f\nendstream")]))
    put("pdf-actions.pdf", pdf([(1, "<</Type/Catalog/Pages 2 0 R/OpenAction<</S/JavaScript/JS(app.alert\\(1\\);window.__pwned=1)>>/AA<</WC<</S/Launch/F(cmd.exe)>>>>/Names<</JavaScript<</Names[(a)<</S/JavaScript/JS(app.alert\\(2\\))>>]>>>>>>"),
                                (2, "<</Type/Pages/Kids[3 0 R]/Count 1>>"), (3, "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Annots[<</Type/Annot/Subtype/Link/Rect[0 0 100 100]/A<</S/URI/URI(https://evil.invalid/x)>>>>]>>"), (4, "<</Length 20>>\nstream\n0 0 100 100 re f\nendstream")]))
    put("pdf-garbage.pdf", b"%PDF-1.7\n" + bytes(random.Random(1).randrange(256) for _ in range(5000)))
    # PostScript (names end in .ps or .eps, the content is sniffed)
    bb = "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n"
    put("ps-loop.eps", bb + "{ 1 1 add pop } loop\n")
    put("ps-recurse.eps", bb + "/f { f } def f\n")
    put("ps-stack-flood.eps", bb + "/f { 1 f } def f\n")
    put("ps-bigarray.eps", bb + "1000000000 array pop 2000000000 string pop 0 0 moveto 10 10 lineto stroke\n")
    put("ps-deep-braces.eps", bb + "{ " * 120000 + "} " * 120000 + "\n")
    put("ps-dict-flood.eps", bb + "1 1 200000 { pop 5 dict begin } for\n")
    put("ps-pages-flood.eps", "%!PS-Adobe-3.0\n%%BoundingBox: 0 0 100 100\n" + "0 0 moveto 5 5 lineto stroke showpage\n" * 20000)
    put("ps-files.eps", bb + "(c:/windows/win.ini) (r) file dup 100 string readstring pop pop (x) = flush currentfile closefile 0 0 moveto 50 50 lineto stroke\n")
    put("ps-bbox-huge.eps", "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1000000000000 1000000000000\n0 0 moveto 1e30 1e30 lineto stroke\n")
    put("ps-image-huge.eps", bb + "1000000 1000000 8 [1000000 0 0 -1000000 0 1000000] { <00> } image\n")
    put("ps-dos-bad.eps", b"\xc5\xd0\xd3\xc6" + struct.pack("<IIIIIIH", 0xFFFFFFFF, 0xFFFFFFFF, 0, 0, 0, 0, 0xFFFF) + bb.encode() + b"0 0 moveto 10 10 lineto stroke\n")
    # CDR
    put("cdr-riff-huge-size.cdr", b"RIFF" + struct.pack("<I", 0xFFFFFFFF) + b"CDR9vrsn" + struct.pack("<I", 2) + b"\x01\x00" + b"LIST" + struct.pack("<I", 0xFFFFFFF0) + b"doc " + b"x" * 64)
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("content/riffData.cdr", b"\x00" * (150 * 1024 * 1024))
    put("cdr-zip-bomb.cdr", bomb.getvalue())
    zbad = io.BytesIO()
    with zipfile.ZipFile(zbad, "w", zipfile.ZIP_STORED) as z:
        z.writestr("../../evil.txt", b"x"); z.writestr("content/riffData.cdr", b"RIFF\x04\x00\x00\x00CDR9"); z.writestr("content/root.dat", b"junk")
    put("cdr-zip-slip.cdr", zbad.getvalue())
    rnd = random.Random(14)
    for base in ("scene-v1000.cdr", "scene-v1300-cmpr.cdr", "scene-v1600.cdr"):
        raw = (SAMPLES / base).read_bytes()
        for i in range(8):
            b = bytearray(raw)
            kind = i % 4
            if kind == 0:
                for _ in range(rnd.randrange(8, 64)):
                    b[rnd.randrange(12, len(b))] = rnd.randrange(256)
            elif kind == 1:
                for _ in range(4):
                    o = rnd.randrange(12, len(b) - 4) & ~3
                    b[o:o + 4] = b"\xff\xff\xff\xff"
            elif kind == 2:
                b = b[:rnd.randrange(40, len(b) - 1)]
            else:
                o = rnd.randrange(12, len(b) - 8)
                b[o:o + 8] = b[o:o + 4] * 2
            put(f"mut-{base[:-4]}-{i}.cdr", bytes(b))
    return f


# ---------------------------------------------------------------- groups
def t_svg(ctx, base, files):
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    for name in ("evil.svg", "svg-links.svg", "svg-bomb.svg", "svg-use-loop.svg", "svg-deep.svg", "svg-hugepath.svg", "svg-bigsize.svg", "svg-manyshapes.svg"):
        p = FIX / name if name == "evil.svg" else files[name]
        if not p.exists():
            continue
        kind, text, took = try_open(page, p, timeout=120000)
        check(kind != "hang", f"{name}: finished ({kind}, {took:.1f}s)")
        if kind == "dialog":
            friendly(text, name)
        page.wait_for_timeout(300)
        audit(page, name)
        doc = page.evaluate(DOC_AUDIT)
        check(not doc["bad"], f"{name}: every value of the opened drawing passed the whitelist ({doc['bad'][:3]}, {doc['nodes']} objects)")
        check(settle(page, 5000), f"{name}: the progress overlay is gone")
    # hostile names stay inert text: the evil.svg group is called <img src=x onerror=alert(1)>
    kind, _, _ = try_open(page, FIX / "evil.svg") if (FIX / "evil.svg").exists() else ("skip", None, 0)
    if kind == "opened":
        names = page.evaluate("() => { const out = []; const rec = (items) => items.forEach((n) => { out.push(n.name); if (n.t === 'group') rec(n.items) }); document.querySelector('.tool-body').__ds.store.root.pages[0].layers.forEach((l) => rec(l.items)); return out.filter(Boolean) }")
        txt = page.inner_text(".ds-dock")
        check(page.locator(".t-ds img").count() == 0, f"evil.svg: names are text, never elements ({[n[:30] for n in names][:2]})")
        check(all(len(n) <= 200 for n in names), "evil.svg: names are capped at 200 characters")
    w.clean("SVG files")
    usable(page, "after hostile SVG files")
    page.close()


def t_paste(ctx, base, files):
    """The clipboard SVG path (Ctrl+V with SVG text) goes through the same sanitiser as a file."""
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    B.new_blank(page, "Paste")
    for name in ("svg-links.svg", "svg-bomb.svg", "svg-use-loop.svg", "svg-hugepath.svg"):
        p = files[name]
        n0 = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages[0].layers.reduce((a, l) => a + l.items.length, 0)")
        res = page.evaluate("async (t) => { const ds = document.querySelector('.tool-body').__ds; try { await ds.clip.run({ text: t, inPlace: false }); return 'ok' } catch (e) { return 'threw ' + e.message } }", p.read_text(encoding="utf8"))
        page.wait_for_timeout(500)
        check(not res.startswith("threw"), f"paste {name}: handled without throwing ({res})")
        audit(page, f"paste {name}")
        doc = page.evaluate(DOC_AUDIT)
        check(not doc["bad"], f"paste {name}: values are whitelisted ({doc['bad'][:3]})")
    # evil.svg as the clipboard text, then look at what was drawn
    if (FIX / "evil.svg").exists():
        page.evaluate("async (t) => { await document.querySelector('.tool-body').__ds.clip.run({ text: t }) }", (FIX / "evil.svg").read_text(encoding="utf8"))
        page.wait_for_timeout(400)
        audit(page, "paste evil.svg")
    # plain text with markup becomes text, not markup
    page.evaluate("async () => { await document.querySelector('.tool-body').__ds.clip.run({ text: '<img src=x onerror=window.__pwned=9> <script>window.__pwned=8</script>' }) }")
    page.wait_for_timeout(300)
    audit(page, "paste of text that looks like markup")
    w.clean("the paste path")
    page.close()


def t_pdf(ctx, base, files):
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    cases = [FIX / "bad-truncated.pdf", FIX / "bad-js.pdf", FIX / "bad-huge.pdf", files["pdf-kids-loop.pdf"], files["pdf-mediabox-huge.pdf"], files["pdf-count-claim.pdf"], files["pdf-actions.pdf"], files["pdf-garbage.pdf"]]
    for p in cases:
        if not p.exists():
            continue
        kind, text, took = try_open(page, p, timeout=120000)
        check(kind != "hang", f"{p.name}: finished ({kind}, {took:.1f}s)")
        if kind == "dialog":
            friendly(text, p.name)
        else:
            doc = page.evaluate(DOC_AUDIT)
            check(not doc["bad"], f"{p.name}: values of the opened drawing are whitelisted ({doc['bad'][:3]}, {doc['pages']} page(s))")
        check(settle(page, 5000), f"{p.name}: the progress overlay is gone")
        audit(page, p.name)
    # password PDF: cancelling must not leave the editor stuck
    if (FIX / "password.pdf").exists():
        kind, _, took = try_open(page, FIX / "password.pdf", timeout=60000)
        check(kind in ("dialog", "opened"), f"password.pdf: cancelling the prompt ends cleanly ({kind})")
    w.clean("PDF files")
    usable(page, "after hostile PDF files")
    page.close()


def t_ps(ctx, base, files, quick):
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    names = [n for n in files if n.startswith("ps-")] + [n for n in ("bad-truncated.eps",) if (FIX / n).exists()]
    slow = {"ps-loop.eps", "ps-recurse.eps", "ps-stack-flood.eps", "ps-dict-flood.eps"}
    for n in names:
        if quick and n in slow:
            continue
        p = files.get(n) or FIX / n
        kind, text, took = try_open(page, p, timeout=130000)
        check(kind != "hang", f"{n}: finished ({kind}, {took:.1f}s)")
        check(took < 100, f"{n}: stopped within the wall-clock budget ({took:.1f}s)")
        if kind == "dialog":
            friendly(text, n)
        else:
            doc = page.evaluate(DOC_AUDIT)
            check(not doc["bad"], f"{n}: values of the opened drawing are whitelisted ({doc['bad'][:3]})")
        check(settle(page, 5000), f"{n}: the progress overlay is gone")
        audit(page, n)
    w.clean("PostScript files")
    usable(page, "after hostile PostScript files")
    page.close()


def t_cdr(ctx, base, files):
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    cases = sorted(SAMPLES.glob("bad-*.cdr")) + [files[n] for n in files if n.startswith("cdr-")] + [files[n] for n in sorted(files) if n.startswith("mut-")]
    outcomes = {"opened": 0, "dialog": 0}
    for p in cases:
        kind, text, took = try_open(page, p, timeout=120000)
        check(kind != "hang", f"{p.name}: finished ({kind}, {took:.1f}s)")
        if kind == "hang":
            continue
        outcomes[kind] += 1
        if kind == "dialog":
            friendly(text, p.name)
        else:
            doc = page.evaluate(DOC_AUDIT)
            check(not doc["bad"], f"{p.name}: the opened drawing is whitelisted ({doc['bad'][:3]})")
        if not settle(page, 5000):
            check(False, f"{p.name}: the progress overlay is gone")
        if p.name.startswith("cdr-zip-bomb"):
            check(took < 60, f"{p.name}: the ZIP bomb was refused or handled quickly ({took:.1f}s)")
    print(f"   CDR corpus: {outcomes['opened']} opened (with notes or partial), {outcomes['dialog']} refused with a message")
    audit(page, "CDR files")
    w.clean("CDR files")
    usable(page, "after hostile CDR files")
    page.close()


def poison_js(kind):
    """JS source (run in the page) that returns a hostile autosave record."""
    base_root = "{ title: 'x', units: 'mm', uid: 'u', fonts: {}, pages: PAGES }"
    page_of = "(items) => ({ id: 1, name: 'P', w: 200, h: 200, layers: [{ id: 2, name: 'L', items }] })"
    rec = lambda root: "({ v: 1, savedAt: 1, title: 'poisoned', pages: 1, assetIds: [], root: " + root + " })"
    P = lambda items_js: base_root.replace("PAGES", "[(" + page_of + ")(" + items_js + ")]")
    path = "(d, extra = {}) => ({ t: 'path', d, fill: '#336699', ...extra })"
    kinds = {
        "proto": "JSON.parse('{\"v\":1,\"savedAt\":1,\"title\":\"p\",\"pages\":1,\"assetIds\":[\"__proto__\",\"constructor\"],\"__proto__\":{\"polluted\":1},\"root\":{\"__proto__\":{\"polluted\":2},\"constructor\":{\"prototype\":{\"polluted\":3}},\"title\":\"x\",\"units\":\"mm\",\"uid\":\"u\",\"fonts\":{\"__proto__\":{\"data\":null,\"polluted\":4},\"constructor\":{}},\"pages\":[{\"__proto__\":{\"polluted\":5},\"id\":1,\"name\":\"P\",\"w\":200,\"h\":200,\"layers\":[{\"id\":2,\"name\":\"L\",\"items\":[{\"__proto__\":{\"polluted\":6},\"t\":\"path\",\"d\":[[\"M\",0,0],[\"L\",9,9]],\"fill\":\"#112233\",\"gradient\":{\"__proto__\":{\"polluted\":7}}},{\"t\":\"text\",\"str\":\"a\",\"family\":\"__proto__\",\"font\":\"constructor\",\"fill\":\"#000000\",\"size\":10,\"m\":[1,0,0,1,0,0]}]}]}]}}')",
        "links": rec(P("[{ t: 'image', asset: 'javascript:alert(1)', href: 'javascript:alert(1)', w: 4, h: 4, m: [1,0,0,1,0,0] }, { t: 'image', asset: '../../x', href: 'http://evil.invalid/x.png', w: 4, h: 4, m: [1,0,0,1,0,0] }, { t: 'path', d: [['M',0,0],['L',5,5]], fill: 'url(javascript:alert(1))', stroke: 'red;background:url(https://evil.invalid/x)' }, { t: 'text', str: '<img src=x onerror=window.__pwned=1>', family: '\"};}body{background:url(https://evil.invalid/f)', fill: '#000000', size: 12, m: [1,0,0,1,10,10] }]")),
        "numbers": rec(P("[{ t: 'path', d: [['M', 1e999, -1e999], ['L', 5, 1e999], ['C', 1, 2, 3, 4, 5, 6], ['Z']], fill: '#336699', strokeWidth: 1e999, stroke: '#000000' }, { t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699', m: [1e999, 0, 0, 1e999, 1e999, 0] }, { t: 'text', str: 'x', family: 'Arial', size: 1e999, fill: '#000000', m: [1e999,0,0,1,0,0] }]").replace("w: 200, h: 200", "w: 1e999, h: 1e99")),
        "names": rec(P("[{ t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699', name: 'N'.repeat(10 * 1024 * 1024) }, { t: 'text', str: 'S'.repeat(5 * 1024 * 1024), family: 'F'.repeat(2 * 1024 * 1024), fill: '#000000', size: 10, m: [1,0,0,1,0,0], name: 'T'.repeat(3 * 1024 * 1024) }]").replace("name: 'P'", "name: 'Q'.repeat(10 * 1024 * 1024)")),
        "bigpath": rec(P("[{ t: 'path', d: [['M', 0, 0], ...Array.from({ length: 600000 }, (_, i) => ['L', i % 200, (i * 7) % 200])], fill: '#336699' }]")),
        "nodes": rec(P("Array.from({ length: 310000 }, (_, i) => ({ t: 'path', d: [['M', 0, 0], ['L', 1, 1]], fill: '#336699' }))")),
        "deep": rec(P("[(() => { let g = { t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }; for (let i = 0; i < 400; i++) g = { t: 'group', items: [g] }; return g })()]")),
        "pages": "({ v: 1, savedAt: 1, title: 'many', pages: 305, assetIds: [], root: { title: 'x', units: 'mm', uid: 'u', fonts: {}, pages: Array.from({ length: 305 }, (_, i) => ({ id: i + 1, name: 'P' + i, w: 100, h: 100, layers: [{ id: 1000 + i, name: 'L', items: [{ t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }] }] })) } })",
        "ids": rec(P("[{ id: 7, t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }, { id: 7, t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }, { id: -3, t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }, { id: 1.5, t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }, { id: 'x', t: 'path', d: [['M',0,0],['L',9,9]], fill: '#336699' }]")),
        "garbage": "[1, 2, 3]",
        "types": "({ v: 1, savedAt: 1, title: 5, pages: 'x', root: 'root', assetIds: {} })",
        "emptyroot": "({ v: 1, savedAt: 1, title: 'x', pages: 1, assetIds: [], root: { pages: [] } })",
    }
    return "() => " + kinds[kind]


def t_autosave(ctx, base):
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    failed = []
    page.on("requestfailed", lambda r: failed.append((r.url[:90], (r.failure or '')[:40])))
    budgets = {"proto": 3, "links": 3, "numbers": 3, "names": 15, "bigpath": 15, "nodes": 40, "deep": 15, "pages": 8, "ids": 3, "garbage": 3, "types": 3, "emptyroot": 3}
    for kind, budget in budgets.items():
        page.evaluate("async () => { const idb = await import('/lib/idb.js'); for (const k of await idb.keys('ds:autosave:')) await idb.del(k) }")
        ok = page.evaluate("async (src) => { const idb = await import('/lib/idb.js'); const rec = (0, eval)(src)(); return await idb.set('ds:autosave:doc', rec) }", poison_js(kind))
        if not ok:
            print(f"   {kind}: the record could not even be written to IndexedDB (too big for this machine), skipped")
            continue
        t_reload = time.time()
        page.reload()
        try:
            B.wait_ds(page)
        except Exception:
            print(f"   autosave {kind}: the editor did not mount within 30 s after reload ({time.time() - t_reload:.0f}s); page says {page.inner_text('body')[:160]!r}; errors {errors[-3:]}; failed requests {failed[-4:]}")
            raise
        page.wait_for_timeout(300)
        t0 = time.time()
        banner = page.locator(".ds-restore")
        try:
            page.wait_for_function("() => document.querySelector('.ds-restore') || document.querySelector('.toast')", timeout=int(budget * 1000))
        except Exception:
            pass
        shown = banner.count() > 0
        if shown:
            txt = banner.inner_text()
            check(page.locator(".ds-restore img, .ds-restore script").count() == 0, f"autosave {kind}: the banner shows the title as text ({txt[:60]!r})")
            page.get_by_role("button", name="Restore").click()
            try:
                page.wait_for_function("() => { const ds = document.querySelector('.tool-body').__ds; return ds.store.root.meta.source !== 'new' || ds.store.root.pages.length > 1 || ds.store.root.pages[0].layers.some((l) => l.items.length) || document.querySelector('.toast') }", timeout=int(budget * 1000))
            except Exception:
                check(False, f"autosave {kind}: restore finished within {budget}s")
            took = time.time() - t0
            check(took <= budget, f"autosave {kind}: restore ends within {budget}s ({took:.1f}s)")
            page.wait_for_timeout(300)
            check(settle(page, 5000), f"autosave {kind}: the progress overlay is gone")
            doc = page.evaluate(DOC_AUDIT)
            check(not doc["bad"], f"autosave {kind}: every restored value is whitelisted ({doc['bad'][:4]}; {doc['nodes']} objects, {doc['pages']} pages)")
            if kind == "pages":
                check(doc["pages"] <= 300, f"autosave pages: trimmed to the 300 page limit ({doc['pages']})")
            if kind == "nodes":
                check(doc["nodes"] <= 300000, f"autosave nodes: never above the 300,000 object limit ({doc['nodes']})")
            if kind == "deep":
                check(not any("depth" in b for b in doc["bad"]), "autosave deep: nesting is cut at 40 levels")
        else:
            print(f"   autosave {kind}: no restore offered (the record was rejected on peek)")
            check(time.time() - t0 <= budget + 1, f"autosave {kind}: rejected within the budget ({time.time() - t0:.1f}s)")
        audit(page, f"autosave {kind}")
        left = page.evaluate("async () => { const idb = await import('/lib/idb.js'); return (await idb.keys('ds:autosave:')).length }")
        print(f"   autosave {kind}: record left in storage: {left}")
    w.clean("poisoned autosave records")
    page.evaluate("async () => { const idb = await import('/lib/idb.js'); for (const k of await idb.keys('ds:autosave:')) await idb.del(k) }")
    usable(page, "after poisoned autosave records")
    page.close()


def t_limits(ctx, base, files):
    page, errors = mount(ctx, base)
    w = Watch(page, errors)
    # more than 20 files in one drop: only the first 20 are taken
    many = []
    for i in range(24):
        p = OUT / f"many-{i}.svg"
        p.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="{10 + i}" height="10" fill="#336699"/></svg>', encoding="utf8")
        many.append(str(p))
    page.set_input_files(".t-ds input[type=file]", many)
    try:
        page.wait_for_function("() => { const ds = document.querySelector('.tool-body').__ds; return ds.store.root.pages.length >= 2 && document.querySelector('.ds-busy').hidden }", timeout=90000)
    except Exception:
        pass
    page.wait_for_timeout(500)
    n = page.evaluate("() => document.querySelector('.tool-body').__ds.store.root.pages.length")
    check(1 <= n <= 20, f"24 files at once: at most 20 are taken ({n} page(s))")
    # a file over 250 MB is refused before it is read
    big = OUT / "toobig.pdf"
    with open(big, "wb") as f:
        f.write(b"%PDF-1.4\n")
        f.seek(260 * 1024 * 1024)
        f.write(b"\0")
    kind, text, took = try_open(page, big, timeout=60000)
    check(kind == "dialog" and "250 MB" in (text or ""), f"a file over 250 MB is refused with a message ({kind}, {(text or '')[:70]!r}, {took:.1f}s)")
    big.unlink(missing_ok=True)
    # an empty file and a file of the wrong type
    (OUT / "empty.cdr").write_bytes(b"")
    kind, text, _ = try_open(page, OUT / "empty.cdr", timeout=30000)
    check(kind == "dialog" and len(text or "") > 20, f"an empty file gives a message ({kind}, {(text or '')[:60]!r})")
    (OUT / "notes.txt").write_text("hello", encoding="utf8")
    kind, text, _ = try_open(page, OUT / "notes.txt", timeout=30000)
    check(kind == "dialog" and "not recognised" in (text or ""), f"a text file gives the not-recognised message ({(text or '')[:60]!r})")
    w.clean("limits")
    usable(page, "after the limit checks")
    page.close()


def t_static():
    """No file-derived string reaches markup: scan the sources for every HTML sink."""
    sinks = re.compile(r"innerHTML|insertAdjacentHTML|outerHTML|document\.write|\{\s*html\s*:|srcdoc|\beval\s*\(|new Function\s*\(|setAttribute\(\s*['\"]on|\.setHTML|DOMParser\(\)\.parseFromString\([^)]*text/html")
    hits = []
    for p in sorted((REPO / "packs/corel").glob("*.js")):
        if not (p.name.startswith("_ds-") or p.name in ("draw-studio.js", "_tree.js")):
            continue
        for i, line in enumerate(p.read_text(encoding="utf8").splitlines(), 1):
            code = line.split("//")[0]
            if sinks.search(code):
                hits.append(f"{p.name}:{i}: {line.strip()[:100]}")
    check(not hits, f"no HTML sink (innerHTML, insertAdjacentHTML, srcdoc, eval ...) in the editor sources {hits[:4]}")
    cdn = re.compile(r"https?://[^'\"` )]+")
    urls = set()
    for p in sorted((REPO / "packs/corel").glob("_ds-*.js")) + [REPO / "packs/corel/draw-studio.js"]:
        urls.update(cdn.findall("\n".join(l.split("//")[0] if "http" not in l.split("//")[0] else l for l in p.read_text(encoding="utf8").splitlines() if not l.strip().startswith("//"))))
    odd = [u for u in urls if not any(h in u for h in ALLOWED_HOSTS) and "w3.org" not in u]
    check(not odd, f"every URL in the editor sources is a pinned CDN or a namespace {odd[:3]}")
    unpinned = [u for u in urls if re.search(r"/(npm|gh)/[^@/]+/", u) and "@" not in u]
    check(not unpinned, f"every CDN URL names an exact version {unpinned[:3]}")


GROUPS = ("static", "svg", "paste", "pdf", "cdr", "ps", "autosave", "limits")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    names = [g for g in GROUPS if not a.only or g in a.only.split(",")]
    files = gen_files()
    base = B.serve_ds()
    profile = f"dssec-{os.getpid()}"
    with launch(profile) as ctx:
        for g in names:
            print(f"== {g}")
            t0 = time.time()
            try:
                if g == "static": t_static()
                elif g == "svg": t_svg(ctx, base, files)
                elif g == "paste": t_paste(ctx, base, files)
                elif g == "pdf": t_pdf(ctx, base, files)
                elif g == "cdr": t_cdr(ctx, base, files)
                elif g == "ps": t_ps(ctx, base, files, a.quick)
                elif g == "autosave": t_autosave(ctx, base)
                elif g == "limits": t_limits(ctx, base, files)
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
