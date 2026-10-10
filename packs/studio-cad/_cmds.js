// Command interpreter for CAD Studio: AutoCAD-style commands written as async functions that await prompts
// (points, numbers, objects, keywords) from the canvas or the command line. No DOM here; the app object supplies the UI hooks.
import { TAU, D2R, R2D, pt, dist, sub, add, cross, len, unit, mid, perp, polar, angle, norm, angDiff, same, Tf, loopArea, intersectPrims } from './_vec.js'
import { prims, transform, distTo, explode, measure, bbox } from './_ent.js'
import { trimEntity, extendEntity, offsetEntity, cornerLines, filletPolyline, hatchBoundaryAt, HATCH_PATTERNS } from './_edit.js'
import { fmtNum } from './_dim.js'
import { UNITS } from './_doc.js'

export const CANCEL = Symbol('cancel')

/** Command name aliases (AutoCAD style). */
export const ALIASES = {
  L: 'LINE', LINE: 'LINE', PL: 'PLINE', PLINE: 'PLINE', POLYLINE: 'PLINE', C: 'CIRCLE', CIRCLE: 'CIRCLE', A: 'ARC', ARC: 'ARC',
  REC: 'RECTANG', RECT: 'RECTANG', RECTANG: 'RECTANG', RECTANGLE: 'RECTANG', EL: 'ELLIPSE', ELLIPSE: 'ELLIPSE', T: 'TEXT', TEXT: 'TEXT', DT: 'TEXT', MT: 'TEXT', MTEXT: 'TEXT',
  H: 'HATCH', HATCH: 'HATCH', BH: 'HATCH', M: 'MOVE', MOVE: 'MOVE', CO: 'COPY', CP: 'COPY', COPY: 'COPY', RO: 'ROTATE', ROTATE: 'ROTATE', SC: 'SCALE', SCALE: 'SCALE',
  MI: 'MIRROR', MIRROR: 'MIRROR', O: 'OFFSET', OFFSET: 'OFFSET', TR: 'TRIM', TRIM: 'TRIM', EX: 'EXTEND', EXTEND: 'EXTEND', F: 'FILLET', FILLET: 'FILLET',
  CHA: 'CHAMFER', CHAMFER: 'CHAMFER', E: 'ERASE', ERASE: 'ERASE', DEL: 'ERASE', X: 'EXPLODE', EXPLODE: 'EXPLODE', AR: 'ARRAY', ARRAY: 'ARRAY',
  DIM: 'DIM', DIMLINEAR: 'DIMLINEAR', DLI: 'DIMLINEAR', DIMALIGNED: 'DIMALIGNED', DAL: 'DIMALIGNED', DIMRADIUS: 'DIMRADIUS', DRA: 'DIMRADIUS',
  DIMDIAMETER: 'DIMDIAMETER', DDI: 'DIMDIAMETER', DIMANGULAR: 'DIMANGULAR', DAN: 'DIMANGULAR',
  DI: 'DIST', DIST: 'DIST', DISTANCE: 'DIST', AREA: 'AREA', AA: 'AREA', ID: 'ID',
  Z: 'ZOOM', ZOOM: 'ZOOM', ZE: 'ZOOME', P: 'PAN', PAN: 'PAN', U: 'UNDO', UNDO: 'UNDO', REDO: 'REDO',
  ORTHO: 'ORTHO', GRID: 'GRID', SNAP: 'SNAP', OSNAP: 'OSNAP', OS: 'OSNAP', POLAR: 'POLAR', LWT: 'LWT',
  LA: 'LAYER', LAYER: 'LAYER', UNITS: 'UNITS', SETTINGS: 'UNITS', REGEN: 'REGEN', RE: 'REGEN', REDRAW: 'REGEN',
  NEW: 'NEW', OPEN: 'OPEN', SAVE: 'SAVE', QSAVE: 'SAVE', EXPORT: 'EXPORT', DXFOUT: 'EXPORT', PLOT: 'EXPORT', PRINT: 'EXPORT', DXFIN: 'IMPORT', IMPORT: 'IMPORT', INSERT: 'IMPORT',
  HELP: 'HELP', '?': 'HELP', SELECTALL: 'SELECTALL', ALL: 'SELECTALL',
}

export const COMMAND_HELP = [
  ['Draw', 'L line, PL polyline, REC rectangle, C circle, A arc, EL ellipse, T text, H hatch'],
  ['Modify', 'M move, CO copy, RO rotate, SC scale, MI mirror, O offset, TR trim, EX extend, F fillet, CHA chamfer, E erase, X explode, AR array'],
  ['Annotate', 'DIM, DLI linear, DAL aligned, DRA radius, DDI diameter, DAN angular'],
  ['Inquire', 'DI distance, AREA, ID point'],
  ['View', 'Z zoom (E extents, W window), P pan, ORTHO, GRID, SNAP, OSNAP, POLAR, LWT'],
  ['Points', 'Type 10,20 (absolute), @5,3 (relative), @10<45 (polar), or just a number for a distance in the cursor direction'],
]

/** Parse a typed coordinate. Returns a point or null. `last` is the previous point, `dirPt` a point showing the cursor direction. */
export function parseCoord(text, last, dirPt) {
  const t = text.trim().replace(/^#/, '')
  const rel = t.startsWith('@')
  const body = rel ? t.slice(1) : t
  const origin = rel ? last || pt(0, 0) : pt(0, 0)
  let m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*,\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)$/i.exec(body)
  if (m) return { x: origin.x + parseFloat(m[1]), y: origin.y + parseFloat(m[2]) }
  m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*<\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)$/i.exec(body)
  if (m) { const d = parseFloat(m[1]), a = parseFloat(m[2]) * D2R; return { x: origin.x + Math.cos(a) * d, y: origin.y + Math.sin(a) * d } }
  m = /^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.exec(body)
  if (m && !rel && last && dirPt) {
    const d = parseFloat(body)
    const v = sub(dirPt, last)
    const u = len(v) < 1e-12 ? pt(1, 0) : unit(v)
    return { x: last.x + u.x * d, y: last.y + u.y * d }
  }
  return null
}

const num = (s) => { const v = parseFloat(String(s).replace(/,/g, '.')); return Number.isFinite(v) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(String(s).trim().replace(/,/g, '.')) ? v : NaN }

