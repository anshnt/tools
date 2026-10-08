// Deterministic sample data behind the "Try sample data" buttons (generated in the page, never downloaded).
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
const pick = (r, a) => a[Math.floor(r() * a.length)]
const pad = (n, w = 2) => String(n).padStart(w, '0')
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const toCsv = (head, rows) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'

const PRODUCTS = [['Laptop', 'Computers', 899], ['Monitor', 'Displays', 229], ['Keyboard', 'Accessories', 49], ['Mouse', 'Accessories', 25], ['Headset', 'Audio', 79], ['Webcam', 'Accessories', 59], ['Dock', 'Computers', 149]]
const REGIONS = ['North', 'South', 'East', 'West']

function salesRows({ n = 60, seed = 7, gaps = false } = {}) {
  const r = rng(seed)
  const rows = []
  for (let i = 0; i < n; i++) {
    const [product, category, price] = pick(r, PRODUCTS)
    const units = 1 + Math.floor(r() * 12)
    const month = 1 + Math.floor(r() * 6), day = 1 + Math.floor(r() * 28)
    const row = [1001 + i, `2025-${pad(month)}-${pad(day)}`, pick(r, REGIONS), product, category, units, price, units * price, `C${pad(1 + Math.floor(r() * 12), 3)}`]
    if (gaps) {
      if (r() < 0.1) row[2] = ''
      if (r() < 0.12) row[5] = ''
      if (r() < 0.08) row[6] = 'N/A'
      if (r() < 0.1) row[8] = ''
      if (r() < 0.06) row[4] = ''
      if (row[5] === '' || row[6] === 'N/A') row[7] = ''
    }
    rows.push(row)
  }
  return rows.sort((a, b) => a[1].localeCompare(b[1]))
}
const SALES_HEAD = ['order_id', 'order_date', 'region', 'product', 'category', 'units', 'unit_price', 'revenue', 'customer_id']

export const SAMPLES = {
  sales: { file: 'sales-sample.csv', make: () => toCsv(SALES_HEAD, salesRows()) },
  customers: {
    file: 'customers-sample.csv',
    make: () => {
      const names = ['Asha Verma', 'Ben Carter', 'Chloe Martin', 'Dev Patel', 'Elena Rossi', 'Farid Khan', 'Grace Lee', 'Hiro Tanaka', 'Isla Murray', 'Jon Okafor', 'Kavya Nair', 'Liam Walsh']
      const cities = ['Pune', 'Austin', 'Lyon', 'Mumbai', 'Milan', 'Dubai', 'Seoul', 'Osaka', 'Leeds', 'Lagos', 'Kochi', 'Dublin']
      const tiers = ['Gold', 'Silver', 'Bronze']
      const r = rng(11)
      return toCsv(['customer_id', 'name', 'city', 'tier', 'signup_date'], names.map((nm, i) => [`C${pad(i + 1, 3)}`, nm, cities[i], pick(r, tiers), `2024-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`]))
    },
  },
  missing: { file: 'sales-with-gaps.csv', make: () => toCsv(SALES_HEAD, salesRows({ n: 48, seed: 21, gaps: true })) },
  messy: {
    file: 'messy-contacts.csv',
    make: () => ` Full Name ,E-mail,Signup Date,Amount ($),Status,Notes
  alice JOHNSON ,Alice@Example.com ,2024-01-05,"$1,200.50",ACTIVE,  prefers   email
bob smith,bob@example.com,03/15/2024,300,active,
,,,,,
Carol  Diaz,carol@example.com,15 Mar 2024,N/A,Inactive,called twice
bob smith,bob@example.com,03/15/2024,300,active,
DAN BROWN,dan@example.com,2024/04/02,"2,050.00",Active,VIP
eve   adams,EVE@EXAMPLE.COM,Apr 9 2024,(45.50),pending,none
frank o'neil,frank@example.com,2024-05-30,12%,ACTIVE,-
`,
  },
  duplicates: {
    file: 'contacts-with-duplicates.csv',
    make: () => `name,email,city,plan
Maya Singh,maya@example.com,Delhi,Pro
Tom Brooks,tom@example.com,Leeds,Free
maya singh,MAYA@example.com ,Delhi,Pro
Ana Lopez,ana@example.com,Madrid,Team
Tom Brooks,tom@example.com,Leeds,Free
Ravi Kumar,ravi@example.com,Chennai,Pro
Ana Lopez,ana@example.com,Madrid,Pro
Zoe Chen,zoe@example.com,Taipei,Free
Ravi Kumar,ravi@example.com,Chennai,Pro
Ben Ortiz,ben@example.com,Lima,Team
Zoe Chen,zoe.chen@example.com,Taipei,Free
`,
  },
  students: {
    file: 'student-scores.csv',
    make: () => {
      const r = rng(5)
      const rows = []
      for (let i = 1; i <= 40; i++) {
        const hours = Math.round((1 + r() * 9) * 10) / 10
        const att = Math.min(100, Math.round(60 + hours * 3.5 + r() * 12))
        const clamp = (v) => Math.max(20, Math.min(100, Math.round(v)))
        rows.push([`S${pad(i, 3)}`, hours, att, clamp(35 + hours * 5.5 + r() * 14), clamp(40 + hours * 4.2 + r() * 18), clamp(55 + r() * 35)])
      }
      return toCsv(['student_id', 'hours_studied', 'attendance_pct', 'math', 'science', 'english'], rows)
    },
  },
  products: {
    file: 'products.json',
    make: () => JSON.stringify({
      store: 'Demo Shop',
      products: PRODUCTS.map(([name, category, price], i) => ({ id: i + 1, name, category, price, stock: { warehouse: 10 + i * 7, store: 3 + i }, tags: [category.toLowerCase(), i % 2 ? 'popular' : 'new'] })),
    }, null, 2),
  },
}
/** A File for a sample, ready to feed the same code path as a real upload. 'workbook' builds a small two-sheet .xlsx. */
export async function sampleFile(key) {
  if (key === 'workbook') {
    const [{ parseCsvText }, { buildXlsx }] = await Promise.all([import('./_table.js'), import('./_xlsx.js')])
    const sheets = []
    for (const [name, k] of [['Sales', 'sales'], ['Customers', 'customers']]) {
      const { table } = await parseCsvText(SAMPLES[k].make())
      sheets.push({ name, headers: table.headers, rows: table.rows })
    }
    return new File([await buildXlsx(sheets)], 'sample-workbook.xlsx')
  }
  return new File([SAMPLES[key].make()], SAMPLES[key].file, { type: SAMPLES[key].file.endsWith('.json') ? 'application/json' : 'text/csv' })
}
