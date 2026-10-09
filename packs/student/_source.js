// A notes input shared by the quiz, MCQ and flashcard tools: textarea + file loading (txt, md, pdf, docx) + sample text + word count.
import { h, button, busy, toast } from '../../lib/ui.js'
import { openPdf, extractText } from '../../lib/pdf.js'
import { mammoth } from '../../lib/libs.js'
import { acceptTextFiles } from './_kit.js'

export const SAMPLES = {
  history: `The French Revolution

The French Revolution began in 1789 and transformed France from a monarchy into a republic. The Estates-General was an assembly representing the three estates of French society: the clergy, the nobility and the commoners. The storming of the Bastille on 14 July 1789 became the symbol of the uprising. The Declaration of the Rights of Man and of the Citizen (DRMC) was adopted in August 1789.

King Louis XVI was executed by guillotine in January 1793. The Reign of Terror lasted from 1793 to 1794 and led to about 17,000 official executions. Maximilien Robespierre was the leader of the Jacobins, a radical political club. Napoleon Bonaparte seized power in 1799 and later became Emperor in 1804.

Inflation refers to a general rise in prices over time. The assignat was a paper currency issued by the revolutionary government. Because the assignats lost value quickly, the cost of bread rose sharply, which angered the urban poor. The Jacobins believed that the republic needed strict control to survive.

The Third Estate consisted of about 98 percent of the population. The National Assembly was formed in June 1789 when the Third Estate declared itself the true representative of France. The Tennis Court Oath was a pledge not to separate until a constitution was written.`,
  biology: `Cell Biology

The cell is the basic structural and functional unit of all living organisms. Mitochondria are organelles that release energy from glucose through cellular respiration. The nucleus contains the genetic material (DNA) and controls the activities of the cell. Ribosomes are the sites where proteins are made.

Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose. Chlorophyll is the green pigment that absorbs sunlight in the chloroplasts. The overall reaction needs carbon dioxide and water and releases oxygen. Plants take in carbon dioxide through tiny pores called stomata.

Osmosis is the movement of water across a semi-permeable membrane from a region of low solute concentration to high solute concentration. Diffusion is the net movement of particles from high concentration to low concentration. An enzyme is a protein that speeds up a chemical reaction without being used up. Most human enzymes work best at about 37 degrees Celsius.

DNA stands for deoxyribonucleic acid. The structure of DNA was described by Watson and Crick in 1953. Humans have 46 chromosomes arranged in 23 pairs. Mitosis is the type of cell division that produces two identical daughter cells.`,
}

/** Text from a file: txt/md/csv as-is, PDF via pdf.js, DOCX via mammoth. */
export async function readTextFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pages = await extractText(await openPdf(file))
    const text = pages.map((p) => p.text).join('\n\n').trim()
    if (!text) throw new Error('This PDF has no selectable text (it is probably a scan). Use Question paper to text to read scanned pages first.')
    return text
  }
  if (name.endsWith('.docx')) return (await (await mammoth()).extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
  if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save the file as .docx or paste the text.')
  return file.text()
}

/** sourceInput({placeholder, sample: 'history'|'biology'}) -> {el, get(), set(text), onInput(fn), focus()} */
export function sourceInput({ placeholder = 'Paste your notes or a textbook section here.', sample = 'biology', rows = 12, min = 80 } = {}) {
  const ta = h('textarea', { class: 'textarea', rows, placeholder, 'aria-label': 'Your notes', spellcheck: false })
  const count = h('span', { class: 'stu-hint' })
  const listeners = []
  const upd = () => {
    const n = (ta.value.match(/\S+/g) || []).length
    count.textContent = n ? `${n.toLocaleString()} words${ta.value.trim().length < min ? ' - add a bit more text for good questions' : ''}` : ''
    for (const f of listeners) f(ta.value)
  }
  ta.addEventListener('input', upd)
  acceptTextFiles(ta, async (_, f) => {
    try { ta.value = await readTextFile(f); upd() } catch (e) { toast(e.message, 'error') }
  })
  const fileBtn = button('Load file', { icon: 'file-up', size: 'sm', variant: 'secondary', title: 'Text, Markdown, PDF or Word (.docx)' })
  fileBtn.addEventListener('click', () => {
    const inp = h('input', { type: 'file', accept: '.txt,.md,.csv,.pdf,.docx,text/*,application/pdf' })
    inp.onchange = () => inp.files[0] && busy(fileBtn, async () => { ta.value = await readTextFile(inp.files[0]); upd() }, 'Reading')
    inp.click()
  })
  const sampleBtn = button('Try a sample', { icon: 'wand-sparkles', size: 'sm', variant: 'ghost', onClick: () => { ta.value = SAMPLES[sample]; upd() } })
  const clearBtn = button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { ta.value = ''; upd(); ta.focus() } })
  const el = h('div', { class: 'stack' }, ta, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'row' }, fileBtn, sampleBtn, clearBtn), count))
  return { el, get: () => ta.value, set: (t) => { ta.value = t; upd() }, onInput: (f) => listeners.push(f), focus: () => ta.focus(), ta }
}