export function createCommands(app) {
  let active = null
  let lastCmd = null

  // ---------- prompts ----------
  function ask(spec) {
    return new Promise((resolve, reject) => {
      const done = (fn) => (v) => { app.prompt = null; app.ghost([]); app.promptChanged(); fn(v) }
      app.prompt = { ...spec, resolve: done(resolve), reject: done(reject) }
      app.promptChanged()
    })
  }
  const kwMatch = (kws, t) => {
    const s = t.toLowerCase()
    return (kws || []).find((k) => k.toLowerCase() === s) || (kws || []).find((k) => k.toLowerCase().startsWith(s))
  }

  const api = {
    /** UI: a click on the canvas. info = { pt (snapped world point), raw, hit (entity under the cursor), snapKind, shift } */
    click(info) {
      const p = app.prompt
      if (!p) return false
      if (p.type === 'point') {
        const r = { x: info.pt.x, y: info.pt.y, hit: info.hit, snapKind: info.snapKind }
        app.lastPoint = pt(r.x, r.y)
        p.resolve(r)
        return true
      }
      if (p.type === 'dist' || p.type === 'angle') {
        if (!p.base) { p.base = pt(info.pt.x, info.pt.y); app.promptChanged(); return true }
        app.lastPoint = pt(info.pt.x, info.pt.y)
        p.resolve(p.type === 'dist' ? dist(p.base, info.pt) : angle(p.base, info.pt))
        return true
      }
      if (p.type === 'pick') {
        const e = info.hit
        if (!e || (p.filter && !p.filter(e))) { app.log('Nothing to pick there.', 'warn'); return true }
        p.resolve({ ent: e, pt: pt(info.raw.x, info.raw.y), shift: info.shift })
        return true
      }
      return p.type === 'select'
    },
    /** UI: Enter, Space or right click. */
    enter() {
      const p = app.prompt
      if (!p) { if (lastCmd) api.run(lastCmd); return }
      if (p.type === 'select') return p.resolve([...app.sel].map((id) => app.doc.byId(id)).filter((e) => e && (!p.filter || p.filter(e))))
      if (p.type === 'point') return p.enter ? p.resolve(null) : api.cancel()
      if (p.def !== undefined && p.def !== null) return p.resolve(p.def)
      if (p.enter) return p.resolve(null)
      api.cancel()
    },
    /** UI: text typed in the command line. */
    text(raw) {
      const t = raw.trim()
      const p = app.prompt
      if (!p) { if (!t) return api.enter(); return api.run(t) }
      app.log(`${p.line}${t}`, 'in')
      if (!t) return api.enter()
      if (p.type === 'text') return p.resolve(raw)
      const isNum = Number.isFinite(num(t))
      const k = p.kws && !isNum && !parseCoord(t, app.lastPoint, null) ? kwMatch(p.kws, t) : null
      if (k) return p.resolve({ kw: k })
      switch (p.type) {
        case 'point': {
          const r = parseCoord(t, app.lastPoint, p.base ? app.cursor : null)
          if (!r) return app.log('Enter a point as x,y or @dx,dy or @distance<angle, or an option.', 'warn')
          app.lastPoint = r
          return p.resolve({ x: r.x, y: r.y })
        }
        case 'number': {
          const v = num(t)
          return Number.isNaN(v) ? app.log('Enter a number or an option.', 'warn') : p.resolve(v)
        }
        case 'dist': {
          const v = num(t)
          if (!Number.isNaN(v)) return p.resolve(v)
          const q = parseCoord(t, p.base || app.lastPoint, app.cursor)
          if (q && p.base) return p.resolve(dist(p.base, q))
          return app.log('Enter a distance or an option.', 'warn')
        }
        case 'angle': {
          const v = num(t)
          return Number.isNaN(v) ? app.log('Enter an angle in degrees or an option.', 'warn') : p.resolve(v * D2R)
        }
        case 'select': {
          if (t.toLowerCase() === 'all' || t.toLowerCase() === 'a') { app.selectAll(); return app.log(`${app.sel.size} found.`, 'info') }
          return app.log('Click objects, drag a window, type ALL, or press Enter to finish.', 'warn')
        }
        default: return app.log('Choose one of the options shown, or press Enter.', 'warn')
      }
    },
    cancel() {
      if (app.prompt) app.prompt.reject(CANCEL)
    },
    /** Undo from the keyboard while a prompt offers an Undo option. */
    wantsUndo() {
      const p = app.prompt
      if (p?.kws?.includes('Undo')) { p.resolve({ kw: 'Undo' }); return true }
      return false
    },
    isActive: () => !!active,
    activeName: () => active?.name,
    lastCommand: () => lastCmd,
    async run(text, opts = {}) {
      const parts = text.trim().split(/\s+/)
      const name = ALIASES[parts[0].toUpperCase()]
      if (!name) { app.log(`Unknown command "${parts[0]}". Type HELP for the list.`, 'warn'); return }
      if (active) { const prev = active; app.prompt?.reject(CANCEL); await prev.done }
      return start(name, parts.slice(1), opts)
    },
    /** Run a one-off command function (grip edits, paste) with the same prompts. */
    async runFn(name, fn, opts = {}) {
      if (active) { const prev = active; app.prompt?.reject(CANCEL); await prev.done }
      return start(name, [], opts, fn)
    },
  }

  async function start(name, args, opts, override) {
    const fn = override || COMMANDS[name]
    if (!fn) return
    const ctx = makeCtx(name, opts)
    const run = { name, done: null }
    active = run
    app.commandChanged(name)
    app.log(`Command: ${name}`, 'cmd')
    run.done = (async () => {
      try { await fn(ctx, args) } catch (e) {
        if (e === CANCEL) app.log('*Cancel*', 'muted')
        else { console.error(e); app.log(e?.userMessage || e?.message || String(e), 'err') }
      } finally {
        if (active === run) active = null
        app.prompt = null
        app.ghost([])
        app.commandChanged(null)
        if (!override && !['UNDO', 'REDO', 'ZOOM', 'ZOOME', 'PAN', 'REGEN', 'HELP', 'LAYER', 'UNITS'].includes(name)) lastCmd = name
        app.promptChanged()
      }
    })()
    return run.done
  }

  // ---------- command context ----------
  function makeCtx(name, opts = {}) {
    let pre = !!opts.preselect
    const lineText = (msg, kws, def) => `${name} ${msg}${kws?.length ? ` [${kws.join('/')}]` : ''}${def != null ? ` <${def}>` : ''}: `
    const c = {
      name,
      doc: app.doc,
      settings: () => app.doc.settings,
      say: (m, kind = 'info') => app.log(m, kind),
      fail(m) { return Object.assign(new Error(m), { userMessage: m }) },
      async point(msg, o = {}) {
        const line = lineText(msg, o.kws, null)
        app.log(line, 'prompt')
        return ask({ type: 'point', msg, line, kws: o.kws, base: o.base || null, enter: !!o.enter, preview: o.preview, ortho: o.base ? true : false })
      },
      async number(msg, o = {}) {
        const line = lineText(msg, o.kws, o.def != null ? +(+o.def).toFixed(4) : null)
        app.log(line, 'prompt')
        for (;;) {
          const r = await ask({ type: 'number', msg, line, kws: o.kws, def: o.def, enter: o.def != null })
          if (r && typeof r === 'object') return r
          if (o.min != null && r < o.min) { app.log(`Value must be at least ${o.min}.`, 'warn'); continue }
          return r
        }
      },
      async dist(msg, o = {}) {
        const line = lineText(msg, o.kws, o.def != null ? +(+o.def).toFixed(4) : null)
        app.log(line, 'prompt')
        return ask({ type: 'dist', msg, line, kws: o.kws, base: o.base || null, def: o.def, enter: o.def != null, preview: o.preview })
      },
      async angle(msg, o = {}) {
        const line = lineText(msg, o.kws, o.def != null ? +(o.def * R2D).toFixed(3) : null)
        app.log(line, 'prompt')
        return ask({ type: 'angle', msg, line, kws: o.kws, base: o.base || null, def: o.def, enter: o.def != null, preview: o.preview })
      },
      async text(msg, o = {}) {
        const line = lineText(msg, null, o.def)
        app.log(line, 'prompt')
        return ask({ type: 'text', msg, line, def: o.def, enter: true })
      },
      async kw(msg, kws, def) {
        const line = lineText(msg, kws, def)
        app.log(line, 'prompt')
        const r = await ask({ type: 'kw', msg, line, kws, def: def != null ? { kw: def } : undefined, enter: false })
        return r.kw
      },
      async pick(msg, o = {}) {
        const line = lineText(msg, o.kws, null)
        app.log(line, 'prompt')
        return ask({ type: 'pick', msg, line, kws: o.kws, filter: o.filter, enter: !!o.enter })
      },
      async select(msg, o = {}) {
        if (pre && app.sel.size) {
          pre = false
          const have = app.selected().filter((e) => !o.filter || o.filter(e))
          if (have.length) { app.log(`${have.length} selected.`, 'info'); return have }
        }
        pre = false
        const line = lineText(msg, ['All'], null)
        app.log(line, 'prompt')
        for (;;) {
          const r = await ask({ type: 'select', msg, line, kws: ['All'], filter: o.filter, enter: true })
          if (r && r.kw === 'All') { app.selectAll(); app.log(`${app.sel.size} found.`, 'info'); continue }
          return r
        }
      },
      clearSel: () => app.clearSelection(),
      ghost: (g) => app.ghost(g),
      undo: () => app.doc.undo(),
      mk: (e) => ({ layer: app.cur.layer, color: app.cur.color, ltype: app.cur.ltype, ...e }),
      add(label, ...ents) {
        c.checkLayer()
        return app.doc.commit(label, (tx) => ents.flat().forEach((e) => tx.add(e)))
      },
      commit: (label, fn) => app.doc.commit(label, fn),
      checkLayer() {
        const l = app.doc.layer(app.cur.layer)
        if (!l.visible || l.locked) throw c.fail(`The current layer "${l.name}" is ${l.locked ? 'locked' : 'turned off'}. Pick another layer first.`)
      },
      replaceAll(label, ents, t) { return app.doc.commit(label, (tx) => ents.forEach((e) => tx.replace(e.id, transform(e, t)))) },
      ghosts: (ents, t) => ents.slice(0, 300).map((e) => transform(e, t)),
      all: () => app.doc.visible().filter((e) => app.selectable(e)),
      last: app.last,
      app,
    }
    return c
  }

  // ---------- entity builders (also used for previews) ----------
  const mkLine = (c, a, b) => c.mk({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  const mkCircle = (c, ctr, r) => c.mk({ type: 'circle', cx: ctr.x, cy: ctr.y, r })
  const mkPoly = (c, pts, closed) => c.mk({ type: 'polyline', closed, pts: pts.map((p) => ({ x: p.x, y: p.y, b: p.b || 0 })) })
  const rectPts = (a, b) => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]
  function circum(a, b, d) {
    const k = 2 * (a.x * (b.y - d.y) + b.x * (d.y - a.y) + d.x * (a.y - b.y))
    if (Math.abs(k) < 1e-12) return null
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, d2 = d.x * d.x + d.y * d.y
    const ctr = { x: (a2 * (b.y - d.y) + b2 * (d.y - a.y) + d2 * (a.y - b.y)) / k, y: (a2 * (d.x - b.x) + b2 * (a.x - d.x) + d2 * (b.x - a.x)) / k }
    return { c: ctr, r: dist(ctr, a) }
  }
  const arcThrough = (c, p1, p2, p3) => {
    const o = circum(p1, p2, p3)
    if (!o) return null
    const ccw = cross(sub(p2, p1), sub(p3, p2)) > 0
    return c.mk({ type: 'arc', cx: o.c.x, cy: o.c.y, r: o.r, a0: norm(angle(o.c, ccw ? p1 : p3)), a1: norm(angle(o.c, ccw ? p3 : p1)) })
  }
  function ellipseFrom(c, ctr, majorEnd, minorDist) {
    const a = dist(ctr, majorEnd)
    if (a < 1e-9 || minorDist < 1e-9) return null
    if (minorDist <= a) return c.mk({ type: 'ellipse', cx: ctr.x, cy: ctr.y, mx: majorEnd.x - ctr.x, my: majorEnd.y - ctr.y, ratio: minorDist / a, t0: 0, t1: TAU })
    const v = perp(sub(majorEnd, ctr))
    const k = minorDist / a
    return c.mk({ type: 'ellipse', cx: ctr.x, cy: ctr.y, mx: v.x * k, my: v.y * k, ratio: a / minorDist, t0: 0, t1: TAU })
  }

  const COMMANDS = {
    // ---------- Draw ----------
    async LINE(c) {
      const first = await c.point('Specify first point')
      if (!first) return
      let prev = first, made = 0
      const pts = [first]
      for (;;) {
        const kws = made > 1 ? ['Undo', 'Close'] : made ? ['Undo'] : []
        const r = await c.point('Specify next point', { base: prev, kws, enter: true, preview: (q) => [mkLine(c, prev, q)] })
        if (!r) return
        if (r.kw === 'Undo') { c.undo(); made--; pts.pop(); prev = pts[pts.length - 1]; continue }
        if (r.kw === 'Close') { c.add('Line', mkLine(c, prev, first)); return }
        if (dist(prev, r) < 1e-12) { c.say('That point is the same as the last one.', 'warn'); continue }
        c.add('Line', mkLine(c, prev, r))
        made++; pts.push(r); prev = r
      }
    },

    async PLINE(c) {
      const p0 = await c.point('Specify start point')
      if (!p0) return
      const pts = [{ x: p0.x, y: p0.y, b: 0 }]
      let arcMode = false
      const tangentAtEnd = () => {
        const n = pts.length
        if (n < 2) return null
        const a = pts[n - 2], b = pts[n - 1]
        return angle(a, b) + (a.b ? 2 * Math.atan(a.b) : 0)
      }
      const withNext = (q) => {
        const copy = pts.map((p) => ({ ...p }))
        const last = copy[copy.length - 1]
        if (arcMode) {
          const tau = tangentAtEnd() ?? angle(last, q)
          const th = 2 * angDiff(angle(last, q), tau)
          last.b = Math.tan(th / 4)
        }
        copy.push({ x: q.x, y: q.y, b: 0 })
        return copy
      }
      for (;;) {
        const kws = [pts.length > 1 ? 'Undo' : null, pts.length > 2 ? 'Close' : null, arcMode ? 'Line' : 'Arc'].filter(Boolean)
        const last = pts[pts.length - 1]
        const r = await c.point(arcMode ? 'Specify endpoint of arc' : 'Specify next point', { base: last, kws, enter: true, preview: (q) => [mkPoly(c, withNext(q), false)] })
        if (!r) break
        if (r.kw === 'Undo') { pts.pop(); pts[pts.length - 1].b = 0; continue }
        if (r.kw === 'Arc') { arcMode = true; continue }
        if (r.kw === 'Line') { arcMode = false; continue }
        if (r.kw === 'Close') { c.add('Polyline', mkPoly(c, pts, true)); return }
        if (dist(last, r) < 1e-12) continue
        const next = withNext(r)
        pts.length = 0
        pts.push(...next)
      }
      if (pts.length >= 2) c.add('Polyline', mkPoly(c, pts, false))
    },

    async RECTANG(c) {
      const a = await c.point('Specify first corner point')
      if (!a) return
      const r = await c.point('Specify other corner point', { base: a, kws: ['Dimensions'], preview: (q) => [mkPoly(c, rectPts(a, q), true)] })
      if (!r) return
      let b = r
      if (r.kw === 'Dimensions') {
        const w = await c.number('Specify length for rectangles', { def: c.last.rectW || 100, min: 1e-9 })
        const h = await c.number('Specify width for rectangles', { def: c.last.rectH || 50, min: 1e-9 })
        if (typeof w !== 'number' || typeof h !== 'number') return
        c.last.rectW = w; c.last.rectH = h
        const o = await c.point('Specify other corner point to set the direction', { base: a, preview: (q) => [mkPoly(c, rectPts(a, { x: a.x + (q.x < a.x ? -w : w), y: a.y + (q.y < a.y ? -h : h) }), true)] })
        if (!o) return
        b = { x: a.x + (o.x < a.x ? -w : w), y: a.y + (o.y < a.y ? -h : h) }
      }
      if (Math.abs(b.x - a.x) < 1e-12 || Math.abs(b.y - a.y) < 1e-12) throw c.fail('The rectangle has no area. Pick two corners that are not in line.')
      c.add('Rectangle', mkPoly(c, rectPts(a, b), true))
    },

    async CIRCLE(c) {
      const r0 = await c.point('Specify center point for circle or', { kws: ['3P', '2P'] })
      if (!r0) return
      if (r0.kw === '3P') {
        const p1 = await c.point('Specify first point on circle'); if (!p1) return
        const p2 = await c.point('Specify second point on circle', { base: p1 }); if (!p2) return
        const p3 = await c.point('Specify third point on circle', { base: p2, preview: (q) => { const o = circum(p1, p2, q); return o ? [mkCircle(c, o.c, o.r)] : [] } }); if (!p3) return
        const o = circum(p1, p2, p3)
        if (!o) throw c.fail('Those three points are in a straight line, so no circle fits.')
        return c.add('Circle', mkCircle(c, o.c, o.r))
      }
      if (r0.kw === '2P') {
        const p1 = await c.point('Specify first end point of circle diameter'); if (!p1) return
        const p2 = await c.point('Specify second end point of circle diameter', { base: p1, preview: (q) => [mkCircle(c, mid(p1, q), dist(p1, q) / 2)] }); if (!p2) return
        if (dist(p1, p2) < 1e-12) throw c.fail('The two points are the same.')
        return c.add('Circle', mkCircle(c, mid(p1, p2), dist(p1, p2) / 2))
      }
      const ctr = r0
      let r = await c.dist('Specify radius of circle', { base: ctr, def: c.last.radius, kws: ['Diameter'], preview: (d) => (d > 0 ? [mkCircle(c, ctr, d)] : []) })
      if (r && r.kw === 'Diameter') {
        const d = await c.dist('Specify diameter of circle', { base: ctr, def: c.last.radius ? c.last.radius * 2 : undefined, preview: (d2) => (d2 > 0 ? [mkCircle(c, ctr, d2 / 2)] : []) })
        r = d / 2
      }
      if (!(r > 0)) throw c.fail('The radius must be greater than zero.')
      c.last.radius = r
      c.add('Circle', mkCircle(c, ctr, r))
    },

    async ARC(c) {
      const first = await c.point('Specify start point of arc or', { kws: ['Center'] })
      if (!first) return
      if (first.kw === 'Center') {
        const ctr = await c.point('Specify center point of arc'); if (!ctr) return
        const s = await c.point('Specify start point of arc', { base: ctr }); if (!s) return
        const r = dist(ctr, s)
        const mkA = (a1) => c.mk({ type: 'arc', cx: ctr.x, cy: ctr.y, r, a0: norm(angle(ctr, s)), a1: norm(a1) })
        const e = await c.point('Specify end point of arc (counter-clockwise) or', { base: ctr, kws: ['Angle'], preview: (q) => [mkA(angle(ctr, q))] })
        if (!e) return
        if (e.kw === 'Angle') {
          const a = await c.number('Specify included angle in degrees', { def: 90 })
          if (typeof a !== 'number' || a === 0) return
          const a0 = angle(ctr, s)
          return c.add('Arc', a > 0 ? c.mk({ type: 'arc', cx: ctr.x, cy: ctr.y, r, a0: norm(a0), a1: norm(a0 + a * D2R) }) : c.mk({ type: 'arc', cx: ctr.x, cy: ctr.y, r, a0: norm(a0 + a * D2R), a1: norm(a0) }))
        }
        return c.add('Arc', mkA(angle(ctr, e)))
      }
      const p1 = first
      const p2 = await c.point('Specify second point of arc', { base: p1 }); if (!p2) return
      const p3 = await c.point('Specify end point of arc', { base: p2, preview: (q) => { const a = arcThrough(c, p1, p2, q); return a ? [a] : [] } }); if (!p3) return
      const arc = arcThrough(c, p1, p2, p3)
      if (!arc) throw c.fail('Those three points are in a straight line, so no arc fits.')
      c.add('Arc', arc)
    },

    async ELLIPSE(c) {
      const r0 = await c.point('Specify axis endpoint of ellipse or', { kws: ['Center'] })
      if (!r0) return
      let ctr, major
      if (r0.kw === 'Center') {
        ctr = await c.point('Specify center of ellipse'); if (!ctr) return
        major = await c.point('Specify endpoint of axis', { base: ctr }); if (!major) return
      } else {
        const p2 = await c.point('Specify other endpoint of axis', { base: r0 }); if (!p2) return
        ctr = mid(r0, p2); major = r0
      }
      const d = await c.dist('Specify distance to other axis', { base: ctr, preview: (k) => { const e = ellipseFrom(c, ctr, major, k); return e ? [e] : [] } })
      const e = ellipseFrom(c, ctr, major, d)
      if (!e) throw c.fail('The ellipse needs a non-zero size in both directions.')
      c.add('Ellipse', e)
    },

    async TEXT(c) {
      const p = await c.point('Specify start point of text')
      if (!p) return
      const h = await c.number('Specify height', { def: c.last.textH || c.settings().textH, min: 1e-9 })
      if (typeof h !== 'number') return
      c.last.textH = h
      const rot = await c.angle('Specify rotation angle of text', { base: p, def: 0 })
      if (typeof rot !== 'number') return
      c.say('Type the text in the box on the canvas. Enter finishes, Shift+Enter adds a line, Esc cancels.', 'muted')
      const str = await app.editText({ x: p.x, y: p.y, h, rot, align: 'l' }, '')
      if (str == null || !str.trim()) return
      c.add('Text', c.mk({ type: 'text', x: p.x, y: p.y, h, text: str, rot, align: 'l' }))
    },

    async HATCH(c) {
      const hs = c.last.hatch
      for (;;) {
        const r = await c.point(`Pick internal point (${HATCH_PATTERNS[hs.pattern].name}, scale ${hs.scale}, angle ${hs.angle}) or`, { kws: ['Pattern', 'Scale', 'Angle'], enter: true })
        if (!r) return
        if (r.kw === 'Pattern') { const k = await c.kw('Pattern', Object.keys(HATCH_PATTERNS).map((n) => n[0].toUpperCase() + n.slice(1)), hs.pattern[0].toUpperCase() + hs.pattern.slice(1)); hs.pattern = k.toLowerCase(); continue }
        if (r.kw === 'Scale') { const v = await c.number('Specify hatch scale', { def: hs.scale, min: 1e-9 }); if (typeof v === 'number') hs.scale = v; continue }
        if (r.kw === 'Angle') { const v = await c.number('Specify hatch angle in degrees', { def: hs.angle }); if (typeof v === 'number') hs.angle = v; continue }
        const loops = hatchBoundaryAt(r, app.doc.visible())
        if (!loops) { c.say('Could not find a closed outline around that point. Hatch fills closed polylines, rectangles, circles and ellipses.', 'warn'); continue }
        c.add('Hatch', c.mk({ type: 'hatch', pattern: hs.pattern, scale: hs.scale, angle: hs.angle, loops }))
      }
    },

    // ---------- Modify ----------
    async MOVE(c) {
      const ents = await c.select('Select objects to move'); if (!ents.length) return
      const b = await c.point('Specify base point'); if (!b) return
      const t = await c.point('Specify second point', { base: b, preview: (q) => c.ghosts(ents, Tf.move(q.x - b.x, q.y - b.y)) }); if (!t) return
      c.replaceAll('Move', ents, Tf.move(t.x - b.x, t.y - b.y))
      c.clearSel()
    },

    async COPY(c) {
      const ents = await c.select('Select objects to copy'); if (!ents.length) return
      const b = await c.point('Specify base point'); if (!b) return
      let n = 0
      for (;;) {
        const t = await c.point('Specify second point', { base: b, enter: true, preview: (q) => c.ghosts(ents, Tf.move(q.x - b.x, q.y - b.y)) })
        if (!t) break
        const tf = Tf.move(t.x - b.x, t.y - b.y)
        c.add('Copy', ents.map((e) => transform(e, tf)))
        n++
      }
      if (n) c.clearSel()
    },

    async ROTATE(c) {
      const ents = await c.select('Select objects to rotate'); if (!ents.length) return
      const b = await c.point('Specify base point'); if (!b) return
      let copy = false
      for (;;) {
        const r = await c.angle('Specify rotation angle or', { base: b, def: 0, kws: ['Copy', 'Reference'], preview: (a) => c.ghosts(ents, Tf.rotate(b, a)) })
        if (r && r.kw === 'Copy') { copy = true; c.say('Copy mode: the originals stay.', 'muted'); continue }
        let a = r
        if (r && r.kw === 'Reference') {
          const ref = await c.angle('Specify the reference angle', { base: b, def: 0 }); if (typeof ref !== 'number') return
          const nw = await c.angle('Specify the new angle', { base: b, preview: (x) => c.ghosts(ents, Tf.rotate(b, x - ref)) }); if (typeof nw !== 'number') return
          a = nw - ref
        }
        if (typeof a !== 'number') return
        const tf = Tf.rotate(b, a)
        if (copy) c.add('Rotate', ents.map((e) => transform(e, tf)))
        else c.replaceAll('Rotate', ents, tf)
        break
      }
      c.clearSel()
    },

    async SCALE(c) {
      const ents = await c.select('Select objects to scale'); if (!ents.length) return
      const b = await c.point('Specify base point'); if (!b) return
      let copy = false
      for (;;) {
        const r = await c.dist('Specify scale factor or', { base: b, kws: ['Copy', 'Reference'], preview: (k) => (k > 0 ? c.ghosts(ents, Tf.scale(b, k)) : []) })
        if (r && r.kw === 'Copy') { copy = true; continue }
        let k = r
        if (r && r.kw === 'Reference') {
          const ref = await c.dist('Specify reference length', { base: b, def: 1 }); if (typeof ref !== 'number' || ref <= 0) return
          const nw = await c.dist('Specify new length', { base: b, preview: (x) => (x > 0 ? c.ghosts(ents, Tf.scale(b, x / ref)) : []) }); if (typeof nw !== 'number') return
          k = nw / ref
        }
        if (typeof k !== 'number' || !(k > 0)) throw c.fail('The scale factor must be greater than zero.')
        const tf = Tf.scale(b, k)
        if (copy) c.add('Scale', ents.map((e) => transform(e, tf)))
        else c.replaceAll('Scale', ents, tf)
        break
      }
      c.clearSel()
    },

    async MIRROR(c) {
      const ents = await c.select('Select objects to mirror'); if (!ents.length) return
      const p1 = await c.point('Specify first point of mirror line'); if (!p1) return
      const p2 = await c.point('Specify second point of mirror line', { base: p1, preview: (q) => (dist(p1, q) > 1e-9 ? [mkLine(c, p1, q), ...c.ghosts(ents, Tf.mirror(p1, q))] : []) }); if (!p2) return
      if (dist(p1, p2) < 1e-12) throw c.fail('The two points of the mirror line are the same.')
      const erase = await c.kw('Erase source objects?', ['Yes', 'No'], 'No')
      const tf = Tf.mirror(p1, p2)
      if (erase === 'Yes') c.replaceAll('Mirror', ents, tf)
      else c.add('Mirror', ents.map((e) => transform(e, tf)))
      c.clearSel()
    },

    async OFFSET(c) {
      const d0 = await c.dist('Specify offset distance or', { kws: ['Through'], def: c.last.offset })
      if (d0 == null) return
      const through = !!d0.kw
      if (!through) { if (!(d0 > 0)) throw c.fail('The offset distance must be greater than zero.'); c.last.offset = d0 }
      const ok = (e) => ['line', 'arc', 'circle', 'polyline'].includes(e.type)
      for (;;) {
        const r = await c.pick('Select object to offset, or press Enter to finish', { enter: true, filter: ok })
        if (!r) return
        app.setSelection([r.ent.id])
        const side = await c.point(through ? 'Specify through point' : 'Specify point on side to offset', {
          preview: (q) => { try { return [offsetEntity(r.ent, through ? Math.max(distTo(r.ent, q), 1e-9) : d0, q)] } catch { return [] } },
        })
        app.clearSelection()
        if (!side) return
        try {
          const ne = offsetEntity(r.ent, through ? distTo(r.ent, side) : d0, side)
          c.add('Offset', ne)
        } catch (e) { c.say(e.userMessage || e.message, 'warn') }
      }
    },

    async TRIM(c) {
      const picked = await c.select('Select cutting edges, or press Enter to use all objects')
      const ids = picked.map((e) => e.id)
      const edges = () => (ids.length ? ids.map((i) => app.doc.byId(i)).filter(Boolean) : c.all())
      c.say(ids.length ? `${ids.length} cutting edge(s).` : 'Using all objects as cutting edges.', 'muted')
      for (;;) {
        const r = await c.pick('Select object to trim (Shift extends), or press Enter to finish', { enter: true, filter: (e) => ['line', 'arc', 'circle', 'ellipse', 'polyline'].includes(e.type) })
        if (!r) return
        let ent = r.ent
        if (r.shift) { doExtend(c, ent, r.pt, edges()); continue }
        let extra = []
        if (ent.type === 'polyline') {
          const parts = explode(ent)
          let best = null
          for (const p of parts) { const d = distTo(p, r.pt); if (!best || d < best.d) best = { p, d } }
          extra = parts.filter((p) => p !== best.p)
          ent = best.p
        }
        const pieces = trimEntity(ent, r.pt, edges().filter((e) => e.id !== r.ent.id))
        if (pieces === null) { c.say('That object does not cross a cutting edge there.', 'warn'); continue }
        c.commit('Trim', (tx) => { tx.remove(r.ent.id); [...extra, ...pieces].forEach((p) => tx.add(p)) })
      }
    },

    async EXTEND(c) {
      const picked = await c.select('Select boundary edges, or press Enter to use all objects')
      const ids = picked.map((e) => e.id)
      const edges = () => (ids.length ? ids.map((i) => app.doc.byId(i)).filter(Boolean) : c.all())
      c.say(ids.length ? `${ids.length} boundary edge(s).` : 'Using all objects as boundary edges.', 'muted')
      for (;;) {
        const r = await c.pick('Select object to extend (Shift trims), or press Enter to finish', { enter: true, filter: (e) => ['line', 'arc', 'ellipse', 'polyline'].includes(e.type) })
        if (!r) return
        if (r.shift) {
          const pieces = trimEntity(r.ent, r.pt, edges().filter((e) => e.id !== r.ent.id))
          if (pieces) c.commit('Trim', (tx) => { tx.remove(r.ent.id); pieces.forEach((p) => tx.add(p)) })
          else c.say('That object does not cross a boundary there.', 'warn')
          continue
        }
        doExtend(c, r.ent, r.pt, edges())
      }
    },

    async FILLET(c) {
      return corner(c, false)
    },
    async CHAMFER(c) {
      return corner(c, true)
    },

    async ERASE(c) {
      const ents = await c.select('Select objects to erase'); if (!ents.length) return
      c.commit('Erase', (tx) => tx.remove(ents.map((e) => e.id)))
      c.clearSel()
      c.say(`${ents.length} object${ents.length === 1 ? '' : 's'} erased.`, 'info')
    },

    async EXPLODE(c) {
      const ents = await c.select('Select objects to explode', { filter: (e) => e.type === 'polyline' || e.type === 'dim' }); if (!ents.length) return
      c.commit('Explode', (tx) => { for (const e of ents) { tx.remove(e.id); explode(e).forEach((p) => tx.add(p)) } })
      c.clearSel()
    },

    async ARRAY(c) {
      const ents = await c.select('Select objects to array'); if (!ents.length) return
      const kind = await c.kw('Array type', ['Rectangular', 'Polar'], 'Rectangular')
      if (kind === 'Rectangular') {
        const rows = await c.number('Number of rows', { def: 2, min: 1 }); if (typeof rows !== 'number') return
        const cols = await c.number('Number of columns', { def: 3, min: 1 }); if (typeof cols !== 'number') return
        const b = bbox(ents[0])
        const dy = await c.number('Distance between rows (negative goes down)', { def: Math.round((b.y1 - b.y0) * 1.5 * 100) / 100 || 10 }); if (typeof dy !== 'number') return
        const dx = await c.number('Distance between columns (negative goes left)', { def: Math.round((b.x1 - b.x0) * 1.5 * 100) / 100 || 10 }); if (typeof dx !== 'number') return
        const out = []
        for (let i = 0; i < Math.round(rows); i++) for (let j = 0; j < Math.round(cols); j++) { if (!i && !j) continue; out.push(...ents.map((e) => transform(e, Tf.move(j * dx, i * dy)))) }
        if (out.length > 20000) throw c.fail('That array would create too many objects.')
        c.add('Array', out)
      } else {
        const ctr = await c.point('Specify center point of array'); if (!ctr) return
        const n = await c.number('Number of items', { def: 6, min: 2 }); if (typeof n !== 'number') return
        const fill = await c.number('Angle to fill in degrees (360 = full circle)', { def: 360 }); if (typeof fill !== 'number') return
        const count = Math.round(n), step = (Math.abs(fill) >= 360 ? TAU : fill * D2R) / (Math.abs(fill) >= 360 ? count : count - 1)
        const out = []
        for (let i = 1; i < count; i++) out.push(...ents.map((e) => transform(e, Tf.rotate(ctr, step * i))))
        c.add('Array', out)
      }
      c.clearSel()
    },

    // ---------- Annotate ----------
    async DIM(c) { return dimCommand(c) },
    async DIMLINEAR(c) { return dimLinear(c, false) },
    async DIMALIGNED(c) { return dimLinear(c, true) },
    async DIMRADIUS(c) { return dimRound(c, 'radius') },
    async DIMDIAMETER(c) { return dimRound(c, 'diameter') },
    async DIMANGULAR(c) { return dimAngular(c) },

    // ---------- Inquire ----------
    async DIST(c) {
      const a = await c.point('Specify first point'); if (!a) return
      const b = await c.point('Specify second point', { base: a, preview: (q) => [mkLine(c, a, q)] }); if (!b) return
      const d = dist(a, b), u = UNITS[c.settings().units].short
      const ang = norm(angle(a, b)) * R2D
      const txt = `Distance = ${fmtNum(d, 4)} ${u}, angle = ${fmtNum(ang, 2)}°, ΔX = ${fmtNum(b.x - a.x, 4)}, ΔY = ${fmtNum(b.y - a.y, 4)}`
      c.say(txt, 'result')
      app.measured({ title: 'Distance', main: `${fmtNum(d, 4)} ${u}`, lines: [`Angle ${fmtNum(ang, 2)}°`, `ΔX ${fmtNum(b.x - a.x, 4)}  ΔY ${fmtNum(b.y - a.y, 4)}`], line: [a, b] })
    },

    async AREA(c) {
      const u = UNITS[c.settings().units].short
      const first = await c.point('Specify first corner point or', { kws: ['Object'] })
      if (!first) return
      if (first.kw === 'Object') {
        const r = await c.pick('Select a closed object', { filter: (e) => !!measure(e)?.area })
        const m = measure(r.ent)
        c.say(`Area = ${fmtNum(m.area, 4)} ${u}²${m.length ? `, perimeter = ${fmtNum(m.length, 4)} ${u}` : ''}`, 'result')
        return app.measured({ title: 'Area', main: `${fmtNum(m.area, 4)} ${u}²`, lines: m.length ? [`Perimeter ${fmtNum(m.length, 4)} ${u}`] : [] })
      }
      const pts = [{ x: first.x, y: first.y, b: 0 }]
      for (;;) {
        const last = pts[pts.length - 1]
        const r = await c.point('Specify next corner point or press Enter to finish', { base: last, enter: true, preview: (q) => [mkPoly(c, [...pts, q], true)] })
        if (!r) break
        pts.push({ x: r.x, y: r.y, b: 0 })
      }
      if (pts.length < 3) throw c.fail('Pick at least three corners.')
      const { area, perimeter } = loopArea(pts)
      c.say(`Area = ${fmtNum(Math.abs(area), 4)} ${u}², perimeter = ${fmtNum(perimeter, 4)} ${u}`, 'result')
      app.measured({ title: 'Area', main: `${fmtNum(Math.abs(area), 4)} ${u}²`, lines: [`Perimeter ${fmtNum(perimeter, 4)} ${u}`], poly: pts })
    },

    async ID(c) {
      const p = await c.point('Specify point'); if (!p) return
      c.say(`X = ${fmtNum(p.x, 4)}  Y = ${fmtNum(p.y, 4)}`, 'result')
      app.measured({ title: 'Point', main: `${fmtNum(p.x, 3)}, ${fmtNum(p.y, 3)}`, lines: [], mark: p })
    },

    // ---------- View and settings ----------
    async ZOOM(c) {
      const r = await c.point('Specify corner of window or', { kws: ['All', 'Extents', 'Previous', 'In', 'Out'], enter: true })
      if (!r) return app.zoomExtents()
      if (r.kw) {
        if (r.kw === 'All' || r.kw === 'Extents') return app.zoomExtents()
        if (r.kw === 'Previous') return app.zoomPrevious()
        return app.zoomBy(r.kw === 'In' ? 2 : 0.5)
      }
      const b = await c.point('Specify opposite corner', { base: r, preview: (q) => [mkPoly(c, rectPts(r, q), true)] }); if (!b) return
      app.zoomWindow(r, b)
    },
    async ZOOME() { app.zoomExtents() },
    async PAN(c) { c.say('Drag with the middle mouse button, hold Space and drag, or use two fingers.', 'info') },
    async UNDO(c) { const l = app.doc.undo(); c.say(l ? `Undid ${l}.` : 'Nothing to undo.', 'info') },
    async REDO(c) { const l = app.doc.redo(); c.say(l ? `Redid ${l}.` : 'Nothing to redo.', 'info') },
    async ORTHO(c, a) { app.setMode('ortho', a[0]) },
    async GRID(c, a) { app.setMode('grid', a[0]) },
    async SNAP(c, a) { app.setMode('snap', a[0]) },
    async OSNAP(c, a) { app.setMode('osnap', a[0]) },
    async POLAR(c, a) { app.setMode('polar', a[0]) },
    async LWT(c, a) { app.setMode('lwt', a[0]) },
    async LAYER() { app.openPanel('layers') },
    async UNITS() { app.openPanel('drawing') },
    async REGEN() { app.render() },
    async NEW() { app.fileAction('new') },
    async OPEN() { app.fileAction('open') },
    async SAVE() { app.fileAction('save') },
    async EXPORT() { app.fileAction('export') },
    async IMPORT() { app.fileAction('import') },
    async SELECTALL() { app.selectAll() },
    async HELP(c) { for (const [k, v] of COMMAND_HELP) c.say(`${k}: ${v}`, 'info') },
  }

  function doExtend(c, ent, p, edges) {
    const out = extendEntity(ent, p, edges.filter((e) => e.id !== ent.id))
    if (!out) return c.say('No boundary found beyond that end.', 'warn')
    c.commit('Extend', (tx) => tx.replace(ent.id, out))
  }

  async function corner(c, chamfer) {
    const label = chamfer ? 'Chamfer' : 'Fillet'
    const lineOnly = (e) => e.type === 'line'
    for (;;) {
      const msg = chamfer ? `Select first line (distances ${+c.last.cd1.toFixed(3)}, ${+c.last.cd2.toFixed(3)}) or` : `Select first object (radius ${+c.last.filletR.toFixed(3)}) or`
      const r = await c.pick(msg, { kws: chamfer ? ['Distance', 'Polyline'] : ['Radius', 'Polyline'], filter: lineOnly })
      if (r.kw === 'Radius') { const v = await c.number('Specify fillet radius', { def: c.last.filletR, min: 0 }); if (typeof v === 'number') c.last.filletR = v; continue }
      if (r.kw === 'Distance') {
        const a = await c.number('Specify first chamfer distance', { def: c.last.cd1, min: 0 }); if (typeof a !== 'number') continue
        const b = await c.number('Specify second chamfer distance', { def: a, min: 0 }); if (typeof b === 'number') { c.last.cd1 = a; c.last.cd2 = b }
        continue
      }
      if (r.kw === 'Polyline') {
        if (chamfer) throw c.fail('Chamfer works on two lines. Explode the polyline first (X).')
        const p = await c.pick('Select 2D polyline', { filter: (e) => e.type === 'polyline' })
        const { entity, skipped } = filletPolyline(p.ent, c.last.filletR)
        c.commit(label, (tx) => tx.replace(p.ent.id, entity))
        if (skipped) c.say(`${skipped} corner${skipped === 1 ? ' was' : 's were'} left sharp because the segments are too short for that radius.`, 'warn')
        return
      }
      const second = await c.pick('Select second object', { filter: lineOnly })
      if (second.ent.id === r.ent.id) throw c.fail('Pick two different lines.')
      const out = cornerLines(r.ent, r.pt, second.ent, second.pt, chamfer ? { chamfer: true, d1: c.last.cd1, d2: c.last.cd2 } : { r: c.last.filletR })
      c.commit(label, (tx) => {
        tx.replace(r.ent.id, out.l1)
        tx.replace(second.ent.id, out.l2)
        if (out.extra) tx.add(out.extra)
      })
      return
    }
  }

  // ---------- Dimensions ----------
  const dimBase = (c) => { const s = c.settings(); return { th: s.dimTh, as: s.dimAs, pr: s.dimPr } }
  const mkDim = (c, o) => c.mk({ type: 'dim', ...dimBase(c), ...o, layer: dimLayer(c) })
  function dimLayer(c) {
    const l = app.doc.layers.find((x) => x.name === 'Dimensions')
    return l && l.visible && !l.locked ? 'Dimensions' : app.cur.layer
  }
  function autoAng(a, b, loc) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
    const ox = loc.x < x0 ? x0 - loc.x : loc.x > x1 ? loc.x - x1 : 0
    const oy = loc.y < y0 ? y0 - loc.y : loc.y > y1 ? loc.y - y1 : 0
    if (ox === 0 && oy === 0) return x1 - x0 >= y1 - y0 ? 0 : Math.PI / 2
    return oy >= ox ? 0 : Math.PI / 2
  }

  async function dimLinear(c, aligned, first, second) {
    let a = first
    let b = second
    if (!a) {
      const r = await c.point('Specify first extension line origin or press Enter to select an object', { enter: true })
      if (r === null) {
        const p = await c.pick('Select line to dimension', { filter: (e) => e.type === 'line' || e.type === 'polyline' })
        const ln = partAt(p.ent, p.pt)
        if (ln.type !== 'line') throw c.fail('Pick a straight segment. Use DIMRADIUS for arcs.')
        a = pt(ln.x1, ln.y1); b = pt(ln.x2, ln.y2)
      } else a = r
    }
    if (!b) { b = await c.point('Specify second extension line origin', { base: a }); if (!b) return }
    if (dist(a, b) < 1e-12) throw c.fail('The two points are the same.')
    let force = null
    for (;;) {
      const mk = (loc) => mkDim(c, { kind: aligned ? 'aligned' : 'linear', a: pt(a.x, a.y), b: pt(b.x, b.y), loc: pt(loc.x, loc.y), ang: force ?? autoAng(a, b, loc) })
      const r = await c.point('Specify dimension line location or', { base: mid(a, b), kws: aligned ? [] : ['Horizontal', 'Vertical'], preview: (q) => [mk(q)] })
      if (!r) return
      if (r.kw) { force = r.kw === 'Horizontal' ? 0 : Math.PI / 2; continue }
      c.add(aligned ? 'Aligned dimension' : 'Linear dimension', mk(r))
      return
    }
  }

  async function dimRound(c, kind, given) {
    const r = given || await c.pick(`Select arc or circle to dimension`, { filter: (e) => e.type === 'circle' || e.type === 'arc' })
    const e = r.ent
    let k = kind
    for (;;) {
      const mk = (loc) => mkDim(c, { kind: k, cx: e.cx, cy: e.cy, r: e.r, loc: pt(loc.x, loc.y) })
      const p = await c.point(`Specify dimension line location or`, { base: pt(e.cx, e.cy), kws: [k === 'radius' ? 'Diameter' : 'Radius'], preview: (q) => [mk(q)] })
      if (!p) return
      if (p.kw) { k = p.kw.toLowerCase(); continue }
      c.add(k === 'radius' ? 'Radius dimension' : 'Diameter dimension', mk(p))
      return
    }
  }

  /** The line or arc segment of a polyline nearest p (other entities are returned as they are). */
  const partAt = (ent, p) => {
    if (ent.type !== 'polyline') return ent
    let best = null
    for (const part of explode(ent)) { const d = distTo(part, p); if (!best || d < best.d) best = { part, d } }
    return best?.part || ent
  }
  const farEnd = (ln, v) => (dist(pt(ln.x1, ln.y1), v) >= dist(pt(ln.x2, ln.y2), v) ? pt(ln.x1, ln.y1) : pt(ln.x2, ln.y2))
  async function dimAngular(c) {
    const okAng = (e) => e.type === 'line' || e.type === 'arc' || e.type === 'polyline'
    const r1 = await c.pick('Select first line or arc, or press Enter to pick three points', { enter: true, filter: okAng })
    let v, a1, a2, q1, q2
    const first = r1 && partAt(r1.ent, r1.pt)
    if (first && first.type === 'arc') {
      const e = first
      v = pt(e.cx, e.cy); a1 = e.a0; a2 = e.a1
      q1 = polar(v, a1, e.r); q2 = polar(v, a2, e.r)
    } else if (first) {
      const r2 = await c.pick('Select second line', { filter: okAng })
      const l1 = first, l2 = partAt(r2.ent, r2.pt)
      if (l2.type !== 'line' || l1.type !== 'line') throw c.fail('Pick two straight lines or one arc.')
      const hit = intersectPrims(prims(l1)[0], prims(l2)[0])[0]
      if (!hit) throw c.fail('Those two lines are parallel, so they have no angle between them.')
      v = hit.pt
      q1 = farEnd(l1, v); q2 = farEnd(l2, v)
      a1 = angle(v, q1); a2 = angle(v, q2)
    } else {
      v = await c.point('Specify angle vertex'); if (!v) return
      q1 = await c.point('Specify first angle endpoint', { base: v }); if (!q1) return
      q2 = await c.point('Specify second angle endpoint', { base: v }); if (!q2) return
      a1 = angle(v, q1); a2 = angle(v, q2)
    }
    const mk = (loc) => mkDim(c, { kind: 'angular', v: pt(v.x, v.y), a1, a2, q1: pt(q1.x, q1.y), q2: pt(q2.x, q2.y), loc: pt(loc.x, loc.y) })
    const loc = await c.point('Specify dimension arc line location', { base: v, preview: (q) => [mk(q)] })
    if (!loc) return
    c.add('Angular dimension', mk(loc))
  }

  async function dimCommand(c) {
    for (;;) {
      const r = await c.point('Select object or specify first extension line origin or', { kws: ['Linear', 'Aligned', 'Radius', 'Diameter', 'Angular'], enter: true })
      if (!r) return
      if (r.kw === 'Linear') { await dimLinear(c, false); continue }
      if (r.kw === 'Aligned') { await dimLinear(c, true); continue }
      if (r.kw === 'Radius') { await dimRound(c, 'radius'); continue }
      if (r.kw === 'Diameter') { await dimRound(c, 'diameter'); continue }
      if (r.kw === 'Angular') { await dimAngular(c); continue }
      const hit = r.hit && !r.snapKind ? partAt(r.hit, r) : null
      if (hit && !r.snapKind && hit.type === 'line') await dimLinear(c, true, pt(hit.x1, hit.y1), pt(hit.x2, hit.y2))
      else if (hit && !r.snapKind && (hit.type === 'circle' || hit.type === 'arc')) await dimRound(c, 'radius', { ent: hit })
      else await dimLinear(c, false, pt(r.x, r.y))
    }
  }

  return api
}
