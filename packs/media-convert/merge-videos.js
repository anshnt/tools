// Merge videos: order the clips, then join them. Matching clips are joined instantly with the concat demuxer (no re-encode);
// different ones are scaled to a common size and frame rate and re-encoded to MP4.
import { createMultiShell, storyboard } from './_multi.js'
import { step, tilePicker, note, alert, h } from './_ui.js'
import { inputName, encodeArgs, capShortSide, fmtTime, X264_PRESETS, QUALITY_CRF } from './_media.js'
import { QUALITY_OPTIONS, firstThatWorks } from './_video.js'
import { select, field, toggle, isAbort } from '../../lib/ui.js'
import { baseName, ext } from '../../lib/files.js'

const RES = [['first', 'Same as the first clip'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']]
const FPS = [['first', 'Same as the first clip'], [60, '60 fps'], [30, '30 fps'], [25, '25 fps'], [24, '24 fps']]
const even = (n) => Math.max(2, Math.round(n / 2) * 2)
const CONTAINERS = ['mp4', 'mov', 'mkv', 'webm', 'm4v']

/** What differs between the clips (empty when they can be joined as they are). */
export function differences(infos) {
  const uniq = (fn) => new Set(infos.map(fn)).size > 1
  const out = []
  if (infos.some((i) => !i.hasVideo)) out.push('some files have no video')
  if (uniq((i) => `${i.display?.width}x${i.display?.height}`)) out.push('resolution')
  if (uniq((i) => Math.round((i.video?.fps || 0) * 10))) out.push('frame rate')
  if (uniq((i) => i.video?.codec)) out.push('video codec')
  if (uniq((i) => `${i.audio?.codec}/${i.audio?.rate}/${i.audio?.channels}`)) out.push('sound format')
  if (uniq((i) => i.rotation)) out.push('orientation')
  return out
}

export function mount(root, { signal }) {
  let controls = null
  let board = null
  let refresh = () => {}

  createMultiShell(root, { signal }, {
    kind: 'video',
    min: 2,
    max: 20,
    dropIcon: 'combine',
    dropLabel: 'Drop two or more clips here or click to choose',
    dropHint: 'MP4, MOV, MKV, WebM and more. Reorder them after adding.',
    action: { label: 'Join clips', icon: 'combine', busy: 'Joining' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The clips are joined inside this tab.'], ['zap', 'Instant when clips match', 'Clips from the same camera or app are joined without re-encoding.'], ['layers', 'Mixed clips are fine', 'Different sizes and frame rates are matched for you.']],

    options(set, shell) {
      let quality = 'balanced'
      const resSel = select(RES, 'first', () => refresh())
      const fpsSel = select(FPS, 'first', () => refresh())
      const force = toggle('Always re-encode (try this if the joined video glitches)', false, () => refresh())
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY_OPTIONS, value: quality, compact: true, onChange: (v) => { quality = v } })
      const verdict = h('div')
      board = storyboard(set)
      controls = () => ({ res: resSel.value, fps: fpsSel.value, force: force.input.checked, quality })
      const reencodeBox = h('div', { class: 'stack' }, h('div', { class: 'mc-grid' }, field('Resolution', resSel), field('Frame rate', fpsSel)), qualityPicker)
      refresh = () => {
        board.update()
        const infos = set.files.map((f) => set.info(f))
        const ready = infos.every(Boolean)
        const verdictNodes = []
        let copy = false
        if (!ready) verdictNodes.push(note('Reading the clips...'))
        else {
          const diff = differences(infos)
          if (diff.includes('some files have no video')) {
            shell.setEnabled(false, 'One of the files has no video. Use Merge audio files for audio.')
            verdictNodes.push(alert('error', 'One of the files has no video. Remove it, or use Merge audio files for audio.'))
          } else if (!diff.length && !force.input.checked) {
            copy = true
            verdictNodes.push(alert('success', h('strong', 'These clips match. '), 'They share the same format, so they are joined instantly with no re-encoding and no quality loss.'))
          } else if (diff.length) {
            verdictNodes.push(alert('info', h('strong', 'The clips differ. '), `They have different ${diff.join(', ')}, so they are scaled to a common size and re-encoded to MP4 H.264. This takes longer.`))
          } else verdictNodes.push(note('Everything will be re-encoded to MP4 H.264.'))
        }
        reencodeBox.hidden = copy
        verdict.replaceChildren(...verdictNodes)
        const total = infos.reduce((a, i) => a + (i?.duration || 0), 0)
        if (ready && !infos.some((i) => !i.hasVideo)) shell.setEnabled(set.files.length >= 2, 'Add at least 2 clips')
        shell.setInfo(`${set.files.length} clips${total ? `, ${fmtTime(total, 1)}` : ''}`, copy ? 'Joined instantly, no re-encoding' : ready ? 'Re-encoded to a common format' : 'Reading the clips...')
      }
      refresh()
      return [
        step(1, 'Order', board),
        step(2, 'How they are joined', [verdict, reencodeBox, h('div', { class: 'mc-switches' }, force)]),
      ]
    },
    onSet: () => refresh(),

    async execute(set, hp) {
      await set.ready()
      const files = [...set.files]
      const infos = files.map((f) => set.info(f))
      const o = controls()
      const total = infos.reduce((a, i) => a + (i.duration || 0), 0)
      const e0 = ext(files[0].name)
      const diff = differences(infos)
      const names = files.map((f, i) => inputName(f, String(i)))
      const inputs = files.map((f, i) => ({ name: names[i], data: f }))
      let blob = null
      let mode = 'encode'
      let outExt = 'mp4'

      if (!diff.length && !o.force) {
        const list = files.map((_, i) => `file '${names[i]}'`).join('\n')
        const build = (e) => () => hp.ffmpeg({
          inputs: [...inputs, { name: 'list.txt', data: new Blob([list]) }],
          args: ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-map', '0:v:0', ...(infos[0].hasAudio ? ['-map', '0:a:0'] : []), '-c', 'copy', ...(e === 'mp4' || e === 'mov' ? ['-movflags', '+faststart'] : []), `out.${e}`],
          output: `out.${e}`, label: 'Joining the clips', total,
        }).then((b) => ({ b, e }))
        try {
          const r = await firstThatWorks([build(CONTAINERS.includes(e0) ? (e0 === 'm4v' ? 'mp4' : e0) : 'mkv'), build('mkv')], isAbort)
          blob = r.b
          outExt = r.e
          mode = 'copy'
        } catch (e) { if (isAbort(e)) throw e }
      }

      if (!blob) {
        const first = infos[0]
        const fw = first.display.width
        const fh = first.display.height
        const d = o.res === 'first' ? { w: even(fw), h: even(fh) } : capShortSide(fw, fh, +o.res)
        const fps = o.fps === 'first' ? Math.min(60, Math.round((first.video.fps || 30) * 100) / 100) : +o.fps
        const anyAudio = infos.some((i) => i.hasAudio)
        const parts = []
        const labels = []
        const extra = []
        let silent = files.length
        files.forEach((_, i) => {
          parts.push(`[${i}:v:0]scale=${d.w}:${d.h}:force_original_aspect_ratio=decrease,pad=${d.w}:${d.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`)
          if (anyAudio) {
            if (infos[i].hasAudio) parts.push(`[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
            else {
              extra.push('-f', 'lavfi', '-t', Math.max(0.1, infos[i].duration || 1).toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
              parts.push(`[${silent++}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
            }
          }
          labels.push(`[v${i}]${anyAudio ? `[a${i}]` : ''}`)
        })
        parts.push(`${labels.join('')}concat=n=${files.length}:v=1:a=${anyAudio ? 1 : 0}[v]${anyAudio ? '[a]' : ''}`)
        const enc = encodeArgs('mp4', { crf: QUALITY_CRF[o.quality], preset: X264_PRESETS.balanced, audio: anyAudio ? 'encode' : 'none', abitrate: 160 })
        blob = await hp.ffmpeg({
          inputs,
          args: [...names.flatMap((n) => ['-i', n]), ...extra, '-filter_complex', parts.join(';'), '-map', '[v]', ...(anyAudio ? ['-map', '[a]'] : []), ...enc, 'out.mp4'],
          output: 'out.mp4', label: 'Joining and re-encoding', total,
        })
        outExt = 'mp4'
      }
      return {
        blob, name: `${baseName(files[0].name)}-merged.${outExt}`, compare: false,
        title: `Joined ${files.length} clips`,
        summary: mode === 'copy' ? 'The clips matched, so they were joined without re-encoding. No quality was lost.' : `The clips were matched to one size and frame rate and encoded as MP4. ${diff.length ? `They differed in ${diff.join(', ')}.` : ''}`,
        stats: [{ label: 'Clips', value: String(files.length) }],
      }
    },
  })
}
