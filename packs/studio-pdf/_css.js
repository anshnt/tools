// Styles for PDF Studio. Injected once; every rule is scoped under .pdfs (or a .pdfs-/.sig-/.stamp- prefix for dialogs).
const CSS = `
.pdfs { --rail: 56px; --pw: 212px; --iw: 304px; position: relative; display: flex; flex-direction: column; height: calc(100dvh - var(--header-h) - 150px); min-height: 580px;
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow); overflow: hidden; font-size: 14px; }
.tool-body:fullscreen .pdfs { height: calc(100dvh - 20px); border-radius: var(--radius); }
.pdfs button { font: inherit; color: inherit; }
.pdfs *:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pdfs .pdfs-scroll:focus-visible { outline: none; }

/* toolbar */
.pdfs-top { display: flex; align-items: center; gap: 4px; padding: 7px 10px; border-bottom: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(12px); overflow-x: auto; scrollbar-width: none; flex: none; }
.pdfs-top::-webkit-scrollbar { display: none; }
.pdfs-top .grp { display: flex; align-items: center; gap: 2px; flex: none; }
.pdfs-top .sep { width: 1px; height: 22px; background: var(--border); margin: 0 6px; flex: none; }
.pdfs-top .grow { flex: 1; min-width: 8px; }
.pbtn { display: inline-grid; place-items: center; min-width: 34px; height: 34px; padding: 0 7px; border-radius: 10px; border: 1px solid transparent; background: transparent; color: var(--text-2); cursor: pointer; transition: background .15s, color .15s, transform .12s; flex: none; }
.pbtn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.pbtn:active:not(:disabled) { transform: scale(.94); }
.pbtn:disabled { opacity: .38; cursor: default; }
.pbtn .icon { width: 18px; height: 18px; }
.pbtn.tog[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.pbtn.txt { font-weight: 650; font-size: 12.5px; }
.pbtn.danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
.pdfs-top .btn { height: 34px; flex: none; }
.pg-nav { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; flex: none; }
.pg-nav input { width: 46px; height: 32px; text-align: center; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2); color: var(--text); font: inherit; -moz-appearance: textfield; }
.pg-nav input::-webkit-outer-spin-button, .pg-nav input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.zoom-sel { height: 32px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2); color: var(--text); font: inherit; padding: 0 6px; min-width: 88px; }
.doc-name { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; padding: 0 6px; flex: none; }
.doc-name .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--warning); margin-right: 6px; vertical-align: middle; }

/* search bar */
.pdfs-search { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--surface); flex: none; overflow-x: auto; scrollbar-width: none; }
.pdfs-search[hidden] { display: none; }
.sb-field { position: relative; flex: 1; min-width: 150px; max-width: 360px; }
.sb-field .icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--muted); }
.sb-field input { width: 100%; height: 34px; padding-left: 34px; }
.sb-info { min-width: 74px; font-size: 12.5px; color: var(--muted); text-align: center; flex: none; }

/* main layout */
.pdfs-main { flex: 1; min-height: 0; display: flex; position: relative; }
.pdfs-rail { width: var(--rail); flex: none; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 0; border-right: 1px solid var(--border); overflow-y: auto; scrollbar-width: none; background: var(--surface); }
.pdfs-rail::-webkit-scrollbar { display: none; }
.pdfs-rail .rsep { width: 26px; height: 1px; background: var(--border); margin: 4px 0; flex: none; }
.tool-btn { width: 40px; height: 40px; flex: none; border-radius: 12px; display: grid; place-items: center; color: var(--text-2); border: 1px solid transparent; background: transparent; cursor: pointer; transition: background .15s, color .15s, transform .15s var(--spring); }
.tool-btn .icon { width: 19px; height: 19px; }
.tool-btn:hover { background: var(--surface-2); color: var(--text); transform: translateY(-1px); }
.tool-btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); box-shadow: 0 6px 16px -10px var(--accent); }
.pdfs-side { flex: none; width: var(--pw); display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-right: 1px solid var(--border); }
.pdfs-side.right { width: var(--iw); border-right: 0; border-left: 1px solid var(--border); }
.pdfs[data-left="off"] .pdfs-side.left, .pdfs[data-right="off"] .pdfs-side.right { display: none; }
.pdfs-view { flex: 1; min-width: 0; position: relative; display: flex; flex-direction: column; background: var(--bg-2); }
.pdfs-scroll { flex: 1; overflow: auto; position: relative; outline: none; overscroll-behavior: contain; }
.pdfs-pages { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 16px 20px 56px; min-width: max-content; }
.pdfs[data-doc="off"] .pdfs-scroll { visibility: hidden; }

/* page */
.pg { position: relative; flex: none; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .06), 0 2px 4px rgba(0, 0, 0, .1), 0 14px 30px -14px rgba(0, 0, 0, .35); }
.pg-paper, .pg-canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.textlayer { position: absolute; inset: 0; overflow: clip; line-height: 1; color: transparent; user-select: text; -webkit-user-select: text; cursor: text; }
.textlayer span { position: absolute; white-space: pre; transform-origin: 0 0; color: transparent; cursor: text; }
.textlayer br { position: absolute; }
.textlayer ::selection { background: rgba(37, 99, 235, .32); }
.layer-svg, .layer-html { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.layer-svg { overflow: visible; }
.layer-svg .hit { fill: rgba(250, 204, 21, .5); mix-blend-mode: multiply; }
.layer-svg .hit.cur { fill: rgba(249, 115, 22, .6); stroke: #ea580c; stroke-width: 1; }
.layer-svg .an text { user-select: none; }
.pdfs[data-tool="select"] .pg { cursor: default; }
.pdfs:not([data-tool="select"]):not([data-tool="highlight"]):not([data-tool="underline"]):not([data-tool="strike"]) .pg { cursor: crosshair; touch-action: none; }
.pdfs:not([data-tool="select"]):not([data-tool="highlight"]):not([data-tool="underline"]):not([data-tool="strike"]) .textlayer { pointer-events: none; user-select: none; }
.pdfs:not([data-tool="select"]) .ff { pointer-events: none !important; }
.pdfs[data-tool="note"] .pg { cursor: copy; }
.tbox { position: absolute; box-sizing: border-box; resize: none; overflow: hidden; border: 1.5px solid var(--accent); border-radius: 2px; padding: 3px; margin: 0; line-height: 1.2; outline: none; pointer-events: auto; white-space: pre-wrap; overflow-wrap: anywhere; }

/* form fields */
.ff { position: absolute; box-sizing: border-box; margin: 0; padding: 0 3px; border: 1px solid transparent; background: #fff; color: #111; font-family: Helvetica, Arial, sans-serif; border-radius: 2px; pointer-events: auto; }
.pdfs[data-ff="on"] .ff { background: #e8edff; border-color: rgba(91, 76, 240, .55); }
.ff:focus { outline: 2px solid var(--accent); outline-offset: 0; background: #fff; }
.ff-ro { opacity: .75; }
textarea.ff { padding: 3px; resize: none; line-height: 1.15; }
.ff-check, .ff-radio { appearance: none; -webkit-appearance: none; padding: 0; border: 1.5px solid #64748b; cursor: pointer; }
.ff-check { border-radius: 3px; }
.ff-radio { border-radius: 50%; }
.pdfs[data-ff] .ff-check:checked { background: #5b4cf0 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7'/%3E%3C/svg%3E") center/80% no-repeat; border-color: #5b4cf0; }
.pdfs[data-ff] .ff-radio:checked { background: radial-gradient(circle, #5b4cf0 0 38%, #fff 42%); border-color: #5b4cf0; }
.ff-sig { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 600; color: #3730a3; cursor: pointer; border: 1.5px dashed #6366f1; background: #eef2ff; }
.ff-sig .icon { width: 14px; height: 14px; }

/* selection popover */
.sel-pop { position: absolute; z-index: 70; display: flex; gap: 2px; padding: 5px; border-radius: 13px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-lg); animation: pdfs-pop .14s var(--ease); }
.sel-pop[hidden] { display: none; }
.sp-btn { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer; }
.sp-btn:hover { background: var(--accent-soft); color: var(--accent); }
.sp-btn .icon { width: 17px; height: 17px; }
@keyframes pdfs-pop { from { opacity: 0; transform: translateY(4px) scale(.97); } }

/* tooltip */
.pdfs-tip { position: absolute; z-index: 90; pointer-events: none; padding: 5px 9px; border-radius: 8px; background: #17171f; color: #fff; font-size: 12.5px; line-height: 1.3; max-width: 260px; box-shadow: 0 8px 24px -8px rgba(0, 0, 0, .5); opacity: 0; transition: opacity .12s; }
.pdfs-tip.on { opacity: 1; }
.pdfs-tip kbd { margin-left: 6px; padding: 1px 5px; border-radius: 5px; background: rgba(255, 255, 255, .18); font: 600 11px var(--mono); }

/* panels */
.panel-head { display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 6px; border-bottom: 1px solid var(--border); flex: none; }
.ph-title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.th-count { font-size: 12px; color: var(--muted); }
.ph-actions { display: flex; gap: 0; justify-content: space-between; }
.ph-actions .pbtn { min-width: 29px; width: 29px; height: 30px; padding: 0; }
.ph-hint { padding: 6px 12px 0; font-size: 12px; }
.thumbs-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.thumbs { position: relative; flex: 1; overflow-y: auto; padding: 10px 14px 20px; display: flex; flex-direction: column; gap: 12px; }
.th { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; border-radius: 12px; border: 1.5px solid transparent; cursor: pointer; outline: none; transition: background .15s, border-color .15s; }
.th:hover { background: var(--surface-2); }
.th.cur { border-color: var(--border-strong); }
.th.sel { background: var(--accent-soft); border-color: var(--accent); }
.th.dragging { opacity: .4; }
.th.over-before::before, .th.over-after::after { content: ""; position: absolute; left: 6px; right: 6px; height: 3px; border-radius: 3px; background: var(--accent); }
.th.over-before::before { top: -8px; }
.th.over-after::after { bottom: -8px; }
.th-img { width: 100%; max-width: 150px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .08), 0 4px 10px -4px rgba(0, 0, 0, .3); border-radius: 2px; overflow: hidden; }
.th-canvas { display: block; width: 100%; height: 100%; }
.th-num { font-size: 12px; color: var(--muted); font-weight: 600; }
.th.sel .th-num { color: var(--accent); }
.rtabs { display: flex; gap: 2px; padding: 8px 8px 0; border-bottom: 1px solid var(--border); flex: none; }
.rtab { flex: 1; padding: 8px 6px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font-weight: 600; font-size: 13px; cursor: pointer; border-radius: 8px 8px 0 0; white-space: nowrap; }
.rtab:hover { color: var(--text); background: var(--surface-2); }
.rtab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.rtab .badge-n { display: inline-block; min-width: 18px; margin-left: 4px; padding: 0 5px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); font-size: 11px; line-height: 18px; }
.rbody { flex: 1; overflow-y: auto; padding: 12px; min-height: 0; }
.rbody > [hidden] { display: none; }
.props, .docinfo, .comments { display: flex; flex-direction: column; gap: 12px; }
.props-head { display: flex; align-items: center; gap: 8px; }
.props-head .icon { color: var(--accent); }
.props-head .muted { margin-left: auto; }
.props-empty { display: grid; justify-items: center; gap: 6px; text-align: center; padding: 28px 12px; color: var(--muted); }
.props-empty .icon { width: 28px; height: 28px; color: var(--accent); opacity: .8; }
.props-empty strong { color: var(--text); }
.props .field, .docinfo .field { margin: 0; }
.swatches { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sw { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--surface); background: var(--c); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; padding: 0; transition: transform .12s; }
.sw:hover { transform: scale(1.12); }
.sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
.sw-none { background: linear-gradient(135deg, transparent 45%, #ef4444 45% 55%, transparent 55%), var(--surface); }
.sw-custom { appearance: none; -webkit-appearance: none; width: 24px; height: 24px; padding: 0; border: 2px dashed var(--border-strong); background: none; cursor: pointer; border-radius: 50%; overflow: hidden; }
.sw-custom::-webkit-color-swatch-wrapper { padding: 0; }
.sw-custom::-webkit-color-swatch { border: 0; border-radius: 50%; }
.sw-custom::-moz-color-swatch { border: 0; border-radius: 50%; }
.row.tight { gap: 4px; flex-wrap: wrap; }
.actions { padding-top: 4px; border-top: 1px solid var(--border); }
.cm { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.cm.sel { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.cm-head { display: flex; align-items: center; gap: 8px; border: 0; background: none; cursor: pointer; padding: 0; text-align: left; }
.cm-head .icon { width: 16px; height: 16px; color: var(--accent); }
.cm-head .muted { margin-left: auto; }
.cm textarea { min-height: 52px; resize: vertical; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 13px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; word-break: break-all; font-weight: 600; }
.shortcuts summary { cursor: pointer; font-weight: 600; font-size: 13px; padding: 4px 0; }
.sc-grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; padding-top: 6px; font-size: 12.5px; align-items: center; }
.sc-grid kbd { padding: 1px 6px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border); font: 600 11.5px var(--mono); justify-self: start; }

/* empty state and status */
.pdfs-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; overflow: auto; background: var(--bg-2); z-index: 5; }
.pdfs-empty[hidden] { display: none; }
.empty-card { width: min(560px, 100%); display: grid; gap: 16px; padding: 22px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); }
.empty-card[hidden] { display: none; }
.empty-card h2 { margin: 0; font-size: 20px; }
.empty-card p { margin: 0; color: var(--muted); }
.empty-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.empty-feats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--text-2); }
.empty-feats li { display: flex; align-items: center; gap: 8px; }
.empty-feats .icon { width: 16px; height: 16px; color: var(--accent); }
.resume { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 12px; background: var(--accent-soft); }
.pdfs-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px 14px; flex-wrap: wrap; padding: 6px 12px; border-top: 1px solid var(--border); font-size: 12.5px; color: var(--muted); background: var(--surface); flex: none; }
.pdfs-foot a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.save-note { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; }
.save-note .icon { color: var(--accent); margin-top: 2px; }

/* signature + stamp dialogs (rendered in a dialog outside .pdfs) */
.sig-dialog { min-width: min(560px, 80vw); }
.sig-pad { position: relative; }
.sig-canvas { display: block; width: 100%; aspect-ratio: 640 / 210; background: #fff; border: 1px dashed var(--border-strong); border-radius: 12px; touch-action: none; cursor: crosshair; }
.sig-line { position: absolute; left: 24px; right: 24px; bottom: 34px; border-bottom: 1.5px solid #cbd5e1; pointer-events: none; }
.sig-line span { position: absolute; left: 0; bottom: -22px; font-size: 12px; color: #94a3b8; }
.sig-inks { display: flex; gap: 8px; margin-right: auto; }
.ink-dot { width: 24px; height: 24px; border-radius: 50%; background: var(--c); border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; padding: 0; }
.ink-dot[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
.sig-fonts { display: grid; gap: 8px; }
.sig-font { text-align: left; font-size: 34px; line-height: 1.3; padding: 6px 16px; border: 1.5px solid var(--border); border-radius: 12px; background: #fff; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sig-font[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.sig-checker { display: grid; place-items: center; padding: 14px; min-height: 120px; border-radius: 12px; background: var(--checker); border: 1px solid var(--border); }
.sig-checker canvas { max-width: 100%; max-height: 160px; }
.sig-saved { display: grid; gap: 6px; }
.sig-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.sig-card { position: relative; border: 1px solid var(--border); border-radius: 12px; background: #fff; display: grid; }
.sig-card .btn { position: absolute; top: 2px; right: 2px; }
.sig-use { border: 0; background: none; padding: 10px; cursor: pointer; display: grid; place-items: center; min-height: 70px; border-radius: 12px; }
.sig-use:hover { background: #eef2ff; }
.sig-use img { max-width: 100%; max-height: 64px; }
.stamp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 8px; }
.stamp-btn { padding: 10px 8px; border: 2px solid var(--c); border-radius: 10px; background: var(--surface); color: var(--c); font: 800 12.5px/1 var(--font); letter-spacing: .08em; cursor: pointer; }
.stamp-btn:hover { background: color-mix(in srgb, var(--c) 10%, var(--surface)); }
.stamp-preview { min-height: 110px; }

/* phones */
@media (max-width: 860px) {
  .pdfs { height: calc(100dvh - 28px); min-height: 480px; border-radius: var(--radius); scroll-margin-top: calc(var(--header-h) + 8px); }
  /* with a document open the app takes the whole screen below the site header (the page title is hidden meanwhile) */
  body.pdfs-open .tool-page .page-hero { display: none; }
  body.pdfs-open .pdfs { height: calc(100dvh - var(--header-h) - 16px); }
  .pdfs-top > .btn-primary { order: -1; margin-right: 6px; }
  .pdfs-top .grow { display: none; }
  .pdfs-main { flex-direction: column-reverse; }
  .pdfs-rail { width: 100%; flex-direction: row; justify-content: flex-start; padding: 6px 8px; border-right: 0; border-top: 1px solid var(--border); overflow-x: auto; overflow-y: hidden; }
  .pdfs-rail .rsep { width: 1px; height: 26px; margin: 0 4px; }
  .pdfs-view { flex: 1; min-height: 0; }
  .pdfs-side { position: absolute; z-index: 40; left: 0; right: 0; bottom: 56px; width: auto; max-height: 58%; border: 0; border-top: 1px solid var(--border-strong); box-shadow: 0 -18px 40px -20px rgba(0, 0, 0, .45); border-radius: 18px 18px 0 0; }
  .pdfs-side.right { width: auto; border-left: 0; }
  .thumbs { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 10px; }
  .th { flex: none; width: 96px; }
  .pdfs-pages { padding: 10px 8px 48px; }
  .doc-name { max-width: 110px; }
  .ph-hint { display: none; }
  .sig-dialog { min-width: 0; }
  .hide-sm { display: none !important; }
}
@media (prefers-reduced-motion: reduce) { .tool-btn, .pbtn, .sw, .sel-pop { transition: none; animation: none; } }
`
export function injectCss() {
  if (document.getElementById('pdfs-css')) return
  const s = document.createElement('style')
  s.id = 'pdfs-css'
  s.textContent = CSS
  document.head.append(s)
}
