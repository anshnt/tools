// App styles for the Docs studio. Everything is scoped under .t-docs and uses the site's CSS variables (light and dark).
import { docCss } from './_doccss.js'

const CSS = `
.t-docs { --dc-line: var(--border); position: relative; display: flex; flex-direction: column; height: max(560px, calc(100dvh - var(--header-h) - 160px)); min-height: 0;
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); color: var(--text); overflow: hidden; box-shadow: var(--shadow); font-size: 14px; }
.tool-body:fullscreen .t-docs { height: calc(100dvh - 20px); }
.t-docs *, .t-docs *::before, .t-docs *::after { box-sizing: border-box; }
.t-docs button { font: inherit; }

/* top bar */
.dc-top { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--dc-line); background: var(--surface); flex: none; }
.dc-title { flex: 1 1 120px; min-width: 0; max-width: 460px; height: 34px; padding: 0 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--text); font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
.dc-title:hover { border-color: var(--border); }
.dc-title:focus { border-color: var(--accent); background: var(--surface); outline: none; box-shadow: 0 0 0 3px var(--ring); }
.dc-saved { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--muted); white-space: nowrap; margin-right: auto; }
.dc-saved .icon { width: 15px; height: 15px; }
.dc-saved.warn { color: var(--warning); }
.dc-top-actions { display: flex; align-items: center; gap: 2px; }
.dc-btn.dc-menu-btn { display: none; }

/* buttons */
.dc-btn { display: inline-grid; place-items: center; grid-auto-flow: column; gap: 6px; min-width: 32px; height: 32px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; color: var(--text-2); cursor: pointer; flex: none; position: relative; transition: background .15s, color .15s; }
.dc-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.dc-btn[aria-pressed="true"], .dc-btn.on { background: var(--accent-soft); color: var(--accent); }
.dc-btn:disabled { opacity: .38; cursor: default; }
.dc-btn.label { padding: 0 11px; font-size: 13px; font-weight: 500; }
.dc-btn.txt { padding: 0 9px; font-size: 12.5px; font-weight: 500; }
.dc-btn.primary { background: var(--accent); color: var(--accent-text); padding: 0 12px; font-weight: 600; font-size: 13px; }
.dc-btn.primary:hover:not(:disabled) { background: var(--accent); color: var(--accent-text); filter: brightness(1.08); }
.dc-btn .icon { width: 17px; height: 17px; }
.dc-btn .bar { position: absolute; left: 8px; right: 8px; bottom: 3px; height: 3px; border-radius: 2px; background: var(--bar, transparent); }
[data-tip]:hover::after, [data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 90; padding: 4px 8px; border-radius: 7px;
  background: var(--text); color: var(--bg); font-size: 12px; font-weight: 500; line-height: 1.3; white-space: nowrap; pointer-events: none; box-shadow: var(--shadow); }
[data-tip][data-tip-pos="top"]:hover::after { top: auto; bottom: calc(100% + 6px); }
[data-tip][data-tip-pos="right"]:hover::after { top: 50%; left: calc(100% + 8px); transform: translateY(-50%); }
.dc-select { height: 32px; padding: 0 24px 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%239d9dab' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E") no-repeat right 8px center; color: var(--text); font-size: 13px; appearance: none; -webkit-appearance: none; cursor: pointer; max-width: 140px; }
.dc-select:hover { border-color: var(--border-strong); }
.dc-size { width: 52px; height: 32px; padding: 0 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); text-align: center; font-size: 13px; }
.t-docs input[type="text"], .t-docs input[type="number"], .t-docs input[type="search"] { font-size: 13px; }

/* toolbar */
.dc-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 2px; padding: 6px 10px; border-bottom: 1px solid var(--dc-line); background: var(--surface); flex: none; }
.dc-group { display: flex; align-items: center; gap: 1px; }
.dc-break { flex-basis: 100%; height: 0; }
.dc-sep { width: 1px; height: 20px; margin: 0 6px; background: var(--border); flex: none; }
.dc-ctx { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 2px; padding: 5px 10px; border-bottom: 1px solid var(--dc-line); background: var(--accent-soft); flex: none; animation: dc-in .18s var(--ease); }
.dc-ctx[hidden] { display: none; }
.dc-ctx-title { font-size: 12px; font-weight: 600; color: var(--accent); margin-right: 8px; text-transform: uppercase; letter-spacing: .05em; }
.dc-ctx .dc-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.dc-ctx input[type="text"], .dc-ctx input[type="number"] { height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
@keyframes dc-in { from { opacity: 0; transform: translateY(-4px); } }

/* main */
.dc-main { display: flex; flex: 1; min-height: 0; position: relative; }
.dc-rail { display: flex; flex-direction: column; gap: 4px; padding: 8px 6px; border-right: 1px solid var(--dc-line); background: var(--surface); flex: none; }
.dc-rail .dc-btn { width: 40px; height: 40px; border-radius: 11px; }
.dc-rail .dc-btn .icon { width: 19px; height: 19px; }
.dc-rail .dc-spacer { flex: 1; }
.dc-side { width: 296px; flex: none; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--dc-line); background: var(--surface); }
.dc-side[hidden] { display: none; }
.dc-side-head { display: flex; align-items: center; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--dc-line); }
.dc-side-head h2 { font-size: 14px; flex: 1; letter-spacing: -.01em; }
.dc-side-body { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.dc-work { flex: 1; min-width: 0; position: relative; display: flex; flex-direction: column; }
.dc-canvas { flex: 1; overflow: auto; background: var(--bg-2); padding: 26px 22px 96px; position: relative; scroll-behavior: auto; }
.dc-sheet { position: relative; margin: 0 auto; }
.dc-paper { position: relative; transform-origin: 0 0; width: var(--pw, 794px); min-height: var(--ph, 1123px); padding: var(--mt, 96px) var(--mr, 96px) var(--mb, 96px) var(--ml, 96px);
  background: #fff; color: #1a1a1f; box-shadow: 0 1px 3px rgba(16, 16, 40, .12), 0 18px 50px -18px rgba(16, 16, 40, .35); border-radius: 2px; }
.dc-canvas[data-view="web"] { padding: 0; background: #fff; }
.dc-canvas[data-view="web"] .dc-sheet { width: 100%; }
.dc-canvas[data-view="web"] .dc-paper { width: 100%; max-width: 860px; min-height: 100%; margin: 0 auto; padding: 22px 20px 90px; box-shadow: none; border-radius: 0; background: #fff; }
.dc-canvas[data-view="web"] .dc-guides { display: none; }
.dc-guides { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.dc-pgap { display: block; margin: 0 calc(-1 * var(--mr, 96px)) 0 calc(-1 * var(--ml, 96px)); padding: 0; user-select: none; pointer-events: none; white-space: normal; text-indent: 0; text-align: left; font: 9pt/1 var(--font); color: #8a8a98; }
.dc-pgap > i { display: flex; align-items: center; justify-content: center; font-style: normal; overflow: hidden; }
.dc-pgap > .w { display: block; }
.dc-pgap > .b { background: var(--bg-2); box-shadow: inset 0 7px 7px -7px rgba(16, 16, 40, .35), inset 0 -7px 7px -7px rgba(16, 16, 40, .35); }
.dc-pgap > .f { align-items: flex-end; padding-bottom: 14px; } .dc-pgap > .h { align-items: flex-start; padding-top: 14px; }
.dc-nopage .dc-pgap, .dc-nopage .dc-pgrow { display: none; }
.dc-pgrow > td { padding: 0 !important; border: 0 !important; background: none !important; }
.dc-pgrow:hover { background: none; }
.dc-pgap + * { margin-top: 0 !important; }
.dc-hf { position: absolute; left: var(--ml, 96px); right: var(--mr, 96px); font: 9pt var(--font); color: #8a8a98; display: flex; justify-content: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* document surface */
.dc-prose { display: flow-root; outline: none; min-height: calc(var(--pages, 1) * (var(--ph, 1123px) - var(--mt, 96px) - var(--mb, 96px)) + (var(--pages, 1) - 1) * (var(--mt, 96px) + var(--mb, 96px) + var(--band, 18px))); white-space: pre-wrap; word-wrap: break-word; font-variant-ligatures: none; position: relative; }
.t-docs .dc-prose > :first-child { margin-top: 0 !important; }
.dc-prose .dc-empty::before { content: attr(data-placeholder); color: #a2a2b0; float: left; height: 0; pointer-events: none; }
.dc-prose .dc-find { background: #ffe08a; border-radius: 2px; }
.dc-prose .dc-find-cur { background: #ff9d3b; outline: 2px solid #ff9d3b; }
.dc-prose ::selection { background: rgba(91, 76, 240, .28); }
.dc-prose .ProseMirror-selectednode { outline: 2px solid #5b4cf0; outline-offset: 1px; }
.dc-prose img.ProseMirror-selectednode { outline: 2px solid #5b4cf0; }
.dc-prose .dc-pb { height: 22px; margin: 6px 0; position: relative; display: block; cursor: default; user-select: none; }
.dc-prose .dc-pb::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: 2px dashed #c3c3cf; }
.dc-prose .dc-pb::after { content: "Page break"; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: #fff; padding: 0 10px; font: 600 10px/1 var(--font); letter-spacing: .06em; text-transform: uppercase; color: #8a8a98; }
.dc-prose .dc-pb.ProseMirror-selectednode { outline: 2px solid #5b4cf0; border-radius: 4px; }
.dc-img { position: relative; display: inline-block; line-height: 0; max-width: 100%; vertical-align: bottom; }
.dc-img img { display: block; max-width: 100%; }
.dc-img.selected { outline: 2px solid #5b4cf0; }
.dc-handle { display: none; position: absolute; width: 11px; height: 11px; background: #fff; border: 2px solid #5b4cf0; border-radius: 3px; z-index: 5; touch-action: none; }
.dc-img.selected .dc-handle { display: block; }
.dc-h-nw { left: -6px; top: -6px; cursor: nwse-resize; } .dc-h-ne { right: -6px; top: -6px; cursor: nesw-resize; }
.dc-h-sw { left: -6px; bottom: -6px; cursor: nesw-resize; } .dc-h-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.dc-task { display: flex; align-items: flex-start; gap: 7px; list-style: none; }
.dc-task-box { flex: none; margin-top: 2px; line-height: 1; user-select: none; }
.dc-task-box input { width: 16px; height: 16px; margin: 0; accent-color: #5b4cf0; cursor: pointer; }
.dc-task-body { flex: 1; min-width: 0; }
.dc-task[data-checked="true"] > .dc-task-body > p:first-child { color: #8a8a98; text-decoration: line-through; }
.dc-prose .tableWrapper { overflow: visible; margin: 0 0 10pt; }
.dc-prose .tableWrapper table { margin: 0; }
.dc-prose td, .dc-prose th { vertical-align: top; position: relative; }
.dc-prose .selectedCell::after { z-index: 2; position: absolute; content: ""; inset: 0; background: rgba(91, 76, 240, .18); pointer-events: none; }
.dc-prose .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: -1px; width: 4px; z-index: 20; background: #5b4cf0; pointer-events: none; }
.dc-prose.resize-cursor { cursor: col-resize; }
.ProseMirror-gapcursor { display: none; pointer-events: none; position: absolute; }
.ProseMirror-gapcursor::after { content: ""; display: block; position: absolute; top: -2px; width: 20px; border-top: 1px solid #1a1a1f; animation: dc-blink 1.1s steps(2, start) infinite; }
@keyframes dc-blink { to { visibility: hidden; } }
.ProseMirror-focused .ProseMirror-gapcursor { display: block; }

/* find bar */
.dc-find-bar { position: absolute; top: 10px; right: 20px; z-index: 25; width: min(440px, calc(100% - 28px)); padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-lg); animation: dc-in .18s var(--ease); }
.dc-find-bar[hidden] { display: none; }
.dc-find-row { display: flex; align-items: center; gap: 4px; }
.dc-find-row input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
.dc-find-row input:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px var(--ring); }
.dc-find-count { min-width: 64px; text-align: center; font-size: 12px; color: var(--muted); white-space: nowrap; }

.dc-linktip { position: absolute; z-index: 30; display: flex; align-items: center; gap: 4px; padding: 5px 6px 5px 10px; max-width: min(380px, calc(100% - 16px)); background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-lg); font-size: 13px; animation: dc-in .15s var(--ease); }
.dc-linktip[hidden] { display: none; }
.dc-linktip a { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 4px; }
.dc-linktip a .icon { width: 14px; height: 14px; flex: none; }

/* popovers */
.dc-pop { position: absolute; z-index: 70; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-lg); padding: 8px; min-width: 180px; max-width: calc(100% - 16px); max-height: calc(100% - 16px); overflow: auto; animation: dc-in .15s var(--ease); }
.dc-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 9px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 13.5px; }
.dc-item:hover, .dc-item:focus-visible { background: var(--surface-2); outline: none; }
.dc-item .icon { width: 17px; height: 17px; color: var(--muted); }
.dc-item small { display: block; color: var(--muted); font-size: 12px; }
.dc-item-text { flex: 1; min-width: 0; }
.dc-swatches { display: grid; grid-template-columns: repeat(10, 22px); gap: 4px; padding: 2px; }
.dc-sw { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(0, 0, 0, .16); cursor: pointer; padding: 0; }
.dc-sw:hover, .dc-sw:focus-visible { transform: scale(1.18); outline: 2px solid var(--accent); outline-offset: 1px; }
.dc-pop-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 6px 4px 4px; }
.dc-grid { display: grid; grid-template-columns: repeat(10, 20px); gap: 3px; padding: 2px; }
.dc-gcell { width: 20px; height: 20px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--surface); padding: 0; cursor: pointer; }
.dc-gcell.on { background: var(--accent-soft); border-color: var(--accent); }
.dc-grid-label { text-align: center; font-size: 12.5px; color: var(--text-2); padding: 6px 0 2px; }

/* side panels */
.dc-seg { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--surface-2); }
.dc-seg button { flex: 1; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--text-2); font-size: 12.5px; font-weight: 500; cursor: pointer; }
.dc-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
.dc-doc { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; align-items: center; padding: 9px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; text-align: left; width: 100%; color: var(--text); }
.dc-doc:hover { border-color: var(--border-strong); background: var(--surface-2); }
.dc-doc.current { border-color: var(--accent); background: var(--accent-soft); }
.dc-doc b { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-doc small { grid-column: 1 / -1; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-doc .acts { display: flex; gap: 0; }
.dc-doc .acts .dc-btn { width: 28px; height: 28px; min-width: 28px; }
.dc-doc .acts .dc-btn .icon { width: 15px; height: 15px; }
.dc-tpl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dc-tpl button { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); color: var(--text); font-size: 13px; cursor: pointer; text-align: left; }
.dc-tpl button:hover { border-color: var(--accent); background: var(--accent-soft); }
.dc-tpl .icon { width: 16px; height: 16px; color: var(--accent); }
.dc-sec { display: flex; flex-direction: column; gap: 8px; }
.dc-sec > h3 { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.dc-ol { display: flex; flex-direction: column; gap: 1px; }
.dc-ol button { text-align: left; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--text-2); font-size: 13px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-ol button:hover { background: var(--surface-2); color: var(--text); }
.dc-ol button.cur { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.dc-ol .lv1 { font-weight: 600; color: var(--text); } .dc-ol .lv3 { padding-left: 22px; } .dc-ol .lv4, .dc-ol .lv5, .dc-ol .lv6 { padding-left: 36px; } .dc-ol .lv2 { padding-left: 14px; }
.dc-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dc-fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.dc-fld input[type="text"], .dc-fld input[type="number"], .dc-fld select { height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); width: 100%; }
.dc-fld.wide { grid-column: 1 / -1; }
.dc-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); cursor: pointer; }
.dc-check input { width: 16px; height: 16px; accent-color: var(--accent); }
.dc-note { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
.dc-help-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.dc-help-row kbd { margin-left: 3px; }

/* status bar + credit */
.dc-bar { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-top: 1px solid var(--dc-line); background: var(--surface); font-size: 12.5px; color: var(--muted); flex: none; flex-wrap: wrap; }
.dc-stat { padding: 0 8px; white-space: nowrap; }
.dc-grow { flex: 1; }
.dc-zoomval { min-width: 46px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.dc-bar .dc-btn { height: 28px; min-width: 28px; }
.dc-credit { padding: 7px 12px; border-top: 1px solid var(--dc-line); background: var(--surface-2); font-size: 12.5px; color: var(--muted); flex: none; text-align: center; }
.dc-credit a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.dc-drop { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 10%, rgba(10, 10, 16, .4)); backdrop-filter: blur(2px); pointer-events: none; }
.dc-drop[hidden] { display: none; }
.dc-drop div { padding: 22px 30px; border: 2px dashed var(--accent); border-radius: 20px; background: var(--surface); font-weight: 600; box-shadow: var(--shadow-lg); }
.dc-modal-form { display: flex; flex-direction: column; gap: 12px; min-width: min(420px, 100%); }
.dc-modal-form label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--muted); }
.dc-modal-form input { height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 15px; }

@media (max-width: 860px) {
  .dc-saved span { display: none; }
  .dc-rail { display: none; }
  .dc-btn.dc-menu-btn { display: inline-grid; }
  .dc-side { position: absolute; z-index: 45; left: 0; top: 0; bottom: 0; width: min(330px, 92%); box-shadow: var(--shadow-lg); }
  .dc-tools { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-right: 36px; -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); }
  .dc-tools > * { flex: none; }
  .dc-break, .dc-tools .dc-sep { display: none; }
  .dc-tools [data-g="history"] { order: 0; } .dc-tools [data-g="format"] { order: 1; } .dc-tools [data-g="list"] { order: 2; } .dc-tools [data-g="style"] { order: 3; }
  .dc-tools [data-g="size"] { order: 4; } .dc-tools [data-g="insert"] { order: 5; } .dc-tools [data-g="align"] { order: 6; } .dc-tools [data-g="color"] { order: 7; }
  .dc-tools { gap: 2px 10px; }
  .dc-ctx { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-right: 36px; -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); }
  .dc-ctx > * { flex: none; }
  .dc-canvas { padding: 14px 10px 90px; }
  .dc-find-bar { right: 10px; }
  .dc-top-actions .hide-sm { display: none; }
  .dc-btn.label:not(.txt) span { display: none; }
  [data-tip]:hover::after { display: none; }
}
@media (prefers-reduced-motion: reduce) { .dc-ctx, .dc-pop, .dc-find-bar { animation: none; } .dc-btn, .dc-sw { transition: none; } }
@media print {
  .site-header, .site-footer, .page-hero, .crumbs, #scroll-progress, .dc-top, .dc-tools, .dc-ctx, .dc-rail, .dc-side, .dc-bar, .dc-credit, .dc-find-bar, .dc-guides, .related, .toasts { display: none !important; }
  body { background: #fff !important; } body::before { display: none !important; }
  .t-docs { height: auto !important; border: 0; box-shadow: none; overflow: visible; }
  .dc-main, .dc-work, .dc-canvas { display: block !important; overflow: visible !important; padding: 0 !important; background: #fff !important; }
  .dc-sheet { width: auto !important; height: auto !important; }
  .dc-paper { width: auto !important; min-height: 0 !important; padding: 0 !important; box-shadow: none !important; transform: none !important; }
  .dc-prose .dc-pb { height: 0; margin: 0; break-after: page; } .dc-prose .dc-pb::before, .dc-prose .dc-pb::after { display: none; }
}
`

let injected = false
export function injectStyles() {
  if (injected && document.getElementById('dc-style')) return
  const s = document.createElement('style')
  s.id = 'dc-style'
  s.textContent = CSS + docCss('.t-docs .dc-prose')
  document.head.append(s)
  injected = true
}
