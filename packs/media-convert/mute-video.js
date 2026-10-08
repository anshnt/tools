// Remove audio from video: strips the sound with a stream copy (no re-encoding), or swaps it for silence.
import { createShell, step, tilePicker, alert, h } from './_ui.js'
import { inputName } from './_media.js'
import { firstThatWorks } from './_video.js'
import { isAbort } from '../../lib/ui.js'
import { suffixName, ext } from '../../lib/files.js'

export function mount(root, { signal }) {
  let mode = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'volume-x',
    dropLabel: 'Drop a video to take the sound out',
    action: { label: 'Remove audio', icon: 'volume-x', busy: 'Removing audio' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The video is processed inside this tab.'], ['zap', 'No re-encoding', 'The picture is copied as it is, so it is instant and loses nothing.'], ['volume-x', 'Sound gone for good', 'The audio is not hidden or muted, it is not in the new file at all.']],
    options(media, shell) {
      const { info } = media
      mode = tilePicker({
        label: 'What to do with the sound', value: 'remove', onChange: () => update(),
        options: [
          { value: 'remove', label: 'Remove the sound', sub: 'A silent video with no audio track at all', icon: 'volume-x' },
          { value: 'silent', label: 'Replace with silence', sub: 'Keeps an audio track, for sites that insist on one', icon: 'volume-1' },
        ],
      })
      function update() {
        const remove = mode.value === 'remove'
        shell.setInfo('Instant, no re-encoding', remove ? 'The picture is copied untouched' : 'The picture is copied and a silent AAC track is added')
        shell.setLabel(remove ? 'Remove audio' : 'Replace with silence')
      }
      update()
      return [
        step(1, 'Sound', [
          !info.hasAudio
            ? alert('info', 'This video already has no sound. You can still add a silent track if a site needs one.')
            : alert('info', `Current sound: ${info.audio.codec.toUpperCase()}${info.audio.layout ? ', ' + info.audio.layout : ''}${info.nAudio > 1 ? ` (${info.nAudio} audio tracks, all removed)` : ''}.`),
          mode,
        ]),
      ]
    },
    async execute(media, hp) {
      const { file, info } = media
      const inName = inputName(file)
      const e0 = ext(file.name) || 'mp4'
      const silent = mode.value === 'silent'
      const dur = Math.max(0.1, info.duration || 1)
      const build = (e) => () => {
        const out = `out.${e}`
        const args = silent
          ? ['-i', inName, '-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...(e === 'webm' ? ['-c:a', 'libopus', '-b:a', '48k'] : ['-c:a', 'aac', '-b:a', '64k']), '-shortest', out]
          : ['-i', inName, '-map', '0:v:0', '-c:v', 'copy', '-an', out]
        return hp.ffmpeg({ inputs: [{ name: inName, data: file }], args, output: out, label: 'Copying the picture' }).then((blob) => ({ blob, e }))
      }
      const { blob, e } = await firstThatWorks([build(e0), build('mkv')], isAbort)
      return {
        blob, name: suffixName(file.name, silent ? 'silent' : 'muted', e), inputSize: file.size,
        title: silent ? 'Sound replaced with silence' : 'Sound removed',
        summary: silent ? 'The picture was copied as it is and a silent audio track was added.' : 'The picture was copied as it is, so quality is untouched and the new file has no audio track.',
      }
    },
  })
}
