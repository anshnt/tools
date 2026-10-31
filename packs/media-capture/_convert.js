// Subtitle routes for the File Converter hub: SRT, WebVTT, ASS/SSA, SAMI, LRC, TTML/DFXP, MicroDVD and SCC into each other (and plain text).
// Text only, so no engine is needed. Output is always UTF-8; old files in Korean, Japanese, Chinese or Western encodings are read correctly.
import { baseName } from '../../lib/files.js'

const FROM = ['srt', 'vtt', 'ass', 'ssa', 'smi', 'sami', 'lrc', 'ttml', 'dfxp', 'sub', 'scc']
const TO = ['srt', 'vtt', 'ass', 'smi', 'lrc', 'ttml', 'sub', 'scc', 'txt']
const MIME = { srt: 'application/x-subrip', vtt: 'text/vtt', ttml: 'application/ttml+xml', smi: 'application/smil+xml' }

/** Convert subtitle text. Resolves [{name, text}]: one entry, or one per language for a SAMI file that holds several. */
export async function convertSubtitles({ bytes, name, to, encoding = 'auto', fps = 0, samiLang = 'ENCC' }) {
  const { parseSubtitles, format } = await import('./_subs.js')
  const { decodeBytes, SAMI_LANGS } = await import('./_subformats.js')
  const { text } = decodeBytes(bytes, encoding)
  const parsed = parseSubtitles(text, { fps: +fps > 0 ? +fps : undefined })
  if (parsed.error) throw new Error(parsed.error)
  const langs = parsed.languages?.length > 1 ? parsed.languages : [{ id: '', cues: parsed.cues }]
  if (!langs.some((l) => l.cues.length)) throw new Error('No subtitle lines found in this file. If the text looks scrambled, set the text encoding.')
  const sam = SAMI_LANGS.find((l) => l[0] === samiLang) || SAMI_LANGS[0]
  const rate = parsed.format === 'sub' && !(+fps > 0) ? parsed.fps : +fps > 0 ? +fps : 23.976
  return langs.map((l) => ({
    name: `${baseName(name) || 'subtitles'}${l.id ? `.${l.id.toLowerCase()}` : ''}.${to}`,
    text: format(l.cues, to, { title: baseName(name) || 'Subtitles', fps: rate, sami: { className: sam[0], name: sam[1], lang: sam[2] }, ttmlLang: sam[2].split('-')[0] }),
    cues: l.cues.length,
  }))
}

export const CONVERTERS = [
  {
    from: FROM,
    to: TO,
    group: 'Subtitles',
    options: [
      { key: 'encoding', label: 'Text encoding of the file', type: 'select', default: 'auto', choices: [['auto', 'Detect automatically'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 (little endian)'], ['utf-16be', 'UTF-16 (big endian)'], ['euc-kr', 'Korean (CP949, EUC-KR)'], ['shift_jis', 'Japanese (Shift_JIS)'], ['gbk', 'Chinese, simplified (GBK)'], ['big5', 'Chinese, traditional (Big5)'], ['windows-1252', 'Western European (Windows-1252)'], ['windows-1251', 'Cyrillic (Windows-1251)']] },
      { key: 'fps', label: 'Frame rate (MicroDVD)', type: 'select', default: '0', choices: [['0', 'Automatic (from the file, else 23.976)'], ['23.976', '23.976'], ['24', '24'], ['25', '25'], ['29.97', '29.97'], ['30', '30']] },
      { key: 'samiLang', label: 'SAMI language (when saving SAMI)', type: 'select', default: 'ENCC', choices: [['ENCC', 'English'], ['KRCC', 'Korean'], ['JPCC', 'Japanese'], ['CNCC', 'Chinese'], ['ESCC', 'Spanish'], ['FRCC', 'French'], ['DECC', 'German'], ['ITCC', 'Italian'], ['PTCC', 'Portuguese'], ['RUCC', 'Russian'], ['HICC', 'Hindi']] },
    ],
    run: async (file, to, opts = {}, { onProgress } = {}) => {
      onProgress?.(0.1)
      const outs = await convertSubtitles({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, to, encoding: opts.encoding || 'auto', fps: opts.fps || 0, samiLang: opts.samiLang || 'ENCC' })
      onProgress?.(1)
      const files = outs.map((o) => new File([o.text], o.name, { type: MIME[to] || 'text/plain' }))
      return files.length === 1 ? files[0] : files
    },
  },
]

export const SNIFF = [
  { ext: 'scc', test: (b) => b[0] === 0x53 && b[1] === 0x63 && b[2] === 0x65 && b[3] === 0x6e }, // "Scen" of Scenarist_SCC
]
