// Compress video: hit a size limit (WhatsApp, email, custom MB) by computing the bitrate from the duration, or just shrink by quality.
import { createShell, step, tilePicker, note, alert, h } from './_ui.js'
import { inputName, MB, videoKbpsFor, pickShortSide, capShortSide, X264_PRESETS, fmtTime } from './_media.js'
import { number, select, field, formatBytes } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'

const TARGETS = {
  whatsapp: { mb: 16, label: 'WhatsApp', sub: 'Under 16 MB, sends as a video', icon: 'message-circle' },
  whatsapp64: { mb: 64, label: 'WhatsApp, large', sub: 'Under 64 MB, for longer videos', icon: 'messages-square' },
  email: { mb: 25, label: 'Email', sub: 'Under 25 MB, fits most inboxes', icon: 'mail' },
  custom: { mb: 0, label: 'Exact size', sub: 'Pick your own limit in MB', icon: 'ruler' },
  quality: { mb: 0, label: 'Just smaller', sub: 'Choose how much to squeeze', icon: 'minimize-2' },
}
const SQUEEZE = [
  { value: 'light', label: 'Light', sub: 'Looks almost identical', icon: 'sparkles', crf: 26 },
  { value: 'medium', label: 'Medium', sub: 'A good balance', icon: 'scale', crf: 29 },
  { value: 'strong', label: 'Strong', sub: 'Much smaller, softer', icon: 'minimize-2', crf: 33 },
]
const CAPS = [[0, 'Automatic (best for the size)'], [-1, 'Keep original size'], [1080, '1080p'], [720, '720p'], [540, '540p'], [480, '480p'], [360, '360p'], [240, '240p']]
const AUDIO = [[96, 'Good (96 kbps)'], [128, 'High (128 kbps)'], [64, 'Small (64 kbps)'], [40, 'Voice (40 kbps, mono)'], [0, 'Remove the sound']]

