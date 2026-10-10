// Side panels: the media bin and the inspector (project settings, or properties of the selected clip).
import { h, icon, dropzone, formatBytes, formatDuration, button } from '../../lib/ui.js'
import { FONTS, MIN_SPEED, MAX_SPEED, setSpeed, clipById, clamp, ASPECTS, trans, clipEnd, projectDuration } from './_model.js'
import { iconBtn } from './_kit.js'

const dur = (s) => (Number.isFinite(s) ? formatDuration(s) : '')

// ---------------------------------------------------------------- media bin
export function createMediaPanel({ media, doc, ui, actions }) {
  const list = h('div', { class: 'vs-mlist' })
  const zone = dropzone({
    accept: 'video/*,audio/*,image/*', multiple: true, compact: true, label: 'Drop or choose media', icon: 'file-plus',
    hint: 'Video, audio and images', onFiles: (files) => actions.importFiles(files),
  })
  const el = h('section', { class: 'vs-panel vs-media', 'aria-label': 'Media' },
    h('div', { class: 'vs-ph' }, 'Media', h('small', { id: 'vs-mcount' })),
    h('div', { class: 'vs-scrollbox' }, zone, list),
    h('p', { class: 'vs-tip' }, 'Drag media onto a track, or press + to add it at the playhead.'))
  const count = el.querySelector('#vs-mcount')

  function used(id) { return doc.p.clips.some((c) => c.mediaId === id) }

  function item(m) {
    const thumb = h('div', { class: 'vs-mt', dataset: { kind: m.kind } })
    if (m.kind === 'video' && m.strip) Object.assign(thumb.style, { backgroundImage: `url(${m.strip})`, backgroundSize: `${(m.stripN || 1) * 100}% 100%`, backgroundPosition: '0 0' })
    else if (m.kind === 'image' && m.thumb) thumb.style.backgroundImage = `url(${m.thumb})`
    else thumb.append(icon(m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'film'))
    const bad = m.status !== 'ok'
    const meta = bad ? 'File is missing. Remove it and import again.' : [m.kind, m.kind === 'image' ? '' : dur(m.duration), m.width ? `${m.width}x${m.height}` : '', formatBytes(m.size)].filter(Boolean).join(' · ')
    const li = h('div', {
      class: ['vs-mi', bad && 'bad'], draggable: !bad, title: m.name,
      ondragstart: (e) => { e.dataTransfer.setData('application/x-vs-media', m.id); e.dataTransfer.effectAllowed = 'copy'; ui.dragMedia = m.id },
      ondragend: () => { ui.dragMedia = null },
      ondblclick: () => !bad && actions.addMediaClip(m.id),
    }, thumb, h('div', { class: 'vs-mn' }, h('b', m.name), h('span', { style: bad ? 'color:var(--danger)' : '' }, meta)),
    h('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
      !bad && iconBtn('plus', 'Add to timeline at the playhead', { pos: 'l', onClick: () => actions.addMediaClip(m.id) }),
      iconBtn('trash-2', 'Remove from project', { pos: 'l', onClick: () => actions.removeMedia(m.id, used(m.id)) })))
    return li
  }

  function refresh() {
    const items = media.list()
    list.replaceChildren(...items.map(item))
    count.textContent = items.length ? `${items.length} file${items.length > 1 ? 's' : ''}` : ''
  }
  const off = media.on(refresh)
  const off2 = doc.on((k) => { if (k !== 'live') refresh() })
  refresh()
  return { el, refresh, zone, destroy() { off(); off2() } }
}

// ---------------------------------------------------------------- inspector
const TITLE_PRESETS = [
  ['Centered title', { x: 0, y: 0, size: 11, align: 'center', bgOpacity: 0, bold: true, shadow: true, strokeW: 0, font: FONTS[0][0] }],
  ['Lower third', { x: 0, y: 34, size: 5.5, align: 'center', bg: '#000000', bgOpacity: 60, bold: true, shadow: false, strokeW: 0, font: FONTS[0][0] }],
  ['Caption', { x: 0, y: 40, size: 5, align: 'center', bgOpacity: 0, bold: true, shadow: true, strokeW: 8, strokeColor: '#000000', font: FONTS[0][0] }],
  ['Big impact', { x: 0, y: 0, size: 20, align: 'center', bgOpacity: 0, bold: false, shadow: true, strokeW: 0, font: FONTS[2][0] }],
]

