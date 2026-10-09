// Shared bits for building .docx files (txt-to-word, markdown-to-word): fonts, page sizes, base styles.

export const FONTS = [
  ['Calibri', 'Calibri, Carlito, "Segoe UI", sans-serif'],
  ['Arial', 'Arial, Helvetica, Liberation Sans, sans-serif'],
  ['Times New Roman', '"Times New Roman", Tinos, Times, serif'],
  ['Georgia', 'Georgia, "Times New Roman", serif'],
  ['Cambria', 'Cambria, Caladea, Georgia, serif'],
  ['Garamond', 'Garamond, "EB Garamond", Georgia, serif'],
  ['Verdana', 'Verdana, DejaVu Sans, sans-serif'],
  ['Tahoma', 'Tahoma, Verdana, sans-serif'],
  ['Trebuchet MS', '"Trebuchet MS", Tahoma, sans-serif'],
  ['Segoe UI', '"Segoe UI", system-ui, sans-serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
  ['Consolas', 'Consolas, "Cascadia Mono", monospace'],
]
export const fontStack = (name) => FONTS.find((f) => f[0] === name)?.[1] || name

/** Page sizes in twips (1/1440 inch) and points. */
export const PAGES = {
  a4: { label: 'A4', width: 11906, height: 16838, pt: [595.3, 841.9] },
  letter: { label: 'Letter', width: 12240, height: 15840, pt: [612, 792] },
  legal: { label: 'Legal', width: 12240, height: 20160, pt: [612, 1008] },
  a5: { label: 'A5', width: 8391, height: 11906, pt: [419.5, 595.3] },
}
/** Margins in twips. */
export const MARGINS = { normal: 1440, narrow: 720, wide: 2160 }

/** Line spacing multiplier -> docx "line" value (240 = single, "auto" rule). */
export const lineValue = (mult) => Math.round(240 * mult)

/** Safe file name from a user supplied title. */
export const docName = (s, fallback = 'document') => (s || '').replace(/\.docx$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || fallback
