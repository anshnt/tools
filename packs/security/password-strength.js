// Password strength checker (zxcvbn-ts) and, with params.focus === 'entropy', the entropy calculator for a password or a policy.
import { h, svg, icon, field, panel, stats, tabs, segmented, number, alert, debounce } from '../../lib/ui.js'
import { useStyles, secretInput, chip, meter, countUp, humanTime, CRACK_RATES, ratingOf, formatBits, load, save } from './_shared.js'

const ZX = {
  core: 'https://cdn.jsdelivr.net/npm/@zxcvbn-ts/core@4.2.0/+esm',
  common: 'https://cdn.jsdelivr.net/npm/@zxcvbn-ts/language-common@4.1.3/+esm',
  en: 'https://cdn.jsdelivr.net/npm/@zxcvbn-ts/language-en@4.1.1/+esm',
}
let zxPromise
/** Lazy-load zxcvbn-ts with the English dictionaries (about 1.5 MB once, cached by the browser). */
export function loadZxcvbn() {
  zxPromise ??= Promise.all([import(ZX.core), import(ZX.common), import(ZX.en)]).then(([core, common, en]) => new core.ZxcvbnFactory({
    translations: en.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary },
  })).catch((e) => {
    zxPromise = null
    throw Object.assign(new Error('Could not load the strength engine. Check your connection and try again.'), { cause: e })
  })
  return zxPromise
}

