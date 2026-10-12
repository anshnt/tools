"""Generate the PDF import test fixture (no downloads, fonts come from this machine).

    uv run --with reportlab --with pillow --with pypdf python packs/corel/tests/pdfin_fixture.py OUT_DIR

Writes OUT_DIR/pdfin-fixture.pdf and OUT_DIR/pdfin-truth.json (what the browser test checks).
Three pages (A4):
  1  embedded TrueType fonts (Latin, bold, italic, mono, Devanagari), char and word spacing, horizontal scaling, rise, rotated text, stroke text,
     invisible text, opacity, clips, linear and radial gradients, JPEG photos (RGB, grey, progressive, CMYK, EXIF rotated), PNG with alpha,
     a stencil image mask (XObject), inline image and inline stencil mask, a non-embedded standard font
  2  one JPEG drawn three times, text lines in several fonts, a clipped photo
  3  a page with /Rotate 90 (a landscape MediaBox shown portrait) and text
"""
import io, json, os, random, struct, sys
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color
from reportlab import rl_config

rl_config.useA85 = 0  # keep DCTDecode as the only filter so the importer can pass the JPEG bytes through

FONTS = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
out.mkdir(parents=True, exist_ok=True)
W, H = A4


def reg(name, file, **kw):
    pdfmetrics.registerFont(TTFont(name, str(FONTS / file), **kw))


reg("Arial", "arial.ttf"); reg("Arial-Bold", "arialbd.ttf"); reg("Georgia-Italic", "georgiai.ttf"); reg("Consolas", "consola.ttf"); reg("Calibri", "calibri.ttf")
reg("Nirmala", "Nirmala.ttc", subfontIndex=0)


def photo(w, h, seed, mode="RGB"):
    random.seed(seed)
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 255 // w + random.randint(0, 20)) % 256, (y * 255 // h + random.randint(0, 20)) % 256, ((x + y) * 255 // (w + h) + random.randint(0, 20)) % 256)
    return im.convert(mode)


def jpeg_file(name, im, **kw):
    p = out / name
    im.save(p, "JPEG", quality=90, **kw)
    return p


