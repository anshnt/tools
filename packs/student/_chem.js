// Chemistry helpers: element data (standard atomic weights, IUPAC, 3 decimals), a formula parser and a chemical equation balancer. No DOM.

const RAW = `H Hydrogen 1.008|He Helium 4.0026|Li Lithium 6.94|Be Beryllium 9.0122|B Boron 10.81|C Carbon 12.011|N Nitrogen 14.007|O Oxygen 15.999|F Fluorine 18.998|Ne Neon 20.180|
Na Sodium 22.990|Mg Magnesium 24.305|Al Aluminium 26.982|Si Silicon 28.085|P Phosphorus 30.974|S Sulfur 32.06|Cl Chlorine 35.45|Ar Argon 39.948|K Potassium 39.098|Ca Calcium 40.078|
Sc Scandium 44.956|Ti Titanium 47.867|V Vanadium 50.942|Cr Chromium 51.996|Mn Manganese 54.938|Fe Iron 55.845|Co Cobalt 58.933|Ni Nickel 58.693|Cu Copper 63.546|Zn Zinc 65.38|
Ga Gallium 69.723|Ge Germanium 72.630|As Arsenic 74.922|Se Selenium 78.971|Br Bromine 79.904|Kr Krypton 83.798|Rb Rubidium 85.468|Sr Strontium 87.62|Y Yttrium 88.906|Zr Zirconium 91.224|
Nb Niobium 92.906|Mo Molybdenum 95.95|Tc Technetium 97.907|Ru Ruthenium 101.07|Rh Rhodium 102.91|Pd Palladium 106.42|Ag Silver 107.87|Cd Cadmium 112.41|In Indium 114.82|Sn Tin 118.71|
Sb Antimony 121.76|Te Tellurium 127.60|I Iodine 126.90|Xe Xenon 131.29|Cs Caesium 132.91|Ba Barium 137.33|La Lanthanum 138.91|Ce Cerium 140.12|Pr Praseodymium 140.91|Nd Neodymium 144.24|
Pm Promethium 144.91|Sm Samarium 150.36|Eu Europium 151.96|Gd Gadolinium 157.25|Tb Terbium 158.93|Dy Dysprosium 162.50|Ho Holmium 164.93|Er Erbium 167.26|Tm Thulium 168.93|Yb Ytterbium 173.05|
Lu Lutetium 174.97|Hf Hafnium 178.49|Ta Tantalum 180.95|W Tungsten 183.84|Re Rhenium 186.21|Os Osmium 190.23|Ir Iridium 192.22|Pt Platinum 195.08|Au Gold 196.97|Hg Mercury 200.59|
Tl Thallium 204.38|Pb Lead 207.2|Bi Bismuth 208.98|Po Polonium 208.98|At Astatine 209.99|Rn Radon 222.02|Fr Francium 223.02|Ra Radium 226.03|Ac Actinium 227.03|Th Thorium 232.04|
Pa Protactinium 231.04|U Uranium 238.03|Np Neptunium 237.05|Pu Plutonium 244.06|Am Americium 243.06|Cm Curium 247.07|Bk Berkelium 247.07|Cf Californium 251.08|Es Einsteinium 252.08|Fm Fermium 257.10|
Md Mendelevium 258.10|No Nobelium 259.10|Lr Lawrencium 266.12|Rf Rutherfordium 267.12|Db Dubnium 268.13|Sg Seaborgium 269.13|Bh Bohrium 270.13|Hs Hassium 277.15|Mt Meitnerium 278.16|Ds Darmstadtium 281.17|
Rg Roentgenium 282.17|Cn Copernicium 285.18|Nh Nihonium 286.18|Fl Flerovium 289.19|Mc Moscovium 290.20|Lv Livermorium 293.20|Ts Tennessine 294.21|Og Oganesson 294.21`

/** symbol -> {symbol, name, mass, z} */
export const ELEMENTS = (() => {
  const out = {}
  RAW.replace(/\n/g, '').split('|').filter(Boolean).forEach((e, i) => {
    const [symbol, name, mass] = e.trim().split(' ')
    out[symbol] = { symbol, name, mass: parseFloat(mass), z: i + 1 }
  })
  return out
})()

export const formulaError = (msg, at) => Object.assign(new Error(msg), { at })

