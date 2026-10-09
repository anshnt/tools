// Tools for Vector Studio. Each tool is {cursor, down, move, up, cancel, dblclick, hover, overlay, activate, deactivate}.
// Events carry screen coords (sx, sy), document coords (p), modifier keys and the artwork node id under the pointer (id).
import { I, inv, ap, P, tr, sc, rot, about, dist, rdp, fitSmooth, polygonSubs, starSubs, lineSubs, nearestOnSub, splitSegment, makeSmooth, makeCorner, isSmooth, hasIn, hasOut, subsToD, transformSubs, DEG } from './_geom.js'
import { mk, get, leaves, bboxOf, localBBox, applyMatrix, restoreNode, convertToPath, toSubs, solid, pickStyle, lineage, cloneNode } from './_model.js'

const f = (v) => Math.round(v * 100) / 100
const ROTATE = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='white' stroke-width='4.4'><path d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'/><path d='M21 3v5h-5'/></g><g stroke='black' stroke-width='2'><path d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'/><path d='M21 3v5h-5'/></g></svg>")}") 12 12, crosshair`
const isShape = (n) => n.type === 'path' || n.type === 'rect' || n.type === 'ellipse'
const lockedAt = (ed, id) => lineage(ed.doc, id).some((n) => n.lock)

const rect = (x, y, w, h, cls) => `<rect class="${cls}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/>`
const sq = (x, y, r, cls) => `<rect class="${cls}" x="${f(x - r)}" y="${f(y - r)}" width="${f(r * 2)}" height="${f(r * 2)}"/>`
const dot = (x, y, r, cls) => `<circle class="${cls}" cx="${f(x)}" cy="${f(y)}" r="${r}"/>`

