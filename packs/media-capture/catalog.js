// Pack media-capture: recorders, transcription and subtitles. Default category: media.
export const cat = 'media'
export default [
  { id: 'screen-recorder', name: 'Screen recorder', desc: 'Record your screen, a window or a tab, with mic and system audio.', icon: 'monitor-play', also: ['screen'], tags: 'record screen capture video', ready: true },
  { id: 'webcam-recorder', name: 'Webcam recorder', desc: 'Record video from your camera: pick the device, mirror it, snap photos and download.', icon: 'webcam', tags: 'camera record video selfie', ready: true },
  { id: 'webcam-photo', name: 'Webcam photo booth', module: 'webcam-recorder', params: { mode: 'photo' }, desc: 'Take photos with your camera: self-timer, mirror, looks, JPG, PNG or WebP.', icon: 'camera', also: ['image'], tags: 'selfie photo picture camera snapshot passport', ready: true },
  { id: 'voice-recorder', name: 'Voice recorder', desc: 'Record your voice with a live waveform, trim it, then save as WAV, WebM or OGG.', icon: 'mic', tags: 'record audio voice memo', ready: true },
  { id: 'video-to-text', name: 'Video / audio to transcript', desc: 'Transcribe videos and recordings to text on your device.', icon: 'file-text', mode: 'model', also: ['ai', 'student'], tags: 'transcript transcribe whisper', ready: true },
  { id: 'subtitle-generator', name: 'Subtitle generator', module: 'video-to-text', params: { mode: 'subtitles' }, desc: 'Auto-generate SRT or VTT subtitles from any video or audio.', icon: 'captions', mode: 'model', tags: 'srt vtt captions auto', ready: true },
  { id: 'subtitle-to-text', name: 'Subtitle to text', desc: 'Strip timestamps and tags from SRT, VTT and ASS files to get clean text.', icon: 'text', tags: 'srt vtt transcript clean', ready: true },
  { id: 'subtitle-converter', name: 'Subtitle converter & shifter', desc: 'Convert SRT, VTT and ASS, shift timings and fix frame-rate or sync problems.', icon: 'timer', tags: 'srt vtt sync offset delay', ready: true },
  { id: 'subtitle-editor', name: 'Subtitle editor', desc: 'Edit SRT, VTT and ASS subtitles line by line, with an optional video to check the timing.', icon: 'subtitles', tags: 'srt vtt ass edit captions timing sync fix', ready: true },
  { id: 'srt-to-vtt', name: 'SRT to VTT converter', module: 'subtitle-converter', params: { to: 'vtt', accept: '.srt,.txt,application/x-subrip,text/plain' }, desc: 'Turn SRT subtitles into WebVTT for HTML5 video and the web.', icon: 'arrow-right-left', tags: 'srt vtt webvtt convert html5 captions track', ready: true },
  { id: 'vtt-to-srt', name: 'VTT to SRT converter', module: 'subtitle-converter', params: { to: 'srt', accept: '.vtt,.txt,text/vtt,text/plain' }, desc: 'Turn WebVTT captions into SRT for video players and editors.', icon: 'arrow-right-left', tags: 'vtt srt webvtt convert captions youtube', ready: true },
  { id: 'subtitle-sync', name: 'Subtitle sync fixer', module: 'subtitle-converter', params: { tab: 'shift' }, desc: 'Fix subtitles that are late or early: shift, fix frame rate or sync from two points.', icon: 'alarm-clock', tags: 'srt vtt sync delay offset late early 23.976 25 fps', ready: true },
]