/**
 * Parse a chemical formula into element counts. Handles nested (), [], {}, hydrates (CuSO4.5H2O, CuSO4*5H2O) and ignores a trailing charge.
 * parseFormula('Ca(OH)2') -> {Ca: 1, O: 2, H: 2}
 */
export function parseFormula(input) {
  let s = String(input).trim().replace(/[·•⋅*]/g, '.').replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)).replace(/\s+/g, '')
  s = s.replace(/\^\d*[+-]$/, '') // a charge written with a caret, e.g. SO4^2-, is ignored for mass
  if (!s) throw formulaError('Type a formula such as H2O or Ca(OH)2.', 0)
  const total = {}
  for (const part of s.split('.')) {
    if (!part) continue
    const lead = /^(\d+)(?=[A-Z(\[{])/.exec(part)
    const mult = lead ? +lead[1] : 1
    const body = lead ? part.slice(lead[0].length) : part
    const counts = parseGroup(body)
    for (const [el, n] of Object.entries(counts)) total[el] = (total[el] || 0) + n * mult
  }
  if (!Object.keys(total).length) throw formulaError('No elements found.', 0)
  return total
}

function parseGroup(s) {
  const stack = [{}]
  const closers = { ')': '(', ']': '[', '}': '{' }
  const opens = []
  let i = 0
  const num = () => { let j = i; while (j < s.length && /\d/.test(s[j])) j++; const n = j > i ? +s.slice(i, j) : 1; i = j; return n }
  while (i < s.length) {
    const c = s[i]
    if (/[A-Z]/.test(c)) {
      let sym = c
      i++
      if (/[a-z]/.test(s[i] || '')) {
        if (ELEMENTS[sym + s[i]]) { sym += s[i]; i++ } else if (!ELEMENTS[sym]) throw formulaError(`"${sym + s[i]}" is not an element.`, i - 1)
      }
      if (!ELEMENTS[sym]) throw formulaError(`"${sym}" is not an element symbol.`, i - 1)
      const n = num()
      stack.at(-1)[sym] = (stack.at(-1)[sym] || 0) + n
    } else if (c === '(' || c === '[' || c === '{') { opens.push(c); stack.push({}); i++ } else if (closers[c]) {
      if (opens.pop() !== closers[c]) throw formulaError(`Unmatched "${c}".`, i)
      i++
      const n = num()
      const inner = stack.pop()
      for (const [el, k] of Object.entries(inner)) stack.at(-1)[el] = (stack.at(-1)[el] || 0) + k * n
    } else if (/[a-z]/.test(c)) throw formulaError(`"${c}" needs a capital letter before it (element symbols start with a capital).`, i)
    else if (/\d/.test(c)) throw formulaError('A number must follow an element or a bracket.', i)
    else throw formulaError(`Unexpected character "${c}".`, i)
  }
  if (opens.length) throw formulaError(`Unmatched "${opens.at(-1)}".`, s.length)
  return stack[0]
}

/** Molar mass and composition. -> {mass, rows: [{symbol, name, count, atomic, subtotal, percent}]} */
export function molarMass(input) {
  const counts = parseFormula(input)
  const rows = Object.entries(counts).map(([symbol, count]) => {
    const e = ELEMENTS[symbol]
    return { symbol, name: e.name, count, atomic: e.mass, subtotal: e.mass * count }
  })
  const mass = rows.reduce((t, r) => t + r.subtotal, 0)
  for (const r of rows) r.percent = (r.subtotal / mass) * 100
  return { mass, rows, counts }
}

/** Hill-system formula text from counts (C first, H second, then alphabetical). */
export function hillFormula(counts) {
  const keys = Object.keys(counts)
  const order = keys.includes('C') ? ['C', ...(keys.includes('H') ? ['H'] : []), ...keys.filter((k) => k !== 'C' && k !== 'H').sort()] : keys.sort()
  return order.map((k) => k + (counts[k] > 1 ? counts[k] : '')).join('')
}

// ---------- equation balancing ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a))
const lcm = (a, b) => (a / gcd(a, b)) * b
class Frac {
  constructor(n, d = 1) { if (d < 0) { n = -n; d = -d } const g = gcd(n, d) || 1; this.n = n / g; this.d = d / g }
  add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d) }
  sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d) }
  mul(o) { return new Frac(this.n * o.n, this.d * o.d) }
  div(o) { return new Frac(this.n * o.d, this.d * o.n) }
  get zero() { return this.n === 0 }
}

