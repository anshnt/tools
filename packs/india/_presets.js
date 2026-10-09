// Photo and signature upload rules for Indian forms. Compiled from the published notices and public guides of 2026; exam bodies change these
// from one notice to the next, so every preset points to the official site and the tools let you edit the numbers.
// Where sources disagree on a limit we use the strictest range that satisfies all of them. KB limits are kilobytes of file size.

const slot = (key, kind, label, w, h, minKB, maxKB, extra = {}) => ({ key, kind, label, w, h, minKB, maxKB, ...extra })
const photo = (w, h, minKB, maxKB, extra) => slot('photo', 'photo', 'Photograph', w, h, minKB, maxKB, extra)
const sign = (w, h, minKB, maxKB, extra) => slot('signature', 'signature', 'Signature', w, h, minKB, maxKB, extra)
const thumb = (w, h, minKB, maxKB, extra) => slot('thumb', 'thumb', 'Left thumb impression', w, h, minKB, maxKB, extra)
const decl = (w, h, minKB, maxKB, extra) => slot('declaration', 'declaration', 'Handwritten declaration', w, h, minKB, maxKB, extra)

export const GROUPS = ['Identity', 'Passport, visa and licence', 'Central exams', 'Banking exams', 'Maharashtra']

export const PRESETS = [
  // ----- Identity -----
  {
    id: 'aadhaar-upload', group: 'Identity', name: 'Aadhaar update: photo upload', focus: ['aadhaar'],
    source: { label: 'myaadhaar.uidai.gov.in', url: 'https://myaadhaar.uidai.gov.in/' },
    note: 'The Aadhaar photo itself is captured live at an Aadhaar centre. This preset is for the photo or document images that the UIDAI self-service portal accepts: JPEG, PNG or PDF up to 2 MB.',
    slots: [photo(413, 531, 0, 2000, { face: 0.62, dpi: 300 })],
  },
  {
    id: 'aadhaar-print', group: 'Identity', name: 'Aadhaar and ID card print: 35 x 45 mm', focus: ['aadhaar'],
    source: { label: 'uidai.gov.in', url: 'https://uidai.gov.in/' },
    note: '3.5 x 4.5 cm at 300 dpi, the standard Indian passport-style photo for printing at a studio or attaching to a form.',
    slots: [photo(413, 531, 0, 0, { face: 0.7, dpi: 300 })],
  },
  {
    id: 'pan-nsdl', group: 'Identity', name: 'PAN: Protean (NSDL)', focus: ['pan'],
    source: { label: 'onlineservices.nsdl.com', url: 'https://www.onlineservices.nsdl.com/' },
    note: 'Photo 2.5 x 3.5 cm and signature 4.5 x 2.0 cm at 200 dpi, JPEG up to 50 KB each (as published for Form 49A uploads).',
    slots: [photo(197, 276, 0, 50, { dpi: 200, face: 0.62 }), sign(354, 157, 0, 50, { dpi: 200 })],
  },
  {
    id: 'pan-utiitsl', group: 'Identity', name: 'PAN: UTIITSL', focus: ['pan'],
    source: { label: 'pan.utiitsl.com', url: 'https://www.pan.utiitsl.com/' },
    note: 'Square photo of 213 x 213 px at 300 dpi up to 30 KB, signature 400 x 200 px up to 60 KB.',
    slots: [photo(213, 213, 0, 30, { dpi: 300, face: 0.6 }), sign(400, 200, 0, 60, { dpi: 300 })],
  },
  // ----- Passport, visa, licence -----
  {
    id: 'passport-seva', group: 'Passport, visa and licence', name: 'Indian passport (Passport Seva)', focus: ['passport'],
    source: { label: 'passportindia.gov.in', url: 'https://www.passportindia.gov.in/' },
    note: 'ICAO-style photo: 35 x 45 mm at 630 x 810 px, white background, JPEG 10 to 250 KB. Face straight to the camera, no glasses, head about 80% of the height.',
    slots: [photo(630, 810, 10, 250, { face: 0.72, white: true, dpi: 450 })],
  },
  {
    id: 'india-evisa', group: 'Passport, visa and licence', name: 'India e-Visa photo (2 x 2 inch)', focus: ['passport'],
    source: { label: 'indianvisaonline.gov.in', url: 'https://indianvisaonline.gov.in/' },
    note: 'Square JPEG, 10 KB to 1 MB, between 350 x 350 and 1000 x 1000 px (2 x 2 inch). Plain light background, full face. If the portal complains about size, use the regular-visa preset (300 KB).',
    slots: [photo(600, 600, 10, 1000, { face: 0.62, white: true, dpi: 300, range: { minW: 350, maxW: 1000, minH: 350, maxH: 1000 } })],
  },
  {
    id: 'india-visa', group: 'Passport, visa and licence', name: 'India visa (regular) photo', focus: ['passport'],
    source: { label: 'indianvisaonline.gov.in', url: 'https://indianvisaonline.gov.in/visa/instruction.html' },
    note: 'Square JPEG of 2 x 2 inch, 10 to 300 KB, equal width and height between 350 and 1000 px.',
    slots: [photo(600, 600, 10, 300, { face: 0.62, white: true, dpi: 300, range: { minW: 350, maxW: 1000, minH: 350, maxH: 1000 } })],
  },
  {
    id: 'sarathi-dl', group: 'Passport, visa and licence', name: 'Driving licence (Sarathi Parivahan)', focus: ['passport', 'dl'],
    source: { label: 'sarathi.parivahan.gov.in', url: 'https://sarathi.parivahan.gov.in/' },
    note: 'The portal is strict about size: photo 420 x 525 px and signature about 256 x 64 px, each 10 to 20 KB, JPEG. Reported by several guides; check the upload screen.',
    slots: [photo(420, 525, 10, 20, { face: 0.62, white: true }), sign(256, 64, 10, 20)],
  },
  // ----- Central exams -----
  {
    id: 'ssc', group: 'Central exams', name: 'SSC (CGL, CHSL, MTS, GD)', focus: ['exam'],
    source: { label: 'ssc.gov.in', url: 'https://ssc.gov.in/' },
    note: 'Recent notices: photo 3.5 x 4.5 cm (about 276 x 354 px), 20 to 50 KB, and signature about 236 x 79 px, 10 to 20 KB. The photo is often captured live; keep this for the admit-card copy.',
    slots: [photo(276, 354, 20, 50, { face: 0.6 }), sign(236, 79, 10, 20)],
  },
  {
    id: 'ssc-old', group: 'Central exams', name: 'SSC (older notices, tiny files)', focus: ['exam'],
    source: { label: 'ssc.gov.in', url: 'https://ssc.gov.in/' },
    note: 'Older SSC notices asked for a 100 x 120 px photo of 4 to 12 KB and a 140 x 60 px signature of 1 to 12 KB. Use only if your notice says so.',
    slots: [photo(100, 120, 4, 12, { face: 0.6 }), sign(140, 60, 1, 12)],
  },
  {
    id: 'upsc', group: 'Central exams', name: 'UPSC (Civil Services, CDS, NDA)', focus: ['exam'],
    source: { label: 'upsconline.nic.in', url: 'https://upsconline.nic.in/' },
    note: 'JPEG only. Photo and signature between 350 and 1000 px on each side, 20 to 300 KB (some guides cap the photo at 200 KB, so we aim for 200 KB). White background, head at least three quarters of the photo.',
    slots: [photo(413, 531, 20, 200, { face: 0.72, white: true, range: { minW: 350, maxW: 1000, minH: 350, maxH: 1000 } }), sign(800, 350, 20, 100, { range: { minW: 350, maxW: 1000, minH: 350, maxH: 1000 } })],
  },
  {
    id: 'rrb', group: 'Central exams', name: 'RRB (NTPC, Group D, ALP, JE)', focus: ['exam'],
    source: { label: 'indianrailways.gov.in', url: 'https://indianrailways.gov.in/' },
    note: 'Typical CEN rules: colour photo 3.5 x 4.5 cm (about 350 x 450 px) 20 to 50 KB and a 140 x 60 px signature of 10 to 20 KB. Recent ALP notices capture the photo live and ask 30 to 49 KB for the signature: edit the limits if yours differs.',
    slots: [photo(350, 450, 20, 50, { face: 0.62, white: true }), sign(140, 60, 10, 20)],
  },
  {
    id: 'neet', group: 'Central exams', name: 'NEET UG (NTA)', focus: ['exam'],
    source: { label: 'neet.nta.nic.in', url: 'https://neet.nta.nic.in/' },
    note: 'Passport photo 10 to 200 KB, signature 4 to 30 KB (black ink on white paper, running handwriting), left thumb impression 10 to 50 KB (blue ink), all JPEG. NTA fixes the file sizes, not the pixels, so photo and signature are 3.5 x 4.5 cm and 3.5 x 1.5 cm at 300 dpi. The postcard photo (4 x 6 inch) is a separate upload: use Custom.',
    slots: [photo(413, 531, 10, 200, { face: 0.62, white: true, dpi: 300 }), sign(413, 177, 4, 30, { dpi: 300 }), thumb(354, 472, 10, 50, { dpi: 300 })],
  },
  {
    id: 'jee-main', group: 'Central exams', name: 'JEE Main (NTA)', focus: ['exam'],
    source: { label: 'jeemain.nta.nic.in', url: 'https://jeemain.nta.nic.in/' },
    note: 'Photo 10 to 200 KB (3.5 x 4.5 cm, 80% face, white background) and signature 10 to 50 KB (3.5 x 1.5 cm), JPEG. Guides quote different ceilings for the signature (50 or 100 KB), so we use the strictest.',
    slots: [photo(413, 531, 10, 200, { face: 0.62, white: true, dpi: 300 }), sign(413, 177, 10, 50, { dpi: 300 })],
  },
  {
    id: 'cuet', group: 'Central exams', name: 'CUET UG (NTA)', focus: ['exam'],
    source: { label: 'cuet.nta.nic.in', url: 'https://cuet.nta.nic.in/' },
    note: 'Photo 10 to 200 KB, signature 10 to 50 KB, JPEG. At least 80% of the face visible on a white or very light background; sign in black or blue ink.',
    slots: [photo(413, 531, 10, 200, { face: 0.62, white: true, dpi: 200 }), sign(413, 177, 10, 50, { dpi: 200 })],
  },
  {
    id: 'gate', group: 'Central exams', name: 'GATE', focus: ['exam'],
    source: { label: 'gate2026.iitg.ac.in', url: 'https://gate2026.iitg.ac.in/' },
    note: 'Photo 3.5 x 4.5 cm, JPEG, between 240 x 320 and 480 x 640 px, 20 to 200 KB; signature about 420 x 120 px (height 80 to 160, width 280 to 560), 10 to 200 KB. Face covers 60 to 70% of the photo, white background.',
    slots: [photo(360, 480, 20, 200, { face: 0.62, white: true, range: { minW: 240, maxW: 480, minH: 320, maxH: 640 } }), sign(420, 120, 10, 200, { range: { minW: 280, maxW: 560, minH: 80, maxH: 160 } })],
  },
  {
    id: 'cat', group: 'Central exams', name: 'CAT (IIM)', focus: ['exam'],
    source: { label: 'iimcat.ac.in', url: 'https://iimcat.ac.in/' },
    note: 'Reported rules: photo 30 x 45 mm (about 354 x 531 px at 300 dpi) and signature 80 x 35 mm (about 472 x 207 px at 150 dpi), JPEG, each up to 80 KB. The portal shows the live limits on the upload page.',
    slots: [photo(354, 531, 20, 80, { face: 0.62, white: true, dpi: 300 }), sign(472, 207, 10, 80, { dpi: 150 })],
  },
  // ----- Banking -----
  {
    id: 'ibps', group: 'Banking exams', name: 'IBPS (PO, Clerk, RRB, SO)', focus: ['exam'],
    source: { label: 'ibps.in', url: 'https://www.ibps.in/' },
    note: 'Photo 200 x 230 px (20 to 50 KB), signature 140 x 60 px (10 to 20 KB), left thumb impression 240 x 240 px (20 to 50 KB, 200 dpi preferred) and a handwritten declaration 800 x 400 px (50 to 100 KB). JPEG. A live photo capture is also asked.',
    slots: [photo(200, 230, 20, 50, { face: 0.62, white: true, dpi: 200 }), sign(140, 60, 10, 20, { dpi: 200 }), thumb(240, 240, 20, 50, { dpi: 200 }), decl(800, 400, 50, 100, { dpi: 200 })],
  },
  {
    id: 'sbi', group: 'Banking exams', name: 'SBI (PO, Clerk, SO)', focus: ['exam'],
    source: { label: 'sbi.co.in/careers', url: 'https://sbi.co.in/web/careers' },
    note: 'Same four uploads as IBPS: photo 200 x 230 px (20 to 50 KB), signature 140 x 60 px (10 to 20 KB), left thumb 240 x 240 px (20 to 50 KB) and handwritten declaration 800 x 400 px (50 to 100 KB). JPEG.',
    slots: [photo(200, 230, 20, 50, { face: 0.62, white: true, dpi: 200 }), sign(140, 60, 10, 20, { dpi: 200 }), thumb(240, 240, 20, 50, { dpi: 200 }), decl(800, 400, 50, 100, { dpi: 200 })],
  },
  // ----- Maharashtra -----
  {
    id: 'mpsc', group: 'Maharashtra', name: 'MPSC (Maharashtra Public Service Commission)', focus: ['exam'],
    source: { label: 'mpsc.gov.in', url: 'https://mpsc.gov.in/' },
    note: 'MPSC states the limits in each advertisement. Most Maharashtra portals use a 200 x 230 px photo (20 to 50 KB) and a 140 x 60 px signature (10 to 20 KB) as a safe default; edit the numbers if your advertisement differs.',
    slots: [photo(200, 230, 20, 50, { face: 0.62, white: true }), sign(140, 60, 10, 20)],
  },
  {
    id: 'mahapariksha', group: 'Maharashtra', name: 'Mahapariksha and state recruitment portals', focus: ['exam'],
    source: { label: 'mahapariksha.gov.in', url: 'https://mahapariksha.gov.in/' },
    note: 'Maharashtra government recruitment portals usually take a 200 x 230 px photo (20 to 50 KB) and a 140 x 60 px signature (10 to 20 KB). Confirm in your notice and edit if needed.',
    slots: [photo(200, 230, 20, 50, { face: 0.62, white: true }), sign(140, 60, 10, 20)],
  },
]

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null

