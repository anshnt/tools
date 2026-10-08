// OCR via tesseract.js (on-device). Language data downloads on first use and is cached by the browser.
import { tesseract } from './libs.js'

export const OCR_LANGS = [
  ['eng', 'English'], ['hin', 'Hindi'], ['mar', 'Marathi'], ['guj', 'Gujarati'], ['ben', 'Bengali'], ['tam', 'Tamil'], ['tel', 'Telugu'],
  ['kan', 'Kannada'], ['mal', 'Malayalam'], ['pan', 'Punjabi'], ['urd', 'Urdu'], ['san', 'Sanskrit'], ['fra', 'French'], ['deu', 'German'],
  ['spa', 'Spanish'], ['por', 'Portuguese'], ['ita', 'Italian'], ['nld', 'Dutch'], ['rus', 'Russian'], ['ara', 'Arabic'], ['chi_sim', 'Chinese (Simplified)'],
  ['chi_tra', 'Chinese (Traditional)'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['tur', 'Turkish'], ['vie', 'Vietnamese'], ['ind', 'Indonesian'],
]

const workers = new Map()
let progressCb = null

async function worker(lang) {
  if (!workers.has(lang)) {
    const T = await tesseract()
    workers.set(lang, T.createWorker(lang, 1, {
      logger: (m) => progressCb?.(m.progress, m.status === 'recognizing text' ? 'Reading text' : 'Loading OCR engine'),
    }).catch((e) => { workers.delete(lang); throw e }))
  }
  return workers.get(lang)
}

/**
 * recognize(image, {lang: 'eng' | 'eng+hin', onProgress(fraction, label)})
 * image: File | Blob | HTMLCanvasElement | HTMLImageElement | URL string
 * -> {text, confidence, data}  (data = tesseract's full result incl. words/lines with bboxes)
 */
export async function recognize(image, { lang = 'eng', onProgress } = {}) {
  const w = await worker(lang)
  progressCb = onProgress
  try {
    const { data } = await w.recognize(image, {}, { blocks: true })
    return { text: data.text.trim(), confidence: data.confidence, data }
  } finally {
    progressCb = null
  }
}

export async function terminateOcr() {
  for (const p of workers.values()) (await p.catch(() => null))?.terminate()
  workers.clear()
}
