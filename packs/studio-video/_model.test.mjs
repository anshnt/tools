// Self-check for the pure editing logic. Run: node packs/studio-video/_model.test.mjs
import assert from 'node:assert/strict'
import { newProject, makeClip, freeStart, removeClips, splitClip, layersAt, projectDuration, snapTime, setSpeed, Doc, gainAt, trans, normalize, timecode } from './_model.js'

const p = newProject()
const a = makeClip('video', 'V1', 0, 4, { mediaId: 'm1' })
const b = makeClip('video', 'V1', 4, 3, { mediaId: 'm2', tin: trans('crossfade', 1) })
const c = makeClip('video', 'V1', 8, 2, { mediaId: 'm3' })
p.clips.push(a, b, c)
assert.equal(projectDuration(p), 10)

// free placement: dropping on top of b lands on the nearest free edge
assert.equal(freeStart(p, 'V1', 4.5, 2), 10)
assert.equal(freeStart(p, 'V1', 7.2, 0.7), 7.2)
assert.equal(freeStart(p, 'V1', 7.2, 1.5), 10)
assert.equal(freeStart(p, 'V2', 3, 5), 3)

// split keeps the source continuous and resets the cut edges
const nid = splitClip(p, a.id, 1)
const right = p.clips.find((x) => x.id === nid)
assert.equal(a.dur, 1)
assert.equal(right.start, 1)
assert.equal(right.in, 1)
assert.equal(right.dur, 3)
assert.equal(splitClip(p, a.id, 0.99), null)

// ripple delete closes the gap on the same track only
const d = makeClip('audio', 'A1', 5, 2, { mediaId: 'm4' })
p.clips.push(d)
removeClips(p, [right.id], true)
assert.equal(p.clips.find((x) => x.id === b.id).start, 1)
assert.equal(p.clips.find((x) => x.id === d.id).start, 5)
removeClips(p, [b.id], false)
assert.equal(p.clips.find((x) => x.id === c.id).start, 5)

// crossfade: incoming clip ramps in while the outgoing one stays underneath
const q = newProject()
const x1 = makeClip('image', 'V1', 0, 3)
const x2 = makeClip('image', 'V1', 3, 3, { tin: trans('crossfade', 1) })
q.clips.push(x1, x2)
let L = layersAt(q, 3.5)
assert.deepEqual(L.map((l) => [l.clip.id === x1.id, l.ghost]), [[true, true], [false, false]])
assert.ok(Math.abs(L[1].alpha - 0.5) < 1e-9)
assert.equal(layersAt(q, 2.5).length, 1)
assert.equal(layersAt(q, 4.5).length, 1)
// fade to black dips the picture, fade out reveals what is below
x2.tin = trans()
x2.tout = trans('black', 1)
L = layersAt(q, 5.5)
assert.ok(Math.abs(L[0].dip - 0.5) < 1e-9)
// titles draw above video and fade
q.clips.push(makeClip('title', 'T1', 0, 2, { fadeIn: 1 }))
L = layersAt(q, 0.5)
assert.equal(L.at(-1).clip.kind, 'title')
assert.ok(Math.abs(L.at(-1).alpha - 0.5) < 1e-9)
// hidden tracks are skipped
q.tracks.find((t) => t.id === 'V1').hidden = true
assert.equal(layersAt(q, 0.5).length, 1)

// snapping
assert.deepEqual(snapTime(2.04, [0, 2, 5], 0.1), { t: 2, hit: 2 })
assert.deepEqual(snapTime(3, [0, 2, 5], 0.1), { t: 3, hit: null })

// speed change shortens instead of overlapping the next clip
const s = newProject()
const s1 = makeClip('video', 'V1', 0, 4, { mediaId: 'm' })
const s2 = makeClip('video', 'V1', 6, 2, { mediaId: 'm' })
s.clips.push(s1, s2)
setSpeed(s, s1, 2)
assert.equal(s1.dur, 2)
setSpeed(s, s1, 0.25)
assert.equal(s1.dur, 6)

// audio gain with fades
const au = makeClip('audio', 'A1', 10, 4, { volume: 50, fadeIn: 1, fadeOut: 2 })
assert.equal(gainAt(au, 10), 0)
assert.equal(gainAt(au, 10.5), 0.25)
assert.equal(gainAt(au, 12), 0.5)
assert.equal(gainAt(au, 13), 0.25)

// history: commit merges slider steps, undo/redo restore snapshots
const doc = new Doc(newProject())
doc.commit('Add', (pr) => pr.clips.push(makeClip('title', 'T1', 0, 3)))
doc.commit('Scale', (pr) => { pr.clips[0].scale = 120 }, { key: 'scale' })
doc.commit('Scale', (pr) => { pr.clips[0].scale = 130 }, { key: 'scale' })
assert.equal(doc.undoStack.length, 2)
assert.equal(doc.undo(), 'Scale')
assert.equal(doc.p.clips[0].scale, 100)
assert.equal(doc.redo(), 'Scale')
assert.equal(doc.p.clips[0].scale, 130)
doc.undo(); doc.undo()
assert.equal(doc.p.clips.length, 0)

// older projects get missing fields filled in
const n = normalize({ aspect: '9:16', clips: [{ id: 'x', kind: 'title', track: 'T1', start: 0, dur: 2 }, { id: 'y', kind: 'video', track: 'nope', start: 0, dur: 1 }] })
assert.equal(n.clips.length, 1)
assert.equal(n.clips[0].size, 9)
assert.equal(n.tracks.length, 5)
assert.equal(timecode(61.5, 30), '01:01:15')

console.log('ok - _model.test.mjs')
