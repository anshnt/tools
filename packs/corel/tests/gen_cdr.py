"""Synthetic CorelDRAW (.cdr) generator, written from the public description of the format.
It exists so the CDR viewer can be tested without any real CorelDRAW file:
every layout here follows the spec, but real files written by CorelDRAW were NOT available, so passing these tests shows the
reader agrees with the spec, not that it handles every real file.

    python gen_cdr.py OUT_DIR          writes scene files for versions 7, 9, 10, 12, X3 (RIFF), X4, X5 (ZIP), X6 (ZIP, external streams),
                                       compressed variants, damaged variants, plus a manifest.json and ground-truth SVGs.
"""
import json, math, struct, sys, zlib, zipfile, io
from pathlib import Path

INCH = 254000
u16 = lambda v: struct.pack("<H", v)
u32 = lambda v: struct.pack("<I", v & 0xFFFFFFFF)
s32 = lambda v: struct.pack("<i", int(round(v)))
f64 = lambda v: struct.pack("<d", v)
coord = lambda inches: s32(inches * INCH)
pad = lambda b: b + (b"\0" if len(b) & 1 else b"")


def chunk(cid, body):
    assert len(cid) == 4
    return cid.encode() + u32(len(body)) + pad(body)


def lst(form, children):
    return chunk("LIST", form.encode() + b"".join(children))


# ---------- matrices (a, b, c, d, tx, ty): x' = a x + c y + tx ----------
def mmul(m, n):
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
def mrot(deg): r = math.radians(deg); return [math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0, 0]
def mtr(x, y): return [1, 0, 0, 1, x, y]
def mapp(m, x, y): return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
I = [1, 0, 0, 1, 0, 0]


def bgr_color(hexstr, v):
    h = hexstr.lstrip("#"); r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return u16(5) + u16(5) + b"\0" * 4 + bytes([b, g, r, 0])  # model bgr, palette user


def cmyk_color(c, m, y, k):
    return u16(2) + u16(5) + b"\0" * 4 + bytes([c, m, y, k])  # model cmyk100


