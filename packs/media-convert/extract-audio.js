// Extract audio from video (also serves video-to-mp3 via params.to). Keeps the original audio untouched or re-encodes it.
import { createShell, step, fixedOutput, note } from './_ui.js'
import { audioOptions } from './_audio.js'
import { AUDIO_FORMATS, copyExtFor, inputName } from './_media.js'
import { select, field, formatBytes } from '../../lib/ui.js'
import { withExt } from '../../lib/files.js'

export function mount(root, { params, signal }) {
  const fixed = params?.to
  let opts = null
  let trackSel = null

  createShell(root, { signal }, {
    kind: 'video',
    require: 'audio',
    accept: 'video/*,audio/*,.mkv,.avi,.mov,.m4v,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.webm,.mp4,.m4a,.mp3,.wav,.aac,.ogg,.opus,.flac',
    dropIcon: fixed ? 'music' : 'audio-waveform',
    dropLabel: fixed ? 'Drop a video to save its sound as MP3' : 'Drop a video to pull its sound out',
    dropHint: 'MP4, MOV, MKV, WebM, AVI and more',
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The video is read inside this tab.'], ['audio-lines', 'Original quality option', 'Copy the exact audio track with no re-encoding and no loss.'], ['download-cloud', 'One-time engine', 'A 31 MB engine downloads once, then your browser keeps it.']],
    action: { label: fixed ? 'Extract MP3' : 'Extract audio', icon: 'audio-waveform', busy: 'Extracting audio' },

    options(media, shell) {
      const { info } = media
      const copyExt = info.audio ? copyExtFor(info.audio.codec) : null
      const extra = fixed ? [] : [{ value: 'copy', label: 'Original', sub: copyExt ? `${info.audio.codec.toUpperCase()} as .${copyExt}, no re-encode` : 'Cannot be saved as is', icon: 'sparkles', disabled: !copyExt }]
      opts = audioOptions({
        fmt: fixed || (copyExt ? 'copy' : 'mp3'), extra, info, hideFormat: !!fixed,
        formats: ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac'],
        onChange: update,
      })
      const nodes = fixed ? [step(1, 'Output', fixedOutput('music', 'MP3', 'Plays on every phone, car stereo and music app.')), ...opts.nodes] : [...opts.nodes]
      if (info.nAudio > 1) {
        trackSel = select(Array.from({ length: info.nAudio }, (_, i) => [i, `Audio track ${i + 1}${i === 0 ? ' (main)' : ''}`]), 0, () => {})
        nodes.push(step(nodes.length + 1, 'Which track?', [field('Audio track', trackSel), note('This video has more than one audio track, for example different languages.')]))
      }
      function update() {
        if (!opts) return
        const o = opts.get()
        if (o.fmt === 'copy') shell.setInfo('Instant, lossless', `Saved as .${copyExt} with the exact original sound`)
        else {
          const est = opts.estimate(info.duration)
          shell.setInfo(`${AUDIO_FORMATS[o.fmt].label}${o.bitrate ? ` ${o.bitrate} kbps` : ''}`, est ? `About ${formatBytes(est)}` : 'Re-encoded from the original')
        }
      }
      update()
      return nodes
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = opts.get()
      const copy = o.fmt === 'copy'
      const e = copy ? copyExtFor(info.audio.codec) : AUDIO_FORMATS[o.fmt].ext
      const inName = inputName(file)
      const out = `out.${e}`
      const track = trackSel ? +trackSel.value : 0
      const blob = await hp.ffmpeg({
        inputs: [{ name: inName, data: file }],
        args: ['-i', inName, '-vn', '-map', `0:a:${track}`, ...(copy ? ['-c:a', 'copy'] : ['-map_metadata', '0', ...o.args]), out], output: out,
        label: copy ? 'Copying the audio track' : 'Extracting audio',
      })
      return {
        blob, name: withExt(file.name, e), kind: 'audio', inputSize: file.size,
        title: copy ? 'Audio extracted, untouched' : `Saved as ${AUDIO_FORMATS[o.fmt].label}`,
        summary: copy ? `The original ${info.audio.codec.toUpperCase()} audio was copied out without any re-encoding.` : `The soundtrack of ${file.name} is now a ${AUDIO_FORMATS[o.fmt].label} file.`,
      }
    },
  })
}
