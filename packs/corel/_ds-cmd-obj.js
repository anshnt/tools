// Draw Studio object commands (run functions for the metadata in _ds-keys.js): align and distribute, combine and break apart, lock, shaping
// (path booleans), clip to container, shape settings, node editing, tool switches, the clipboard and the docker windows.
// Every document change is one store.tx, so each is one undo step.
import { collect, leavesOf, replaceLeaves, setFlag } from './_ds-ops.js'
import { align, breakApart, clipInside, combine, combineBlocker, countLocked, distribute, hasClip, releaseClip, setShape, unlockAll } from './_ds-ops-arrange.js'
import { editableIds, selectionBox, topIds } from './_ds-sel.js'
import { SHAPE_DEFAULTS, shapePrefs } from './_ds-tools-draw.js'
import { meanScale } from './_model.js'
import { errorMessage, toast } from '../../lib/ui.js'

const LEAVE_DEFAULTS = { weld: [false, false], trim: [true, false], intersect: [false, false] }
const SHAPE_LABELS = { weld: 'Weld', trim: 'Trim', intersect: 'Intersect', simplify: 'Simplify', frontMinusBack: 'Front minus back', backMinusFront: 'Back minus front' }
export const NODE_OPS = ['add', 'delete', 'toLine', 'toCurve', 'cusp', 'smooth', 'symmetrical', 'break', 'join', 'close', 'reverse']
const ALIGN_LABEL = { left: 'Align left', right: 'Align right', top: 'Align top', bottom: 'Align bottom', centerH: 'Centre horizontally', centerV: 'Centre vertically', center: 'Centre on page' }

