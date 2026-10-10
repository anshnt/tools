// Layout Studio styles. Everything is scoped under .t-ls; colors come from the site's CSS variables so light and dark both work.
export const CSS = `
.t-ls { --ls-board: #e6e6ee; --ls-ruler-bg: #f6f6f9; --ls-ruler-tick: #9a9aa8; --ls-ruler-text: #5d5d6b; --ls-label: #5d5d6b; --ls-panel: var(--surface); --ls-bar: color-mix(in srgb, var(--surface) 92%, var(--accent) 3%);
  display: flex; flex-direction: column; height: clamp(560px, calc(100dvh - var(--header-h, 64px) - 170px), 1200px); border: 1px solid var(--border); border-radius: 18px; overflow: hidden;
  background: var(--surface); box-shadow: var(--shadow); position: relative; min-width: 0; font-size: 13px; }
:root[data-theme="dark"] .t-ls { --ls-board: #0b0b11; --ls-ruler-bg: #15151d; --ls-ruler-tick: #6c6c7c; --ls-ruler-text: #a2a2b2; --ls-label: #a2a2b2; }
.tool-body.app:fullscreen .t-ls { height: calc(100dvh - 20px); border-radius: 12px; }
.t-ls * { box-sizing: border-box; }
.t-ls [hidden] { display: none !important; }

/* toolbar */
.t-ls .ls-top { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; background: var(--ls-bar); flex: none; }
.t-ls .ls-sepv { width: 1px; align-self: stretch; margin: 4px 6px; background: var(--border); }
.t-ls .ls-spacer { flex: 1; min-width: 4px; }
.t-ls .ls-docname { width: clamp(120px, 20vw, 240px); height: 32px; border: 1px solid transparent; background: transparent; border-radius: 8px; padding: 0 8px; font-weight: 650; font-size: 14px; color: var(--text); font-family: inherit; }
.t-ls .ls-docname:hover { border-color: var(--border); } .t-ls .ls-docname:focus { border-color: var(--accent); background: var(--surface); outline: none; box-shadow: 0 0 0 3px var(--ring); }
.t-ls .ls-save { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; padding: 0 6px; white-space: nowrap; }
.t-ls .ls-save .icon { width: 13px; height: 13px; }
.t-ls .ls-zoomval { width: 104px; min-width: 0; height: 32px; padding: 0 22px 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; font-size: 12.5px; cursor: pointer; }
.t-ls .ls-zoomval:hover { border-color: var(--border-strong); }

/* buttons and tooltips */
.t-ls .ls-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 32px; height: 32px; padding: 0 6px; border-radius: 9px; border: 1px solid transparent; background: transparent; color: var(--text-2); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 550; flex: none; transition: background .15s, color .15s, border-color .15s; }
.t-ls .ls-btn .icon { width: 17px; height: 17px; }
.t-ls .ls-btn.has-label { padding: 0 10px; }
.t-ls .ls-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.t-ls .ls-btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.t-ls .ls-btn:disabled { opacity: .38; cursor: default; }
.t-ls .ls-btn.primary { background: var(--accent); color: var(--accent-text); }
.t-ls .ls-btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, #000); color: var(--accent-text); }
.t-ls [data-tip]::after { content: attr(data-tip); position: absolute; z-index: 90; pointer-events: none; white-space: nowrap; font-size: 12px; font-weight: 500; line-height: 1.3; padding: 5px 9px; border-radius: 8px; background: #15151e; color: #f4f4fa; box-shadow: 0 8px 24px -8px rgba(0,0,0,.5); opacity: 0; transition: opacity .12s; max-width: 260px; }
.t-ls [data-tip]:hover::after, .t-ls [data-tip]:focus-visible::after { opacity: 1; transition-delay: .4s; }
.t-ls [data-pos="b"]::after { top: calc(100% + 7px); left: 50%; transform: translateX(-50%); }
.t-ls [data-pos="t"]::after { bottom: calc(100% + 7px); left: 50%; transform: translateX(-50%); }
.t-ls [data-pos="r"]::after { left: calc(100% + 9px); top: 50%; transform: translateY(-50%); }
.t-ls [data-pos="l"]::after { right: calc(100% + 9px); top: 50%; transform: translateY(-50%); }
@media (hover: none) { .t-ls [data-tip]::after { display: none; } }

/* control bar */
.t-ls .ls-ctxbar { border-bottom: 1px solid var(--border); padding: 0 10px; height: 58px; display: flex; align-items: center; background: var(--surface); flex: none; position: relative; z-index: 4; }
@media (max-width: 1180px) { .t-ls .ls-ctxbar { overflow-x: auto; scrollbar-width: thin; } }
.t-ls .ls-bar-group { display: flex; align-items: flex-end; gap: 6px; flex-wrap: nowrap; width: max-content; min-width: 100%; padding: 4px 0; }
.t-ls .ls-bar-group .ls-btn, .t-ls .ls-bar-group .ls-seg { align-self: flex-end; }
.t-ls .ls-bar-group .ls-colorrow { align-self: flex-end; height: 32px; }
.t-ls .ls-sep { width: 1px; align-self: stretch; background: var(--border); margin: 2px 2px; }
.t-ls .ls-hint { color: var(--muted); font-size: 12.5px; padding: 0 4px; }
.t-ls .ls-sel, .t-ls .ls-num, .t-ls .ls-name { height: 32px; padding: 0 8px; font-size: 12.5px; border-radius: 8px; min-width: 0; }
.t-ls select.ls-sel { padding-right: 24px; }
.t-ls .ls-w-style { width: 124px; } .t-ls .ls-w-font { width: 118px; } .t-ls .ls-w-weight { width: 92px; }
.t-ls .ls-numwrap { display: grid; gap: 2px; width: 66px; font-size: 10.5px; color: var(--muted); position: relative; }
.t-ls .ls-numlbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 10.5px; }
.t-ls .ls-suffix { position: absolute; right: 8px; bottom: 7px; font-size: 10px; color: var(--muted); pointer-events: none; }
.t-ls .ls-panel-body .ls-numwrap { width: auto; }
.t-ls .ls-inline { display: inline-flex; align-items: center; gap: 8px; align-self: flex-end; height: 32px; font-size: 12px; color: var(--muted); }
.t-ls .ls-zoom { width: 120px; }
.t-ls .ls-seg { display: inline-flex; gap: 1px; padding: 2px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); flex: none; }
.t-ls .ls-seg .ls-btn { height: 28px; min-width: 30px; }
.t-ls .ls-colorrow { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.t-ls .ls-color { width: 34px; height: 30px; padding: 2px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); cursor: pointer; flex: none; }
.t-ls .ls-color.is-none { background: repeating-linear-gradient(135deg, var(--surface) 0 5px, var(--border) 5px 6px); opacity: .85; }
.t-ls .ls-none { height: 30px; min-width: 30px; }
.t-ls .ls-swatches { display: flex; gap: 4px; flex-wrap: wrap; }
.t-ls .ls-sw { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--border-strong); cursor: pointer; padding: 0; }
.t-ls .ls-sw:hover { transform: scale(1.18); }

/* main area */
.t-ls .ls-main { flex: 1; min-height: 0; display: flex; position: relative; }
.t-ls .ls-rail { width: 48px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; border-right: 1px solid var(--border); background: var(--ls-bar); }
.t-ls .ls-rail .ls-btn { width: 36px; height: 36px; }
.t-ls .ls-rail .ls-btn .icon { width: 19px; height: 19px; }
.t-ls .ls-stage { position: relative; flex: 1; min-width: 0; background: var(--ls-board); overflow: hidden; }
.t-ls .ls-view { position: absolute; left: 20px; top: 20px; right: 0; bottom: 0; overflow: hidden; touch-action: none; outline: none; -webkit-user-select: none; user-select: none; }
.t-ls .ls-stage.no-rulers .ls-view { left: 0; top: 0; }
.t-ls .ls-view:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.t-ls .ls-canvas { display: block; width: 100%; height: 100%; }
.t-ls .ls-ruler { position: absolute; z-index: 3; pointer-events: auto; }
.t-ls .ls-ruler-h { left: 20px; top: 0; height: 20px; width: calc(100% - 20px); cursor: s-resize; border-bottom: 1px solid var(--border); }
.t-ls .ls-ruler-v { left: 0; top: 20px; width: 20px; height: calc(100% - 20px); cursor: e-resize; border-right: 1px solid var(--border); }
.t-ls .ls-ruler-corner { position: absolute; left: 0; top: 0; width: 20px; height: 20px; background: var(--ls-ruler-bg); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); z-index: 3; }
.t-ls .ls-stage.no-rulers .ls-ruler, .t-ls .ls-stage.no-rulers .ls-ruler-corner { display: none; }
.t-ls .ls-edit { position: absolute; left: 0; top: 0; transform-origin: 50% 50%; outline: calc(2px / var(--ls-z, 1)) solid var(--accent); outline-offset: calc(1px / var(--ls-z, 1)); white-space: pre-wrap; overflow-wrap: anywhere;
  z-index: 6; margin: 0; column-fill: auto; font-kerning: none; text-rendering: optimizeSpeed; caret-color: var(--accent); -webkit-user-select: text; user-select: text; cursor: text; background: transparent; min-width: 8px; }
.t-ls .ls-edit > div { min-height: 1em; }
.t-ls .ls-edit ::selection { background: rgba(91, 76, 240, .35); }
.t-ls .ls-welcome { position: absolute; inset: 0; z-index: 20; overflow: auto; background: color-mix(in srgb, var(--surface) 95%, transparent); backdrop-filter: blur(8px); padding: 28px 24px; }
.t-ls .ls-welcome-in { max-width: 920px; margin: 0 auto; display: grid; gap: 18px; }
.t-ls .ls-welcome h2 { font-size: 26px; letter-spacing: -.02em; margin: 0; }
.t-ls .ls-welcome p { color: var(--muted); margin: 4px 0 0; max-width: 60ch; }
.t-ls .ls-fab { position: absolute; z-index: 8; right: 12px; bottom: 12px; display: flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(6px); box-shadow: var(--shadow); }
.t-ls .ls-fab .ls-btn { height: 30px; }

/* right side */
.t-ls .ls-side { width: 304px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--ls-panel); min-height: 0; }
.t-ls .ls-tabs { display: flex; border-bottom: 1px solid var(--border); flex: none; }
.t-ls .ls-tab { flex: 1; display: inline-flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 2px 6px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.t-ls .ls-tab .icon { width: 16px; height: 16px; }
.t-ls .ls-tab:hover { color: var(--text); } .t-ls .ls-tab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.t-ls .ls-panes { flex: 1; overflow-y: auto; min-height: 0; overscroll-behavior: contain; }
.t-ls .ls-panel-body { display: block; }
.t-ls .ls-sec { border-bottom: 1px solid var(--border); }
.t-ls .ls-sec > summary { list-style: none; cursor: pointer; padding: 10px 14px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); display: flex; align-items: center; justify-content: space-between; }
.t-ls .ls-sec > summary::-webkit-details-marker { display: none; }
.t-ls .ls-sec > summary::after { content: ""; width: 7px; height: 7px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(45deg); transition: transform .2s; margin-right: 3px; }
.t-ls .ls-sec[open] > summary::after { transform: rotate(-135deg); }
.t-ls .ls-sec-body { padding: 2px 14px 14px; display: grid; gap: 10px; }
.t-ls .ls-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.t-ls .ls-row { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 8px; }
.t-ls .ls-row > :only-child { grid-column: 1 / -1; }
.t-ls .ls-row2 { display: flex; gap: 6px; align-items: center; } .t-ls .ls-row2 > * { min-width: 0; }
.t-ls .ls-lbl { font-size: 12px; color: var(--muted); }
.t-ls .ls-panel-body .ls-sel, .t-ls .ls-panel-body .ls-row .input { width: 100%; }
.t-ls .ls-rowbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.t-ls .ls-rowbar.disabled { opacity: .45; pointer-events: none; }
.t-ls .ls-iconrow { display: flex; gap: 2px; flex-wrap: wrap; }
.t-ls .ls-muted { color: var(--muted); font-size: 12px; line-height: 1.45; margin: 0; }
.t-ls .ls-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; min-height: 24px; }
.t-ls .ls-guide { display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 2px 0; }
.t-ls .alert { font-size: 12.5px; padding: 9px 11px; }
.t-ls .ls-bannerrow { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }

/* pages, layers, styles */
.t-ls .ls-pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 12px 10px; }
.t-ls .ls-page { text-align: center; border-radius: 8px; }
.t-ls .ls-page.over { outline: 2px dashed var(--accent); outline-offset: 3px; }
.t-ls .ls-pagebtn { border: 1px solid var(--border-strong); background: #fff; padding: 0; border-radius: 4px; cursor: pointer; display: block; margin: 0 auto; box-shadow: var(--shadow-sm); overflow: hidden; line-height: 0; }
.t-ls .ls-pagebtn canvas { display: block; }
.t-ls .ls-page.current .ls-pagebtn { outline: 2px solid var(--accent); outline-offset: 2px; }
.t-ls .ls-pagenum { margin-top: 5px; font-size: 11.5px; color: var(--muted); display: flex; justify-content: center; gap: 6px; align-items: center; }
.t-ls .ls-page.current .ls-pagenum { color: var(--accent); font-weight: 700; }
.t-ls .ls-pm { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: var(--surface-3); font-size: 10px; font-weight: 700; color: var(--text-2); }
.t-ls .ls-master, .t-ls .ls-layer { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; border: 1px solid transparent; }
.t-ls .ls-master.active, .t-ls .ls-layer.active { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.t-ls .ls-layer.is-off .ls-name { opacity: .5; }
.t-ls .ls-name { flex: 1; min-width: 0; }
.t-ls .ls-layers, .t-ls .ls-masters, .t-ls .ls-stylelist { display: grid; gap: 2px; }
.t-ls .ls-style { display: flex; align-items: center; border-radius: 9px; border: 1px solid transparent; }
.t-ls .ls-style.active { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.t-ls .ls-stylename { flex: 1; text-align: left; border: 0; background: transparent; padding: 7px 9px; font: inherit; font-size: 12.5px; color: var(--text); cursor: pointer; border-radius: 8px; }

/* status */
.t-ls .ls-status { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 3px 10px; border-top: 1px solid var(--border); background: var(--ls-bar); font-size: 12px; color: var(--muted); flex: none; }
.t-ls .ls-status .ls-btn { height: 26px; font-size: 12px; }
.t-ls .ls-status select { height: 26px; width: auto; padding: 0 22px 0 8px; font-size: 12px; }

/* gallery */
.t-ls .ls-gallery, .ls-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
.ls-card { display: grid; gap: 3px; text-align: left; padding: 10px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); color: var(--text); cursor: pointer; font: inherit; transition: transform .25s var(--spring), border-color .2s, box-shadow .2s; }
.ls-card:hover { transform: translateY(-3px); border-color: var(--accent); box-shadow: 0 18px 36px -22px var(--accent); }
.ls-card strong { font-size: 14px; margin-top: 6px; } .ls-card span { font-size: 12px; color: var(--text-2); } .ls-card small { font-size: 12px; color: var(--muted); line-height: 1.35; }
.ls-thumb { aspect-ratio: 4 / 3; display: grid; place-items: center; background: var(--surface-2); border-radius: 10px; overflow: hidden; }
.ls-thumb canvas { max-width: 86%; max-height: 90%; width: auto; height: auto; box-shadow: 0 6px 18px -6px rgba(0,0,0,.35); border-radius: 2px; }
.ls-thumb-ph { display: grid; place-items: center; color: var(--muted); width: 100%; height: 100%; min-height: 56px; }
.ls-start { display: grid; gap: 14px; } .ls-start h3 { margin: 0; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ls-recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; } .ls-card.compact img { width: 100%; aspect-ratio: 4/3; object-fit: contain; background: var(--surface-2); border-radius: 8px; }
.ls-recentlist { display: grid; gap: 8px; }
.ls-recentrow { display: flex; gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 12px; }
.ls-recentrow img, .ls-recentrow .ls-thumb-ph { width: 64px; height: 48px; object-fit: contain; background: var(--surface-2); border-radius: 6px; flex: none; }
.ls-recentrow .meta { flex: 1; min-width: 0; display: grid; } .ls-recentrow small { color: var(--muted); }
.ls-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ls-rowbar { display: flex; gap: 8px; flex-wrap: wrap; }

/* context menu */
.t-ls .ls-menu { position: absolute; z-index: 80; min-width: 210px; padding: 6px; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-lg); display: grid; gap: 1px; animation: dlg-in .14s var(--ease); }
.t-ls .ls-mi { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border: 0; border-radius: 9px; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.t-ls .ls-mi .icon { width: 16px; height: 16px; color: var(--muted); flex: none; }
.t-ls .ls-mi span { flex: 1; }
.t-ls .ls-mi kbd { font-size: 10.5px; }
.t-ls .ls-mi:hover:not(:disabled), .t-ls .ls-mi:focus-visible { background: var(--accent-soft); outline: none; }
.t-ls .ls-mi:disabled { opacity: .4; }
.t-ls .ls-mi-sep { height: 1px; margin: 4px 6px; background: var(--border); }

/* phones */
.t-ls .ls-panelbtn { display: none; }
@media (max-width: 860px) {
  .t-ls { height: calc(100dvh - var(--header-h, 64px) - 120px); min-height: 520px; border-radius: 14px; }
  .t-ls .ls-docname { width: 120px; }
  .t-ls .ls-main { flex-direction: column; }
  .t-ls .ls-rail { width: auto; flex-direction: row; justify-content: flex-start; overflow-x: auto; padding: 4px 8px; border-right: 0; border-bottom: 1px solid var(--border); }
  .t-ls .ls-rail .ls-btn { width: 40px; height: 40px; }
  .t-ls .ls-ctxbar { overflow-x: auto; scrollbar-width: none; }
  .t-ls .ls-bar-group { flex-wrap: nowrap; width: max-content; }
  .t-ls .ls-panelbtn { display: inline-flex; }
  .t-ls .ls-side { position: absolute; z-index: 30; left: 0; right: 0; bottom: 0; width: auto; height: 52%; border-left: 0; border-top: 1px solid var(--border-strong); border-radius: 18px 18px 0 0; box-shadow: 0 -20px 50px -20px rgba(0,0,0,.45); display: none; }
  .t-ls.side-open .ls-side { display: flex; }
  .t-ls .ls-btn { min-width: 38px; height: 38px; }
  .t-ls .ls-status { display: none; }
  .t-ls .ls-fab { bottom: 8px; right: 8px; }
  .t-ls .ls-welcome { padding: 18px 14px; }
}
/* phone toolbar: wrap onto two rows (name, undo, redo, panels / file and export actions); pinch zooms, so the zoom controls and shortcuts list go */
@media (max-width: 600px) {
  .t-ls .ls-top > * { order: 2; }
  .t-ls .ls-top > .ls-docname, .t-ls .ls-top > .ls-top1 { order: 1; }
  .t-ls .ls-docname { flex: 1 1 170px; width: auto; min-width: 0; }
  .t-ls .ls-sepv, .t-ls .ls-sm-hide, .t-ls .ls-save, .t-ls .ls-top > .ls-spacer { display: none; }
}
@media (max-width: 600px) { .tool-page:has(.t-ls) .page-head > .head-text > p { display: none; } }
@media (prefers-reduced-motion: reduce) { .ls-card, .ls-card:hover { transition: none; transform: none; } }
`

let injected = false
export function injectCss() {
  if (injected && document.getElementById('ls-css')) return
  injected = true
  const s = document.createElement('style')
  s.id = 'ls-css'
  s.textContent = CSS
  document.head.append(s)
}
