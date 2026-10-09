// QR codes (qrcode-generator, MIT) drawn to a canvas or straight into a jsPDF document as vector squares.
let lib = null
export async function qrModel(text, ecl = 'M') {
  lib ??= import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm').then((m) => m.default || m).catch((e) => { lib = null; throw Object.assign(new Error('Could not load the QR code library. Check your connection.'), { cause: e }) })
  const make = await lib
  const qr = make(0, ecl)
  qr.addData(String(text))
  qr.make()
  const n = qr.getModuleCount()
  return { n, dark: (r, c) => qr.isDark(r, c) }
}

/** Draw into a canvas context at (x, y) with total size `size` (including the quiet zone `margin` in modules). */
export function drawQr(ctx, model, x, y, size, { fg = '#000', bg = '#fff', margin = 2 } = {}) {
  const cells = model.n + margin * 2
  const u = size / cells
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, size, size) }
  ctx.fillStyle = fg
  for (let r = 0; r < model.n; r++) for (let c = 0; c < model.n; c++) if (model.dark(r, c)) ctx.fillRect(x + (c + margin) * u, y + (r + margin) * u, Math.ceil(u * 1000) / 1000 + 0.2, Math.ceil(u * 1000) / 1000 + 0.2)
}

/** Draw into a jsPDF doc (units of the doc) as filled squares. */
export function pdfQr(doc, model, x, y, size, { fg = [0, 0, 0], margin = 1 } = {}) {
  const cells = model.n + margin * 2
  const u = size / cells
  doc.setFillColor(...fg)
  for (let r = 0; r < model.n; r++) for (let c = 0; c < model.n; c++) if (model.dark(r, c)) doc.rect(x + (c + margin) * u, y + (r + margin) * u, u + 0.15, u + 0.15, 'F')
}

export async function qrCanvas(text, size = 320, opts = {}) {
  const model = await qrModel(text, opts.ecl || 'M')
  const c = document.createElement('canvas')
  c.width = c.height = size
  drawQr(c.getContext('2d'), model, 0, 0, size, opts)
  return c
}