/** env: {store, boxOf, tools, app: {confirm(title, text, ok) -> Promise<bool>, showDock(id, tab), commitEdits}, clip} -> {impl, shapeProps} */
export function createObjImpl({ store, boxOf, tools, app, clip }) {
  const sel = () => store.sel.ids
  const say = (t) => store.setStatus(t)
  const hasSel = () => sel().length > 0
  const live = () => editableIds(store)
  function targets(what = 'edited') {
    if (!sel().length) { say('Select an object first.'); return [] }
    const ids = topIds(store, live())
    if (!ids.length) say(`Locked objects cannot be ${what}. Unlock them in the Objects docker.`)
    return ids
  }
  const selNodes = () => sel().map((id) => store.find(id)?.node).filter(Boolean)
  const leafCount = () => leavesOf(selNodes()).length
  const page = () => store.page()
  const pageBox = () => ({ x: 0, y: 0, w: page().w, h: page().h })
  const pref = (k, d) => store.prefs[k] ?? d

  // ---------- align and distribute ----------
  function doAlign(mode) {
    const ids = targets('aligned')
    if (!ids.length) return
    const to = pref('alignTo', 'selection')
    let ref
    if (mode === 'center' || to === 'page' || (ids.length === 1 && to === 'selection')) ref = pageBox()
    else if (to === 'active') { const act = ids[ids.length - 1]; ref = boxOf(store.find(act).node) }
    else ref = selectionBox(store, boxOf, ids)
    if (!ref) return
    if (!store.tx(ALIGN_LABEL[mode], (r) => align(r, ids, mode, ref, boxOf))) say('Already aligned.')
  }
  function doDistribute(mode) {
    const ids = targets('distributed')
    if (!ids.length) return
    const toPage = pref('distTo', 'selection') === 'page'
    if (ids.length < (toPage ? 2 : 3)) { say(toPage ? 'Select two or more objects to spread over the page.' : 'Select three or more objects to distribute.'); return }
    if (!store.tx('Distribute', (r) => distribute(r, ids, mode, boxOf, toPage ? pageBox() : null))) say('The objects are already evenly spread.')
  }
  const alignCmd = (mode, keyed) => ({ run: () => doAlign(mode), enabled: hasSel, ...(keyed ? { keyWhen: () => store.tool === 'pick' && hasSel(), passWhenDisabled: true } : {}) })
  const distCmd = (mode) => ({ run: () => doDistribute(mode), enabled: () => sel().length >= (pref('distTo', 'selection') === 'page' ? 2 : 3) })

  // ---------- combine, break apart, lock ----------
  function doCombine() {
    const ids = targets('combined')
    if (!ids.length) return
    const out = {}
    const ok = store.tx('Combine', (r) => combine(r, ids, store.newId, { out }), { get sel() { return out.id != null ? [out.id] : sel() } })
    if (!ok) { say(combineBlocker(leavesOf(collect(store.root, new Set(ids)).map((f) => f.node))) || 'Select two or more shapes to combine.'); return }
    say(out.clipDropped ? 'Combined. The shapes had different clips, so the result has none.' : 'Combined into one curve.')
  }
  function doBreak() {
    const ids = targets('broken apart')
    if (!ids.length) return
    const out = { ids: [] }
    if (!store.tx('Break apart', (r) => breakApart(r, ids, store.newId, { out }), { get sel() { return out.ids } })) say('Select a curve that has several parts (a combined curve).')
    else say(`Broken apart into ${out.ids.length} objects.`)
  }
  const lockAction = () => {
    const ids = topIds(store, sel().filter((id) => store.find(id)?.node))
    return ids.length && ids.every((id) => store.find(id).node.locked) ? 'unlock' : 'lock'
  }
  function doLock() {
    if (!hasSel()) { say('Select an object first.'); return }
    const ids = topIds(store, sel().filter((id) => store.find(id)?.node))
    if (lockAction() === 'unlock') { store.tx('Unlock', (r) => setFlag(r, ids, 'locked', false)); say('Unlocked'); return }
    const todo = ids.filter((id) => !store.find(id).node.locked)
    store.tx('Lock', (r) => setFlag(r, todo, 'locked', true), { sel: [] })
    say('Locked. Unlock it from the Objects docker, or with Object > Unlock all objects.')
  }

  // ---------- shaping ----------
  let shaping = false
  function target(ids, leaves) {
    if (store.selMode === 'click') { const n = store.find(ids[ids.length - 1])?.node; const ls = n ? leavesOf([n]) : []; if (ls.length) return ls[ls.length - 1].id }
    return leaves[0].id // a marquee selection: the bottom-most object is the target
  }
  async function doShape(op) {
    if (shaping) return
    app.commitEdits?.()
    const ids = targets('shaped')
    if (!ids.length) return
    const B = await import('./_ds-bool.js').catch(() => null)
    if (!B) { say('Shaping is not available in this build.'); return }
    const leaves = leavesOf(collect(store.root, new Set(ids)).map((f) => f.node))
    const why = B.shapeBlocker(leaves, 2)
    if (why) { say(why); return }
    const segs = leaves.reduce((s, l) => s + B.segmentCount(l), 0)
    if (segs > B.CONFIRM_SEGMENTS && !(await app.confirm('Shape many points?', `These shapes have ${segs.toLocaleString()} points together. Shaping them can take a while.`, 'Shape them'))) return
    const [leaveSource, leaveTarget] = store.prefs.shapeLeave?.[op] ?? LEAVE_DEFAULTS[op] ?? [false, false]
    const tid = target(ids, leaves)
    shaping = true
    say(`${SHAPE_LABELS[op]}...`)
    const work = B.shape(op, leaves, tid, { newId: store.newId, leaveSource, leaveTarget })
    store.track(work.catch(() => {}))
    try {
      const res = await work
      if (!leaves.every((l) => store.find(l.id)?.node === l)) { say('The drawing changed while shaping. Try again.'); return }
      const made = []
      for (const v of res.replace.values()) for (const n of Array.isArray(v) ? v : v ? [v] : []) made.push(n.id)
      if (!store.tx(SHAPE_LABELS[op], (r) => replaceLeaves(r, res.replace), { sel: made })) { say(res.notes[0] || 'Nothing changed.'); return }
      say(res.notes[0] || `${SHAPE_LABELS[op]} done.`)
    } catch (e) {
      if (e?.code === 'ABORT') return
      toast(errorMessage(e), 'error')
      say('')
    } finally { shaping = false }
  }
  const shapeCmd = (op) => ({ run: () => doShape(op), enabled: () => leafCount() >= 2 })

  // ---------- clip to container ----------
  function doClip() {
    const ids = targets('clipped')
    if (ids.length < 2) { if (ids.length) say('Select the objects and the container shape, with the container selected last.'); return }
    const cid = store.selMode === 'click' ? ids[ids.length - 1] : collect(store.root, new Set(ids))[0].node.id
    const c = store.find(cid)?.node
    if (c?.t !== 'path') { say('The container must be a shape or curve. Select it last.'); return }
    store.tx('Clip to container', (r) => clipInside(r, ids, c))
    say('Clipped. The container stays where it is; Object > Release clip frees the contents.')
  }
  function doUnclip() {
    const ids = targets('released')
    if (!ids.length) return
    if (!store.tx('Release clip', (r) => releaseClip(r, ids))) say('Nothing selected is clipped.')
  }

  // ---------- shape settings (corner radius, sides, points, ellipse mode) ----------
  const SET_LABEL = { rect: 'corner radius', ellipse: 'ellipse', poly: 'sides', star: 'star' }
  /** Change a setting: remembered for the next shape of that kind, and applied to the selected shapes of the kind. patch uses UI keys (see below). */
  function shapeProps(kind, patch) {
    const sp = { ...shapePrefs(store), ...patch }
    store.setPref('shape', Object.fromEntries(Object.keys(SHAPE_DEFAULTS).map((k) => [k, sp[k]])))
    const ids = editableIds(store)
    const leaves = leavesOf(ids.map((id) => store.find(id)?.node).filter(Boolean))
    if (!leaves.some((l) => l.t === 'path' && l.shape?.k === kind && l.sm)) return false
    const fn = (shape, sm) => {
      if (kind === 'rect' && 'rx' in patch) { const r = Math.max(0, patch.rx / meanScale(sm)); return { rx: r, ry: r } }
      if (kind === 'poly' && 'n' in patch) return { n: patch.n }
      if (kind === 'star') return { ...('sn' in patch ? { n: patch.sn } : {}), ...('sharp' in patch ? { r2: Math.max(0.01, shape.r1 * (1 - patch.sharp / 100)) } : {}) }
      if (kind === 'ellipse') {
        if (sp.ellipse === 'ellipse') return { a1: undefined, a2: undefined, pie: undefined }
        return { a1: sp.a1, a2: sp.a2, pie: sp.ellipse === 'pie' ? true : undefined }
      }
      return {}
    }
    return store.tx(`Change ${SET_LABEL[kind]}`, (r) => setShape(r, ids, kind, fn), { merge: `shape-${kind}-${Object.keys(patch).join(',')}` })
  }

  const nodeCmd = (op) => ({ run: () => tools.tools.shape.op(op), enabled: () => store.tool === 'shape' && tools.tools.shape.can(op) })
  const toolCmd = (id) => ({ run: () => tools.set(id), checked: () => store.tool === id })
  const impl = {
    'arrange.combine': { run: doCombine, enabled: () => leafCount() >= 2 },
    'arrange.breakApart': { run: doBreak, enabled: hasSel },
    'arrange.lock': { run: doLock, enabled: hasSel, label: () => (hasSel() && lockAction() === 'unlock' ? 'Unlock' : 'Lock') },
    'arrange.unlockAll': { run: () => { const p = page(); if (!store.tx('Unlock all objects', (r) => unlockAll(r, p.id))) say('Nothing is locked on this page.') }, enabled: () => !!page() && countLocked(page()) > 0 },
    'align.left': alignCmd('left', true), 'align.right': alignCmd('right', true), 'align.top': alignCmd('top', true), 'align.bottom': alignCmd('bottom', true),
    'align.centerH': alignCmd('centerH', true), 'align.centerV': alignCmd('centerV', true), 'align.page': alignCmd('center', true),
    'distribute.left': distCmd('left'), 'distribute.centerH': distCmd('centerH'), 'distribute.right': distCmd('right'), 'distribute.spaceH': distCmd('spaceH'),
    'distribute.top': distCmd('top'), 'distribute.centerV': distCmd('centerV'), 'distribute.bottom': distCmd('bottom'), 'distribute.spaceV': distCmd('spaceV'),
    'shape.weld': shapeCmd('weld'), 'shape.trim': shapeCmd('trim'), 'shape.intersect': shapeCmd('intersect'), 'shape.simplify': shapeCmd('simplify'),
    'shape.frontMinusBack': shapeCmd('frontMinusBack'), 'shape.backMinusFront': shapeCmd('backMinusFront'),
    'object.clip': { run: doClip, enabled: () => sel().length >= 2 },
    'object.unclip': { run: doUnclip, enabled: () => hasClip(selNodes()) },
    'edit.copy': { run: () => clip.copy(), enabled: hasSel },
    'edit.cut': { run: () => clip.cut(), enabled: hasSel },
    'edit.paste': { run: () => clip.paste(false), enabled: () => true },
    'edit.pasteInPlace': { run: () => clip.paste(true), enabled: () => true },
    'win.align': { run: () => app.showDock('align') },
    'win.transform': { run: () => app.showDock('transform') },
    'win.transformPos': { run: () => app.showDock('transform', 'position') },
    'win.transformRotate': { run: () => app.showDock('transform', 'rotate') },
    'win.transformScale': { run: () => app.showDock('transform', 'scale') },
    'win.transformSize': { run: () => app.showDock('transform', 'size') },
    ...Object.fromEntries(['shape', 'free', 'pen', 'rect', 'ellipse', 'polygon', 'star'].map((id) => [`tool.${id}`, toolCmd(id)])),
    ...Object.fromEntries(NODE_OPS.map((op) => [`node.${op}`, nodeCmd(op)])),
  }
  return { impl, shapeProps }
}