jpg_rgb = jpeg_file("_rgb.jpg", photo(640, 480, 1))
jpg_gray = jpeg_file("_gray.jpg", photo(320, 240, 2, "L"))
jpg_prog = jpeg_file("_prog.jpg", photo(400, 300, 3), progressive=True)
jpg_cmyk = jpeg_file("_cmyk.jpg", photo(200, 150, 4, "CMYK"))
exif = Image.Exif(); exif[0x0112] = 6
jpg_exif = jpeg_file("_exif.jpg", photo(300, 200, 5), exif=exif)
alpha = Image.new("RGBA", (240, 240))
ap = alpha.load()
for y in range(240):
    for x in range(240):
        d = ((x - 120) ** 2 + (y - 120) ** 2) ** 0.5
        ap[x, y] = (230, 60 + x // 2, 90, max(0, min(255, int(255 * (1 - d / 120)))))
png_alpha = out / "_alpha.png"
alpha.save(png_alpha)

pdf_path = out / "_base.pdf"
c = canvas.Canvas(str(pdf_path), pagesize=A4, pageCompression=1)
c.setTitle("pdfin fixture")


def rounded_clip(x, y, w, h, r=18):
    p = c.beginPath(); p.roundRect(x, y, w, h, r); c.clipPath(p, stroke=0, fill=0)


# ---------------- page 1 ----------------
c.setFillColorRGB(0.96, 0.95, 0.9); c.rect(0, 0, W, H, stroke=0, fill=1)
c.saveState(); rounded_clip(30, H - 260, 250, 190); c.linearGradient(30, H - 260, 280, H - 70, (Color(0.9, 0.3, 0.2), Color(0.2, 0.3, 0.9))); c.restoreState()
c.saveState(); rounded_clip(300, H - 260, 250, 190); c.radialGradient(425, H - 165, 110, (Color(1, 1, 0.6), Color(0.1, 0.5, 0.3))); c.restoreState()
c.saveState(); rounded_clip(40, H - 250, 110, 80); c.drawImage(str(jpg_rgb), 40, H - 250, 110, 80); c.restoreState()      # clipped photo, DCT pass-through
c.drawImage(str(jpg_gray), 160, H - 250, 100, 75)                                                                         # grey DCT
c.drawImage(str(jpg_prog), 40, H - 335, 100, 75)                                                                          # progressive DCT
c.drawImage(str(jpg_cmyk), 150, H - 335, 100, 75)                                                                         # CMYK: decoded path
c.drawImage(str(jpg_exif), 260, H - 335, 100, 66)                                                                         # EXIF tag: must not rotate
c.drawImage(str(png_alpha), 310, H - 250, 120, 120, mask="auto")                                                         # PNG with soft mask
c.drawImage(str(png_alpha), 440, H - 250, 100, 100, mask="auto")

y = H - 380
c.setFillColorRGB(0.1, 0.1, 0.1)
c.setFont("Arial", 18); c.drawString(40, y, "Plain Latin text with Arial 18")
t = c.beginText(40, y - 28); t.setFont("Georgia-Italic", 16); t.setCharSpace(2); t.setFillColorRGB(0.5, 0.1, 0.1); t.textOut("Char spacing two points"); c.drawText(t)
t = c.beginText(40, y - 54); t.setFont("Arial-Bold", 14); t.setWordSpace(14); t.setFillColorRGB(0.1, 0.3, 0.1); t.textOut("Word spacing on a bold line"); c.drawText(t)
t = c.beginText(40, y - 80); t.setFont("Consolas", 14); t.setHorizScale(80); t.textOut("Horizontal scale eighty percent"); c.drawText(t)
t = c.beginText(40, y - 106); t.setFont("Calibri", 16); t.textOut("Rise: "); t.setRise(6); t.textOut("up"); t.setRise(-4); t.textOut("down"); t.setRise(0); t.textOut(" back"); c.drawText(t)
t = c.beginText(40, y - 132); t.setFont("Arial-Bold", 30); t.setTextRenderMode(1); t.setStrokeColorRGB(0.1, 0.2, 0.7); t.textOut("Stroke"); t.setTextRenderMode(2); t.setFillColorRGB(0.9, 0.8, 0.2); t.textOut(" Both"); t.setTextRenderMode(3); t.textOut(" HIDDEN"); t.setTextRenderMode(0); c.drawText(t)  # the render mode outlives the text object, so reset it
c.setFillColorRGB(0.1, 0.1, 0.1)
c.setFont("Nirmala", 20); c.drawString(300, y, "\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u0941\u0928\u093f\u092f\u093e")                      # Devanagari (code points, no shaping engine here)
c.setFont("Arial", 12); c.drawString(300, y - 20, "Caf\u00e9 na\u00efve \u00e9l\u00e8ve \u2014 accents")
c.saveState(); c.translate(330, y - 120); c.rotate(30); c.setFont("Georgia-Italic", 18); c.setFillColorRGB(0.2, 0.2, 0.6); c.drawString(0, 0, "Rotated thirty degrees"); c.restoreState()
c.saveState(); c.setFillAlpha(0.5); c.setFont("Arial-Bold", 26); c.setFillColorRGB(0.8, 0.1, 0.1); c.drawString(40, y - 175, "Half opacity text"); c.restoreState()
c.saveState(); p = c.beginPath(); p.rect(300, y - 215, 120, 22); c.clipPath(p, stroke=0, fill=0); c.setFont("Arial", 22); c.drawString(300, y - 210, "Clipped text line"); c.restoreState()
c.setFont("Helvetica", 14); c.drawString(40, y - 210, "Standard font, not embedded")
# stencil mask (XObject, added after the fact), inline image and inline stencil mask
c.saveState(); c.setFillColorRGB(0.7, 0.1, 0.5); c.translate(440, y - 70); c.scale(70, 70); c._code.append("/StencilA Do"); c.restoreState()
c.saveState(); c.translate(520, y - 70); c.scale(40, 40)
hexrgb = "".join("%02x%02x%02x" % ((i * 60) % 256, (j * 60) % 256, ((i + j) * 30) % 256) for j in range(4) for i in range(4))
c._code.append("BI /W 4 /H 4 /BPC 8 /CS /RGB /F /AHx ID %s > EI" % hexrgb); c.restoreState()
c.saveState(); c.setFillColorRGB(0.1, 0.5, 0.2); c.translate(440, y - 150); c.scale(40, 40)
c._code.append("BI /W 8 /H 8 /BPC 1 /IM true /F /AHx ID aa55aa55aa55aa55 > EI"); c.restoreState()
c.showPage()

# ---------------- page 2 ----------------
for k in range(3):
    c.drawImage(str(jpg_rgb), 40 + k * 180, H - 160, 160, 120)
c.saveState(); rounded_clip(40, H - 330, 300, 140, 30); c.drawImage(str(jpg_rgb), 40, H - 330, 300, 140); c.restoreState()
c.setFillColorRGB(0, 0, 0)
for i, (f, s) in enumerate((("Arial", 14), ("Georgia-Italic", 14), ("Consolas", 12), ("Calibri", 15), ("Arial-Bold", 13))):
    c.setFont(f, s); c.drawString(40, H - 380 - i * 22, "Line %d in %s, a sentence long enough to span words" % (i + 1, f))
c.showPage()

# ---------------- page 3: rotated page ----------------
c.setPageRotation(90)
c.setFont("Arial-Bold", 24); c.drawString(60, H - 100, "Rotated page text"); c.setFont("Arial", 12); c.drawString(60, H - 130, "Second line on the rotated page")
c.drawImage(str(jpg_rgb), 60, H - 330, 200, 150)
c.showPage()
c.save()

# stencil image mask XObject (1 bit, bit 0 paints): a ring
from pypdf import PdfReader, PdfWriter
from pypdf.generic import BooleanObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject

rows = []
for yy in range(32):
    bits = 0
    for xx in range(32):
        d = ((xx - 15.5) ** 2 + (yy - 15.5) ** 2) ** 0.5
        bits = (bits << 1) | (0 if 7 <= d <= 15 else 1)
    rows.append(struct.pack(">I", bits))
r = PdfReader(str(pdf_path)); w = PdfWriter(clone_from=r)
st = DecodedStreamObject(); st.set_data(b"".join(rows))
st.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"), NameObject("/Width"): NumberObject(32), NameObject("/Height"): NumberObject(32),
           NameObject("/ImageMask"): BooleanObject(True), NameObject("/BitsPerComponent"): NumberObject(1)})
ref = w._add_object(st)
res = w.pages[0]["/Resources"]
xo = res.get("/XObject")
if xo is None:
    xo = DictionaryObject(); res[NameObject("/XObject")] = xo
else:
    xo = xo.get_object()
xo[NameObject("/StencilA")] = ref
with open(out / "pdfin-fixture.pdf", "wb") as f:
    w.write(f)
pdf_path.unlink()
for p in (jpg_rgb, jpg_gray, jpg_prog, jpg_cmyk, jpg_exif, png_alpha):
    p.unlink()

truth = {
    "pages": 3,
    "fonts_min": 5,
    "dct_passthrough_expected": ["rgb", "gray", "progressive"],  # on page 1 (rgb is drawn twice with a clip on one); CMYK and EXIF go through the decoded path
    "strings": ["Plain Latin text with Arial 18", "Char spacing two points", "Word spacing on a bold line", "Horizontal scale eighty percent", "Rotated thirty degrees", "Half opacity text", "Standard font, not embedded"],
    "invisible": "HIDDEN",
}
(out / "pdfin-truth.json").write_text(json.dumps(truth, indent=1))
print("wrote", out / "pdfin-fixture.pdf", (out / "pdfin-fixture.pdf").stat().st_size, "bytes")
