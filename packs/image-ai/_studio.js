// The shared "photo studio" shell for tools that cut out a subject: hero drop, thumbnail strip, stage with
// Cutout / Original / Compare views, a scanning overlay while the model runs, queue processing and reset.
// Remove background and Change background both build on it and only supply how the result is drawn.
import { h, icon, button, alert, clear, segmented, debounce, toast } from '../../lib/ui.js'
import { friendlyError, handoff } from './_ml.js'
import { steps, heroDrop, stage, scanFx, compare, strip, burst } from './_ui.js'

/**
 * subjectStudio({ q, signal, labels, views: [['result','Result'], ...], draw(item, canvas), renderDone(item, fresh) -> Node, hero: {...}, maxFiles })
 * Returns { stepper, hero, layout, stage, cmp, scan, setSide(el), select, addFiles, redraw, run, runAndWait, reset, active, setView }
 */
export function subjectStudio({ q, signal, afterLabel = 'Result', draw, renderDone, hero: heroOpts, maxFiles = 30, stepLabels = ['Add photos', 'Cut out', 'Download'], resultView = 'Result' }) {
  let active = null
  let view = 'result'
  let running = false
  const ctls = new Set()
  signal.addEventListener('abort', () => { for (const c of ctls) c.abort() })

  const stepper = steps(stepLabels, 0)
  const beforeCv = document.createElement('canvas')
  const afterCv = document.createElement('canvas')
  const cmp = compare(beforeCv, afterCv, { beforeLabel: 'Original', afterLabel, start: 1 })
  cmp.setStatic(true)
  const stg = stage()
  const scan = scanFx()
  const nameChip = h('div', { class: 'ia-chip bl' }, icon('image'), h('span', ''))
  const nameText = nameChip.querySelector('span')
  const viewSeg = segmented([['result', resultView], ['original', 'Original'], ['compare', 'Compare']], view, (v) => setView(v), 'View')
  stg.append(cmp, nameChip, h('div', { class: 'ia-tools' }, viewSeg), scan.el)

  const doneSlot = h('div')
  const errSlot = h('div')
  const thumbs = strip({ onSelect: (i) => select(q.items[i]), onRemove: (i) => removeItem(q.items[i]), onAdd: () => hero.zone.open() })
  const sideHost = h('div', { class: 'ia-side' })
  const layout = h('div', { class: 'ia-studio', hidden: true }, h('div', { class: 'ia-main' }, thumbs.el, stg, errSlot, doneSlot), sideHost)

  const hero = heroDrop({ multiple: true, accept: 'image/*', ...heroOpts, onFiles: (f) => addFiles(f) })

  stg.addEventListener('dragover', (e) => e.preventDefault())
  stg.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))) })

  const isDone = (it) => it && !q.stale(it)

  function setView(v) {
    view = v
    cmp.dataset.view = v
    viewSeg.set(v)
    if (!isDone(active)) { cmp.setStatic(true); cmp.animateTo(1); return }
    cmp.setStatic(v !== 'compare')
    cmp.animateTo(v === 'result' ? 0 : v === 'original' ? 1 : 0.5)
  }

  function paintAfter(it) {
    draw(it, afterCv)
  }
  const redraw = debounce(() => { if (isDone(active)) paintAfter(active) }, 25)

  function drawBefore(prev) {
    beforeCv.width = prev.width; beforeCv.height = prev.height
    beforeCv.getContext('2d').drawImage(prev.canvas, 0, 0)
    cmp.setAspect(prev.width, prev.height)
  }

  function renderThumbs() {
    thumbs.render(q.items.map((it) => ({ name: it.name, thumb: it.thumb, status: isDone(it) ? 'done' : it.status === 'run' ? 'run' : it.status === 'error' ? 'error' : '' })), q.items.indexOf(active))
    stepper.set(!q.items.length ? 0 : isDone(active) ? 2 : 1)
    api.onQueue?.(q.items.length)
  }

  async function select(it) {
    if (!it) return
    active = it
    renderThumbs()
    clear(doneSlot)
    clear(errSlot)
    try {
      const prev = await q.prepare(it)
      if (active !== it) return
      drawBefore(prev)
      const wk = await q.work(it)
      nameText.textContent = `${it.name}  -  ${wk.originalWidth} x ${wk.originalHeight}`
    } catch (e) {
      clear(errSlot, alert('error', friendlyError(e).message))
      return
    }
    if (q.stale(it)) {
      cmp.set(1); cmp.setStatic(true)
      if (it.status === 'run') scan.update(it.progress?.f, it.progress?.l || 'Working')
      else run(it)
    } else {
      showDone(it, false)
    }
    api.onSelect?.(it)
  }

  function showDone(it, fresh) {
    paintAfter(it)
    scan.stop()
    renderThumbs()
    clear(errSlot)
    clear(doneSlot, renderDone(it, fresh))
    if (fresh) {
      view = 'result'
      cmp.dataset.view = 'result'
      viewSeg.set('result')
      cmp.setStatic(true)
      cmp.set(1)
      cmp.animateTo(0, 900)
      burst(stg)
    } else {
      setView(view)
    }
    api.onSelect?.(it)
  }

  function run(it) {
    if (it.job) return it.job
    if (!q.stale(it)) return Promise.resolve()
    it.job = doRun(it).finally(() => { it.job = null })
    return it.job
  }

  async function doRun(it) {
    const ctl = new AbortController()
    ctls.add(ctl)
    if (it === active) {
      scan.onCancel = () => ctl.abort()
      scan.start('Loading AI model', true)
      clear(doneSlot); clear(errSlot)
    }
    try {
      await q.process(it, {
        signal: ctl.signal,
        onProgress: (f, l) => { it.progress = { f, l }; if (it === active) scan.update(f, l) },
      })
      if (it === active) showDone(it, true)
    } catch (e) {
      if (it === active) {
        scan.stop()
        if (e?.code !== 'ABORT' && e?.name !== 'AbortError') {
          clear(errSlot, alert('error', friendlyError(e).message, ' ', button('Try again', { size: 'sm', icon: 'refresh-cw', onClick: () => run(it) })))
        }
      }
    } finally {
      ctls.delete(ctl)
      renderThumbs()
    }
  }

  const runAndWait = async (it) => { if (q.stale(it)) await run(it) }

  async function runQueue() {
    if (running) return
    running = true
    try {
      for (const it of [...q.items]) {
        if (!q.items.includes(it) || !q.stale(it) || it.status === 'error') continue
        await run(it)
      }
    } finally { running = false }
  }

  async function addFiles(files) {
    files = files.slice(0, maxFiles - q.items.length)
    if (!files.length) return toast(`That is the limit for one batch (${maxFiles} photos).`)
    const added = q.add(files)
    hero.hidden = true
    layout.hidden = false
    if (!active) await select(added[0])
    else renderThumbs()
    runQueue()
  }

  function removeItem(it) {
    q.remove(it)
    if (!q.items.length) return reset()
    if (it === active) select(q.items[0])
    else renderThumbs()
  }

  function reset() {
    for (const c of ctls) c.abort()
    for (const it of [...q.items]) q.remove(it)
    active = null
    layout.hidden = true
    hero.hidden = false
    scan.stop()
    clear(doneSlot); clear(errSlot)
    stepper.set(0)
    api.onReset?.()
  }

  const api = {
    stepper, hero, layout, stage: stg, cmp, scan, thumbs, doneSlot, errSlot,
    onQueue: null, onSelect: null, onReset: null,
    setSide: (...kids) => sideHost.append(...kids.flat()),
    select, addFiles, redraw, run, runAndWait, reset, renderThumbs, setView, showDone,
    get active() { return active },
    get view() { return view },
    dispose() { for (const c of ctls) c.abort(); q.dispose() },
  }
  return api
}

/** Take a file another tool left for us (see handoff in _ml.js). */
export const takeHandoff = () => handoff.take()