/** A single-slot preset built from numbers typed by the user (px or cm/mm/in at a DPI). */
export function customPreset({ kind = 'photo', w, h, minKB = 0, maxKB = 0, dpi = 0, unit = 'px', label }) {
  const k = { px: null, cm: 2.54, mm: 25.4, in: 1 }[unit]
  const toPx = (v) => (k ? Math.round((v / k) * (dpi || 300)) : Math.round(v))
  return {
    id: 'custom', group: 'Custom', name: 'Custom size', source: null, note: 'Your own size and file limits.',
    slots: [{ key: kind, kind, label: label || (kind === 'photo' ? 'Photograph' : 'Signature'), w: toPx(w), h: toPx(h), minKB, maxKB, dpi, face: 0.62 }],
  }
}

/** Does a measured result satisfy a slot? -> checklist items [{ok, label, value}] */
export function checkSlot(spec, info, extra = {}) {
  const items = []
  const r = spec.range
  const dimOk = r ? info.width >= r.minW && info.width <= r.maxW && info.height >= r.minH && info.height <= r.maxH : info.width === spec.w && info.height === spec.h
  items.push({ ok: dimOk, label: r ? `Size within ${r.minW}-${r.maxW} x ${r.minH}-${r.maxH} px` : `Size ${spec.w} x ${spec.h} px`, value: `${info.width} x ${info.height} px` })
  const kb = info.size / 1024
  const lo = spec.minKB ? spec.minKB * 1024 : 0, hi = spec.maxKB ? spec.maxKB * 1000 : Infinity
  const sizeOk = info.size >= lo && info.size <= hi
  items.push({ ok: sizeOk, label: `File size ${spec.minKB ? `${spec.minKB} to ` : 'up to '}${spec.maxKB ? `${spec.maxKB} KB` : 'any'}`.replace('up to any', 'no limit'), value: `${kb.toFixed(1)} KB` })
  items.push({ ok: info.type === 'image/jpeg' || info.type === 'image/png', label: `Format ${info.type === 'image/png' ? 'PNG' : 'JPEG'}`, value: info.type.replace('image/', '').toUpperCase() })
  if (spec.dpi) items.push({ ok: info.dpi === spec.dpi ? true : 'warn', label: `Resolution ${spec.dpi} dpi`, value: info.dpi ? `${info.dpi} dpi` : 'not set' })
  if (extra.softened) items.push({ ok: 'warn', label: 'Fine detail softened to fit the size limit', value: '' })
  if (extra.padded) items.push({ ok: true, label: 'Padded with metadata to reach the minimum size', value: '' })
  return items
}
