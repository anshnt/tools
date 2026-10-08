# Writing a tool

This site is a no-build static app on GitHub Pages. Every tool is one ES module in a **pack** folder, mounted into the tool page by the shell. Read this whole file before writing a tool.

## Layout

```
index.html, assets/        shell: router, home, search, theme, motion (do not edit from a pack PR)
lib/                       shared helpers every tool uses (do not edit from a pack PR)
  ui.js                    UI kit: h(), svg(), button, busy, dropzone, fileList, field, input, textarea, number, select,
                           toggle, segmented, rangeField, panel, card, row, stack, split, stats, table, tabs, progress,
                           alert, empty, toast, modal, copyText, copyButton, download, downloadButton, preview,
                           formatBytes, formatNumber, formatDuration, debounce, yieldToMain, onCleanup, fileType, isAbort
  files.js                 ext, baseName, withExt, suffixName, safeName, zip(), pickFiles, pickFolder, base64 helpers, mimeOf
  libs.js                  pinned CDN loaders: pdfjs, pdfLib, jszip, xlsx, papaparse, docx, mammoth, marked, turndown,
                           dompurify, tesseract, transformers, chartjs, jspdf, html2canvas, diff, hashwasm, katex,
                           pptxgen, anthropic, script(src)
  image.js                 loadImage (incl. HEIC), heicToBlob, isHeic, canvas, toCanvas, fitSize, toBlob, canEncode,
                           compressToTarget, pixels, MAX_PIXELS, NATIVE_ENCODE
  pdf.js                   openPdf, renderPage, thumbnail, pageSize, extractText, loadPdfLib, savePdf, rasterizePdf,
                           pdfToTargetSize, parseRanges, PAGE_SIZES
  ffmpeg.js                runFFmpeg, loadFFmpeg, probe, terminateFFmpeg, MAX_INPUT_BYTES (single-thread ffmpeg.wasm)
  ocr.js                   recognize(image, {lang, onProgress}), OCR_LANGS
  whisper.js               transcribe(blob, {model, language, task, onProgress}), decodeAudio, toSRT, toVTT, WHISPER_MODELS, WHISPER_LANGS
  ai.js                    Claude: ensureKey(), ask({...}), notice(), imageBlock, pdfBlock, textBlock, openSettings, isConfigured
  store.js                 load/save/remove/persisted for localStorage (namespaced, never throws)
packs/<pack>/catalog.js    the pack's tool entries (owned by the pack)
packs/<pack>/<module>.js   tool modules (owned by the pack)
scripts/check.mjs          CI: catalog, module contract, imports, icons, syntax, pinned CDNs, house rules
scripts/smoke.py           CI: mounts every ready tool at 1280px and 375px in headless Chromium
```

A pack PR touches **only `packs/<pack>/`**. If a shared helper is missing, write it inside your pack (e.g. `packs/<pack>/_shared.js`; files starting with `_` are never tool modules) and mention it in the PR so it can be promoted to `lib/` later. Read the source of each `lib/` file you use; the doc comments are the API reference.

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
- Only the keys above are allowed; `ready` must be the boolean `true`.
- You may add new entries to your pack (new tools are welcome) and make names and descriptions more accurate. Do not delete or rename existing ids.
- **Be honest.** If a browser cannot do what an entry says, reword the description to what the tool really does, or leave `ready` off. Never ship a mock.

## Module contract

```js
// packs/<pack>/<module>.js
import { h, dropzone, button, busy } from '../../lib/ui.js'

export function mount(root, { tool, params, signal }) {
  root.append(/* your UI */)
  return () => { /* optional cleanup: stop media streams, timers, workers */ }
}
```

- `root` is an empty element inside the tool page. The shell already shows the title, description, badges and related tools. Do not repeat the title.
- `signal` aborts when the user navigates away. Pass it to `ask()`, `runFFmpeg()`, `fetch()` and long loops. Also use it (or the returned cleanup) to stop cameras, microphones, intervals and workers.
- `ui.onCleanup(fn)` registers extra cleanup for the current page. `fileList`, `dropzone` and `ai.notice` already clean up after themselves.
- `mount` may be async. Export pure logic functions too (e.g. `export function count(text)`) so they are testable.
- Query parameters: the router ignores everything after `?` in `#/tool-id?x=1`, so tools can read `new URLSearchParams(location.hash.split('?')[1])` for shareable links.
- See `packs/pdf-edit/merge-pdf.js` (file tool) and `packs/text-utils/word-counter.js` (text tool) for reference.

## Look and feel

The site has a distinctive, modern look: glassy header, gradient brand, Pinterest-style masonry cards, bento categories, and soft motion. Tools should feel like part of it.

