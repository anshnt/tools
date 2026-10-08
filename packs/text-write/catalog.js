// Pack text-write: document conversion, speech and language tools. Default category: text.
export const cat = 'text'
export default [
  { id: 'word-to-txt', name: 'Word to TXT', desc: 'Extract plain text from a .docx document.', icon: 'file-text', tags: 'docx text extract', ready: true },
  { id: 'txt-to-word', name: 'TXT to Word', desc: 'Turn plain text into a formatted .docx file.', icon: 'file-plus-2', tags: 'docx create', ready: true },
  { id: 'word-to-markdown', name: 'Word to Markdown', desc: 'Convert .docx to clean Markdown with headings, lists and tables.', icon: 'file-code-2', tags: 'docx md', ready: true },
  { id: 'markdown-to-word', name: 'Markdown to Word', desc: 'Convert Markdown into a styled .docx document.', icon: 'file-type-2', tags: 'md docx', ready: true },
  { id: 'text-to-speech', name: 'Text to speech', desc: 'Read text aloud with your device voices, adjust speed and pitch.', icon: 'volume-2', tags: 'tts read aloud voice', ready: true },
  { id: 'text-to-voice', name: 'Text to voice (natural, download)', module: 'text-to-speech', params: { hq: true }, cat: 'ai', also: ['text'], mode: 'model', desc: 'Natural-sounding speech from an on-device voice model; download as WAV.', icon: 'audio-lines', tags: 'tts natural voice wav download kokoro', ready: true },
  { id: 'speech-to-text', name: 'Speech to text', desc: 'Dictate live, or transcribe an audio file on your device.', icon: 'mic', mode: 'model', tags: 'dictation transcribe voice typing stt', ready: true },
  { id: 'voice-to-text', name: 'Voice to text', module: 'speech-to-text', params: { file: true }, cat: 'ai', mode: 'model', desc: 'Turn voice notes and recordings into text with on-device Whisper.', icon: 'mic-vocal', tags: 'voice note whatsapp audio transcribe', ready: true },
  { id: 'grammar-checker', name: 'Grammar checker', desc: 'Find grammar, style and punctuation issues with one-click fixes.', icon: 'spell-check-2', mode: 'online', tags: 'grammar proofread languagetool' },
  { id: 'spell-checker', name: 'Spell checker', module: 'grammar-checker', params: { spelling: true }, desc: 'Catch spelling mistakes in English and other languages.', icon: 'spell-check', mode: 'online', tags: 'spelling typos' },
  { id: 'paraphraser', name: 'Paraphraser', desc: 'Rewrite text in a different tone: simpler, formal, shorter or friendlier.', icon: 'repeat-2', mode: 'ai', tags: 'rewrite rephrase reword' },
  { id: 'text-summarizer', name: 'Text summarizer', desc: 'Summarize long text into key points, on-device or with AI.', icon: 'list-collapse', tags: 'summary tldr key points' },
  { id: 'text-translator', name: 'Text translator', desc: 'Translate text between 100+ languages.', icon: 'languages', mode: 'online', tags: 'translate language hindi english' },
  { id: 'readability-checker', name: 'Readability checker', desc: 'Flesch reading ease, grade level, long sentences and passive voice.', icon: 'gauge', tags: 'flesch grade level reading' },
  { id: 'plagiarism-checker', name: 'Plagiarism checker', desc: 'Find overlap between texts and run exact-phrase web searches for suspect sentences.', icon: 'shield-check', tags: 'similarity duplicate copied' },
  { id: 'text-editor', name: 'Online notepad', desc: 'A distraction-free notepad that autosaves on this device.', icon: 'notebook-pen', tags: 'notes notepad write autosave' },
]