/** The numbers behind a compression plan (pure, so it can be reasoned about and tested). */
export function plan({ mode, sizeMb, squeeze, capChoice, audioKbps, info }) {
  const w = info.display?.width || info.video?.width
  const h2 = info.display?.height || info.video?.height
  const fps = info.video?.fps || 30
  const aKbps = info.hasAudio ? audioKbps : 0
  const out = { aKbps, mono: audioKbps === 40, w, h: h2, fps }
  if (mode === 'quality') {
    const cap = capChoice > 0 ? capChoice : 0
    const d = cap ? capShortSide(w, h2, cap) : { w: even(w), h: even(h2) }
    return { ...out, ...d, crf: SQUEEZE.find((s) => s.value === squeeze).crf, vKbps: 0, target: 0, limit: 0, cap }
  }
  const mb = mode === 'custom' ? sizeMb : TARGETS[mode].mb
  const limit = mb * MB
  const aim = limit * 0.93
  const vKbps = info.duration ? videoKbpsFor(aim, info.duration, aKbps) : 0
  const useKbps = Math.max(30, vKbps)
  let cap = capChoice > 0 ? capChoice : 0
  if (capChoice === 0) cap = pickShortSide(useKbps, w, h2, Math.min(fps, 30))
  const d = cap && cap < Math.min(w, h2) ? capShortSide(w, h2, cap) : { w: even(w), h: even(h2) }
  return { ...out, ...d, crf: 0, vKbps: useKbps, rawKbps: vKbps, target: aim, limit, cap, capFps: fps > 30 && useKbps < 2500 ? 30 : 0 }
}
const even = (n) => Math.max(2, Math.round(n / 2) * 2)

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'minimize-2',
    dropLabel: 'Drop a big video to make it smaller',
    action: { label: 'Compress video', icon: 'minimize-2', busy: 'Compressing' },
    options(media, shell) {
      const { info, file } = media
      let mode = 'whatsapp'
      let squeeze = 'medium'
      let lastMode = mode
      const picker = tilePicker({
        label: 'Target', value: mode, onChange: (v) => { mode = v; refresh() },
        options: Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label, sub: t.sub, icon: t.icon })),
      })
      const sizeIn = number(10, { min: 0.2, max: 2000, step: 0.1, ariaLabel: 'Target size in megabytes', onInput: () => refresh() })
      const sizeBox = h('div', { hidden: true }, field('Target size (MB)', sizeIn, 'The file is made to come out just under this size.'))
      const squeezePicker = tilePicker({ label: 'How much', options: SQUEEZE, value: squeeze, compact: true, onChange: (v) => { squeeze = v; refresh() } })
      const squeezeStep = step(2, 'How much to squeeze', squeezePicker)
      const short = Math.min(info.display?.width || 0, info.display?.height || 0)
      const capSel = select(CAPS.filter(([c]) => c <= 0 || c < short), 0, () => refresh())
      const audioSel = select(AUDIO, 96, () => refresh())
      const speedSel = select([['balanced', 'Balanced'], ['fast', 'Fastest (a bit bigger)'], ['small', 'Slower (a bit smaller)']], 'balanced', () => refresh())
      const audioField = field('Sound', audioSel)
      audioField.hidden = !info.hasAudio
      const summary = h('div', { class: 'stack tight' })

      get = () => {
        const sizeMb = sizeIn.valueAsNumber
        const p = plan({ mode, sizeMb, squeeze, capChoice: +capSel.value, audioKbps: +audioSel.value, info })
        return { p, mode, speed: speedSel.value, sizeMb }
      }
      function refresh() {
        sizeBox.hidden = mode !== 'custom'
        squeezeStep.hidden = mode !== 'quality'
        capSel.options[0].textContent = mode === 'quality' ? 'Keep original size' : 'Automatic (best for the size)'
        if (mode !== lastMode) { capSel.value = mode === 'quality' ? '-1' : '0'; lastMode = mode }
        const g = get()
        const p = g.p
        const nodes = []
        let enabled = true
        let why = ''
        if (mode === 'custom' && !(g.sizeMb >= 0.2)) { enabled = false; why = 'Enter a size of at least 0.2 MB' }
        if (mode !== 'quality' && !info.duration) { enabled = false; why = 'The length of this video is unknown, so a size target is not possible. Use "Just smaller".' }
        if (enabled && mode !== 'quality') {
          const limit = p.limit
          const fit = file.size <= limit
          if (fit) nodes.push(alert('success', `This video is already ${formatBytes(file.size)}, under the ${+(limit / MB).toFixed(1)} MB limit. You can still compress it to make it lighter.`))
          if (p.rawKbps < 150) nodes.push(alert('warn', `${+(limit / MB).toFixed(1)} MB for ${fmtTime(info.duration)} leaves only about ${Math.max(0, Math.round(p.rawKbps))} kbps for the picture, so it will look rough. Pick a bigger limit, trim the video first, or drop the sound.`))
          nodes.push(h('dl', { class: 'mc-kv' },
            h('dt', 'Video bitrate'), h('dd', `about ${Math.round(p.vKbps)} kbps`),
            h('dt', 'Resolution'), h('dd', `${p.w} x ${p.h}${p.cap && p.cap < short ? ` (${p.cap}p)` : ''}`),
            h('dt', 'Sound'), h('dd', info.hasAudio ? `${p.aKbps ? p.aKbps + ' kbps' : 'removed'}` : 'none'),
            h('dt', 'Expected size'), h('dd', `about ${formatBytes(p.target)}`)))
          shell.setInfo(`Under ${+(limit / MB).toFixed(1)} MB`, `${p.w} x ${p.h}, about ${Math.round(p.vKbps)} kbps`)
        } else if (enabled) {
          nodes.push(note(`Re-encodes at ${p.w} x ${p.h} with constant quality. The size depends on the video, but "${SQUEEZE.find((s) => s.value === squeeze).label}" usually saves ${squeeze === 'light' ? '30 to 50' : squeeze === 'medium' ? '50 to 70' : '70 to 90'}% on phone footage.`))
          shell.setInfo(`${SQUEEZE.find((s) => s.value === squeeze).label} compression`, `${p.w} x ${p.h}`)
        } else shell.setInfo('', why)
        shell.setEnabled(enabled, why)
        summary.replaceChildren(...nodes)
      }
      refresh()
      return [
        step(1, 'Where is it going?', [picker, sizeBox]),
        squeezeStep,
        step(3, 'Settings', [h('div', { class: 'mc-grid' }, field('Resolution', capSel), audioField, field('Encoding speed', speedSel)), summary]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const { p, mode, speed } = get()
      const inName = inputName(file)
      const out = 'out.mp4'
      const vf = []
      if (p.cap && p.cap < Math.min(info.display.width, info.display.height)) vf.push(`scale=${p.w}:${p.h}`)
      if (p.capFps) vf.push(`fps=${p.capFps}`)
      const audio = !info.hasAudio || !p.aKbps ? ['-an'] : ['-c:a', 'aac', '-b:a', `${p.aKbps}k`, ...(p.mono ? ['-ac', '1'] : [])]
      const encode = (kbps, label) => hp.ffmpeg({
        inputs: [{ name: inName, data: file }],
        args: ['-i', inName, '-map', '0:v:0', ...(info.hasAudio && p.aKbps ? ['-map', '0:a:0'] : []), ...(vf.length ? ['-vf', vf.join(',')] : []),
          '-c:v', 'libx264', '-preset', X264_PRESETS[speed], ...(kbps ? ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.25)}k`, '-bufsize', `${Math.round(kbps * 2)}k`] : ['-crf', String(p.crf)]),
          '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', out],
        output: out, label,
      })
      let blob = await encode(p.vKbps, mode === 'quality' ? 'Compressing' : 'Compressing to the target size')
      let tries = 1
      const notes = []
      if (mode !== 'quality') {
        // single pass bitrate control can overshoot a little: retry once at a lower bitrate if we are over the limit
        let kbps = p.vKbps
        while (blob.size > p.limit && tries < 3 && kbps > 30) {
          kbps = Math.max(30, Math.floor(kbps * (p.limit * 0.95 / blob.size)))
          blob = await encode(kbps, 'A bit over the limit, squeezing a little more')
          tries++
        }
        const under = blob.size <= p.limit
        const lim = `${+(p.limit / MB).toFixed(1)} MB`
        notes.push(under ? alert('success', h('strong', `Under ${lim}. `), `${formatBytes(blob.size)} fits the limit.`) : alert('warn', h('strong', `Still over ${lim}. `), 'Try a bigger limit, a lower resolution, or trim the video first.'))
      }
      return {
        blob, name: suffixName(file.name, mode === 'quality' ? 'smaller' : 'compressed', 'mp4'), inputSize: file.size, notes,
        title: blob.size < file.size ? `Down to ${formatBytes(blob.size)}` : 'Compressed',
        summary: `${p.w} x ${p.h}${p.cap && p.cap < Math.min(info.display.width, info.display.height) ? '' : ' (original size)'}, H.264 video${p.aKbps ? ` and AAC sound at ${p.aKbps} kbps` : ' without sound'}.${tries > 1 ? ` Took ${tries} tries to fit the limit.` : ''}`,
        stats: [{ label: 'Resolution', value: `${p.w}x${p.h}` }],
      }
    },
  })
}