- Build everything from `lib/ui.js` and the classes in `assets/app.css`: `.panel`, `.stack`, `.row`, `.grid-2`, `.grid-3`, `.grid-auto`, `.tool-split`, `.stats`, `.code-out`, `.prose`, `.preview`, `.result-big`, `.muted`, `.small`.
- Colors only through CSS variables (`var(--accent)`, `var(--muted)`, `var(--border)`, `var(--surface)`, `var(--surface-2)`, `var(--text)`, `var(--text-2)`, `var(--danger)`, `var(--success)`, `--c` for the category color) so light and dark both work.
- Need a few custom rules? Inject one `<style>` once, scoped under a class unique to your tool (`.t-qr ...`). No global selectors. Respect `prefers-reduced-motion`.
- Small touches are welcome: a live preview, a before/after comparison, an animated result, a satisfying success state. Keep it fast.

Standard shapes:
- **File tools**: `dropzone` -> (`fileList` if several) -> options in a `panel` -> one primary `button` wrapped in `busy(btn, fn, {label, errorTo: resultEl, progress: prog})` -> `progress()` -> result: `alert('success', ...)` + `downloadButton`. Show before/after sizes when relevant. Name outputs sensibly (`suffixName(file.name, 'compressed')`). Snapshot `[...list.files]` before long work and `list.setDisabled(true)` while it runs.
- **Text tools**: input `textarea` -> options -> live output (`textarea({readonly: true})` or `.code-out`) with `copyButton` and a download button. Update live on input (debounce heavy work).
- **Calculators**: inputs in a `.grid-2` or `.grid-auto`, results as `stats([...])` with one `accent` tile (use `danger: true` for bad states), plus a table or chart when useful. Recalculate live; no Calculate button. `number()` passes `NaN` while a field is empty: show a hint, not `NaN`.
- **Two-pane** layouts: `split(left, right)` stacks on mobile.
- Several dropzones on one page: pass `paste: false` to all but the main one.

## Must-haves (every tool)

1. **Works for real.** Correct results for real inputs, not a mock. Test with real files and check the output opens.
2. **Mobile.** Usable at 360px wide: no horizontal page scroll, tap targets at least 32px, nothing fixed-width over ~320px, wide tables inside `table()`. Inputs are 16px on phones (no iOS zoom) automatically.
3. **Errors.** `busy()` reports errors (and ignores cancellations). Validate input and say what is wrong in plain words. Corrupt or encrypted files get a clear message: `loadPdfLib`/`openPdf` throw `err.code === 'PASSWORD'`, so ask for the password with an input and retry.
4. **Big inputs.** Do not freeze the tab: show `progress()`, `await yieldToMain()` inside long loops (not `requestAnimationFrame`, which stops in background tabs), and set limits with a message (canvases are capped at `MAX_PIXELS`).
5. **Privacy.** Local tools never upload files. `online` tools call only the public API they need, with no keys, and name the service in a small muted line. `ai` tools use `lib/ai.js` only, show `ai.notice()`, and call `ai.ensureKey()` before running.
6. **Accessibility.** Labels on inputs (`field(label, control)`), buttons with text or `ariaLabel`, keyboard works, visible focus, color is never the only signal.
7. **Cleanup.** Stop MediaStreams, revoke object URLs you create, clear intervals, terminate workers, abort fetches on unmount.
8. **No new globals, no build step, no npm.** Libraries load from `lib/libs.js` or a pinned CDN URL (`https://cdn.jsdelivr.net/npm/name@1.2.3/...`), at least two weeks old. Check the license (MIT, Apache, BSD, ISC, or LGPL loaded at runtime are fine; avoid non-commercial and AGPL models and libraries).
9. **House style.** No em dashes anywhere (use a hyphen or comma). Plain, friendly copy.

## Formats and engines

