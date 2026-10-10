// Typography for document content. Shared by the editor paper and by the print / HTML export so both look the same.
// scope: a CSS selector (".dc-paper .dc-prose" in the editor, "body" in exports).
export function docCss(scope) {
  const s = scope
  return `
${s} { font-family: var(--doc-font, Calibri, Carlito, "Segoe UI", Arial, sans-serif); font-size: var(--doc-size, 11pt); line-height: 1.4; color: #1a1a1f; }
${s} p { margin: 0 0 8pt; }
${s} p[data-variant="title"] { font-size: 30pt; line-height: 1.12; font-weight: 700; letter-spacing: -.02em; margin: 0 0 6pt; }
${s} p[data-variant="subtitle"] { font-size: 15pt; line-height: 1.3; color: #5b5b66; margin: 0 0 14pt; }
${s} h1, ${s} h2, ${s} h3, ${s} h4, ${s} h5, ${s} h6 { font-weight: 700; line-height: 1.2; margin: 14pt 0 5pt; letter-spacing: -.01em; break-after: avoid; }
${s} h1 { font-size: 22pt; margin-top: 18pt; }
${s} h2 { font-size: 16pt; }
${s} h3 { font-size: 13pt; }
${s} h4 { font-size: 11.5pt; }
${s} h5 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; }
${s} h6 { font-size: 11pt; font-style: italic; color: #5b5b66; font-weight: 600; }
${s} ul, ${s} ol { margin: 0 0 8pt; padding-left: 24pt; }
${s} li > ul, ${s} li > ol { margin: 2pt 0 0; }
${s} li > p { margin: 0 0 3pt; }
${s} ul[data-task] { list-style: none; padding-left: 2pt; }
${s} blockquote { margin: 0 0 8pt; padding: 2pt 0 2pt 14pt; border-left: 3px solid #c9c9d3; color: #4b4b57; }
${s} blockquote > p:last-child { margin-bottom: 0; }
${s} pre { background: #f4f4f7; border-radius: 6px; padding: 9pt 12pt; margin: 0 0 8pt; font: 10pt/1.45 "Courier New", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
${s} code { background: #f0f0f4; padding: 0 3px; border-radius: 3px; font-family: "Courier New", Consolas, monospace; font-size: .92em; }
${s} pre code { background: none; padding: 0; font-size: inherit; }
${s} hr { border: 0; border-top: 1px solid #c9c9d3; margin: 12pt 0; }
${s} a { color: #1558d6; text-decoration: underline; }
${s} img { max-width: 100%; height: auto; vertical-align: bottom; }
${s} mark { color: inherit; padding: 0; }
${s} table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0 0 10pt; }
${s} td, ${s} th { border: 1px solid #c4c4cf; padding: 4pt 7pt; vertical-align: top; min-width: 1em; overflow-wrap: anywhere; }
${s} th { background: #f1f1f6; font-weight: 700; text-align: left; }
${s} td > p, ${s} th > p { margin: 0 0 2pt; }
${s} td > p:last-child, ${s} th > p:last-child { margin-bottom: 0; }
`
}

/** Extra rules that only the exported (static) HTML needs: check boxes drawn with CSS and real page breaks. */
export function exportCss() {
  return `
li[data-task] > p:first-child::before { content: "\\2610"; margin-right: 6pt; font-family: "Segoe UI Symbol", "DejaVu Sans", sans-serif; }
li[data-task][data-checked="true"] > p:first-child::before { content: "\\2611"; }
.dc-pb { break-after: page; page-break-after: always; height: 0; margin: 0; border: 0; }
tr { break-inside: avoid; }
img { break-inside: avoid; }
`
}