class Gen:
    def __init__(self, version, compress=False, container="riff"):
        self.v = version
        self.compress = compress
        self.container = container
        self.fills = {}
        self.outls = {}
        self.fonts = {}
        self.bitmaps = {}
        self.next_id = 100
        self.truth_defs = []

    # ----- tables -----
    def new_id(self):
        self.next_id += 1
        return self.next_id

    def fild(self, fill):
        """fill: '#rrggbb' | ('cmyk', c, m, y, k) | {'grad': [(offset, color)...], 'angle': deg, 'kind': 'linear'|'radial'} | None"""
        if fill is None:
            return 0
        key = json.dumps(fill, sort_keys=True)
        if key in self.fills:
            return self.fills[key][0]
        fid = self.new_id()
        v = self.v
        if isinstance(fill, dict):
            body = self._gradient(fill)
            ftype = 2
        else:
            col = cmyk_color(*fill[1:]) if isinstance(fill, tuple) else bgr_color(fill, v)
            ftype = 1
            if v < 1300:
                body = b"\0\0" + col + u16(0) + (b"\0\0" if v >= 600 else b"") + u32(0) + s32(45e6) + u32(60)
            else:
                props = bytes([1]) + u32(12) + col + bytes([0]) + u32(0)
                body = u32(1300) + u32(len(props)) + props + u16(0) + b"\0\0" + u32(0) + s32(45e6) + u32(60)
        if v >= 1300:
            data = u32(fid) + u32(1300) + u32(2 + len(body)) + u16(ftype) + body
        else:
            data = u32(fid) + u16(ftype) + body
        self.fills[key] = (fid, chunk("fild", data))
        return fid

    def _gradient(self, g):
        v = self.v
        stops = g["grad"]
        b = b"\0" * (8 if v >= 1300 else 2)
        b += bytes([2 if g.get("kind") == "radial" else 1])
        b += b"\0" * (17 if v >= 1300 else 19 if v >= 600 else 11)
        b += s32(0) if 600 <= v < 1300 else s32(0)[:2]
        b += s32(g.get("angle", 0) * 1e6) + s32(0) + s32(0)
        if v >= 600:
            b += b"\0\0"
        b += u32(0) + bytes([50, 0]) + u32(len(stops))
        if v >= 1300:
            b += b"\0" * 3
        for off, col in stops:
            b += bgr_color(col, v) + b"\0" * (26 if v >= 1500 else 5 if v >= 1300 else 0) + u32(int(round(off * 10000)))
            if v >= 1300:
                b += b"\0" * 3
        if v >= 1300:
            b += b"\0" * 3
        return b

    def outl(self, line):
        """line: None (no outline) | {'w': inches, 'color': '#hex', 'dash': [..], 'cap': 0-2, 'join': 0-2}"""
        if line is None:
            line = {"none": True, "w": 0, "color": "#000000"}
        key = json.dumps(line, sort_keys=True)
        if key in self.outls:
            return self.outls[key][0]
        oid = self.new_id()
        v = self.v
        dash = line.get("dash") or []
        ltype = (1 if line.get("none") else 0) | (2 if dash else 0)
        b = u32(oid)
        if v >= 1300:
            b += u32(1) + u32(0)
        b += u16(ltype) + u16(line.get("cap", 0)) + u16(line.get("join", 0))
        if 600 <= v < 1300:
            b += b"\0\0"
        b += coord(line.get("w", 0)) + u16(100)
        if v >= 600:
            b += b"\0\0"
        b += s32(0)
        b += b"\0" * (46 if v >= 1300 else 52 if v >= 600 else 0)
        b += bgr_color(line.get("color", "#000000"), v)
        b += b"\0" * (16 if v >= 600 else 10)
        b += u16(len(dash))
        area = b"".join(u16(d) for d in dash).ljust(22 if v >= 600 else 20, b"\0")
        b += area + u32(0) + u32(0)
        self.outls[key] = (oid, chunk("outl", b))
        return oid

    def font(self, name):
        if name in self.fonts:
            return self.fonts[name][0]
        fid = len(self.fonts) + 1
        nm = (name.encode("utf-16le") + b"\0\0") if self.v >= 1200 else name.encode("cp1252") + b"\0"
        self.fonts[name] = (fid, chunk("font", u16(fid) + u16(0) + u32(0) + b"\0" * 10 + nm))
        return fid

    def bmp_chunk(self, w, h, rgb):
        """rgb: function (x, y) -> (r, g, b); stored bottom-up, 24 bit BGR, rows padded to 4 bytes."""
        iid = len(self.bitmaps) + 1
        stride = ((w * 24 + 31) // 32) * 4
        px = bytearray()
        for y in range(h - 1, -1, -1):
            row = bytearray()
            for x in range(w):
                r, g, b = rgb(x, y)
                row += bytes([b, g, r])
            px += row.ljust(stride, b"\0")
        v = self.v
        body = u32(iid) + b"\0" * (14 if v < 600 else 46 if v < 700 else 50) + u32(5) + b"\0" * 4 + u32(w) + u32(h) + b"\0" * 4 + u32(24) + b"\0" * 4 + u32(len(px)) + b"\0" * 32 + bytes(px)
        self.bitmaps[iid] = chunk("bmp ", body)
        return iid

    # ----- chunks -----
    def loda(self, ctype, args):
        """args: list of (type, body) in file order"""
        n = len(args)
        offs_pos, types_pos = 20, 20 + (n + 1) * 4
        data_start = types_pos + n * 4
        offs, pos = [], data_start
        for _, b in args:
            offs.append(pos); pos += len(b)
        offs.append(pos)
        types = [args[n - 1 - j][0] for j in range(n)]
        body = u32(pos) + u32(n) + u32(offs_pos) + u32(types_pos) + u32(ctype)
        body += b"".join(u32(o) for o in offs) + b"".join(u32(t) for t in types) + b"".join(b for _, b in args)
        return chunk("loda", body)

    def name_arg(self, name):
        return (1000, name.encode("utf-16le") + b"\0\0" if self.v >= 1200 else name.encode("cp1252") + b"\0")

    def trfd(self, m):
        v = self.v
        t = u16(0x08) + (b"\0" * 6 if v >= 600 else b"") + f64(m[0]) + f64(m[2]) + f64(m[4] * INCH) + f64(m[1]) + f64(m[3]) + f64(m[5] * INCH)
        if v >= 1300:
            t = b"\0" * 8 + t
        body = u32(12 + 4 + len(t)) + u32(1) + u32(12) + u32(16) + t
        return chunk("trfd", body)

    def bbox(self, x0, y0, x1, y1):
        return chunk("bbox", coord(x0) + coord(y0) + coord(x1) + coord(y1))

    def flgs(self, ctype, f0=0, f2=0):
        return chunk("flgs", bytes([f0, 0, f2, ctype]))

    def mcfg(self, w, h):
        v = self.v
        pre = 12 if v >= 1300 else 4 if v >= 900 else 0x1C if 600 <= v < 700 else 0
        return chunk("mcfg", b"\0" * pre + coord(w) + coord(h) + b"\0" * 16)

    # ----- geometry bodies -----
    def geom(self, o):
        v = self.v
        k = o["type"]
        if k == "rect":
            r = o.get("radius", 0)
            if v < 1500:
                b = coord(o["w"]) + coord(o["h"]) + coord(r) + (coord(r) * 3 if v >= 900 else b"")
            else:
                rc = lambda inch: f64(inch * INCH)
                b = rc(o["w"]) + rc(o["h"]) + f64(1.0) + f64(1.0) + bytes([0]) + b"\0" * 7 + f64(r) + bytes([0]) + b"\0" * 15 + f64(r) + b"\0" * 16 + f64(r) + b"\0" * 16 + f64(r)
            return 1, b
        if k == "ellipse":
            return 2, coord(o["rx"] * 2) + coord(o["ry"] * 2) + s32(o.get("a1", 0) * 1e6) + s32(o.get("a2", 0) * 1e6) + u32(1 if o.get("pie") else 0)
        if k in ("curve", "polygon"):
            pts = o["pts"]
            b = u32(len(pts)) + b"".join(coord(p[0]) + coord(p[1]) for p in pts) + bytes(p[2] for p in pts)
            return (3 if k == "curve" else 0x14), b
        if k == "text":
            return 4, coord(0) + coord(0)
        if k == "bitmap":
            return 5, coord(0) + coord(0) + coord(o["w"]) + coord(o["h"]) + b"\0" * 32 + u32(o["image"]) + b"\0" * 24 + u32(0)
        raise ValueError(k)

    def txsm(self, text, size, font_id, fill_id):
        v = self.v
        b = u32(0) + b"\0" * 32
        if v >= 1500:
            b += b"\0"
        if v < 800:
            b += u32(0)
        b += u32(1)  # frames
        b += u32(1) + b"\0" * 48
        if v >= 800:
            b += u32(0)
            if v >= 1500:
                b += b"\0" * 8
        b += b"\0" * (40 if v >= 1500 else 36 if v >= 1400 else 34 if v >= 801 else 32 if v == 800 else 36)
        b += u32(1)  # paragraphs
        b += u32(0) + b"\0" + u32(1)
        flags = 0x01 | 0x02 | 0x04 | 0x40
        b += u16(len(text)) + bytes([flags]) + (b"\0" if v >= 800 else b"")
        b += u16(font_id) + u16(0) + u32(0x40) + coord(size) + u32(fill_id) + (b"\0" * 48 if v >= 1300 else b"")
        b += u32(len(text)) + b"\0" * (len(text) * (8 if v >= 1200 else 4))
        data = text.encode("utf-16le") if v >= 1200 else text.encode("cp1252")
        if v >= 1200:
            b += u32(len(data))
        b += data + b"\0"
        return chunk("txsm", b)

    # ----- objects -----
    def obj(self, o, parent=I):
        """Returns (chunk bytes, truth svg fragment, bbox in page frame). `parent` is the product of the enclosing group matrices."""
        v = self.v
        if o["type"] == "group":
            gm = o.get("m", I)
            kids, svgs = [], []
            for c in o["children"]:
                kb, ks, _ = self.obj(c, mmul(parent, gm))
                kids.append(kb); svgs.append(ks)
            body = [self.flgs(0x10), self.trfd(gm)] + kids
            return lst("grp ", body), f'<g transform="matrix({gm[0]} {gm[1]} {gm[2]} {gm[3]} {gm[4]} {gm[5]})">' + "".join(svgs) + "</g>", None
        ctype, gb = self.geom(o)
        args = [(30, gb)]
        fill = o.get("fill")
        line = o.get("line")
        args.append((20, u32(self.fild(fill))))
        args.append((10, u32(self.outl(line))))
        if o.get("name"):
            args.append(self.name_arg(o["name"]))
        if o.get("opacity", 1) < 1:
            args.append((8000, b"\0" * (14 if v >= 1300 else 10) + u16(int(o["opacity"] * 1000))))
        m = o.get("m", I)
        parts = [self.flgs(0x08), self.loda(ctype, args), self.trfd(m)]
        if o["type"] == "text":
            fid = self.font(o.get("font", "Arial"))
            parts.append(self.txsm(o["text"], o["size"], fid, self.fild(o.get("fill") or "#000000")))
        # bounding box (page frame) from sampled geometry
        pts = self.sample(o, mmul(parent, m))
        bb = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
        parts.append(self.bbox(*bb))
        return lst("obj ", parts), self.truth(o, m), bb

    def sample(self, o, m):
        k = o["type"]
        if k == "rect":
            w, h = o["w"], o["h"]
            loc = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        elif k == "ellipse":
            rx, ry = o["rx"], o["ry"]
            a1, a2 = o.get("a1", 0), o.get("a2", 0)
            if a1 != a2:  # arc or pie: only the arc itself (and the centre for a pie) counts for the bounding box
                sweep = (a2 - a1) % 360
                loc = [(rx + rx * math.cos(math.radians(a1 + sweep * t / 120)), ry + ry * math.sin(math.radians(a1 + sweep * t / 120))) for t in range(121)]
                if o.get("pie"): loc.append((rx, ry))
            else:
                loc = [(rx + rx * math.cos(t / 90 * math.pi), ry + ry * math.sin(t / 90 * math.pi)) for t in range(180)]
        elif k in ("curve", "polygon"):
            loc, pts, i = [], o["pts"], 0
            while i < len(pts):
                op = (pts[i][2] & 0xC0) >> 6
                if op == 3 and i + 2 < len(pts):  # cubic: two controls then the end point; sample the curve itself
                    p0 = (pts[i - 1][0], pts[i - 1][1]) if i else (pts[i][0], pts[i][1])
                    a, b, c = pts[i], pts[i + 1], pts[i + 2]
                    for n in range(1, 41):
                        t = n / 40; u = 1 - t
                        loc.append((u**3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t**3 * c[0], u**3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t**3 * c[1]))
                    i += 3
                else:
                    loc.append((pts[i][0], pts[i][1])); i += 1
        elif k == "text":
            loc = [(0, 0), (len(o["text"]) * o["size"] * 0.5, o["size"])]
        else:
            loc = [(0, 0), (o["w"], o["h"])]
        return [mapp(m, *p) for p in loc]

    def truth(self, o, m):
        """Independent SVG (inches, y up -> flipped by the wrapper group) used as the reference rendering."""
        k = o["type"]
        mat = f'matrix({m[0]} {m[1]} {m[2]} {m[3]} {m[4]} {m[5]})'
        def paint():
            f, l = o.get("fill"), o.get("line")
            fa = "none"
            if isinstance(f, str): fa = f
            elif isinstance(f, tuple): fa = cmyk_hex(*f[1:])
            elif isinstance(f, dict):
                gid = "g%d" % (len(self.truth_defs) + 1)
                st = "".join(f'<stop offset="{a}" stop-color="{c}"/>' for a, c in f["grad"])
                self.truth_defs.append(f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0">{st}</linearGradient>')
                fa = f"url(#{gid})"
            s = f'fill="{fa}"'
            if o.get("opacity", 1) < 1: s += f' opacity="{o["opacity"]}"'
            if l and not l.get("none"):
                s += f' stroke="{l["color"]}" stroke-width="{l["w"]}"'
                if l.get("cap"): s += f' stroke-linecap="{["butt","round","square"][l["cap"]]}"'
                if l.get("join"): s += f' stroke-linejoin="{["miter","round","bevel"][l["join"]]}"'
                if l.get("dash"): s += ' stroke-dasharray="%s"' % " ".join(str(d * l["w"]) for d in l["dash"])
            return s
        if k == "rect":
            r = o.get("radius", 0)
            return f'<rect x="{-o["w"]/2}" y="{-o["h"]/2}" width="{o["w"]}" height="{o["h"]}" rx="{r}" ry="{r}" transform="{mat}" {paint()}/>'
        if k == "ellipse" and o.get("a1", 0) != o.get("a2", 0):
            rx, ry = o["rx"], o["ry"]
            pt = lambda a: (rx + rx * math.cos(math.radians(a)), ry + ry * math.sin(math.radians(a)))
            (x1, y1), (x2, y2) = pt(o["a1"]), pt(o["a2"])
            sweep = (o["a2"] - o["a1"]) % 360
            d = f"M{x1} {y1}A{rx} {ry} 0 {1 if sweep > 180 else 0} 1 {x2} {y2}" + (f"L{rx} {ry}Z" if o.get("pie") else "")
            return f'<path d="{d}" transform="{mat}" {paint()}/>'
        if k == "ellipse":
            return f'<ellipse cx="{o["rx"]}" cy="{o["ry"]}" rx="{o["rx"]}" ry="{o["ry"]}" transform="{mat}" {paint()}/>'
        if k in ("curve", "polygon"):
            return f'<path d="{path_d(o["pts"])}" transform="{mat}" {paint()}/>'
        if k == "text":
            return f'<g transform="{mat}"><text transform="scale(1 -1)" font-family="{o.get("font","Arial")}" font-size="{o["size"]}" {paint()}>{o["text"]}</text></g>'
        if k == "bitmap":
            return f'<rect x="0" y="0" width="{o["w"]}" height="{o["h"]}" transform="{mat}" fill="#8888ff"/>'
        return ""

    # ----- file assembly -----
    def build(self, scene):
        v = self.v
        W, H = scene["page"]
        pages, truth_pages = [], []
        for p in scene["pages"]:
            layers = []
            tl = []
            if p.get("master"):
                for lt, nm in ((0x08, "Desktop"), (0x0A, "Guides"), (0x1A, "Document Grid")):
                    layers.append(lst("layr", [self.flgs(0x98, f0=lt), self.loda(0x98, [self.name_arg(nm)])]))
            for l in p["layers"]:
                objs = []
                for o in l["objects"]:
                    kb, ks, _ = self.obj(o)
                    objs.append(kb); tl.append(ks)
                layers.append(lst("layr", [self.flgs(0x98, f0=0), self.loda(0x98, [self.name_arg(l["name"])])] + objs))
            pg = [self.flgs(0x90, f2=1 if p.get("master") else 0), self.loda(0x90, [self.name_arg(p["name"])] + ([(19130, coord(p["size"][0]) + coord(p["size"][1]))] if p.get("size") else []))] + layers
            pages.append(lst("page", pg))
            truth_pages.append("".join(tl))
        tables = [chunk("vrsn", u16(v))]
        doc = [self.mcfg(W, H)]
        doc.append(lst("fild", [c for _, c in self.fills.values()]))
        doc.append(lst("outl", [c for _, c in self.outls.values()]))
        doc.append(lst("font", [c for _, c in self.fonts.values()]))
        doc.append(lst("bmpt", list(self.bitmaps.values())))
        return tables, lst("doc ", doc), pages, truth_pages

    def preview(self):
        w, h = 64, 40
        px = bytearray()
        for y in range(h - 1, -1, -1):
            row = bytearray()
            for x in range(w):
                row += bytes([200 - y * 3, 80 + x, 60])
            px += row.ljust(((w * 24 + 31) // 32) * 4, b"\0")
        return chunk("DISP", b"\0" * 4 + u32(40) + u32(w) + u32(h) + u16(1) + u16(24) + u32(0) + u32(len(px)) + u32(0) + u32(0) + u32(0) + u32(0) + bytes(px))


def path_d(pts):
    d, i = "", 0
    while i < len(pts):
        x, y, t = pts[i]
        op = (t & 0xC0) >> 6
        if op == 0: d += f"M{x} {y}"; i += 1
        elif op == 1: d += f"L{x} {y}"; i += 1
        elif op == 3:
            a, b, c = pts[i], pts[i + 1], pts[i + 2]
            d += f"C{a[0]} {a[1]} {b[0]} {b[1]} {c[0]} {c[1]}"; i += 3; t = c[2]
        else: i += 1
        if t & 8: d += "Z"
    return d


def cmyk_hex(c, m, y, k):
    c, m, y, k = [x / 100 for x in (c, m, y, k)]
    return "#%02x%02x%02x" % tuple(round(255 * (1 - a) * (1 - k)) for a in (c, m, y))


def P(x, y, op, close=False):
    return (x, y, (op << 6) | (8 if close else 0) | 4)


def scene_main():
    """Page 21 x 29.7 cm (A4) with a layer of mixed objects, a group, text, a bitmap and a hidden desktop layer on the master page."""
    W, H = 8.27, 11.69
    line = lambda w, c, **k: {"w": w, "color": c, **k}
    star = [P(0, 1, 0, True)] + [P(math.sin(a) * (1 if i % 2 == 0 else 0.45), math.cos(a) * (1 if i % 2 == 0 else 0.45), 1, i == 9) for i, a in enumerate([k * math.pi / 5 for k in range(1, 11)])]
    curve = [P(0, 0, 0), P(0.5, 1, 3), P(1.0, -0.5, 3), P(1.5, 0.5, 2), P(2.0, 1.0, 3), P(2.5, 1.0, 3), P(3.0, 0.2, 2)]
    objs = [
        {"type": "rect", "w": 2.0, "h": 1.2, "radius": 0.15, "fill": "#2196f3", "line": line(0.03, "#0d47a1"), "m": mtr(-2.5, 4.0), "name": "Blue card"},
        {"type": "rect", "w": 1.5, "h": 1.5, "fill": "#ffb300", "line": None, "m": mmul(mtr(1.0, 4.0), mrot(25))},
        {"type": "ellipse", "rx": 1.0, "ry": 0.6, "fill": "#e53935", "line": line(0.05, "#212121", dash=[3, 2], cap=1), "m": mtr(2.0 - 1.0, 2.0 - 0.6)},
        {"type": "ellipse", "rx": 0.8, "ry": 0.8, "a1": 20, "a2": 200, "pie": True, "fill": ("cmyk", 80, 10, 0, 0), "line": line(0.02, "#000000"), "m": mtr(-2.5 - 0.8, 1.5 - 0.8)},
        {"type": "polygon", "pts": star, "fill": "#43a047", "line": line(0.04, "#1b5e20", join=1), "m": mmul(mtr(-1.0, -1.0), [1.2, 0, 0, 1.2, 0, 0])},
        {"type": "curve", "pts": curve, "fill": None, "line": line(0.06, "#6a1b9a", cap=1), "m": mtr(-1.5, -3.0)},
        {"type": "group", "m": mtr(0.5, -3.5), "children": [
            {"type": "rect", "w": 1.0, "h": 0.6, "fill": "#00bcd4", "line": None, "m": mtr(0, 0)},
            {"type": "ellipse", "rx": 0.25, "ry": 0.25, "fill": "#ffffff", "line": line(0.02, "#006064"), "m": mtr(-0.25, -0.25)}]},
        {"type": "text", "text": "Hello CDR", "size": 0.5, "font": "Arial", "fill": "#212121", "line": None, "m": mtr(-3.5, -4.8)},
        {"type": "rect", "w": 1.6, "h": 0.8, "fill": {"grad": [(0, "#ff5722"), (1, "#ffeb3b")], "angle": 0}, "line": None, "m": mtr(2.5, -2.0), "name": "Gradient"},
    ]
    return {"page": (W, H), "pages": [
        {"name": "Master page", "master": True, "layers": []},
        {"name": "Page 1", "layers": [{"name": "Layer 1", "objects": objs}]},
        {"name": "Page 2", "layers": [{"name": "Layer 1", "objects": [{"type": "rect", "w": 3, "h": 2, "fill": "#7e57c2", "line": None, "m": mtr(0, 0)}]}]},
    ]}


def write_riff(version_tag, version, scene, compress=False, bitmap=True, out=None):
    g = Gen(version, compress)
    if bitmap:
        iid = g.bmp_chunk(8, 6, lambda x, y: (x * 30, y * 40, 120))
        scene["pages"][1]["layers"][0]["objects"].append({"type": "bitmap", "w": 1.6, "h": 1.2, "image": iid, "fill": None, "line": None, "m": mtr(2.0, -4.5)})
    tables, doc, pages, truth = g.build(scene)
    body = tables[0] + g.preview()
    rest = [doc] + pages
    if compress:
        body += compress_list(rest)
    else:
        body += b"".join(rest)
    riff = b"RIFF" + u32(4 + len(body)) + version_tag.encode() + body
    return riff, g, truth


def compress_list(chunks):
    """Wrap chunk bytes in a LIST 'cmpr' like CorelDRAW does: compressed chunk stream plus a pool of sizes."""
    pool = []
    def conv(raw):
        out = b""
        p = 0
        while p + 8 <= len(raw):
            cid = raw[p:p + 4]
            ln = struct.unpack("<I", raw[p + 4:p + 8])[0]
            body = raw[p + 8:p + 8 + ln]
            idx = len(pool); pool.append(0)
            if cid == b"LIST" and body[:4] not in (b"stlt",):
                inner = conv(body[4:])
                nb = body[:4] + inner
            else:
                nb = body
            pool[idx] = len(nb)
            out += cid + u32(idx) + nb + (b"\0" if len(nb) & 1 else b"")
            p += 8 + ln + (ln & 1)
        return out
    stream = b"".join(conv(c) for c in chunks)
    sizes = b"".join(u32(x) for x in pool)
    z1, z2 = zlib.compress(stream), zlib.compress(sizes)
    c1 = b"CPng" + bytes([1, 0, 4, 0]) + z1
    c2 = b"CPng" + bytes([1, 0, 4, 0]) + z2
    payload = b"cmpr" + u32(len(c1)) + u32(len(stream)) + u32(len(c2)) + u32(len(sizes)) + c1 + c2
    return chunk("LIST", payload)


def thumb_png(w=80, h=50):
    raw = b"".join(b"\0" + b"".join(bytes([100 + y, 160, 220 - x]) for x in range(w)) for y in range(h))
    def ch(t, d): c = zlib.crc32(t + d); return struct.pack(">I", len(d)) + t + d + struct.pack(">I", c)
    return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")


def make_zip(riff, thumb=True, x6=None):
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("metadata/metadata.xml", "<metadata/>")
        if thumb:
            z.writestr("metadata/thumbnails/thumbnail.png", thumb_png())
        if x6 is None:
            z.writestr("content/riffData.cdr", riff)
        else:
            root, streams = x6
            z.writestr("content/root.dat", root)
            z.writestr("content/dataFileList.dat", "\n".join(f"data/{i}.dat" for i in range(len(streams))))
            for i, s in enumerate(streams):
                z.writestr(f"content/data/{i}.dat", s)
    return bio.getvalue()


def externalize(riff):
    """X6 style: every non-LIST chunk body is moved into one external stream and replaced by a 16 byte redirect."""
    stream = bytearray()
    def conv(raw):
        out = b""
        p = 0
        while p + 8 <= len(raw):
            cid = raw[p:p + 4]
            ln = struct.unpack("<I", raw[p + 4:p + 8])[0]
            body = raw[p + 8:p + 8 + ln]
            if cid == b"LIST":
                nb = body[:4] + conv(body[4:])
                if len(nb) == 16: nb += b"\0\0"
            elif len(body) <= 8:
                nb = body if len(body) != 16 else body + b"\0\0"
            else:
                ofs = len(stream); stream.extend(body)
                nb = u32(0) + u32(len(body)) + u32(ofs) + u32(0)
            out += cid + u32(len(nb)) + pad(nb)
            p += 8 + ln + (ln & 1)
        return out
    inner = conv(riff[12:])
    root = b"RIFF" + u32(4 + len(inner)) + riff[8:12] + inner
    return root, [bytes(stream)]


def truth_svg(scene, page_idx):
    W, H = scene["page"]
    p = scene["pages"][page_idx]
    return W, H, p


def main(out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    VERS = [("CDR7", 700), ("CDR9", 900), ("CDRA", 1000), ("CDRC", 1200), ("CDRD", 1300)]
    for tag, v in VERS:
        for comp in (False, True):
            scene = scene_main()
            riff, g, truth = write_riff(tag, v, scene, compress=comp)
            name = f"scene-v{v}{'-cmpr' if comp else ''}.cdr"
            (out / name).write_bytes(riff)
            manifest[name] = {"version": v, "container": "riff", "compressed": comp, "objects": len(scene["pages"][1]["layers"][0]["objects"]), "pages": 3}
    for tag, v in (("CDRE", 1400), ("CDRF", 1500)):
        scene = scene_main()
        riff, g, truth = write_riff(tag, v, scene, compress=True)
        (out / f"scene-v{v}.cdr").write_bytes(make_zip(riff))
        manifest[f"scene-v{v}.cdr"] = {"version": v, "container": "zip", "compressed": True, "objects": len(scene["pages"][1]["layers"][0]["objects"]), "pages": 3}
    scene = scene_main()
    riff, g, truth = write_riff("CDRG", 1600, scene, compress=False)
    root, streams = externalize(riff)
    (out / "scene-v1600.cdr").write_bytes(make_zip(riff, x6=(root, streams)))
    manifest["scene-v1600.cdr"] = {"version": 1600, "container": "zip-x6", "compressed": False, "objects": len(scene["pages"][1]["layers"][0]["objects"]), "pages": 3}
    # damaged variants of the X3 file
    base = (out / "scene-v1300.cdr").read_bytes()
    (out / "bad-truncated.cdr").write_bytes(base[: len(base) * 3 // 5])
    (out / "bad-truncated-late.cdr").write_bytes(base[: len(base) * 17 // 20])
    (out / "bad-truncated-cmpr.cdr").write_bytes((out / "scene-v1300-cmpr.cdr").read_bytes()[:900])
    (out / "bad-garbage.cdr").write_bytes(b"RIFF" + u32(100) + b"CDRD" + bytes(range(96)))
    (out / "bad-notcdr.cdr").write_bytes(b"this is not a corel draw file at all")
    (out / "bad-empty.cdr").write_bytes(b"")
    (out / "bad-zip-empty.cdr").write_bytes(make_zip(b"", thumb=True)[:])
    (out / "old-v500.cdr").write_bytes(write_riff("CDR5", 500, scene_main(), bitmap=False)[0])
    # corrupt a byte in the middle of the compressed stream
    cm = bytearray((out / "scene-v1300-cmpr.cdr").read_bytes())
    at = bytes(cm).index(b"cmpr") + 200
    for i in range(at, at + 40): cm[i] ^= 0xFF
    (out / "bad-corrupt-cmpr.cdr").write_bytes(bytes(cm))
    # ground truth drawings (independent SVG from the scene description), one per non-master page of the last scene
    scene = scene_main()
    g = Gen(1300)
    iid = g.bmp_chunk(8, 6, lambda x, y: (x * 30, y * 40, 120))
    scene["pages"][1]["layers"][0]["objects"].append({"type": "bitmap", "w": 1.6, "h": 1.2, "image": iid, "fill": None, "line": None, "m": mtr(2.0, -4.5)})
    W, H = scene["page"]
    for n, pg in enumerate([p for p in scene["pages"] if not p.get("master")], 1):
        frags = []
        for l in pg["layers"]:
            for o in l["objects"]:
                frags.append(g.obj(o)[1])
        defs = "".join(g.truth_defs); g.truth_defs = []
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}in" height="{H}in" viewBox="0 0 {W} {H}"><defs>{defs}</defs>'
               f'<rect width="{W}" height="{H}" fill="#ffffff"/><g transform="translate({W/2} {H/2}) scale(1 -1)">{"".join(frags)}</g></svg>')
        (out / f"truth-page{n}.svg").write_text(svg, encoding="utf8")
    json.dump(manifest, open(out / "manifest.json", "w"), indent=1)
    print("wrote", len(list(out.glob('*.cdr'))), "files to", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cdr-samples")