- **Images:** `loadImage()` decodes JPG, PNG, WebP, GIF, AVIF, BMP, SVG and HEIC (via heic-to). Browsers can only *encode* JPEG, PNG and WebP everywhere (AVIF in Chromium; check `canEncode`). `toBlob()` rejects for unsupported types; write your own encoder for GIF, BMP, ICO or TIFF (small, in your pack).
- **PDF:** read and render with pdf.js (`openPdf`, `renderPage`, `extractText`); edit with pdf-lib (`loadPdfLib`, `@cantoo/pdf-lib` 2.11.1, which also supports `doc.encrypt({userPassword, ownerPassword, permissions})`). `rasterizePdf` and `pdfToTargetSize` rebuild PDFs from page images: text stops being selectable, so say so. Mixing pdf.js and pdf-lib page sizes? Use `pageSize()` (it applies /Rotate).
- **Audio/video:** `runFFmpeg()` (single-thread ffmpeg.wasm 0.12, works on GitHub Pages without special headers). The core is about 31 MB, downloaded once. Encoding is slower than native, so prefer `-c copy` when possible, use `-preset ultrafast` or `veryfast` for x264, and warn above ~200 MB. `probe(file)` gives duration and streams. MediaRecorder and WebCodecs are fine where they fit better.
- **Speech:** `transcribe()` in `lib/whisper.js` (on-device Whisper via transformers.js 4.3). **OCR:** `recognize()` in `lib/ocr.js` (tesseract.js 7).
- **On-device ML:** `transformers()` (transformers.js 4.3.0). Show download progress and a one-line note that the model downloads once.

## Online services that work from a browser (CORS verified)

| Need | Endpoint |
|---|---|
| Exchange rates | `https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR` (ECB), fallback `https://open.er-api.com/v6/latest/USD` |
| URL shortener | `https://v.gd/create.php?format=json&url=...` |
| Translation | `https://api.mymemory.translated.net/get?q=...&langpair=en\|hi` (500 chars per call), or the Chrome built-in `Translator` API when available |
| Grammar / spelling | `https://api.languagetool.org/v2/check` (POST form: text, language) |
| IFSC | `https://ifsc.razorpay.com/<IFSC>` |
| PIN codes | `https://api.postalpincode.in/pincode/<pin>` and `/postoffice/<name>` |
| DNS | `https://dns.google/resolve?name=...&type=MX` or Cloudflare `https://cloudflare-dns.com/dns-query?name=...&type=A` with header `accept: application/dns-json` |
| IP info | `https://ipwho.is/<ip>` (empty for your own IP) |
| Domains (RDAP) | `https://rdap.org/domain/<domain>` (404 means likely available) |
| Certificates (CT logs) | `https://crt.sh/?q=<domain>&output=json`, `https://api.certspotter.com/v1/issuances?domain=<domain>&expand=dns_names&expand=issuer` |
| HTTP headers | `https://api.hackertarget.com/httpheaders/?q=<url>` (small free daily quota) |
| Web page text / links | `https://r.jina.ai/<url>` (Markdown of any page) |
| Screenshots, page PDF, metadata | `https://api.microlink.io/?url=<url>&screenshot=true` (also `&pdf=true`, `&meta=true`; about 50 free calls a day) |
| Speed test | `https://speed.cloudflare.com/__down?bytes=N` (and `__up` with POST) |
| Citations | `https://api.crossref.org/works/<doi>`, `https://openlibrary.org/isbn/<isbn>.json` |
| YouTube title | `https://noembed.com/embed?url=<youtube url>` |

Handle rate limits and outages with a readable message. If something cannot work from a browser (for example live train status or vehicle owner lookups), do the useful part locally and deep-link to the official site.

## AI tools

Claude only, through `lib/ai.js`. The default model is `claude-opus-5-5`; visitors can pick Sonnet 5.5 or Haiku 5.5.

```js
import * as ai from '../../lib/ai.js'
root.append(ai.notice())
if (!(await ai.ensureKey())) return
const text = await ai.ask({ system, prompt, pdfs: [file], images: [img], onText: (t) => (out.value = t), signal })
const obj = await ai.ask({ prompt, json: { type: 'object', properties: {...}, required: [...], additionalProperties: false } })
// Multi-turn: keep messages and call ask({ messages }); attach big PDFs once with { ...await ai.pdfBlock(file), cache_control: { type: 'ephemeral' } }.
// ask({ raw: true }) returns the full message (citations, usage, stop_reason).
```

Give AI tools a useful no-key fallback where possible (templates, extractive summary, local OCR) so they still do something without a key.

## Checks and testing

```bash
node scripts/check.mjs
```

It must pass: it validates every catalog entry, that `ready` tools have a module exporting `mount`, that relative imports resolve and named imports exist, Lucide icon names, JS syntax, pinned CDN versions and the no-em-dash rule. CI also runs `scripts/smoke.py`, which mounts every ready tool at 1280px and 375px and fails on console errors, uncaught exceptions, error alerts or horizontal overflow.

Test locally with a static server (`python -m http.server 8000`, then open `http://localhost:8000/#/<tool-id>`): clean console, 375px wide, dark mode (moon button), and the main path with real inputs. Generate test inputs yourself (Pillow, pypdf, reportlab, python-docx, openpyxl, pillow-heif, ffmpeg) rather than downloading sample files from websites.