export function createTools(cv) {
  const ed = cv.ed
  const screenM = () => [cv.z, 0, 0, cv.z, ed.view.x, ed.view.y]
  const outline = (n, cls = 'ov-outline') => { const subs = isShape(n) ? toSubs(n) : null; return subs ? `<path class="${cls}" d="${subsToD(transformSubs(subs, screenM()))}"/>` : '' }
  const lineStyle = () => ({ ...pickStyle(ed.style), fill: null, stroke: ed.style.stroke || solid('#1b1b2f'), sw: Math.max(ed.style.sw || 0, 1) })

  // ---------- shared: moving whole nodes ----------
  function beginMove(ev, toggle = null) {
    const nodes = ed.top
    return { mode: 'move', tx: ed.begin('Move'), start: ev.p, s0: [ev.sx, ev.sy], orig: nodes.map((n) => ({ n, snap: structuredClone(n) })), box: ed.box(), T: cv.targets(nodes.map((n) => n.id)), moved: false, copy: ev.alt, toggle }
  }
  function dragMove(st, ev) {
    if (!st.moved) {
      if (Math.hypot(ev.sx - st.s0[0], ev.sy - st.s0[1]) < 3) return
      st.moved = true
      if (st.copy) {
        const clones = st.orig.map(({ n }) => cloneNode(ed.doc, n))
        ed.add(clones)
        st.orig = clones.map((n) => ({ n, snap: structuredClone(n) }))
      }
    }
    let dx = ev.p.x - st.start.x, dy = ev.p.y - st.start.y
    if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
    if (st.box) {
      const s = cv.snapBox({ x: st.box.x + dx, y: st.box.y + dy, w: st.box.w, h: st.box.h }, st.T, ev.ctrl)
      dx += s.dx; dy += s.dy
    }
    for (const { n, snap } of st.orig) { restoreNode(n, snap); applyMatrix(n, tr(dx, dy)) }
    ed.touch(); cv.scheduleOv()
  }

  // ---------- On-canvas gradient handles (selection tool) ----------
  const gradOf = () => {
    const ns = ed.top
    if (ns.length !== 1) return null
    const n = ns[0]
    if (!n || n.type === 'group' || n.type === 'image' || n.lock) return null
    const isG = (p) => p && (p.t === 'linear' || p.t === 'radial')
    const which = isG(n.fill) ? 'fill' : isG(n.stroke) ? 'stroke' : null
    if (!which) return null
    const lb = localBBox(n)
    if (!lb || lb.w < 1e-6 || lb.h < 1e-6) return null
    const p = n[which], T = n.t || I
    const W = (fx, fy) => ap(T, lb.x + fx * lb.w, lb.y + fy * lb.h)
    const pts = p.t === 'linear' ? { p1: W(p.x1, p.y1), p2: W(p.x2, p.y2) } : { c: W(p.cx, p.cy), r: W(p.cx + p.r, p.cy) }
    return { n, which, p, lb, T, pts }
  }
  const gradOverlay = () => {
    const g = gradOf()
    if (!g) return ''
    const sp = Object.fromEntries(Object.entries(g.pts).map(([k, [x, y]]) => [k, cv.S(x, y)]))
    if (g.p.t === 'linear') {
      const [a, b] = [sp.p1, sp.p2]
      return `<line class="ov-gline" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>` + dot(a[0], a[1], 5.5, 'ov-gdot') + sq(b[0], b[1], 5, 'ov-h')
    }
    const [c, r] = [sp.c, sp.r]
    return `<line class="ov-gline" x1="${f(c[0])}" y1="${f(c[1])}" x2="${f(r[0])}" y2="${f(r[1])}"/>` + dot(c[0], c[1], 5.5, 'ov-gdot') + sq(r[0], r[1], 5, 'ov-h')
  }

  // ---------- Select ----------
  const select = (() => {
    let st = null
    const dirs = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] }
    const curs = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
    const frame = () => {
      if (!ed.sel.length) return null
      const B = ed.box()
      if (!B) return null
      const [x0, y0] = cv.S(B.x, B.y)
      return { B, x0, y0, x1: x0 + B.w * cv.z, y1: y0 + B.h * cv.z }
    }
    const handleAt = (fr, sx, sy, touch) => {
      const w = fr.x1 - fr.x0, h = fr.y1 - fr.y0
      const r = Math.min(touch ? 16 : 8, Math.max(3.5, Math.min(w, h) * 0.3)) // small objects keep their middle clickable
      for (const [k, [u, v]] of Object.entries(dirs)) {
        if ((k === 'n' || k === 's') && w < 28) continue
        if ((k === 'e' || k === 'w') && h < 28) continue
        if (Math.hypot(sx - (fr.x0 + w * u), sy - (fr.y0 + h * v)) <= r) return k
      }
      return null
    }
    const rotateZone = (fr, sx, sy, touch) => {
      const inside = sx >= fr.x0 && sx <= fr.x1 && sy >= fr.y0 && sy <= fr.y1
      if (inside) return false
      const rr = touch ? 34 : 22
      return [[fr.x0, fr.y0], [fr.x1, fr.y0], [fr.x1, fr.y1], [fr.x0, fr.y1]].some(([x, y]) => Math.hypot(sx - x, sy - y) <= rr)
    }
    const inLevel = () => ((ed.ctx && get(ed.doc, ed.ctx)?.kids) || ed.doc.nodes).filter((n) => n.vis && !n.lock)
    const marqueeIds = (a, b) => {
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
      return inLevel().filter((n) => { const bb = bboxOf(n); return bb && bb.x <= x1 && bb.x + bb.w >= x0 && bb.y <= y1 && bb.y + bb.h >= y0 }).map((n) => n.id)
    }
    return {
      cursor: 'default',
      hover(ev) {
        const fr = frame()
        let c = null
        const g = gradOf()
        if (g && Object.values(g.pts).some(([x, y]) => { const [sx, sy] = cv.S(x, y); return Math.hypot(ev.sx - sx, ev.sy - sy) <= 9 })) { cv.updateCursor('pointer'); return }
        if (fr) { const hk = handleAt(fr, ev.sx, ev.sy, false); c = hk ? curs[hk] : rotateZone(fr, ev.sx, ev.sy, false) ? ROTATE : null }
        cv.updateCursor(c || (ev.id ? 'move' : 'default'))
      },
      down(ev) {
        const g = gradOf()
        if (g) {
          for (const [k, [x, y]] of Object.entries(g.pts)) {
            const [sx, sy] = cv.S(x, y)
            if (Math.hypot(ev.sx - sx, ev.sy - sy) <= (ev.touch ? 16 : 9)) { st = { mode: 'grad', k, tx: ed.begin('Edit gradient') }; return }
          }
        }
        const fr = frame()
        if (fr) {
          const hk = handleAt(fr, ev.sx, ev.sy, ev.touch)
          if (hk) {
            const [u, v] = dirs[hk], B = fr.B, nodes = ed.top
            st = { mode: 'scale', hk, u, v, B, tx: ed.begin('Resize'), orig: nodes.map((n) => ({ n, snap: structuredClone(n) })), T: cv.targets(nodes.map((n) => n.id)) }
            return
          }
          if (rotateZone(fr, ev.sx, ev.sy, ev.touch)) {
            const nodes = ed.top, B = fr.B, c = { x: B.x + B.w / 2, y: B.y + B.h / 2 }
            st = { mode: 'rotate', c, a0: Math.atan2(ev.p.y - c.y, ev.p.x - c.x), tx: ed.begin('Rotate'), orig: nodes.map((n) => ({ n, snap: structuredClone(n) })) }
            return
          }
        }
        if (ev.id) {
          const n = ed.pick(ev.id)
          if (n && !lockedAt(ed, n.id)) {
            let toggle = null
            if (ev.shift) { if (ed.sel.includes(n.id)) toggle = n.id; else ed.setSel([...ed.sel, n.id]) } else if (!ed.sel.includes(n.id)) ed.setSel([n.id])
            st = beginMove(ev, toggle)
            return
          }
        }
        const base = ev.shift ? [...ed.sel] : []
        if (!ev.shift) ed.clearSel()
        st = { mode: 'marquee', a: ev.p, b: ev.p, base }
      },
      move(ev) {
        if (!st) return
        if (st.mode === 'move') return dragMove(st, ev)
        if (st.mode === 'marquee') { st.b = ev.p; ed.setSel([...st.base, ...marqueeIds(st.a, st.b)]); return }
        if (st.mode === 'grad') {
          const g = gradOf()
          if (!g) return
          const [lx, ly] = ap(inv(g.T), ev.p.x, ev.p.y)
          const fx = (lx - g.lb.x) / g.lb.w, fy = (ly - g.lb.y) / g.lb.h, p = { ...g.p }
          if (st.k === 'p1') { p.x1 = fx; p.y1 = fy } else if (st.k === 'p2') { p.x2 = fx; p.y2 = fy }
          else if (st.k === 'c') { const moved = p.fx === p.cx && p.fy === p.cy; p.cx = fx; p.cy = fy; if (moved) { p.fx = fx; p.fy = fy } }
          else if (st.k === 'r') p.r = Math.max(0.01, Math.abs(fx - p.cx))
          g.n[g.which] = p
          ed.touch(); cv.scheduleOv()
          return
        }
        if (st.mode === 'rotate') {
          let a = Math.atan2(ev.p.y - st.c.y, ev.p.x - st.c.x) - st.a0
          if (ev.shift) a = Math.round(a / (15 * DEG)) * 15 * DEG
          const M = about(rot(a), st.c.x, st.c.y)
          for (const { n, snap } of st.orig) { restoreNode(n, snap); applyMatrix(n, M) }
          ed.emit('status', `Rotate ${f((a / DEG + 540) % 360 - 180)} deg`)
          ed.touch(); cv.scheduleOv()
          return
        }
        if (st.mode === 'scale') {
          const { B, u, v } = st
          const p = cv.snapPoint(ev.p, st.T, ev.ctrl)
          const hp = { x: B.x + B.w * u, y: B.y + B.h * v }
          const anc = ev.alt ? { x: B.x + B.w / 2, y: B.y + B.h / 2 } : { x: B.x + B.w * (1 - u), y: B.y + B.h * (1 - v) }
          let sx = u === 0.5 || Math.abs(hp.x - anc.x) < 1e-6 ? 1 : (p.x - anc.x) / (hp.x - anc.x)
          let sy = v === 0.5 || Math.abs(hp.y - anc.y) < 1e-6 ? 1 : (p.y - anc.y) / (hp.y - anc.y)
          if (ev.shift || (u !== 0.5 && v !== 0.5 && ev.touch)) {
            const s = u === 0.5 ? sy : v === 0.5 ? sx : Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy
            sx = sy = s
          }
          const fix = (s) => (Math.abs(s) < 0.001 ? 0.001 * (s < 0 ? -1 : 1) : s)
          sx = fix(sx); sy = fix(sy)
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
          const M = about(sc(sx, sy), anc.x, anc.y)
          for (const { n, snap } of st.orig) { restoreNode(n, snap); applyMatrix(n, M) }
          ed.emit('status', `${f(B.w * Math.abs(sx))} x ${f(B.h * Math.abs(sy))}`)
          ed.touch(); cv.scheduleOv()
        }
      },
      up() {
        const s = st; st = null
        if (!s) return
        if (s.mode === 'marquee') return
        if (s.tx) ed.commit(s.tx)
        if (s.mode === 'move' && !s.moved && s.toggle) ed.setSel(ed.sel.filter((x) => x !== s.toggle))
        ed.emit('doc')
      },
      cancel() { if (st?.tx) ed.cancel(st.tx); st = null },
      dblclick(ev) {
        if (!ev.id) { if (ed.ctx) { ed.ctx = null; ed.setSel([]); cv.scheduleOv() } return }
        const top = ed.pick(ev.id), leaf = get(ed.doc, ev.id)
        if (top?.type === 'group') { ed.ctx = top.id; const child = ed.pick(ev.id); ed.setSel(child ? [child.id] : []); cv.scheduleOv(); return }
        if (leaf?.type === 'text') { ed.setSel([leaf.id]); cv.editText(leaf) } else if (leaf && isShape(leaf)) { ed.setSel([leaf.id]); ed.setTool('direct') }
      },
      deactivate() { if (st?.tx) ed.cancel(st.tx); st = null },
      overlay() {
        let s = ''
        if (st?.mode === 'marquee') { const [x0, y0] = cv.S(Math.min(st.a.x, st.b.x), Math.min(st.a.y, st.b.y)), [x1, y1] = cv.S(Math.max(st.a.x, st.b.x), Math.max(st.a.y, st.b.y)); s += rect(x0, y0, x1 - x0, y1 - y0, 'ov-marquee') }
        const fr = frame()
        if (!fr) return s
        const top = ed.top
        if (top.length === 1) s += outline(top[0])
        if (top.length > 1) for (const n of top) { const b = bboxOf(n); if (b) { const [x0, y0] = cv.S(b.x, b.y); s += rect(x0, y0, b.w * cv.z, b.h * cv.z, 'ov-sub') } }
        s += rect(fr.x0, fr.y0, fr.x1 - fr.x0, fr.y1 - fr.y0, 'ov-box')
        s += gradOverlay()
        const w = fr.x1 - fr.x0, h = fr.y1 - fr.y0, r = 4.5
        for (const [k, [u, v]] of Object.entries(dirs)) {
          if ((k === 'n' || k === 's') && w < 28) continue
          if ((k === 'e' || k === 'w') && h < 28) continue
          s += sq(fr.x0 + w * u, fr.y0 + h * v, r, 'ov-h')
        }
        return s
      },
    }
  })()

  // ---------- Direct select ----------
  const direct = (() => {
    let st = null
    const targets = (whole = false) => leaves({ type: 'group', kids: whole ? ed.doc.nodes : ed.nodes }).filter((n) => isShape(n) && n.vis && !(whole && lockedAt(ed, n.id)))
    const subsOf = (n) => (n.type === 'path' ? n.subs : toSubs(n))
    const key = (n, s, i) => `${n.id}|${s}|${i}`
    const all = (whole = false) => { const out = []; for (const n of targets(whole)) subsOf(n).forEach((sub, s) => sub.pts.forEach((pt, i) => out.push({ n, s, i, sub, pt, key: key(n, s, i) }))); return out }
    const hitAnchor = (ev) => {
      const r = ev.touch ? 16 : 8
      let best = null
      for (const a of all()) { const [x, y] = cv.S(a.pt.x, a.pt.y), d = Math.hypot(ev.sx - x, ev.sy - y); if (d <= r && (!best || d < best.d)) best = { ...a, d } }
      return best
    }
    const visibleHandles = () => {
      const out = new Map()
      for (const k of ed.anchors) {
        const ref = ed.anchorRef(k)
        if (!ref) continue
        const n = ref.sub.pts.length
        const add = (idx, which) => {
          const pt = ref.sub.pts[idx]
          if (!pt || (which === 'i' ? !hasIn(pt) : !hasOut(pt))) return
          out.set(key(ref.node, ref.s, idx) + which, { node: ref.node, s: ref.s, i: idx, which, pt, sub: ref.sub })
        }
        add(ref.i, 'i'); add(ref.i, 'o')
        if (ref.sub.closed || ref.i > 0) add((ref.i - 1 + n) % n, 'o')
        if (ref.sub.closed || ref.i < n - 1) add((ref.i + 1) % n, 'i')
      }
      return [...out.values()]
    }
    const hitHandle = (ev) => {
      const r = ev.touch ? 16 : 7
      for (const hd of visibleHandles()) { const [x, y] = cv.S(hd.pt.x + hd.pt[hd.which + 'x'], hd.pt.y + hd.pt[hd.which + 'y']); if (Math.hypot(ev.sx - x, ev.sy - y) <= r) return hd }
      return null
    }
    const ensure = (nodes) => { for (const n of new Set(nodes)) if (n.type !== 'path') convertToPath(n) }

    return {
      cursor: 'default',
      hover(ev) { cv.updateCursor(hitAnchor(ev) || hitHandle(ev) ? 'pointer' : ev.id ? 'move' : 'default') },
      down(ev) {
        const hd = hitHandle(ev)
        if (hd) {
          const pt = hd.pt, o = hd.which === 'i' ? 'o' : 'i'
          st = { mode: 'handle', hd, tx: ed.begin('Edit handle'), smooth: isSmooth(pt), olen: Math.hypot(pt[o + 'x'], pt[o + 'y']) }
          return
        }
        const a = hitAnchor(ev)
        if (a) {
          const tx = ed.begin('Move points')
          if (ev.shift) { const k = a.key; ed.anchors.has(k) ? ed.anchors.delete(k) : ed.anchors.add(k) } else if (!ed.anchors.has(a.key)) { ed.anchors.clear(); ed.anchors.add(a.key) }
          if (!ed.sel.includes(a.n.id)) ed.setSel(ev.shift ? [...ed.sel, a.n.id] : [a.n.id], true)
          ensure([...ed.anchors].map((k) => get(ed.doc, k.split('|')[0])).filter(Boolean))
          const refs = [...ed.anchors].map((k) => ed.anchorRef(k)).filter(Boolean)
          st = { mode: 'anchors', tx, start: ev.p, s0: [ev.sx, ev.sy], refs: refs.map((r) => ({ r, x: r.pt.x, y: r.pt.y })), lead: refs.find((r) => key(r.node, r.s, r.i) === a.key) || refs[0], moved: false, T: cv.targets() }
          ed.emit('sel')
          return
        }
        if (ev.id) {
          const n = get(ed.doc, ev.id)
          if (n && !lockedAt(ed, n.id)) {
            if (ev.shift) ed.setSel(ed.sel.includes(n.id) ? ed.sel.filter((x) => x !== n.id) : [...ed.sel, n.id])
            else if (!ed.sel.includes(n.id)) ed.setSel([n.id])
            st = beginMove(ev)
            return
          }
        }
        if (!ev.shift) { ed.anchors.clear(); ed.clearSel() }
        st = { mode: 'marquee', a: ev.p, b: ev.p, shift: ev.shift }
      },
      move(ev) {
        if (!st) return
        if (st.mode === 'move') return dragMove(st, ev)
        if (st.mode === 'marquee') { st.b = ev.p; cv.scheduleOv(); return }
        if (st.mode === 'handle') {
          const { hd } = st, pt = hd.pt, o = hd.which === 'i' ? 'o' : 'i'
          let dx = ev.p.x - pt.x, dy = ev.p.y - pt.y
          if (ev.shift) { const a = Math.round(Math.atan2(dy, dx) / (45 * DEG)) * 45 * DEG, l = Math.hypot(dx, dy); dx = Math.cos(a) * l; dy = Math.sin(a) * l }
          pt[hd.which + 'x'] = dx; pt[hd.which + 'y'] = dy
          if (!ev.alt && (st.smooth || (!hasIn(pt) && !hasOut(pt)))) {
            const l = Math.hypot(dx, dy) || 1, len = st.smooth ? st.olen : Math.hypot(dx, dy)
            pt[o + 'x'] = (-dx / l) * len; pt[o + 'y'] = (-dy / l) * len
          }
          ed.touch(); cv.scheduleOv()
          return
        }
        if (st.mode === 'anchors') {
          if (!st.moved && Math.hypot(ev.sx - st.s0[0], ev.sy - st.s0[1]) < 3) return
          st.moved = true
          let dx = ev.p.x - st.start.x, dy = ev.p.y - st.start.y
          if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
          const lead = st.refs.find((x) => x.r === st.lead) || st.refs[0]
          if (lead) { const s = cv.snapPoint({ x: lead.x + dx, y: lead.y + dy }, st.T, ev.ctrl); dx = s.x - lead.x; dy = s.y - lead.y }
          for (const a of st.refs) { a.r.pt.x = a.x + dx; a.r.pt.y = a.y + dy }
          ed.touch(); cv.scheduleOv()
        }
      },
      up() {
        const s = st; st = null
        if (!s) return
        if (s.mode === 'marquee') {
          const x0 = Math.min(s.a.x, s.b.x), y0 = Math.min(s.a.y, s.b.y), x1 = Math.max(s.a.x, s.b.x), y1 = Math.max(s.a.y, s.b.y)
          const hits = all(true).filter((a) => a.pt.x >= x0 && a.pt.x <= x1 && a.pt.y >= y0 && a.pt.y <= y1)
          if (hits.length) {
            const tx = ed.begin('Select points')
            ensure(hits.map((a) => a.n))
            if (!s.shift) ed.anchors.clear()
            for (const a of hits) ed.anchors.add(key(a.n, a.s, a.i))
            ed.commit(tx)
            ed.setSel([...new Set([...(s.shift ? ed.sel : []), ...hits.map((a) => a.n.id)])], true)
          }
          ed.emit('sel'); return
        }
        if (s.tx) ed.commit(s.tx)
        ed.emit('doc')
      },
      cancel() { if (st?.tx) ed.cancel(st.tx); st = null },
      dblclick(ev) {
        const a = hitAnchor(ev)
        if (a) {
          ed.tx('Toggle smooth point', () => {
            ensure([a.n])
            const n = get(ed.doc, a.n.id), sub = n.subs[a.s], pt = sub.pts[a.i]
            if (hasIn(pt) || hasOut(pt)) makeCorner(pt); else makeSmooth(sub, a.i)
            ed.anchors.clear(); ed.anchors.add(key(n, a.s, a.i))
          })
          ed.emit('sel')
          return
        }
        let best = null
        for (const n of targets()) subsOf(n).forEach((sub, s) => { const h = nearestOnSub(sub, ev.p); if (h && h.dist * cv.z < 9 && (!best || h.dist < best.h.dist)) best = { n, s, h } })
        if (!best) { if (ev.id) { const n = get(ed.doc, ev.id); if (n?.type === 'text') { ed.setSel([n.id]); cv.editText(n) } } return }
        ed.tx('Add point', () => {
          ensure([best.n])
          const n = get(ed.doc, best.n.id), idx = splitSegment(n.subs[best.s], best.h.seg, best.h.t)
          ed.anchors.clear(); ed.anchors.add(key(n, best.s, idx))
          if (!ed.sel.includes(n.id)) ed.setSel([n.id], true)
        })
        ed.emit('sel')
      },
      deactivate() { if (st?.tx) ed.cancel(st.tx); st = null },
      overlay() {
        let s = ''
        if (st?.mode === 'marquee') { const [x0, y0] = cv.S(Math.min(st.a.x, st.b.x), Math.min(st.a.y, st.b.y)), [x1, y1] = cv.S(Math.max(st.a.x, st.b.x), Math.max(st.a.y, st.b.y)); s += rect(x0, y0, x1 - x0, y1 - y0, 'ov-marquee') }
        for (const n of targets()) {
          if (!ed.sel.includes(n.id) && !lineage(ed.doc, n.id).some((a) => ed.sel.includes(a.id))) continue
          s += outline(n)
        }
        for (const hd of visibleHandles()) {
          const [ax, ay] = cv.S(hd.pt.x, hd.pt.y), [hx, hy] = cv.S(hd.pt.x + hd.pt[hd.which + 'x'], hd.pt.y + hd.pt[hd.which + 'y'])
          s += `<line class="ov-hline" x1="${f(ax)}" y1="${f(ay)}" x2="${f(hx)}" y2="${f(hy)}"/>` + dot(hx, hy, 4, 'ov-hdot')
        }
        for (const a of all()) {
          if (!ed.sel.includes(a.n.id) && !lineage(ed.doc, a.n.id).some((x) => ed.sel.includes(x.id))) continue
          const [x, y] = cv.S(a.pt.x, a.pt.y)
          s += sq(x, y, 4.5, ed.anchors.has(a.key) ? 'ov-anchor sel' : 'ov-anchor')
        }
        return s
      },
    }
  })()

  // ---------- Pen ----------
  const pen = (() => {
    let b = null // building: {node, sub, tx}
    let drag = null // {idx, closing}
    let last = { t: 0, sx: 0, sy: 0 }
    const finish = (select = true) => {
      if (!b) return
      const { node, sub, tx } = b
      b = null; drag = null; cv.guides = { x: [], y: [] }
      if (sub.pts.length < 2) { ed.cancel(tx); ed.emit('doc'); return }
      if (sub.closed && ed.style.fill) node.fill = structuredClone(ed.style.fill)
      ed.commit(tx)
      if (select) ed.setSel([node.id], false, false)
      ed.emit('doc')
    }
    return {
      cursor: 'crosshair',
      down(ev) {
        const now = performance.now(), dbl = b && now - last.t < 350 && Math.hypot(ev.sx - last.sx, ev.sy - last.sy) < 6
        last = { t: now, sx: ev.sx, sy: ev.sy }
        const T = b?.T || cv.targets()
        let p = cv.snapPoint(ev.p, T, ev.ctrl)
        if (b && ev.shift) { const q = b.sub.pts.at(-1), a = Math.round(Math.atan2(p.y - q.y, p.x - q.x) / (45 * DEG)) * 45 * DEG, l = dist(p, q); p = { x: q.x + Math.cos(a) * l, y: q.y + Math.sin(a) * l } }
        if (!b) {
          const tx = ed.begin('Pen path')
          const node = mk(ed.doc, 'path', { subs: [{ closed: false, pts: [P(p.x, p.y)] }] }, lineStyle())
          ed.add(node)
          b = { node, sub: node.subs[0], tx, T }
          drag = { idx: 0 }
          return
        }
        if (dbl) { const pts = b.sub.pts; if (pts.length > 1 && dist(pts.at(-1), pts.at(-2)) < 1e-6) pts.pop(); finish(); return false }
        const pts = b.sub.pts
        const [fx, fy] = cv.S(pts[0].x, pts[0].y)
        if (pts.length >= 3 && Math.hypot(fx - ev.sx, fy - ev.sy) < (ev.touch ? 16 : 9)) {
          b.sub.closed = true; drag = { idx: 0, closing: true }; ed.touch(); return
        }
        pts.push(P(p.x, p.y)); drag = { idx: pts.length - 1 }; ed.touch()
      },
      move(ev) {
        if (!b || !drag) return
        const pt = b.sub.pts[drag.idx]
        const dx = ev.p.x - pt.x, dy = ev.p.y - pt.y
        if (Math.hypot(dx, dy) * cv.z < 3) return
        pt.ox = dx; pt.oy = dy; pt.ix = -dx; pt.iy = -dy
        ed.touch(); cv.scheduleOv()
      },
      up() {
        if (drag?.closing) finish()
        drag = null
      },
      hover(ev) { if (b) { cv.pointer = cv.snapPoint(ev.p, b.T, ev.ctrl); cv.scheduleOv() } },
      cancel() { if (b) { drag = null; finish() } },
      key(e) {
        if (!b) return false
        if (e.key === 'Enter' || e.key === 'Escape') { finish(); return true }
        if (e.key === 'Backspace' || e.key === 'Delete') { b.sub.pts.pop(); if (b.sub.pts.length < 1) { ed.cancel(b.tx); b = null; ed.emit('doc') } else { const l = b.sub.pts.at(-1); l.ox = l.oy = 0; ed.touch() } return true }
        return false
      },
      undo() { if (!b) return false; return this.key({ key: 'Backspace' }) },
      deactivate() { finish() },
      overlay() {
        if (!b) return ''
        let s = ''
        const pts = b.sub.pts, last = pts.at(-1)
        if (cv.pointer && !b.sub.closed) {
          const [ax, ay] = cv.S(last.x, last.y), [bx, by] = cv.S(cv.pointer.x, cv.pointer.y)
          s += hasOut(last) ? `<path class="ov-rubber" d="M${f(ax)} ${f(ay)}C${f(ax + last.ox * cv.z)} ${f(ay + last.oy * cv.z)} ${f(bx)} ${f(by)} ${f(bx)} ${f(by)}"/>` : `<line class="ov-rubber" x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}"/>`
        }
        pts.forEach((p, i) => {
          const [x, y] = cv.S(p.x, p.y)
          if (hasOut(p) || hasIn(p)) { for (const w of ['i', 'o']) { const hx = x + p[w + 'x'] * cv.z, hy = y + p[w + 'y'] * cv.z; if (p[w + 'x'] || p[w + 'y']) s += `<line class="ov-hline" x1="${f(x)}" y1="${f(y)}" x2="${f(hx)}" y2="${f(hy)}"/>` + dot(hx, hy, 3.5, 'ov-hdot') } }
          s += sq(x, y, 4, i === pts.length - 1 ? 'ov-anchor sel' : 'ov-anchor')
        })
        if (pts.length >= 3 && cv.pointer && !b.sub.closed) { const [x, y] = cv.S(pts[0].x, pts[0].y), [px, py] = cv.S(cv.pointer.x, cv.pointer.y); if (Math.hypot(px - x, py - y) < 9) s += dot(x, y, 8, 'ov-ring') }
        return s
      },
    }
  })()

  // ---------- Pencil ----------
  const pencil = (() => {
    let st = null
    return {
      cursor: 'crosshair',
      down(ev) { st = { pts: [ev.p], tx: ed.begin('Pencil') } },
      move(ev) {
        if (!st) return
        const q = st.pts.at(-1)
        if (Math.hypot(ev.p.x - q.x, ev.p.y - q.y) * cv.z >= 2) { st.pts.push(ev.p); cv.scheduleOv() }
      },
      up() {
        const s = st; st = null
        if (!s) return
        if (s.pts.length < 2) { ed.cancel(s.tx); return }
        const pts = rdp(s.pts, Math.max(0.2, ed.tp.smooth) / cv.z)
        const closed = pts.length > 3 && dist(pts[0], pts.at(-1)) * cv.z < 10
        if (closed) pts.pop()
        const sub = fitSmooth(pts, closed)
        const node = mk(ed.doc, 'path', { subs: [sub] }, closed ? pickStyle(ed.style) : lineStyle())
        ed.add(node)
        ed.commit(s.tx)
      },
      cancel() { if (st) ed.cancel(st.tx); st = null },
      deactivate() { st = null },
      overlay() {
        if (!st || st.pts.length < 2) return ''
        return `<path class="ov-rubber" d="M${st.pts.map((p) => cv.S(p.x, p.y).map(f).join(' ')).join('L')}"/>`
      },
    }
  })()

  // ---------- Shapes ----------
  function shapeTool(kind) {
    let st = null
    const make = (c) => {
      const style = kind === 'line' ? lineStyle() : pickStyle(ed.style)
      if (kind === 'rect') return mk(ed.doc, 'rect', { x: 0, y: 0, w: 1, h: 1, rx: ed.tp.radius, ry: ed.tp.radius }, style)
      if (kind === 'ellipse') return mk(ed.doc, 'ellipse', { cx: 0, cy: 0, rx: 1, ry: 1 }, style)
      return mk(ed.doc, 'path', { subs: [{ closed: false, pts: [] }] }, style)
    }
    const update = (n, a, b, ev) => {
      let dx = b.x - a.x, dy = b.y - a.y
      if (kind === 'rect' || kind === 'ellipse') {
        if (ev.shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m }
        let x0 = a.x, y0 = a.y, x1 = a.x + dx, y1 = a.y + dy
        if (ev.alt) { x0 = a.x - dx; y0 = a.y - dy }
        const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
        if (kind === 'rect') Object.assign(n, { x, y, w, h })
        else Object.assign(n, { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 })
      } else if (kind === 'polygon') {
        n.subs = polygonSubs(a.x, a.y, Math.max(1, Math.hypot(dx, dy)), Math.max(3, Math.round(ed.tp.sides)))
      } else if (kind === 'star') {
        const r = Math.max(1, Math.hypot(dx, dy))
        n.subs = starSubs(a.x, a.y, r, r * ed.tp.inner, Math.max(3, Math.round(ed.tp.points)))
      } else if (kind === 'line') {
        if (ev.shift) { const ang = Math.round(Math.atan2(dy, dx) / (45 * DEG)) * 45 * DEG, l = Math.hypot(dx, dy); dx = Math.cos(ang) * l; dy = Math.sin(ang) * l }
        n.subs = lineSubs(ev.alt ? a.x - dx : a.x, ev.alt ? a.y - dy : a.y, a.x + dx, a.y + dy)
      }
    }
    return {
      cursor: 'crosshair',
      down(ev) { const T = cv.targets(); st = { a: cv.snapPoint(ev.p, T, ev.ctrl), T, node: null, tx: ed.begin('Draw ' + kind), s0: [ev.sx, ev.sy], moved: false } },
      move(ev) {
        if (!st) return
        if (!st.moved && Math.hypot(ev.sx - st.s0[0], ev.sy - st.s0[1]) < 3) return
        st.moved = true
        if (!st.node) { st.node = make(); ed.add(st.node) }
        update(st.node, st.a, cv.snapPoint(ev.p, st.T, ev.ctrl), ev)
        ed.emit('status', `${f(Math.abs(ev.p.x - st.a.x))} x ${f(Math.abs(ev.p.y - st.a.y))}`)
        ed.touch(); cv.scheduleOv()
      },
      up() {
        const s = st; st = null
        if (!s) return
        if (!s.node) {
          const n = make(), a = s.a
          if (kind === 'rect') Object.assign(n, { x: a.x - 50, y: a.y - 50, w: 100, h: 100 })
          else if (kind === 'ellipse') Object.assign(n, { cx: a.x, cy: a.y, rx: 50, ry: 50 })
          else update(n, a, kind === 'line' ? { x: a.x + 50, y: a.y } : { x: a.x, y: a.y - 60 }, { shift: false, alt: kind === 'line' })
          ed.add(n)
          s.node = n
        }
        ed.commit(s.tx)
      },
      cancel() { if (st) ed.cancel(st.tx); st = null },
      deactivate() { if (st) ed.cancel(st.tx); st = null },
    }
  }

  // ---------- Text ----------
  const text = {
    cursor: 'text',
    down(ev) {
      const hit = ev.id && get(ed.doc, ev.id)
      if (hit?.type === 'text' && !lockedAt(ed, hit.id)) { ed.setSel([hit.id]); cv.editText(hit); return false }
      const tx = ed.begin('Add text'), { fs, ff, fw, fi, ta } = ed.tp
      const node = mk(ed.doc, 'text', { x: ev.p.x, y: ev.p.y, text: 'Text', ff, fs, fw, fi, ta, lh: 1.2, ls: 0 }, { ...pickStyle(ed.style), stroke: null, fill: ed.style.fill || solid('#1b1b2f') })
      ed.add(node)
      cv.editText(node, tx)
      return false
    },
  }

  // ---------- Eyedropper ----------
  const eyedrop = {
    cursor: 'copy',
    down(ev) {
      const src = ev.id && get(ed.doc, ev.id)
      if (!src || src.type === 'group' || src.type === 'image') return false
      const s = pickStyle(src)
      if (ed.sel.length) ed.setStyle(s, null)
      else { Object.assign(ed.style, s); ed.emit('style') }
      ed.emit('status', 'Style picked')
      return false
    },
  }

  return {
    select, direct, pen, pencil, text, eyedrop,
    rect: shapeTool('rect'), ellipse: shapeTool('ellipse'), polygon: shapeTool('polygon'), star: shapeTool('star'), line: shapeTool('line'),
    hand: { cursor: 'grab' },
  }
}
