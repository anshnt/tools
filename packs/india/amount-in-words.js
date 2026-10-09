// Amount in words for cheques: Indian numbering (lakh, crore), rupees and paise, English and Hindi.
import { h, card, panel, stack, input, field, select, toggle, button, alert, clear, copyButton, debounce } from '../../lib/ui.js'
import { parseAmount, amountInWords, formatIndian, MAX_DIGITS } from './_words.js'
import { useStyles, style, note } from './_shared.js'

const CSS = `
.in-amt { font-size: 22px; font-weight: 650; letter-spacing: -.02em; min-height: 54px; font-variant-numeric: tabular-nums; }
.in-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.in-chip { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); border-radius: 99px; padding: 6px 12px; font-size: 13px; cursor: pointer; min-height: 32px; transition: border-color .2s, background .2s; }
.in-chip:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.in-cheque { position: relative; border-radius: 16px; padding: 18px 18px 16px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--surface)), var(--surface) 55%, color-mix(in srgb, var(--accent-2) 7%, var(--surface))); box-shadow: var(--shadow-sm); display: grid; gap: 12px; }
.in-cheque .line { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: baseline; font-size: 13px; color: var(--muted); }
.in-cheque .words { font-size: clamp(16px, 3.6vw, 20px); font-weight: 600; color: var(--text); line-height: 1.45; border-bottom: 1px dashed var(--border-strong); padding-bottom: 6px; overflow-wrap: anywhere; min-height: 1.6em; }
.in-cheque .box { justify-self: end; border: 1.5px solid var(--text-2); border-radius: 6px; padding: 6px 14px; font-weight: 700; font-size: clamp(16px, 4vw, 20px); font-variant-numeric: tabular-nums; max-width: 100%; overflow-wrap: anywhere; text-align: right; }
.in-cheque .stamp { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.in-words { font-size: 17px; line-height: 1.55; font-weight: 550; overflow-wrap: anywhere; padding: 14px 16px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); min-height: 52px; }
.in-words.hi { font-size: 19px; }
`

const EXAMPLES = ['1,000', '12,500', '1,50,000', '25,00,000', '1,00,00,000']

export function mount(root) {
  useStyles()
  style('in-amount', CSS)
  const amt = input({ class: 'in-amt', inputmode: 'decimal', placeholder: 'e.g. 1,23,456.78', autocomplete: 'off', 'aria-label': 'Amount in rupees', spellcheck: false })
  const grouped = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const msg = h('div')
  const style_ = select([['title', 'Title Case'], ['upper', 'UPPER CASE'], ['lower', 'Sentence case']], 'title', () => render())
  const paise = select([['words', 'Paise in words'], ['fraction', 'Paise as 78/100']], 'words', () => render())
  const hyphen = toggle('Hyphenate 21 to 99 (Twenty-One)', true, () => render())
  const and = toggle('Use "and" (One Hundred and Five)', false, () => render())
  const hindi = toggle('Also show Hindi', false, () => render())
  const enOut = h('div', { class: 'in-words', 'aria-live': 'polite' })
  const hiOut = h('div', { class: 'in-words hi', lang: 'hi', hidden: true })
  const cheqWords = h('div', { class: 'words' }), cheqBox = h('div', { class: 'box' }, '₹ 0.00/-')
  const cheque = h('div', { class: 'in-cheque', 'aria-hidden': 'true' },
    h('div', { class: 'stamp' }, 'Cheque preview'),
    h('div', { class: 'line' }, h('span', 'Rupees'), cheqWords), cheqBox)
  let enText = '', hiText = '', digits = ''
  const hiRow = h('div', { class: 'stack', hidden: true }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('strong', 'Hindi'), copyButton(() => hiText, 'Copy Hindi')), hiOut)

  function render() {
    const p = parseAmount(amt.value)
    hiRow.hidden = !hindi.input.checked
    if (p.error) {
      enText = hiText = digits = ''
      grouped.textContent = ''
      enOut.textContent = 'Type an amount above to see it in words.'
      hiOut.textContent = ''
      cheqWords.textContent = ''
      cheqBox.textContent = '₹ 0.00/-'
      clear(msg, p.error === 'empty' ? null : alert('warn', p.error))
      return
    }
    const o = { case: style_.value, paise: paise.value, hyphen: hyphen.input.checked, and: and.input.checked }
    enText = amountInWords(p.rupees, p.paise, o)
    hiText = amountInWords(p.rupees, p.paise, { lang: 'hi' })
    digits = `${formatIndian(p.rupees, p.paise, true)}`
    grouped.textContent = `₹${formatIndian(p.rupees, p.paise)}`
    enOut.textContent = enText
    hiOut.textContent = hiText
    cheqWords.textContent = enText.replace(/^Rupees\s*/i, '')
    cheqBox.textContent = `₹ ${digits}/-`
    clear(msg, p.rounded ? alert('info', 'Rounded to two decimal places (paise).') : null)
  }
  amt.addEventListener('input', debounce(render, 40))

  root.append(stack(
    card('Amount', h('div', { class: 'stack' },
      field('Amount in digits', amt, 'You can paste with commas, the ₹ sign or Rs.'),
      grouped,
      h('div', { class: 'in-chips', role: 'group', 'aria-label': 'Examples' }, EXAMPLES.map((c) => h('button', { type: 'button', class: 'in-chip', onclick: () => { amt.value = c; render(); amt.focus() } }, `₹${c}`))),
      msg)),
    card('In words', h('div', { class: 'stack' },
      enOut,
      h('div', { class: 'row' }, copyButton(() => enText, 'Copy words'), copyButton(() => (digits ? `₹${digits}/-` : ''), 'Copy ₹ amount'), button('Clear', { icon: 'eraser', size: 'sm', onClick: () => { amt.value = ''; render(); amt.focus() } })),
      hiRow, cheque)),
    panel(h('div', { class: 'stack' }, h('h2', { style: 'margin:0' }, 'Options'),
      h('div', { class: 'grid-2' }, field('Letter case', style_), field('Paise', paise)),
      h('div', { class: 'stack', style: 'gap:8px' }, hyphen, and, hindi),
      note('Uses the Indian system: thousand, lakh, crore, arab, kharab, neel, up to ' + MAX_DIGITS + ' digits. Write the amount in words on a cheque exactly as printed here, ending with "Only" so nothing can be added. Banks go by the words if words and figures differ.'))),
  ))
  render()
}