/** Split "A + B -> C + D" into {left: [...], right: [...]} (accepts ->, =>, =, →, <=>, ⇌). Compounds may start with a coefficient. */
export function splitEquation(text) {
  const t = String(text).trim()
  const m = t.split(/\s*(?:<=>|<->|⇌|→|=>|->|=)\s*/)
  if (m.length !== 2 || !m[0] || !m[1]) throw formulaError('Write reactants and products separated by "->", for example H2 + O2 -> H2O.', 0)
  const side = (s) => s.split(/\s+\+\s+|\s*\+\s*(?=[A-Z0-9(\[])/).map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^\d+\s*(?=[A-Z(\[])/, ''))
  return { left: side(m[0]), right: side(m[1]) }
}

/**
 * balance(text) -> {left: [{formula, coeff}], right: [...], counts: {El: [leftTotal, rightTotal]}, text, independent}
 * Solves the nullspace of the element matrix with exact fractions. Throws a readable error when it cannot balance.
 */
export function balance(text) {
  const { left, right } = splitEquation(text)
  const species = [...left, ...right]
  const parsed = species.map((f) => parseFormula(f))
  const els = [...new Set(parsed.flatMap((p) => Object.keys(p)))]
  for (const el of els) {
    const l = parsed.slice(0, left.length).some((p) => p[el]), r = parsed.slice(left.length).some((p) => p[el])
    if (l !== r) throw formulaError(`${el} appears only on the ${l ? 'left' : 'right'} side, so the equation cannot be balanced. Check the formulas for a typing mistake.`, 0)
  }
  const cols = species.length
  const M = els.map((el) => parsed.map((p, j) => new Frac((p[el] || 0) * (j < left.length ? 1 : -1))))
  // reduced row echelon form
  let r = 0
  const pivots = []
  for (let c = 0; c < cols && r < M.length; c++) {
    let p = r
    while (p < M.length && M[p][c].zero) p++
    if (p === M.length) continue
    ;[M[r], M[p]] = [M[p], M[r]]
    const pv = M[r][c]
    M[r] = M[r].map((x) => x.div(pv))
    for (let i = 0; i < M.length; i++) if (i !== r && !M[i][c].zero) { const f = M[i][c]; M[i] = M[i].map((x, k) => x.sub(f.mul(M[r][k]))) }
    pivots.push(c)
    r++
  }
  const free = Array.from({ length: cols }, (_, i) => i).filter((c) => !pivots.includes(c))
  if (!free.length) throw formulaError('This equation cannot be balanced as written. Check the formulas for typing mistakes (a missing element on one side is the usual cause).', 0)
  // first free variable = 1, the others = 0 -> one valid solution; more than one free variable means several independent balances
  const sol = Array.from({ length: cols }, () => new Frac(0))
  sol[free[0]] = new Frac(1)
  pivots.forEach((c, row) => { sol[c] = M[row][free[0]].mul(new Frac(-1)) })
  const den = sol.reduce((t, f) => lcm(t, f.d), 1)
  let ints = sol.map((f) => (f.n * den) / f.d)
  const g = ints.reduce((t, x) => gcd(t, x), 0) || 1
  ints = ints.map((x) => x / g)
  if (ints.some((x) => x <= 0)) {
    if (ints.every((x) => x >= 0) && ints.some((x) => x === 0)) throw formulaError('Some compounds would get a coefficient of 0, so this reaction mixes more than one independent reaction. Split it into separate equations.', 0)
    throw formulaError('No all-positive whole-number balance exists for this equation. Check that every species is on the right side.', 0)
  }
  const L = left.map((f, i) => ({ formula: f, coeff: ints[i] }))
  const R = right.map((f, i) => ({ formula: f, coeff: ints[left.length + i] }))
  const counts = {}
  for (const el of els) counts[el] = [L.reduce((t, s, i) => t + s.coeff * (parsed[i][el] || 0), 0), R.reduce((t, s, i) => t + s.coeff * (parsed[left.length + i][el] || 0), 0)]
  const fmt = (arr) => arr.map((s) => (s.coeff === 1 ? '' : s.coeff) + s.formula).join(' + ')
  return { left: L, right: R, counts, text: `${fmt(L)} -> ${fmt(R)}`, independent: free.length }
}
