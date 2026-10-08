// Add subtitles to a video: preview the SRT/VTT on the video, then burn them in (libass with Noto Sans) or attach a soft track.
import { createShell, step, tilePicker, note, alert, h, icon, button, clear } from './_ui.js'
import { inputName, parseSubtitles, toSrt, pickFonts, fmtTime } from './_media.js'
import { reencodePlan, mapAV, firstThatWorks } from './_video.js'
import { putFonts, fetchBytes } from './_engine.js'
import { dropzone, select, field, input, number, isAbort, formatBytes, onCleanup } from '../../lib/ui.js'
import { suffixName, ext } from '../../lib/files.js'

const LANGS = [['eng', 'English'], ['hin', 'Hindi'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['por', 'Portuguese'], ['ita', 'Italian'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['zho', 'Chinese'], ['ara', 'Arabic'], ['rus', 'Russian'], ['ben', 'Bengali'], ['tam', 'Tamil'], ['tel', 'Telugu'], ['mar', 'Marathi'], ['guj', 'Gujarati'], ['pan', 'Punjabi'], ['kan', 'Kannada'], ['mal', 'Malayalam'], ['urd', 'Urdu'], ['und', 'Not specified']]
const SIZES = { small: 0.04, medium: 0.055, large: 0.075 }
const STYLES = {
  white: { label: 'White', sub: 'With a dark outline', primary: '&H00FFFFFF&', outline: '&H00000000&', back: '&H64000000&', border: 1 },
  yellow: { label: 'Yellow', sub: 'Classic movie subtitles', primary: '&H0000F0FF&', outline: '&H00000000&', back: '&H64000000&', border: 1 },
  box: { label: 'On a box', sub: 'White text, dark box', primary: '&H00FFFFFF&', outline: '&HA0000000&', back: '&HA0000000&', border: 3 },
}
// force_style uses the legacy SSA numbering: 1-3 bottom, 5-7 top, 9-11 middle
const POS = { bottom: 2, middle: 10, top: 6 }

/** Read a subtitle file as text: UTF-8, UTF-16 (with BOM) or, failing that, Windows-1252. */
export async function readSubtitleText(file) {
  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }
}

/** The force_style string for the subtitles filter. */
export function forceStyle({ family, size, style, pos }) {
  const s = STYLES[style]
  return `FontName=${family},FontSize=${Math.round(SIZES[size] * 288 * 10) / 10},PrimaryColour=${s.primary},OutlineColour=${s.outline},BackColour=${s.back},BorderStyle=${s.border},Outline=${s.border === 3 ? 6 : 2},Shadow=0,Alignment=${POS[pos]},MarginV=${pos === 'bottom' ? 24 : 18}`
}

export function mount(root, { signal }) {
  let get = null
  const S = { cues: [], text: '', file: null }

  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'captions',
    dropLabel: 'Drop a video to add subtitles',
    action: { label: 'Add subtitles', icon: 'captions', busy: 'Adding subtitles' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. Neither the video nor the subtitles leave this tab.'], ['captions', 'Preview first', 'See the subtitles on your video before you save anything.'], ['languages', 'Many scripts', 'Latin, Cyrillic, Greek, Hindi, Tamil, Arabic and more can be burned in.']],

    options(media, shell) {
      const { info, file } = media
      let how = 'burn'
      let styleKey = 'white'
      let pos = 'bottom'
      let sizeKey = 'medium'
      let container = ['mov', 'mp4', 'm4v'].includes(ext(file.name)) ? 'mp4' : ext(file.name) === 'webm' ? 'webm' : ext(file.name) === 'mkv' ? 'mkv' : 'mp4'

      // ----- subtitle file picker + preview -----
      const fileInfo = h('div')
      const cueBox = h('div')
      const shift = number(0, { step: 0.1, min: -600, max: 600, ariaLabel: 'Shift subtitles by seconds', onInput: () => { paintCues(); paintOverlay(); sync() } })
      const shiftField = field('Shift timing (seconds)', shift, 'Positive numbers show the subtitles later, negative earlier. Use it when they are out of sync.')
      shiftField.hidden = true
      const zone = dropzone({ accept: '.srt,.vtt,text/vtt,application/x-subrip,text/plain', label: 'Add an SRT or VTT file', hint: 'Drop it here or click to choose', icon: 'file-text', compact: true, paste: false, onFiles: ([f]) => loadSubs(f) })

      const view = media.el?.parentElement
      const overlay = h('div', { class: 'mc-sub-overlay', 'aria-hidden': 'true', hidden: true })
      if (view && media.canPlay) view.append(overlay)

      async function loadSubs(f) {
        try {
          const text = await readSubtitleText(f)
          const cues = parseSubtitles(text)
          if (!cues.length) throw new Error('No subtitles were found in this file. It should be an SRT or WebVTT file.')
          S.cues = cues
          S.text = text
          S.file = f
          shiftField.hidden = false
          clear(fileInfo, h('div', { class: 'row' }, icon('file-text'), h('div', { class: 'grow' }, h('b', f.name), h('div', { class: 'mc-note' }, `${cues.length} subtitles, ${fmtTime(cues[0].start, 1)} to ${fmtTime(cues.at(-1).end, 1)}`)), button('Remove', { icon: 'x', variant: 'ghost', size: 'sm', onClick: removeSubs })))
          zone.hidden = true
          paintCues()
          paintOverlay()
        } catch (e) {
          clear(fileInfo, alert('error', e.message || 'That file could not be read.'))
        }
        sync()
      }
      function removeSubs() {
        S.cues = []; S.text = ''; S.file = null
        shiftField.hidden = true
        zone.hidden = false
        clear(fileInfo); clear(cueBox)
        overlay.hidden = true
        sync()
      }
      const offset = () => (Number.isFinite(shift.valueAsNumber) ? shift.valueAsNumber : 0)
      let rows = []
      function paintCues() {
        const d = offset()
        rows = S.cues.map((c) => h('div', { class: 'mc-cue', role: 'button', tabindex: 0, onclick: () => { if (media.el && media.canPlay) { media.el.currentTime = Math.max(0, c.start + d); media.el.pause() } } },
          h('time', fmtTime(Math.max(0, c.start + d), 1)), h('span', c.text)))
        clear(cueBox, S.cues.length ? h('div', { class: 'mc-cues', role: 'list', 'aria-label': 'Subtitles' }, rows) : null)
        paintOverlay()
      }
      function paintOverlay() {
        const v = media.el
        if (!S.cues.length || !v || !media.canPlay) { overlay.hidden = true; return }
        const t = v.currentTime - offset()
        const idx = S.cues.findIndex((c) => t >= c.start && t < c.end)
        rows.forEach((r, i) => r.classList.toggle('on', i === idx))
        if (idx < 0) { overlay.hidden = true; return }
        overlay.hidden = false
        overlay.textContent = S.cues[idx].text
        const w = view.clientWidth || 640
        overlay.style.fontSize = `${Math.max(12, Math.round((v.videoHeight ? Math.min(view.clientHeight || 360, v.clientHeight || 360) : 360) * SIZES[sizeKey] * 1.05))}px`
        overlay.style.bottom = pos === 'bottom' ? '58px' : ''
        overlay.style.top = pos === 'top' ? '42px' : pos === 'middle' ? '50%' : ''
        overlay.style.transform = pos === 'middle' ? 'translateY(-50%)' : ''
        overlay.style.color = styleKey === 'yellow' ? '#ffe600' : '#fff'
        overlay.style.background = styleKey === 'box' ? 'rgba(0,0,0,.62)' : 'transparent'
        overlay.style.padding = styleKey === 'box' ? '2px 10px' : '0'
        overlay.style.width = styleKey === 'box' ? 'fit-content' : ''
        overlay.style.margin = styleKey === 'box' ? '0 auto' : ''
        void w
      }
      let raf = 0
      const loop = () => { paintOverlay(); raf = media.el && !media.el.paused ? requestAnimationFrame(loop) : 0 }
      const onTime = () => { if (!raf) paintOverlay() }
      if (media.el) {
        media.el.addEventListener('timeupdate', onTime)
        media.el.addEventListener('seeked', onTime)
        media.el.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(loop) })
      }
      onCleanup(() => cancelAnimationFrame(raf))

      // ----- options -----
      const howPicker = tilePicker({
        label: 'How to add them', value: how, onChange: (v) => { how = v; sync() },
        options: [
          { value: 'burn', label: 'Burn in', sub: 'Always visible in any player. Re-encodes the video', icon: 'flame' },
          { value: 'soft', label: 'Soft track', sub: 'Can be switched on and off. No re-encode', icon: 'toggle-right' },
        ],
      })
      const stylePicker = tilePicker({ label: 'Style', compact: true, value: styleKey, onChange: (v) => { styleKey = v; paintOverlay(); sync() }, options: Object.entries(STYLES).map(([value, s]) => ({ value, label: s.label, sub: s.sub })) })
      const sizePicker = tilePicker({ label: 'Size', compact: true, value: sizeKey, onChange: (v) => { sizeKey = v; paintOverlay() }, options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] })
      const posPicker = tilePicker({ label: 'Position', compact: true, value: pos, onChange: (v) => { pos = v; paintOverlay() }, options: [{ value: 'bottom', label: 'Bottom' }, { value: 'middle', label: 'Middle' }, { value: 'top', label: 'Top' }] })
      const fontNote = note('')
      const burnBox = h('div', { class: 'stack' }, stylePicker, h('div', { class: 'mc-grid' }, h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, 'Size'), sizePicker), h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, 'Position'), posPicker)), fontNote)
      const langSel = select(LANGS, 'eng', () => {})
      const titleIn = input({ value: '', placeholder: 'Optional, for example "English"', 'aria-label': 'Track name' })
      const containerPicker = tilePicker({
        label: 'Save as', compact: true, value: container, onChange: (v) => { container = v; sync() },
        options: [{ value: 'mp4', label: 'MP4', sub: 'mov_text track' }, { value: 'mkv', label: 'MKV', sub: 'SubRip track' }, ...(['vp8', 'vp9', 'av1'].includes(info.video.codec) ? [{ value: 'webm', label: 'WebM', sub: 'WebVTT track' }] : [])],
      })
      if (container === 'webm' && !['vp8', 'vp9', 'av1'].includes(info.video.codec)) container = 'mp4'
      const softBox = h('div', { class: 'stack', hidden: true }, containerPicker, h('div', { class: 'mc-grid' }, field('Language', langSel), field('Track name', titleIn)),
        note('The video and sound are copied as they are. In the player, turn the subtitles on from its subtitles or CC menu. Not every player shows soft tracks (some phone gallery apps do not).'))

      get = () => ({ how, styleKey, sizeKey, pos, container, lang: langSel.value, title: titleIn.value.trim(), shift: offset() })
      function sync() {
        burnBox.hidden = how !== 'burn'
        softBox.hidden = how !== 'soft'
        const has = S.cues.length > 0
        shell.setEnabled(has, 'Add a subtitle file first')
        if (S.text) {
          const f = pickFonts(S.text)
          const bits = []
          if (f.unsupported.length) { fontNote.textContent = `Burned-in text for ${f.unsupported.join(', ')} is not supported yet (the characters would show as empty boxes). Use a soft track instead.`; fontNote.className = 'mc-note warn' }
          else { fontNote.textContent = `Font: ${f.family}${f.script !== 'Latin' ? ` (${f.script})` : ''}. It downloads once, a few tens of KB.`; fontNote.className = 'mc-note' }
          void bits
        } else { fontNote.textContent = ''; }
        shell.setInfo(!has ? 'Add subtitles to begin' : how === 'burn' ? 'Burn in (re-encodes)' : `Soft track in ${container.toUpperCase()}`, !has ? 'Drop an SRT or VTT file below' : `${S.cues.length} subtitles${how === 'burn' ? ', the video is re-encoded' : ', the video is copied as it is'}`)
        shell.setLabel(how === 'burn' ? 'Burn in subtitles' : 'Attach subtitles')
      }
      sync()
      return [
        step(1, 'Subtitle file', [zone, fileInfo, shiftField, cueBox, note('Plain SRT and WebVTT are supported. Styling inside the file is ignored so the result looks the same everywhere.')]),
        step(2, 'How to add them', [howPicker, burnBox, softBox]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const inName = inputName(file)
      const srt = toSrt(S.cues, o.shift)
      const subBlob = new Blob([srt], { type: 'application/x-subrip' })
      const e0 = ext(file.name)
      if (o.how === 'burn') {
        const f = pickFonts(S.text)
        hp.report(null, 'Getting the font')
        const fonts = await Promise.all(f.files.map(async (url, i) => ({ name: `font${i}.woff`, data: await fetchBytes(url, hp.signal) })))
        await putFonts(fonts)
        const plan = reencodePlan(file, info, { quality: 'balanced' })
        const out = `out.${plan.ext}`
        const vf = `subtitles=sub.srt:fontsdir=/fonts:force_style='${forceStyle({ family: f.family, size: o.sizeKey, style: o.styleKey, pos: o.pos })}'`
        const blob = await hp.ffmpeg({ inputs: [{ name: inName, data: file }, { name: 'sub.srt', data: subBlob }], args: ['-i', inName, ...mapAV(info), '-vf', vf, ...plan.codec, out], output: out, label: 'Burning in the subtitles' })
        return {
          blob, name: suffixName(file.name, 'subtitled', plan.ext), inputSize: file.size, compare: false,
          title: 'Subtitles burned in',
          summary: `${S.cues.length} subtitles are now part of the picture (${f.family}), so they show in every player.`,
        }
      }
      const codec = { mp4: 'mov_text', mkv: 'srt', webm: 'webvtt' }[o.container]
      const subName = o.container === 'webm' ? 'sub.srt' : 'sub.srt'
      const meta = ['-metadata:s:s:0', `language=${o.lang}`, ...(o.title ? ['-metadata:s:s:0', `title=${o.title}`] : []), '-disposition:s:0', 'default']
      const build = (vcodec, acodec) => () => {
        const out = `out.${o.container}`
        return hp.ffmpeg({
          inputs: [{ name: inName, data: file }, { name: subName, data: subBlob }],
          args: ['-i', inName, '-i', subName, '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a?'] : []), '-map', '1:0', '-c:v', ...vcodec, ...(info.hasAudio ? ['-c:a', ...acodec] : []), '-c:s', codec, ...meta, ...(o.container === 'mp4' ? ['-movflags', '+faststart'] : []), out],
          output: out, label: 'Attaching the subtitles',
        })
      }
      const blob = await firstThatWorks([
        build(['copy'], ['copy']),
        build(['copy'], o.container === 'webm' ? ['libopus', '-b:a', '128k'] : ['aac', '-b:a', '160k']),
        build(o.container === 'webm' ? ['libvpx', '-crf', '12', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '5'] : ['libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'], o.container === 'webm' ? ['libopus', '-b:a', '128k'] : ['aac', '-b:a', '160k']),
      ], isAbort)
      return {
        blob, name: suffixName(file.name, 'subtitled', o.container), inputSize: file.size, compare: false,
        title: 'Subtitle track attached',
        summary: `${S.cues.length} subtitles were added as a ${codec} track${o.title ? ` named "${o.title}"` : ''}. Turn them on from the player's subtitles menu. The video was not changed.${e0 && e0 !== o.container ? '' : ''}`,
      }
    },
  })
}
