# Writing a tool

This site is a no-build static app on GitHub Pages. Every tool is one ES module in a **pack** folder, mounted into the tool page by the shell. Read this whole file before writing a tool.

## Layout

```
index.html, assets/        shell: router, home, search, theme (do not edit from a pack PR)
lib/                       shared helpers every tool uses (do not edit from a pack PR)
  ui.js                    UI kit: h(), button, dropzone, fileList, field, select, toggle, segmented, rangeField,
                           panel, card, split, stats, table, tabs, progress, alert, toast, modal, copyButton,
                           downloadButton, download, busy, formatBytes, formatNumber, formatDuration, debounce
  files.js                 ext, baseName, withExt, suffixName, zip(), pickFiles, pickFolder, base64 helpers, mimeOf
  libs.js                  pinned CDN loaders: pdfjs, pdfLib, jszip, xlsx, papaparse, docx, mammoth, marked,
                           turndown, dompurify, tesseract, transformers, chartjs, jspdf, html2canvas, diff,
                           hashwasm, katex, pptxgen, anthropic, script(src)
  image.js                 loadImage, canvas, toCanvas, fitSize, toBlob, canEncode, compressToTarget, pixels
  pdf.js                   openPdf, renderPage, thumbnail, extractText, loadPdfLib, savePdf, parseRanges, PAGE_SIZES
  ocr.js                   recognize(image, {lang, onProgress}), OCR_LANGS
  whisper.js               transcribe(blob, {model, language, onProgress}), decodeAudio, toSRT, toVTT, WHISPER_MODELS
  ai.js                    Claude: ensureKey(), ask({...}), notice(), imageBlock, pdfBlock, openSettings
  store.js                 load/save/persisted for localStorage (namespaced, never throws)
packs/<pack>/catalog.js    the pack's tool entries (owned by the pack)
packs/<pack>/<module>.js   tool modules (owned by the pack)
scripts/check.mjs          CI: catalog, module contract, icons, syntax, house rules
```

A pack PR touches **only `packs/<pack>/`**. If a shared helper is missing, write it inside your pack (e.g. `packs/<pack>/_shared.js`, files starting with `_` are never tool modules) and mention it in the PR so it can be promoted to `lib/` later.

## Catalog entry

```js
{ id: 'merge-pdf', name: 'Merge PDF', desc: 'One sentence, max 130 chars.', icon: 'combine', tags: 'search keywords',
  cat: 'pdf',            // optional, defaults to the pack's `cat`
  also: ['image'],       // optional, extra categories it is listed under
  module: 'merge-pdf',   // optional, defaults to id -> packs/<pack>/<module>.js
  params: { mode: 'x' }, // optional, passed to mount() so one module can serve several focused entries
  mode: 'local',         // 'local' (default) | 'model' (downloads an on-device ML model) | 'online' (public API) | 'ai' (Claude, user key)
  ready: true }          // set only when the tool fully works; until then the site shows "Coming soon"
```

