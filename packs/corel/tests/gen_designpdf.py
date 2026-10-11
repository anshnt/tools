"""Fixture generator for Draw Studio. Nothing is downloaded: every file is made here from scratch.

    uv run --with reportlab --with pillow --with numpy --with pypdf python gen_designpdf.py [OUT_DIR] [--only name,name]

OUT_DIR defaults to C:/Projects/tools-packs/draw-studio-tests (outside the repo, never committed). Writes:
  designtool-3p.pdf / designtool-3p.ai   3 A4 pages, 12 JPEG photos (about 15 MB), rounded clips, linear + radial gradient,
                                         embedded TrueType subsets (Latin, one Devanagari line), rotated text, multi-line block
  password.pdf                           small PDF with the user password "secret"
  legacy.ai, tiny.eps, multi.eps         hand-written PostScript (path operators, a Creator comment, DOS EPS header variant)
  evil.svg, big.svg                      hostile SVG (script, handlers, remote image, foreignObject) and a 30k-path SVG
  exif-rotated.jpg                       JPEG with orientation 6
  bad-truncated.pdf, bad-js.pdf, bad-huge.pdf, bad-truncated.eps   hostile or damaged inputs
Fixture text is neutral on purpose (no personal text). The user's own invitation file is never copied or quoted here.
"""
import io, math, random, struct, sys
from pathlib import Path

FONTS = Path("C:/Windows/Fonts")
OUT = Path("C:/Projects/tools-packs/draw-studio-tests")
A4 = (595.28, 841.89)


