// Pack media-capture: recorders, transcription and subtitles. Default category: media.
export const cat = 'media'
export default [
  { id: 'screen-recorder', name: 'Screen recorder', desc: 'Record your screen, a window or a tab, with mic and system audio.', icon: 'monitor-play', also: ['screen'], tags: 'record screen capture video' },
  { id: 'webcam-recorder', name: 'Webcam recorder', desc: 'Record video from your camera and download it.', icon: 'webcam', tags: 'camera record video selfie' },
  { id: 'voice-recorder', name: 'Voice recorder', desc: 'Record audio from your microphone with a live waveform.', icon: 'mic', tags: 'record audio voice memo' },
  { id: 'video-to-text', name: 'Video / audio to transcript', desc: 'Transcribe videos and recordings to text on your device.', icon: 'file-text', mode: 'model', also: ['ai', 'student'], tags: 'transcript transcribe whisper' },
  { id: 'subtitle-generator', name: 'Subtitle generator', desc: 'Auto-generate SRT or VTT subtitles from any video or audio.', icon: 'captions', mode: 'model', tags: 'srt vtt captions auto' },
  { id: 'subtitle-to-text', name: 'Subtitle to text', desc: 'Strip timestamps from SRT/VTT files to get clean text.', icon: 'text', tags: 'srt vtt transcript clean' },
  { id: 'subtitle-converter', name: 'Subtitle converter & shifter', desc: 'Convert SRT and VTT, and shift timings to fix sync.', icon: 'timer', tags: 'srt vtt sync offset delay' },
]