// ---------- Charset (naive) entropy ----------
export const CLASSES = [
  { id: 'lower', label: 'Lowercase', re: /[a-z]/, size: 26, sample: 'a-z' },
  { id: 'upper', label: 'Uppercase', re: /[A-Z]/, size: 26, sample: 'A-Z' },
  { id: 'digits', label: 'Digits', re: /\d/, size: 10, sample: '0-9' },
  { id: 'symbols', label: 'Symbols', re: /[ -/:-@[-`{-~]/, size: 33, sample: '!@#' },
  { id: 'other', label: 'Other / Unicode', re: /[^\x00-\x7f]/, size: 100, sample: 'e a' },
]
/** Pool size and bits if every character were drawn at random from the classes that appear in the text. */
export function charsetEntropy(pw) {
  const len = [...pw].length
  const used = CLASSES.filter((c) => c.re.test(pw))
  const pool = used.reduce((a, c) => a + c.size, 0)
  return { length: len, used, pool, bits: pool > 1 ? len * Math.log2(pool) : 0 }
}
const sci = (bits) => {
  const x = bits * Math.log10(2)
  const e = Math.floor(x)
  return { m: 10 ** (x - e), e }
}
export function combos(bits) {
  if (!(bits > 0)) return '0'
  if (bits < 40) return Math.round(2 ** bits).toLocaleString()
  const { m, e } = sci(bits)
  return `${m.toFixed(1)} x 10^${e}`
}

const crackedIn = (sec) => {
  const t = humanTime(sec)
  return t === 'instantly' ? [h('b', 'Cracked instantly')] : ['Cracked in about ', h('b', t)]
}
const PATTERN_TAGS = {
  'passwords-common': 'Common password',
  'commonWords-en': 'Common word', 'wikipedia-en': 'Common word', 'diceware-common': 'Common word',
  'firstnames-en': 'First name', 'lastnames-en': 'Surname',
}
function tagFor(m) {
  switch (m.pattern) {
    case 'dictionary': {
      let t = PATTERN_TAGS[m.dictionaryName] || 'Dictionary word'
      if (m.dictionaryName === 'passwords-common' && m.rank) t += ` (#${m.rank.toLocaleString()})`
      if (m.reversed) t += ', reversed'
      if (m.l33t) t += ', l33t'
      return t
    }
    case 'spatial': return 'Keyboard pattern'
    case 'repeat': return `Repeats "${m.baseToken}"`
    case 'sequence': return 'Sequence'
    case 'regex': return m.regexName === 'recentYear' ? 'Recent year' : 'Pattern'
    case 'date': return 'Date'
    case 'separator': return 'Separator'
    default: return 'Random characters'
  }
}
const kindOf = (m) => (m.pattern === 'bruteforce' ? 'good' : m.pattern === 'separator' ? 'mid' : m.pattern === 'dictionary' && m.dictionaryName !== 'passwords-common' && (m.guessesLog10 ?? 0) > 5 ? 'mid' : 'weak')

/** Checks derived from the zxcvbn match sequence. */
export function checklist(pw, r) {
  const seq = r.sequence || []
  const has = (p, fn = () => true) => seq.some((m) => m.pattern === p && fn(m))
  return [
    { ok: [...pw].length >= 12, text: '12 or more characters' },
    { ok: CLASSES.slice(0, 4).filter((c) => c.re.test(pw)).length >= 3, text: 'Mixes at least 3 character types' },
    { ok: !has('dictionary', (m) => m.dictionaryName === 'passwords-common'), text: 'Not a known common password' },
    { ok: !has('dictionary', (m) => m.dictionaryName !== 'passwords-common' && m.token.length > 3), text: 'No dictionary words or names' },
    { ok: !has('spatial') && !has('sequence'), text: 'No keyboard walks or sequences like abc or 123' },
    { ok: !has('repeat') && !has('date') && !has('regex'), text: 'No repeats, dates or recent years' },
  ]
}

const CSS = `
.sx-ps-hero{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center}
.sx-ring{position:relative;width:132px;height:132px;flex:none}
.sx-ring svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.sx-ring .bg{fill:none;stroke:var(--surface-3);stroke-width:9}
.sx-ring .fg{fill:none;stroke:var(--mc,var(--accent));stroke-width:9;stroke-linecap:round;stroke-dasharray:276.46;stroke-dashoffset:276.46;transition:stroke-dashoffset .8s var(--ease),stroke .4s;filter:drop-shadow(0 0 7px color-mix(in srgb,var(--mc,var(--accent)) 55%,transparent))}
.sx-ring-c{position:absolute;inset:0;display:grid;place-items:center;text-align:center;line-height:1}
.sx-ring-c b{font-size:38px;font-weight:700;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.sx-ring-c small{display:block;font-size:11px;color:var(--muted);margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
.sx-ps-hero[data-level="0"]{--mc:#ef4444}.sx-ps-hero[data-level="1"]{--mc:#f97316}.sx-ps-hero[data-level="2"]{--mc:#eab308}.sx-ps-hero[data-level="3"]{--mc:#22c55e}.sx-ps-hero[data-level="4"]{--mc:#10b981}
.sx-ps-title{font-size:clamp(22px,3.4vw,32px);font-weight:700;letter-spacing:-.035em;color:var(--mc)}
.sx-ps-sub{color:var(--text-2);margin-top:4px}.sx-ps-sub b{color:var(--text)}
.sx-times{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px}
.sx-time{padding:13px 15px;border-radius:16px;border:1px solid var(--border);background:var(--surface);animation:sx-in .4s var(--ease) both;animation-delay:calc(var(--i)*60ms)}
.sx-time .l{font-size:12px;color:var(--muted)}.sx-time .v{font-size:18px;font-weight:650;letter-spacing:-.02em;margin-top:2px;overflow-wrap:anywhere}.sx-time .n{font-size:11.5px;color:var(--muted);margin-top:3px}
.sx-time.hot{border-color:color-mix(in srgb,var(--mc) 40%,var(--border));background:linear-gradient(150deg,color-mix(in srgb,var(--mc) 9%,var(--surface)),var(--surface))}
.sx-toks{display:flex;flex-wrap:wrap;gap:8px 6px}
.sx-tok{display:flex;flex-direction:column;gap:4px;padding:8px 12px 7px;border-radius:12px;background:var(--surface-2);border-bottom:3px solid var(--tc);animation:sx-in .4s var(--ease) both;animation-delay:calc(var(--i)*55ms);min-width:0;max-width:100%}
.sx-tok code{font-family:var(--mono);font-size:15px;overflow-wrap:anywhere;font-weight:560}
.sx-tok small{font-size:11px;color:var(--muted)}
.sx-tok[data-k="weak"]{--tc:#ef4444}.sx-tok[data-k="mid"]{--tc:#eab308}.sx-tok[data-k="good"]{--tc:#10b981}
.sx-checks{list-style:none;margin:0;padding:0;display:grid;gap:7px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.sx-checks li{display:flex;gap:9px;align-items:center;font-size:14px;padding:8px 12px;border-radius:12px;background:var(--surface-2);transition:background .3s}
.sx-checks li .icon{width:18px;height:18px;flex:none}
.sx-checks li.ok{background:var(--success-soft)}.sx-checks li.ok .icon{color:var(--success)}.sx-checks li.no .icon{color:var(--danger)}
.sx-tips{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}.sx-tips li{display:flex;gap:9px;align-items:flex-start;font-size:14px;color:var(--text-2)}.sx-tips .icon{width:16px;height:16px;margin-top:3px;color:var(--warning);flex:none}
.sx-bar{display:grid;grid-template-columns:130px 1fr auto;gap:12px;align-items:center;font-size:13.5px}
.sx-bar .track{height:12px;border-radius:99px;background:var(--surface-3);overflow:hidden}
.sx-bar .fill{display:block;height:100%;width:0;border-radius:inherit;background:var(--brand);transition:width .7s var(--ease)}
.sx-bar .fill.alt{background:linear-gradient(90deg,#0ea5e9,#10b981)}
.sx-bar b{font-variant-numeric:tabular-nums;min-width:72px;text-align:right}
.sx-formula{font-family:var(--mono);font-size:13.5px;padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px dashed var(--border-strong);overflow-wrap:anywhere}
.sx-samples{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
@media (max-width:560px){.sx-ps-hero{grid-template-columns:1fr;justify-items:center;text-align:center}.sx-bar{grid-template-columns:1fr auto}.sx-bar .track{grid-column:1/-1;order:3}}
`

const SAMPLES = ['password123', 'Tr0ub4dor&3', 'correct horse battery staple', 'qwertyuiop', 'N7#kP2$wQ9!vLm4x']

export function mount(root, { params, signal }) {
  useStyles('sx-strength', CSS)
  const entropyMode = params.focus === 'entropy'
  const tabRoot = h('div')
  let engine = null
  const enginePromise = loadZxcvbn().then((z) => (engine = z)).catch((e) => ({ error: e }))
  signal?.addEventListener('abort', () => { engine = null })

  async function analyse(pw) {
    const e = await enginePromise
    if (e?.error) throw e.error
    return e.check(pw.slice(0, 256))
  }

  // ---------- shared: password box ----------
  function passwordBox(onChange, placeholder) {
    const box = secretInput({ placeholder, ariaLabel: 'Password to check', onInput: (v) => onChange(v) })
    box.input.maxLength = 256
    const samples = h('div', { class: 'sx-samples' }, h('span', { class: 'sx-hint' }, 'Try:'), SAMPLES.map((p) => h('button', {
      type: 'button', class: 'sx-preset', onclick: () => { box.input.value = p; box.input.type = 'text'; onChange(p) },
    }, p.length > 18 ? p.slice(0, 16) + '...' : p)))
    return { box, samples }
  }

  // ---------- Strength checker ----------
  function strengthView() {
    const out = h('div', { class: 'stack' })
    const empty = alert('info', 'Type a password above to see how long it would hold up. It is analysed on this device and never sent anywhere.')
    out.append(empty)
    let seq = 0
    const run = debounce(async (pw) => {
      const mine = ++seq
      if (!pw) return out.replaceChildren(empty)
      let r
      try { r = await analyse(pw) } catch (e) { return out.replaceChildren(alert('error', e.message)) }
      if (mine !== seq) return
      render(pw, r)
    }, 90)

    function render(pw, r) {
      const rating = [{ level: 0, label: 'Very weak' }, { level: 1, label: 'Weak' }, { level: 2, label: 'Fair' }, { level: 3, label: 'Strong' }, { level: 4, label: 'Very strong' }][r.score]
      const g = r.guesses
      const fast = CRACK_RATES[3]
      const ring = h('circle', { class: 'fg', cx: 50, cy: 50, r: 44.0 })
      const num = h('b', '0')
      const hero = h('div', { class: 'sx-ps-hero', 'data-level': rating.level },
        h('div', { class: 'sx-ring', role: 'img', 'aria-label': `Score ${r.score} out of 4` },
          svg('svg', { viewBox: '0 0 100 100' }, svg('circle', { class: 'bg', cx: 50, cy: 50, r: 44 }), ring),
          h('div', { class: 'sx-ring-c' }, h('div', num, h('small', 'of 4')))),
        h('div', h('div', { class: 'sx-ps-title' }, rating.label),
          h('div', { class: 'sx-ps-sub' }, crackedIn(g / fast.rate), ' by a GPU rig attacking a fast hash. It takes about ', h('b', `10^${Math.max(0, r.guessesLog10).toFixed(1)}`), ' guesses.')))
      requestAnimationFrame(() => { ring.style.strokeDashoffset = String(276.46 * (1 - Math.max(0.06, (r.score + 0.0) / 4))) })
      countUp(num, r.score, (n) => String(Math.round(n)), 500)

      const times = h('div', { class: 'sx-times', style: `--mc:var(--mc)` }, CRACK_RATES.map((c, i) => h('div', { class: ['sx-time', i === 3 && 'hot'], style: { '--i': i } },
        h('div', { class: 'l' }, c.label), h('div', { class: 'v' }, humanTime(g / c.rate)), h('div', { class: 'n' }, c.note))))
      times.dataset.level = rating.level
      times.style.setProperty('--mc', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'][rating.level])

      const toks = h('div', { class: 'sx-toks' }, (r.sequence || []).map((m, i) => h('div', { class: 'sx-tok', 'data-k': kindOf(m), style: { '--i': i } }, h('code', m.token), h('small', tagFor(m)))))
      const cl = checklist(pw, r)
      const tips = [r.feedback?.warning, ...(r.feedback?.suggestions || [])].filter(Boolean)
      out.replaceChildren(
        panel(hero),
        h('div', { class: 'sx-k' }, icon('timer'), 'Time to crack'), times,
        panel(h('div', { class: 'stack' },
          h('div', { class: 'sx-k' }, icon('puzzle'), 'What the engine saw'), toks,
          h('div', { class: 'sx-hint' }, 'Underline colours: red is a guessable pattern, yellow is partly guessable, green is random characters.'))),
        h('div', { class: 'sx-cols' },
          panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('list-checks'), 'Quick checks'),
            h('ul', { class: 'sx-checks', style: 'grid-template-columns:1fr' }, cl.map((c) => h('li', { class: c.ok ? 'ok' : 'no' }, icon(c.ok ? 'circle-check' : 'circle-x'), c.text))))),
          panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('lightbulb'), 'How to improve it'),
            tips.length ? h('ul', { class: 'sx-tips' }, tips.map((t) => h('li', icon('arrow-right'), t))) : h('div', { class: 'sx-hint' }, 'No warnings. A longer random passphrase is still the best upgrade.')))))
    }

    const { box, samples } = passwordBox(run, 'Type or paste a password')
    return h('div', { class: 'stack' },
      panel(h('div', { class: 'stack' }, field('Password', box, 'Analysed in this tab with zxcvbn. Passwords over 256 characters are cut off.'), samples)),
      out)
  }

  // ---------- Entropy calculator ----------
  function passwordEntropyView() {
    const out = h('div', { class: 'stack' })
    const empty = alert('info', 'Type a password to see its entropy in bits. Nothing leaves this page.')
    out.append(empty)
    let seq = 0
    const run = debounce(async (pw) => {
      const mine = ++seq
      if (!pw) return out.replaceChildren(empty)
      const c = charsetEntropy(pw)
      draw(pw, c, null)
      try {
        const r = await analyse(pw)
        if (mine === seq) draw(pw, c, r)
      } catch { /* the offline estimate is still shown */ }
    }, 90)

    function draw(pw, c, r) {
      const real = r ? Math.max(0, Math.log2(Math.max(r.guesses, 1))) : null
      const top = Math.max(c.bits, real ?? 0, 40)
      const rating = ratingOf(real ?? c.bits)
      const m = meter()
      m.set(rating)
      const bar = (label, bits, alt) => {
        const fill = h('i', { class: ['fill', alt && 'alt'] })
        requestAnimationFrame(() => { fill.style.width = `${Math.min(100, (bits / top) * 100)}%` })
        return h('div', { class: 'sx-bar' }, h('span', label), h('span', { class: 'track' }, fill), h('b', formatBits(bits)))
      }
      out.replaceChildren(
        stats([
          { label: 'Charset entropy', value: formatBits(c.bits), hint: `${c.length} characters from a pool of ${c.pool}`, accent: !r },
          { label: 'Pattern-aware entropy', value: real == null ? 'Loading...' : formatBits(real), hint: 'log2 of the guesses a smart attacker needs', accent: !!r, danger: real != null && real < 28 },
          { label: 'Combinations (charset)', value: combos(c.bits), hint: 'if every character were random' },
          { label: 'Rating', value: rating.label, hint: 'based on the pattern-aware number' },
        ]),
        panel(h('div', { class: 'stack' },
          h('div', { class: 'sx-k' }, icon('scale'), 'Charset vs. reality'),
          bar('Charset (naive)', c.bits, false),
          real == null ? h('div', { class: 'sx-skel', style: 'height:12px' }) : bar('Pattern-aware', real, true),
          m,
          h('div', { class: 'sx-hint' }, 'Charset entropy assumes every character is drawn at random. Real passwords follow patterns, so the pattern-aware number is the one to trust.'))),
        h('div', { class: 'sx-cols' },
          panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('calculator'), 'The charset maths'),
            h('div', { class: 'sx-formula' }, `${c.length} x log2(${c.pool || 0}) = ${c.bits.toFixed(1)} bits`),
            h('div', { class: 'sx-chips' }, CLASSES.map((k) => chip(`${k.label} (${k.size})`, k.re.test(pw), null, { disabled: true }))))),
          panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('timer'), 'Brute-force time'),
            h('div', { class: 'sx-times', style: 'grid-template-columns:1fr 1fr' }, CRACK_RATES.slice(2).map((k, i) => h('div', { class: 'sx-time', style: { '--i': i } }, h('div', { class: 'l' }, k.label),
              h('div', { class: 'v' }, humanTime(2 ** ((real ?? c.bits) - 1) / k.rate)), h('div', { class: 'n' }, 'average, pattern-aware'))))))))
    }
    const { box, samples } = passwordBox(run, 'Type or paste a password')
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, field('Password', box, 'Entropy is measured in bits: every extra bit doubles the work for an attacker.'), samples)), out)
  }

  function policyView() {
    const s = { mode: 'chars', lower: true, upper: true, digits: true, symbols: true, custom: 0, length: 12, wordList: 7776, wordCount: 6, ...load('password-entropy:policy', {}) }
    const out = h('div', { class: 'stack' })
    const render = () => {
      save('password-entropy:policy', s)
      const pool = (s.lower ? 26 : 0) + (s.upper ? 26 : 0) + (s.digits ? 10 : 0) + (s.symbols ? 33 : 0) + (Number.isFinite(s.custom) ? Math.max(0, s.custom) : 0)
      const bits = s.mode === 'chars' ? (pool > 1 ? s.length * Math.log2(pool) : 0) : (s.wordList > 1 ? s.wordCount * Math.log2(s.wordList) : 0)
      const rating = ratingOf(bits)
      const m = meter()
      m.set(rating)
      const rows = s.mode === 'chars' && pool > 1
        ? [40, 64, 80, 128].map((t) => [`${t} bits`, `${Math.ceil(t / Math.log2(pool))} characters`])
        : s.mode === 'words' && s.wordList > 1 ? [40, 64, 80, 128].map((t) => [`${t} bits`, `${Math.ceil(t / Math.log2(s.wordList))} words`]) : []
      out.replaceChildren(
        stats([
          { label: 'Entropy', value: formatBits(bits), hint: s.mode === 'chars' ? `pool of ${pool} characters` : `${s.wordCount} words from ${s.wordList.toLocaleString()}`, accent: true, danger: bits < 28 },
          { label: 'Combinations', value: combos(bits), hint: 'possible secrets' },
          { label: 'Rating', value: rating.label, hint: 'if chosen at random' },
          { label: 'Offline fast hash', value: humanTime(2 ** (bits - 1) / CRACK_RATES[3].rate), hint: 'average time to crack' },
        ]),
        panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('calculator'), 'The maths'),
          h('div', { class: 'sx-formula' }, s.mode === 'chars' ? `${s.length} x log2(${pool}) = ${bits.toFixed(1)} bits` : `${s.wordCount} x log2(${s.wordList}) = ${bits.toFixed(1)} bits`), m)),
        h('div', { class: 'sx-cols' },
          panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('timer'), 'Average time to crack'),
            h('div', { class: 'sx-times' }, CRACK_RATES.map((k, i) => h('div', { class: 'sx-time', style: { '--i': i } }, h('div', { class: 'l' }, k.label), h('div', { class: 'v' }, humanTime(2 ** (bits - 1) / k.rate)), h('div', { class: 'n' }, k.note)))))),
          rows.length ? panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('target'), 'Length needed'),
            h('div', { class: 'sx-times', style: 'grid-template-columns:1fr 1fr' }, rows.map(([a, b], i) => h('div', { class: 'sx-time', style: { '--i': i } }, h('div', { class: 'l' }, a), h('div', { class: 'v' }, b)))))) : null))
    }
    const modeSeg = segmented([['chars', 'Characters'], ['words', 'Words (diceware)']], s.mode, (v) => { s.mode = v; sync(); render() }, 'Policy type')
    const lenRange = h('input', { type: 'range', min: 4, max: 64, step: 1, value: s.length, 'aria-label': 'Length', oninput: (e) => { s.length = +e.target.value; lenOut.textContent = s.length; render() } })
    const lenOut = h('b', { class: 'mono' }, s.length)
    const wcRange = h('input', { type: 'range', min: 2, max: 12, step: 1, value: s.wordCount, 'aria-label': 'Number of words', oninput: (e) => { s.wordCount = +e.target.value; wcOut.textContent = s.wordCount; render() } })
    const wcOut = h('b', { class: 'mono' }, s.wordCount)
    const custom = number(s.custom || '', { min: 0, step: 1, placeholder: '0', ariaLabel: 'Extra characters in the pool', onInput: (n) => { s.custom = Number.isFinite(n) ? Math.round(n) : 0; render() } })
    const listSel = h('select', { class: 'select', 'aria-label': 'Word list size', onchange: (e) => { s.wordList = +e.target.value; render() } },
      [[7776, 'EFF large (7,776 words)'], [2048, 'BIP-39 (2,048 words)'], [1296, 'EFF short (1,296 words)'], [10000, 'Common 10,000 words'], [65536, 'Large dictionary (65,536)']].map(([v, l]) => h('option', { value: v, selected: v === s.wordList }, l)))
    const charsBox = h('div', { class: 'stack' },
      h('div', { class: 'sx-chips' },
        chip('Lowercase', s.lower, (v) => { s.lower = v; render() }, { sample: '26' }), chip('Uppercase', s.upper, (v) => { s.upper = v; render() }, { sample: '26' }),
        chip('Digits', s.digits, (v) => { s.digits = v; render() }, { sample: '10' }), chip('Symbols', s.symbols, (v) => { s.symbols = v; render() }, { sample: '33' })),
      field('Length', h('div', { class: 'sx-lens' }, lenRange, lenOut)),
      field('Extra characters in the pool', custom, 'Add more if your policy allows other characters, such as accented letters.'))
    const wordsBox = h('div', { class: 'stack' }, field('Word list', listSel), field('Number of words', h('div', { class: 'sx-lens' }, wcRange, wcOut)))
    function sync() { charsBox.hidden = s.mode !== 'chars'; wordsBox.hidden = s.mode !== 'words' }
    sync()
    render()
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, h('div', { class: 'sx-hint' }, 'Entropy of a secret that is generated at random under this policy. Humans choosing their own passwords land far lower.'), modeSeg, charsBox, wordsBox)), out)
  }

  if (entropyMode) {
    tabRoot.append(tabs([
      { id: 'password', label: 'A password', render: passwordEntropyView },
      { id: 'policy', label: 'A policy', render: policyView },
    ], 'password'))
  } else {
    tabRoot.append(strengthView())
  }
  root.append(h('div', { class: 'sx stack' }, tabRoot))
}