- `id` is the URL (`#/merge-pdf`), kebab-case, unique across all packs, and **never renamed** once merged.
- `icon` is a [Lucide](https://lucide.dev/icons) name (lucide 1.47.0). The check fails on unknown names.
- You may add new entries to your pack (new tools are welcome) and refine names/descriptions. Do not delete or rename other ids.

## Module contract

```js
// packs/<pack>/<module>.js
import { h, dropzone, button, busy } from '../../lib/ui.js'

export function mount(root, { tool, params, signal }) {
  root.append(/* your UI */)
  return () => { /* optional cleanup: stop media streams, timers, revoke object URLs, terminate workers */ }
}
```

- `root` is an empty element inside the tool page. The shell already shows the title, description, badges and related tools. Do not repeat the title.
- `signal` aborts when the user navigates away. Use it (or the returned cleanup) to stop cameras/microphones, intervals, workers and long loops.
- `mount` may be async. Export pure logic functions too (e.g. `export function count(text)`) so they are testable.
- See `packs/pdf-edit/merge-pdf.js` (file tool) and `packs/text-utils/word-counter.js` (text tool) for reference.

## Look and feel

Build everything from `lib/ui.js` and the classes in `assets/app.css`. No inline colors: use the CSS variables (`var(--accent)`, `var(--muted)`, `var(--border)`, `var(--surface)`, `var(--surface-2)`, ...) so light and dark both work. Do not add global styles; if you truly need a few rules, inject a `<style>` scoped under a class unique to your tool (e.g. `.t-merge-pdf ...`) once.

Standard shapes:
- **File tools**: `dropzone` -> (`fileList` if several) -> options in a `panel` -> primary `button` with `busy()` -> `progress()` -> result: `alert('success', ...)` + `downloadButton`. Show before/after sizes when relevant. Name outputs sensibly (`suffixName(file.name, 'compressed')`).
- **Text tools**: input `textarea` -> options -> live output (`textarea({readonly: true})` or `.code-out`) with `copyButton` and a download button. Update live on input when cheap (debounce heavy work).
- **Calculators**: inputs in a `.grid-2`/`.grid-auto`, results as `stats([...])` with one `accent` tile, plus a table/chart when useful. Recalculate live, no "Calculate" button needed.
- **Two-pane** layouts: `split(left, right)` collapses to one column on mobile.
- Primary action: `variant: 'primary'`, one per screen. Secondary: default. Destructive: `'danger'`.

## Must-haves (every tool)

1. **Works for real.** It produces a correct result for real inputs, not a mock. Test with real files (generate them in the browser if needed) and check the output opens.
2. **Mobile.** Usable at 360px wide: no horizontal page scroll, tap targets >= 32px, nothing fixed-width over ~320px (use `max-width: 100%`), tables inside `table()` (scrolls itself).
3. **Errors.** Wrap actions in `busy(btn, fn)` (errors become a toast). Validate input and say what is wrong in plain words (`alert('error', ...)`). Never fail silently. Corrupt/encrypted files get a clear message.
4. **Big inputs.** Do not freeze the tab: show `progress()`, yield (`await new Promise(requestAnimationFrame)`) inside long loops, and set sensible limits with a message.
5. **Privacy.** Local tools never upload files. `online` tools call only the public API they need, with no keys, and say which service is used (small muted line). `ai` tools use `lib/ai.js` only, show `ai.notice()`, and call `ai.ensureKey()` before running.
6. **Accessibility.** Labels on inputs (`field(label, control)`), buttons with text or `ariaLabel`, keyboard works, focus visible, color is not the only signal.
7. **Cleanup.** Stop MediaStreams, revoke object URLs, clear intervals, abort fetches on unmount.
8. **No new globals, no build step, no npm.** Libraries load from `lib/libs.js` or a pinned CDN URL (`https://cdn.jsdelivr.net/npm/name@1.2.3/...`). Prefer versions at least 2 weeks old. Pin exact versions.
9. **House style.** No em dashes anywhere (use a hyphen or comma). Plain, friendly copy.

## Modes and external services

- `model`: on-device ML via `lib/libs.js` `transformers()` (transformers.js 4.3.0), `tesseract()` or `lib/whisper.js`. Show download progress and a one-line note that the model downloads once.
- `online`: only CORS-enabled public endpoints that need no key (e.g. Cloudflare DNS-over-HTTPS, frankfurter.app rates, RDAP, LanguageTool public API, r.jina.ai reader). Handle rate limits and outages with a readable message. If something cannot work from a browser, do the useful part locally and deep-link to the official site.
- `ai`: Claude only, through `lib/ai.js`:
  ```js
  import * as ai from '../../lib/ai.js'
  root.append(ai.notice())
  if (!(await ai.ensureKey())) return
  const text = await ai.ask({ system, prompt, pdfs: [file], images: [img], onText: (t) => (out.value = t), signal })
  const obj = await ai.ask({ prompt, json: { type: 'object', properties: {...}, required: [...], additionalProperties: false } })
  ```
  Where possible give AI tools a useful no-key fallback (templates, extractive summary, local OCR) so they still do something without a key.

## Checks

```bash
node scripts/check.mjs
```

It must pass. It validates every catalog entry, that `ready` tools have a module exporting `mount`, Lucide icon names, JS syntax, pinned CDN versions and the no-em-dash rule.

## Testing locally

Serve the repo root with any static server (`python -m http.server 8000`) and open `http://localhost:8000/#/<tool-id>`. Check the browser console is clean, try it at 375px wide and in dark mode (moon button), and exercise the main path with real inputs.