def photo(i, w=2400, h=1800):
    """A smooth, photo-like picture: colour gradients plus blobs plus fine noise so the JPEG is big."""
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(1000 + i)
    yy, xx = np.mgrid[0:h, 0:w].astype("float32")
    u, v = xx / w, yy / h
    base = np.stack([
        120 + 110 * np.sin(2 * math.pi * (u * (1 + i % 3) + 0.1 * i)),
        120 + 110 * np.sin(2 * math.pi * (v * (1 + i % 4) + 0.2 * i) + 1.0),
        120 + 110 * np.sin(2 * math.pi * ((u + v) * 1.5 + 0.05 * i) + 2.0)], axis=-1)
    for _ in range(14):
        cx, cy, r = rng.random() * w, rng.random() * h, 120 + rng.random() * 380
        m = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r)))[..., None]
        base = base * (1 - 0.5 * m) + (rng.random(3) * 255) * 0.5 * m
    base += rng.normal(0, 5.0, base.shape)
    img = Image.fromarray(np.clip(base, 0, 255).astype("uint8"), "RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=95, subsampling=2)
    return buf.getvalue()


def make_designpdf(out):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.utils import ImageReader
    pdfmetrics.registerFont(TTFont("SegoeUI", str(FONTS / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUIBold", str(FONTS / "segoeuib.ttf")))
    pdfmetrics.registerFont(TTFont("ArialTT", str(FONTS / "arial.ttf")))
    pdfmetrics.registerFont(TTFont("Nirmala", str(FONTS / "Nirmala.ttc"), subfontIndex=0))
    pdf = out / "designtool-3p.pdf"
    c = canvas.Canvas(str(pdf), pagesize=A4, pageCompression=1)
    c.setTitle("Draw Studio fixture")
    W, H = A4
    k = 0

    def rounded_photo(x, y, w, h, r=18):
        nonlocal k
        data = photo(k)
        k += 1
        c.saveState()
        p = c.beginPath()
        p.roundRect(x, y, w, h, r)
        c.clipPath(p, stroke=0, fill=0)
        c.drawImage(ImageReader(io.BytesIO(data)), x, y, w, h)
        c.restoreState()
        c.setStrokeColorRGB(0.1, 0.1, 0.1)
        c.setLineWidth(1)
        c.roundRect(x, y, w, h, r, stroke=1, fill=0)

    def banner(y, h, c0, c1):
        c.saveState()
        p = c.beginPath()
        p.rect(0, y, W, h)
        c.clipPath(p, stroke=0, fill=0)
        c.linearGradient(0, y, W, y + h, (c0, c1), (0, 1))
        c.restoreState()

    # page 1: gradients, Latin + Devanagari text, rotated text, 4 photos
    banner(H - 120, 120, (0.09, 0.2, 0.6), (0.85, 0.2, 0.5))
    c.setFillColorRGB(1, 1, 1)
    c.setFont("SegoeUIBold", 34)
    c.drawString(36, H - 62, "Draw Studio fixture")
    c.setFont("SegoeUI", 14)
    c.drawString(36, H - 90, "Page one: photos, clips, gradients and embedded fonts")
    c.saveState()
    p = c.beginPath()
    p.circle(W - 90, H - 200, 52)
    c.clipPath(p, stroke=0, fill=0)
    c.radialGradient(W - 90, H - 200, 52, ((1, 0.9, 0.3), (0.9, 0.3, 0.1)), (0, 1))
    c.restoreState()
    c.setFillColorRGB(0.1, 0.1, 0.12)
    c.setFont("Nirmala", 22)
    c.drawString(36, H - 190, "\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u0941\u0928\u093f\u092f\u093e")
    c.saveState()
    c.translate(36, H - 235)
    c.rotate(12)
    c.setFont("ArialTT", 16)
    c.setFillColorRGB(0.6, 0.1, 0.1)
    c.drawString(0, 0, "Rotated label at twelve degrees")
    c.restoreState()
    for n, (x, y) in enumerate([(36, 330), (306, 330), (36, 60), (306, 60)]):
        rounded_photo(x, y, 252, 190)
    c.showPage()

    # page 2: multi-line block, 4 photos
    c.setFillColorRGB(0.1, 0.1, 0.12)
    c.setFont("SegoeUIBold", 26)
    c.drawString(36, H - 60, "Page two")
    c.setFont("ArialTT", 12)
    t = c.beginText(36, H - 96)
    t.setLeading(17)
    for line in ["A multi-line text block set in Arial.", "Second line of the block, a little longer than the first one.",
                 "Third line.", "Fourth line with numbers 0123456789 and symbols & % #."]:
        t.textLine(line)
    c.drawText(t)
    for x, y in [(36, 380), (306, 380), (36, 130), (306, 130)]:
        rounded_photo(x, y, 252, 190, 34)
    c.setFillColorRGB(0.4, 0.4, 0.45)
    c.setFont("SegoeUI", 10)
    c.drawString(36, 60, "Footer text on page two")
    c.showPage()

    # page 3: 4 photos (2 clipped to a circle), small vector shapes
    c.setFont("SegoeUIBold", 26)
    c.setFillColorRGB(0.1, 0.1, 0.12)
    c.drawString(36, H - 60, "Page three")
    for x, y in [(36, 440), (306, 440)]:
        rounded_photo(x, y, 252, 252, 126)
    for x, y in [(36, 130), (306, 130)]:
        rounded_photo(x, y, 252, 190, 6)
    c.setFillColorRGB(0.1, 0.5, 0.3)
    c.setStrokeColorRGB(0, 0, 0)
    c.setDash(6, 3)
    c.rect(36, 60, 120, 40, stroke=1, fill=1)
    c.setDash()
    c.setFillColorRGB(0.9, 0.5, 0.1)
    c.circle(250, 80, 20, stroke=0, fill=1)
    c.showPage()
    c.save()
    (out / "designtool-3p.ai").write_bytes(pdf.read_bytes())
    return pdf


def make_password_pdf(out):
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader, PdfWriter
    tmp = out / "_plain.pdf"
    c = canvas.Canvas(str(tmp), pagesize=A4)
    c.setFont("Helvetica", 24)
    c.drawString(72, 700, "Secret page")
    c.rect(72, 500, 200, 100, stroke=1, fill=0)
    c.save()
    w = PdfWriter(clone_from=PdfReader(str(tmp)))
    w.encrypt("secret", "owner")
    with open(out / "password.pdf", "wb") as f:
        w.write(f)
    tmp.unlink()


LEGACY = """%!PS-Adobe-3.0
%%Creator: legacy vector editor 8.0
%%Title: legacy.ai
%%BoundingBox: 0 0 300 200
%%HiResBoundingBox: 0 0 300 200
%%EndComments
%%BeginSetup
%%EndSetup
0 0 0 0 k
20 20 m 280 20 l 280 180 l 20 180 l h f
0.1 0.6 0.9 0 k
60 60 m 60 140 120 160 150 160 c 200 160 240 120 240 100 c 240 60 l f
0 0 0 1 K
3 w 1 j 1 J
[6 3] 0 d
30 30 m 270 170 l S
%%EOF
"""

TINY_EPS = """%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 100 100
%%Title: tiny.eps
%%EndComments
0.9 0.2 0.2 setrgbcolor
10 10 moveto 90 10 lineto 90 90 lineto 10 90 lineto closepath fill
0 0.4 0.8 setrgbcolor
2 setlinewidth
50 50 30 0 360 arc stroke
showpage
%%EOF
"""

MULTI_EPS = """%!PS-Adobe-3.0
%%Pages: 2
%%BoundingBox: 0 0 200 100
%%EndComments
%%Page: 1 1
0 0.5 0 setrgbcolor
10 10 moveto 190 10 lineto 190 90 lineto 10 90 lineto closepath fill
showpage
%%Page: 2 2
0.5 0 0.5 setrgbcolor
20 20 moveto 100 90 lineto 180 20 lineto closepath fill
showpage
%%EOF
"""

EVIL_SVG = """<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="120" viewBox="0 0 200 120" onload="window.__pwned=1">
<script>window.__pwned = 1; alert(1)</script>
<g id="&lt;img src=x onerror=alert(1)&gt;" onclick="alert(2)">
<rect x="10" y="10" width="80" height="50" fill="red;background:url(https://evil.invalid/x)" onmouseover="alert(3)"/>
<rect x="100" y="10" width="80" height="50" fill="#2266cc" style="fill:url(https://evil.invalid/p)"/>
<image href="https://evil.invalid/steal.png" x="10" y="70" width="40" height="40"/>
<foreignObject x="0" y="0" width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(4)"/></div></foreignObject>
<text x="60" y="100" font-family="Arial&quot;;}body{background:red" fill="#000">&lt;b&gt;label&lt;/b&gt;</text>
</g>
</svg>
"""


def big_svg(n=30000):
    rnd = random.Random(7)
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">']
    for i in range(n):
        x, y, s = rnd.random() * 980, rnd.random() * 980, 2 + rnd.random() * 18
        parts.append(f'<path d="M{x:.1f} {y:.1f}h{s:.1f}v{s:.1f}h-{s:.1f}z" fill="#{rnd.randrange(0x1000000):06x}"/>')
    parts.append("</svg>")
    return "\n".join(parts)


def exif_jpg(out):
    from PIL import Image
    img = Image.new("RGB", (300, 200))
    px = img.load()
    for y in range(200):
        for x in range(300):
            px[x, y] = (x * 255 // 300, y * 255 // 200, 128)
    ex = Image.Exif()
    ex[0x0112] = 6
    img.save(out / "exif-rotated.jpg", "JPEG", quality=90, exif=ex)


def hostile(out, pdf):
    data = pdf.read_bytes()
    (out / "bad-truncated.pdf").write_bytes(data[: int(len(data) * 0.6)])
    js = b"%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n4 0 obj<</S/JavaScript/JS(app.alert\\(1\\))>>endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n"
    (out / "bad-js.pdf").write_bytes(js)
    huge = b"%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length 1073741824>>stream\nq Q\nendstream endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n"
    (out / "bad-huge.pdf").write_bytes(huge)
    (out / "bad-truncated.eps").write_bytes(TINY_EPS.encode()[:90])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
        args = [a for a in args if a not in only]
    out = Path(args[0]) if args else OUT
    out.mkdir(parents=True, exist_ok=True)
    want = lambda n: only is None or n in only
    if want("pdf"):
        pdf = make_designpdf(out)
        print("designtool-3p.pdf", round(pdf.stat().st_size / 1e6, 1), "MB")
    pdf = out / "designtool-3p.pdf"
    if want("password"):
        make_password_pdf(out)
    if want("ps"):
        (out / "legacy.ai").write_text(LEGACY)
        (out / "tiny.eps").write_text(TINY_EPS)
        (out / "multi.eps").write_text(MULTI_EPS)
    if want("svg"):
        (out / "evil.svg").write_text(EVIL_SVG)
        (out / "big.svg").write_text(big_svg())
    if want("jpg"):
        exif_jpg(out)
    if want("bad") and pdf.exists():
        hostile(out, pdf)
    print("wrote fixtures to", out)


if __name__ == "__main__":
    main()