export function createInspector({ doc, ui, actions, player }) {
  const body = h('div', { class: 'vs-scrollbox' })
  const el = h('section', { class: 'vs-panel vs-insp', 'aria-label': 'Inspector' }, h('div', { class: 'vs-ph', id: 'vs-ititle' }, 'Inspector'), body)
  const title = el.querySelector('#vs-ititle')
  let self = false
  let kind = null

  const targets = (p) => p.clips.filter((c) => ui.sel.has(c.id) && c.kind === kind)
  const edit = (label, key, fn) => {
    self = true
    try { doc.commit(label, (p) => { for (const c of targets(p)) fn(c, p) }, { key }) } finally { self = false }
  }

  const editR = (label, fn) => { edit(label, null, fn); render() } // discrete change that can alter other controls: rebuild
  const wide = (label, ctl) => h('div', { class: 'vs-f wide' }, h('label', label), ctl)
  const sec = (name, ...kids) => h('div', { class: 'vs-sec' }, h('h4', name), ...kids)

  function slider(label, { min, max, step = 1, value, key, set, dec = 0, def }) {
    const r = h('input', { type: 'range', min, max, step, value, 'aria-label': label })
    const n = h('input', { class: 'vs-num', type: 'number', min, max, step, value: +Number(value).toFixed(dec), 'aria-label': `${label} value` })
    const apply = (v) => {
      if (!Number.isFinite(v)) return
      v = clamp(v, min, max)
      r.value = String(v)
      n.value = String(+v.toFixed(dec))
      set(v)
    }
    r.addEventListener('input', () => apply(r.valueAsNumber))
    n.addEventListener('change', () => apply(n.valueAsNumber))
    const lab = h('label', { title: def === undefined ? '' : 'Double-click to reset', ondblclick: () => def !== undefined && apply(def) }, label)
    return h('div', { class: 'vs-f' }, lab, r, n)
  }
  const prop = (label, name, opts) => slider(label, { ...opts, value: opts.c[name], key: name, set: (v) => edit(`Change ${label.toLowerCase()}`, name, (c) => { c[name] = v }) })
  const select = (label, options, value, onChange) => wide(label, h('select', { class: 'vs-in', 'aria-label': label, onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))))
  const color = (label, value, onChange) => wide(label, h('input', { type: 'color', class: 'vs-color', value, 'aria-label': label, oninput: (e) => onChange(e.target.value) }))
  const check = (label, value, onChange) => h('label', { class: 'switch', style: 'margin:6px 0' }, h('input', { type: 'checkbox', role: 'switch', checked: !!value, onchange: (e) => onChange(e.target.checked) }), h('span', label))
  const seg = (label, options, value, onChange) => {
    const box = h('div', { class: 'vs-seg', role: 'group', 'aria-label': label })
    const btns = options.map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(v === value), 'aria-label': ic ? l : null, title: ic ? l : null, onclick: () => { btns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === v))); onChange(v) } }, ic ? icon(ic) : l))
    options.forEach(([v], i) => { btns[i]._v = v })
    box.append(...btns)
    return wide(label, box)
  }
  const act = (label, ic, fn, variant = 'secondary') => button(label, { icon: ic, size: 'sm', variant, onClick: fn })
  const info = (c) => h('p', { class: 'vs-note' }, `Starts at ${dur(c.start)} - ${dur(clipEnd(c))}, length ${(c.dur).toFixed(2)} s.`)

  // ---- sections
  function transform(c) {
    return sec('Transform',
      prop('Scale', 'scale', { c, min: 10, max: 400, def: 100 }),
      prop('Position X', 'x', { c, min: -100, max: 100, def: 0 }),
      prop('Position Y', 'y', { c, min: -100, max: 100, def: 0 }),
      prop('Rotation', 'rot', { c, min: -180, max: 180, def: 0 }),
      prop('Opacity', 'opacity', { c, min: 0, max: 100, def: 100 }),
      c.kind !== 'title' && h('div', { class: 'vs-btnrow' },
        act('Fit to frame', 'minimize-2', () => editR('Fit to frame', (x) => { x.fit = 'contain'; x.scale = 100; x.x = 0; x.y = 0; x.rot = 0 })),
        act('Fill frame', 'maximize', () => editR('Fill frame', (x) => { x.fit = 'cover'; x.scale = 100; x.x = 0; x.y = 0 }))))
  }
  const volume = (c) => sec('Audio',
    prop('Volume', 'volume', { c, min: 0, max: 200, def: 100 }),
    prop('Fade in', 'fadeIn', { c, min: 0, max: 8, step: 0.1, dec: 1, def: 0 }),
    prop('Fade out', 'fadeOut', { c, min: 0, max: 8, step: 0.1, dec: 1, def: 0 }))
  const speed = (c) => sec('Speed',
    slider('Speed', { min: MIN_SPEED, max: MAX_SPEED, step: 0.05, value: c.speed, dec: 2, def: 1, set: (v) => edit('Change speed', 'speed', (x, p) => setSpeed(p, x, v)) }),
    h('p', { class: 'vs-note' }, c.kind === 'audio' || c.kind === 'video' ? 'Audio pitch follows speed.' : ''))
  const transitions = (c) => sec('Transitions',
    select('In', [['none', 'None'], ['crossfade', 'Crossfade'], ['black', 'Fade from black']], c.tin.type, (v) => edit('Set transition in', null, (x) => { x.tin = trans(v, x.tin.dur || 0.5) })),
    slider('In length', { min: 0.1, max: 3, step: 0.1, value: c.tin.dur, dec: 1, def: 0.5, set: (v) => edit('Transition in length', 'tin', (x) => { x.tin.dur = v }) }),
    select('Out', [['none', 'None'], ['fade', 'Fade out'], ['black', 'Fade to black']], c.tout.type, (v) => edit('Set transition out', null, (x) => { x.tout = trans(v, x.tout.dur || 0.5) })),
    slider('Out length', { min: 0.1, max: 3, step: 0.1, value: c.tout.dur, dec: 1, def: 0.5, set: (v) => edit('Transition out length', 'tout', (x) => { x.tout.dur = v }) }),
    h('p', { class: 'vs-note' }, 'A crossfade blends with the clip before it on the same track, or with the tracks underneath.'))
  const color3 = (c) => sec('Color',
    prop('Brightness', 'bright', { c, min: 0, max: 200, def: 100 }),
    prop('Contrast', 'contrast', { c, min: 0, max: 200, def: 100 }),
    prop('Saturation', 'sat', { c, min: 0, max: 200, def: 100 }))
  const actionsSec = (c) => sec('Clip',
    info(c),
    h('div', { class: 'vs-btnrow' },
      act('Split', 'scissors', () => actions.split()),
      act('Duplicate', 'copy', () => actions.duplicate()),
      c.kind === 'video' && act('Detach audio', 'audio-lines', () => actions.detachAudio()),
      act('Delete', 'trash-2', () => actions.deleteSel(), 'danger')))
  const nameField = (c) => sec('Name', h('input', { class: 'vs-in', value: c.name, 'aria-label': 'Clip name', placeholder: 'Clip name', oninput: (e) => edit('Rename clip', 'name', (x) => { x.name = e.target.value }) }))

  function titleSections(c) {
    const preset = (p) => editR('Title preset', (x) => Object.assign(x, p))
    return [
      sec('Text',
        h('textarea', { class: 'vs-in', rows: 3, value: c.text, 'aria-label': 'Title text', oninput: (e) => edit('Edit title text', 'text', (x) => { x.text = e.target.value }) }),
        select('Font', FONTS, c.font, (v) => edit('Change font', null, (x) => { x.font = v })),
        prop('Size', 'size', { c, min: 2, max: 40, step: 0.5, dec: 1, def: 9 }),
        color('Color', c.color, (v) => edit('Title color', 'color', (x) => { x.color = v })),
        h('div', { class: 'vs-btnrow', style: 'margin-top:8px' },
          h('div', { class: 'vs-seg' },
            h('button', { type: 'button', 'aria-pressed': String(c.bold), 'aria-label': 'Bold', title: 'Bold', onclick: (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); edit('Bold', null, (x) => { x.bold = on }) } }, icon('bold')),
            h('button', { type: 'button', 'aria-pressed': String(c.italic), 'aria-label': 'Italic', title: 'Italic', onclick: (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); edit('Italic', null, (x) => { x.italic = on }) } }, icon('italic'))),
          (() => {
            const box = h('div', { class: 'vs-seg', role: 'group', 'aria-label': 'Alignment' })
            const defs = [['left', 'Align left', 'align-left'], ['center', 'Align center', 'align-center'], ['right', 'Align right', 'align-right']]
            const btns = defs.map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(c.align === v), 'aria-label': l, title: l, onclick: () => { btns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === v))); edit('Align text', null, (x) => { x.align = v }) } }, icon(ic)))
            defs.forEach(([v], i) => { btns[i]._v = v })
            box.append(...btns)
            return box
          })())),
      sec('Presets', h('div', { class: 'vs-btnrow' }, TITLE_PRESETS.map(([n, p]) => act(n, 'type', () => preset(p))))),
      transform(c),
      sec('Style',
        prop('Box opacity', 'bgOpacity', { c, min: 0, max: 100, def: 0 }),
        color('Box color', c.bg, (v) => edit('Box color', 'bg', (x) => { x.bg = v })),
        prop('Outline', 'strokeW', { c, min: 0, max: 30, def: 0 }),
        color('Outline color', c.strokeColor, (v) => edit('Outline color', 'strokeColor', (x) => { x.strokeColor = v })),
        check('Drop shadow', c.shadow, (v) => edit('Drop shadow', null, (x) => { x.shadow = v }))),
      sec('Fades',
        prop('Fade in', 'fadeIn', { c, min: 0, max: 5, step: 0.1, dec: 1, def: 0 }),
        prop('Fade out', 'fadeOut', { c, min: 0, max: 5, step: 0.1, dec: 1, def: 0 })),
      actionsSec(c),
    ]
  }

  function projectSections() {
    const p = doc.p
    return [
      sec('Project',
        wide('Name', h('input', { class: 'vs-in', value: p.name, 'aria-label': 'Project name', oninput: (e) => { self = true; doc.commit('Rename project', (x) => { x.name = e.target.value || 'Untitled project' }, { key: 'pname' }); self = false; actions.syncName() } })),
        wide('Aspect', (() => {
          const box = h('div', { class: 'vs-seg', role: 'group', 'aria-label': 'Aspect ratio' })
          const btns = Object.keys(ASPECTS).map((a) => h('button', { type: 'button', 'aria-pressed': String(p.aspect === a), onclick: () => { actions.setAspect(a); btns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === a))) } }, a))
          box.append(...btns)
          return box
        })()),
        select('Frame rate', [[24, '24 fps'], [25, '25 fps'], [30, '30 fps'], [60, '60 fps']], p.fps, (v) => { self = true; doc.commit('Change frame rate', (x) => { x.fps = +v }); self = false }),
        color('Background', p.bg, (v) => { self = true; doc.commit('Change background', (x) => { x.bg = v }, { key: 'bg' }); self = false }),
        h('p', { class: 'vs-note' }, `${p.width} x ${p.height}, ${p.clips.length} clip${p.clips.length === 1 ? '' : 's'}, ${dur(projectDuration(p))} long.`)),
      sec('Get started',
        h('p', { class: 'vs-note', style: 'margin-top:0' }, 'Import media, add it to the timeline, select a clip to edit its look, speed, volume and transitions, then Export.'),
        h('div', { class: 'vs-btnrow', style: 'margin-top:8px' }, act('Shortcuts', 'keyboard', () => actions.showShortcuts()), act('Fit timeline', 'maximize-2', () => actions.fitTimeline()))),
    ]
  }

  let queued = false
  function render() {
    queued = false
    const p = doc.p
    const sel = [...ui.sel].map((id) => clipById(p, id)).filter(Boolean)
    const c = sel.at(-1)
    kind = c?.kind || null
    body.replaceChildren()
    if (!c) { title.textContent = 'Project'; body.append(...projectSections()); return }
    title.textContent = sel.length > 1 ? `${sel.length} ${c.kind} clips` : { video: 'Video clip', image: 'Image clip', title: 'Title', audio: 'Audio clip' }[c.kind]
    if (c.kind === 'title') return body.append(...titleSections(c))
    if (c.kind === 'audio') return body.append(nameField(c), volume(c), speed(c), actionsSec(c))
    body.append(nameField(c), transform(c), ...(c.kind === 'video' ? [speed(c), volume(c)] : []), transitions(c), color3(c), actionsSec(c))
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render) } }
  const offs = [
    doc.on((k) => { if (k !== 'live' && !self) schedule() }),
    ui.on((patch) => { if ('sel' in patch) schedule() }),
  ]
  render()
  return { el, refresh: render, destroy() { offs.forEach((f) => f()) } }
}
