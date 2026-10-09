// Pack ai: Claude-powered tools (visitor's own Anthropic API key). Default category: ai, default mode: ai.
export const cat = 'ai'
export const mode = 'ai'
export default [
  { id: 'ai-chat', name: 'AI chat', desc: 'Chat with Claude, attach images and PDFs, and copy the answers.', icon: 'message-circle', tags: 'chat assistant claude ask', ready: true },
  { id: 'ai-image-to-text', name: 'AI image to text', desc: 'Read text from photos, tables and handwriting with Claude vision.', icon: 'scan-text', tags: 'ocr vision extract text', ready: true },
  { id: 'handwriting-to-text', name: 'Handwriting to text', module: 'ai-image-to-text', params: { handwriting: true }, also: ['student'], desc: 'Convert handwritten notes into editable text.', icon: 'pen-line', tags: 'handwritten notes ocr', ready: true },
  { id: 'pdf-summary', name: 'PDF summarizer', desc: 'Summaries, key points and action items for any PDF or document.', icon: 'file-text', tags: 'summarize pdf document tldr', ready: true },
  { id: 'document-summarizer', name: 'Document summarizer', module: 'pdf-summary', params: { docs: true }, cat: 'career', also: ['ai'], desc: 'Summarize PDFs, Word files and text documents.', icon: 'file-stack', tags: 'summarize docx report', ready: true },
  { id: 'research-paper-summarizer', name: 'Research paper summarizer', module: 'pdf-summary', params: { preset: 'research' }, cat: 'student', also: ['ai', 'career'], desc: 'Problem, method, results and limitations of a paper, explained.', icon: 'book-open-text', tags: 'research paper arxiv journal', ready: true },
  { id: 'pdf-to-notes', name: 'PDF to study notes', module: 'pdf-summary', params: { preset: 'notes' }, cat: 'student', also: ['ai'], desc: 'Turn a chapter or PDF into structured revision notes.', icon: 'notebook-text', tags: 'study notes revision', ready: true },
  { id: 'pdf-qa', name: 'Chat with PDF', desc: 'Ask questions about a PDF and get answers with page references.', icon: 'message-square-text', tags: 'pdf question answer chat', ready: true },
  { id: 'multi-pdf-qa', name: 'Chat with multiple PDFs', module: 'pdf-qa', params: { multi: true }, desc: 'Ask questions across several documents at once.', icon: 'messages-square', tags: 'multiple documents question answer', ready: true },
  { id: 'document-translator', name: 'Document translator', desc: 'Translate PDFs, Word files and text while keeping the structure.', icon: 'languages', tags: 'translate document pdf docx', ready: true },
  { id: 'image-translator', name: 'Image translator', desc: 'Translate the text in a photo, sign, menu or screenshot.', icon: 'image', tags: 'translate photo sign menu', ready: true },
  { id: 'meeting-summary', name: 'Meeting summarizer', desc: 'Summary, decisions and action items from a transcript or recording.', icon: 'users', also: ['career'], tags: 'meeting minutes action items', ready: true },
  { id: 'meeting-transcript-summary', name: 'Meeting transcript to summary', module: 'meeting-summary', params: { transcript: true }, cat: 'career', desc: 'Paste a Zoom/Meet/Teams transcript and get crisp minutes.', icon: 'file-text', tags: 'zoom teams transcript minutes', ready: true },
  { id: 'youtube-summary', name: 'YouTube video summarizer', desc: 'Summarize a YouTube video from its transcript.', icon: 'circle-play', tags: 'youtube video summary transcript', ready: true },
  { id: 'youtube-to-notes', name: 'YouTube video to notes', module: 'youtube-summary', params: { preset: 'notes' }, cat: 'student', also: ['ai'], desc: 'Turn a lecture video into study notes.', icon: 'notebook-pen', tags: 'youtube lecture notes', ready: true },
  { id: 'website-summary', name: 'Website summarizer', desc: 'Summarize any web page or article by URL.', icon: 'globe', tags: 'summarize article url webpage', ready: true },
  { id: 'resume-job-match', name: 'Resume to job matching', also: ['career'], desc: 'How well your resume fits a job, gaps to fix and tailored bullets.', icon: 'target', tags: 'resume job fit match', ready: true },
  { id: 'email-reply', name: 'Email reply writer', also: ['career'], desc: 'Paste an email and get a ready-to-send reply in your tone.', icon: 'reply', tags: 'email reply respond', ready: true },
  { id: 'text-to-image', name: 'Text to image (SVG art)', desc: 'Describe a picture and Claude draws it as editable SVG; export PNG.', icon: 'image-plus', also: ['image'], tags: 'generate image illustration svg icon', ready: true },
  { id: 'ai-image-editor', name: 'AI image editor', desc: 'Say what to change ("brighter, crop to face, add caption") and it is applied locally.', icon: 'wand-sparkles', also: ['image'], tags: 'edit photo instruction image to image', ready: true },
  { id: 'ai-document-extraction', name: 'AI document data extraction', desc: 'Invoices, receipts, IDs and forms to structured JSON or CSV.', icon: 'file-scan', also: ['data'], tags: 'invoice receipt extract fields ocr', ready: true },
  { id: 'ai-spreadsheet-analysis', name: 'AI spreadsheet analysis', desc: 'Upload CSV/Excel and ask questions; get answers, stats and charts.', icon: 'sheet', also: ['data'], tags: 'analyze excel csv insights', ready: true },
  { id: 'ai-diagram', name: 'Text to diagram', desc: 'Describe a process and get a flowchart or diagram (Mermaid).', icon: 'workflow', also: ['dev', 'career'], tags: 'diagram flowchart mermaid', ready: true },
  { id: 'ai-code-explainer', name: 'Code explainer', also: ['dev'], desc: 'Paste code and get a plain-English explanation and improvements.', icon: 'code', tags: 'explain code review', ready: true },
]
