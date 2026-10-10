// Pack studio-audio: Audio Studio, a browser multitrack audio editor. Default category: studio.
// The extra entries open the same editor with a starting template; each one keeps its own autosaved project.
export const cat = 'studio'
export default [
  { id: 'audio-studio', name: 'Audio Studio', desc: 'Multitrack audio editor: record, cut, fade, mix, add effects and export WAV or MP3.', icon: 'audio-waveform', layout: 'app', tags: 'pro tools audition alternative daw multitrack podcast waveform mixer recorder', ready: true },
  { id: 'podcast-editor', module: 'audio-studio', params: { template: 'podcast' }, name: 'Podcast Editor', desc: 'Edit a podcast on host, guest and music tracks with voice cleanup, then export WAV or MP3.', icon: 'mic', layout: 'app', tags: 'podcast editor audacity alternative episode interview voice cleanup noise gate', ready: true },
  { id: 'voice-over-recorder', module: 'audio-studio', params: { template: 'voiceover' }, name: 'Voice-over Recorder', desc: 'Record a voice-over with your microphone, tidy it with gate, EQ and compression, and export it.', icon: 'mic-vocal', layout: 'app', tags: 'voice over voiceover narration record microphone dictation clean up', ready: true },
  { id: 'music-mixer', module: 'audio-studio', params: { template: 'music' }, name: 'Multitrack Music Mixer', desc: 'Layer drums, bass, keys and vocals on a beat grid, mix them with effects and export a stereo file.', icon: 'sliders-horizontal', layout: 'app', tags: 'music mixer daw beat grid metronome stems mixdown reverb', ready: true },
]
