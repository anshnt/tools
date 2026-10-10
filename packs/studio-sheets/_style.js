// Styles for the Sheets app, injected once and scoped under .sx. Colors come from the site's CSS variables (light and dark).
const CSS = `
.sx { --rail: 48px; --insp: 330px; position: relative; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto auto; grid-template-columns: minmax(0, 1fr);
  height: clamp(640px, calc(100dvh - var(--header-h) - 200px), 1200px); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-2); box-shadow: var(--shadow);
  font-size: 13px; color: var(--text); overflow: hidden; }
.tool-body.app:fullscreen .sx { height: calc(100dvh - 24px); }
.sx *:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.sx button { font-family: inherit; }
.sx-top { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.sx-title { flex: 1 1 160px; min-width: 120px; max-width: 360px; height: 34px; padding: 0 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--text); font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
.sx-title:hover { border-color: var(--border); }
.sx-title:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); background: var(--surface); }
.sx-save { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.sx-save .icon { width: 14px; height: 14px; }
.sx-save.busy .icon { animation: sx-spin 1s linear infinite; }
@keyframes sx-spin { to { transform: rotate(360deg); } }
.sx-spacer { flex: 1 1 auto; }
.sx-top .btn { height: 34px; }
.sx-bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--surface); border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: thin; flex-wrap: nowrap; }
.sx-grp { flex: none; display: flex; align-items: center; gap: 1px; padding: 2px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 11px; }
.sx-b { position: relative; flex: none; display: inline-grid; grid-auto-flow: column; place-items: center; gap: 5px; min-width: 32px; height: 32px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; color: var(--text-2); cursor: pointer; transition: background .15s, color .15s, transform .1s; font-size: 12.5px; font-weight: 550; white-space: nowrap; }
.sx-b .icon { width: 17px; height: 17px; }
.sx-b:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
.sx-b:active:not(:disabled) { transform: scale(.94); }
.sx-b:disabled { opacity: .38; cursor: not-allowed; }
.sx-b[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.sx-b.caret::after { content: ""; width: 0; height: 0; border: 3.5px solid transparent; border-top-color: currentColor; border-bottom: 0; margin-left: 1px; opacity: .65; }
.sx-b .sx-cbar { position: absolute; left: 7px; right: 7px; bottom: 3px; height: 3px; border-radius: 2px; background: var(--c, transparent); }
.sx [data-tip]::after { content: attr(data-tip); display: none; position: absolute; left: 50%; top: calc(100% + 7px); transform: translateX(-50%); padding: 5px 9px; border-radius: 7px; background: var(--text); color: var(--bg); font-size: 11.5px; font-weight: 500; line-height: 1.25; white-space: nowrap; pointer-events: none; z-index: 120; box-shadow: var(--shadow); }
.sx [data-tip]:hover::after, .sx [data-tip]:focus-visible::after { display: block; animation: sx-tip .14s .45s both; }
@keyframes sx-tip { from { opacity: 0; } to { opacity: 1; } }
.sx [data-tip-pos="right"]::after { left: calc(100% + 8px); top: 50%; transform: translateY(-50%); }
.sx [data-tip-pos="up"]::after { top: auto; bottom: calc(100% + 7px); }
@media (hover: none) { .sx [data-tip]::after { display: none !important; } }
.sx-sel { flex: none; height: 32px; min-width: 0; padding: 0 24px 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12.5px; cursor: pointer; appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%); background-position: calc(100% - 13px) 14px, calc(100% - 9px) 14px; background-size: 4px 4px; background-repeat: no-repeat; }
.sx-sel.sm { width: 62px; }
.sx-sel.nf { width: 132px; }
.sx-sep { flex: none; width: 1px; align-self: stretch; margin: 4px 2px; background: var(--border); }
.sx-fx { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--surface); border-bottom: 1px solid var(--border); }
.sx-name { flex: none; width: 112px; height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font: 600 12.5px var(--mono); text-align: center; }
.sx-name:focus, .sx-fbar:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); background: var(--surface); }
.sx-fxb { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; font: italic 600 14px var(--font); }
.sx-fxb:hover { background: var(--surface-3); color: var(--accent); }
.sx-fbar { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font: 13px var(--mono); }
.sx-main { display: grid; grid-template-columns: var(--rail) minmax(0, 1fr); min-height: 0; position: relative; }
.sx-main.has-insp { grid-template-columns: var(--rail) minmax(0, 1fr) var(--insp); }
.sx-rail { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; scrollbar-width: none; }
.sx-rail .sx-b { width: 38px; height: 38px; padding: 0; }
.sx-rail .sx-b .icon { width: 19px; height: 19px; }
.sx-rail .sx-b[aria-pressed="true"]::before { content: ""; position: absolute; left: -4px; top: 9px; bottom: 9px; width: 3px; border-radius: 3px; background: var(--accent); }
.sx-gv { position: relative; min-width: 0; min-height: 0; background: var(--surface); }
.sx-sc { position: absolute; inset: 0; overflow: auto; outline: none; -webkit-user-select: none; user-select: none; overscroll-behavior: contain; scrollbar-width: thin; }
.sx-sc.select-mode { touch-action: none; }
.sx-ct { position: relative; }
.sx-st { position: sticky; top: 0; left: 0; width: 0; height: 0; overflow: visible; }
.sx-cv { position: absolute; left: 0; top: 0; display: block; max-width: none; max-height: none; }
.sx-ov { position: absolute; inset: 0 var(--sbw, 12px) var(--sbh, 12px) 0; pointer-events: none; overflow: hidden; }
.sx-ov > * { pointer-events: auto; }
.sx-ed { position: absolute; z-index: 20; margin: 0; padding: 3px 5px; border: 2px solid var(--accent); border-radius: 0; background: var(--surface); color: var(--text); resize: none; overflow: hidden; white-space: pre; outline: none; box-shadow: 0 6px 22px -8px rgba(0,0,0,.4); font-family: var(--font); line-height: 1.3; -webkit-user-select: text; user-select: text; }
.sx-ac { position: absolute; z-index: 40; min-width: 260px; max-width: min(460px, 92%); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow-lg); padding: 4px; }
.sx-ac-i { display: grid; grid-template-columns: auto 1fr; gap: 0 8px; padding: 5px 8px; border-radius: 7px; cursor: pointer; align-items: baseline; }
.sx-ac-i b { font: 600 12.5px var(--mono); color: var(--accent); }
.sx-ac-i span { font: 11.5px var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-ac-i small { grid-column: 1 / -1; color: var(--muted); font-size: 11.5px; }
.sx-ac-i.on, .sx-ac-i:hover { background: var(--accent-soft); }
.sx-hint { position: absolute; z-index: 39; padding: 4px 9px; border-radius: 8px; background: var(--text); color: var(--bg); font: 12px var(--mono); max-width: 90%; pointer-events: none; }
.sx-hint u { text-decoration: none; font-weight: 700; color: #fbbf24; }
.sx-charts { position: absolute; left: 50px; top: 26px; right: 0; bottom: 0; overflow: hidden; pointer-events: none; }
.sx-chart { position: absolute; pointer-events: auto; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow); padding: 10px 12px 12px; cursor: move; touch-action: none; outline: none; }
.sx-chart canvas { display: block; width: 100% !important; height: 100% !important; pointer-events: none; }
.sx-chart.sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--ring), var(--shadow-lg); }
.sx-chart-rs { position: absolute; right: -1px; bottom: -1px; width: 18px; height: 18px; cursor: nwse-resize; border-radius: 0 0 11px 0; background: linear-gradient(135deg, transparent 55%, var(--muted) 55%, var(--muted) 62%, transparent 62%, transparent 72%, var(--muted) 72%, var(--muted) 79%, transparent 79%); opacity: .6; }
.sx-chart-bar { position: absolute; right: 6px; top: 6px; display: none; gap: 2px; }
.sx-chart:hover .sx-chart-bar, .sx-chart.sel .sx-chart-bar { display: flex; }
.sx-chart-x { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text-2); cursor: pointer; }
.sx-chart-x:hover { background: var(--surface-3); color: var(--accent); }
.sx-chart-x .icon { width: 14px; height: 14px; }
.sx-insp { display: none; flex-direction: column; min-height: 0; background: var(--surface); border-left: 1px solid var(--border); }
.sx-main.has-insp .sx-insp { display: flex; }
.sx-ph { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); font-weight: 650; font-size: 13.5px; }
.sx-ph .icon { width: 17px; height: 17px; color: var(--accent); }
.sx-ph .sx-b { margin-left: auto; height: 28px; min-width: 28px; }
.sx-pb { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin; }
.sx-sec { display: flex; flex-direction: column; gap: 8px; }
.sx-sec > h4 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.sx-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sx-row > * { min-width: 0; }
.sx-row.tight { gap: 2px; }
.sx-row .grow { flex: 1 1 80px; }
.sx-pb .field { gap: 4px; }
.sx-pb .field-label { font-size: 12px; }
.sx-pb .input, .sx-pb .select { height: 34px; font-size: 13px; padding-top: 0; padding-bottom: 0; }
.sx-pb .select { padding-right: 30px; }
.sx-pb .btn { height: 34px; }
.sx-pb .btn-sm { height: 30px; }
.sx-pb .seg button { padding: 0 9px; height: 28px; }
.sx-list { display: flex; flex-direction: column; gap: 4px; }
.sx-li { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2); text-align: left; cursor: pointer; color: var(--text); font-size: 12.5px; width: 100%; }
.sx-li:hover { border-color: var(--accent); }
.sx-li.on { border-color: var(--accent); background: var(--accent-soft); }
.sx-li b { font-family: var(--mono); font-size: 12px; }
.sx-li small { color: var(--muted); }
.sx-li .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-nf { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
.sx-nfi { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 9px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 12.5px; text-align: left; cursor: pointer; }
.sx-nfi:hover { background: var(--surface-3); }
.sx-nfi.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.sx-nfi span:last-child { color: var(--muted); font-family: var(--mono); font-size: 11.5px; }
.sx-types { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.sx-type { display: grid; justify-items: center; gap: 4px; padding: 8px 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); cursor: pointer; font-size: 11px; color: var(--text-2); }
.sx-type:hover { border-color: var(--accent); color: var(--accent); }
.sx-type.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.sx-type .icon { width: 20px; height: 20px; }
.sx-note { font-size: 12px; color: var(--muted); line-height: 1.45; }
.sx-empty { padding: 18px 8px; text-align: center; color: var(--muted); font-size: 12.5px; }
.sx-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--surface-3); font-size: 11.5px; }
.sx-tabs { display: flex; align-items: stretch; gap: 2px; padding: 4px 8px 0; background: var(--surface-2); border-top: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.sx-tab { flex: none; display: flex; align-items: center; gap: 6px; max-width: 220px; padding: 0 14px; height: 30px; border: 1px solid transparent; border-bottom: 0; border-radius: 9px 9px 0 0; background: transparent; color: var(--text-2); font-size: 12.5px; cursor: pointer; position: relative; }
.sx-tab:hover { background: var(--surface-3); }
.sx-tab[aria-selected="true"] { background: var(--surface); border-color: var(--border); color: var(--text); font-weight: 650; box-shadow: 0 -2px 0 var(--tabc, var(--accent)) inset; }
.sx-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-tab input { width: 120px; height: 22px; border: 1px solid var(--accent); border-radius: 5px; background: var(--surface); color: var(--text); font: inherit; padding: 0 4px; }
.sx-tab.drop { box-shadow: -3px 0 0 var(--accent); }
.sx-tabadd { flex: none; align-self: center; width: 28px; height: 28px; margin-left: 4px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--text-2); cursor: pointer; }
.sx-tabadd:hover { background: var(--surface-3); color: var(--accent); }
.sx-status { display: flex; align-items: center; gap: 14px; padding: 4px 12px; background: var(--surface-2); border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); flex-wrap: wrap; min-height: 30px; }
.sx-status b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.sx-zoom { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.sx-zoom input[type=range] { width: 110px; margin: 0; }
.sx-zoom .sx-b { height: 24px; min-width: 24px; }
.sx-credit { margin: 10px 2px 0; font-size: 12.5px; color: var(--muted); }
.sx-credit a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.sx-pop { position: fixed; z-index: 400; min-width: 180px; max-width: min(420px, calc(100vw - 16px)); overflow-y: auto; padding: 5px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow-lg); animation: sx-pop .12s var(--ease); outline: none; color: var(--text); font-size: 13px; }
@keyframes sx-pop { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
.sx-mi { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 13px; text-align: left; cursor: pointer; }
.sx-mi:hover:not(:disabled), .sx-mi:focus-visible { background: var(--accent-soft); }
.sx-mi:disabled { opacity: .4; cursor: not-allowed; }
.sx-mi.danger { color: var(--danger); }
.sx-mi .icon { width: 16px; height: 16px; color: var(--muted); flex: none; }
.sx-mi.on { font-weight: 600; }
.sx-mi-i { width: 16px; flex: none; }
.sx-mi-l { flex: 1; }
.sx-mi kbd { font-size: 11px; color: var(--muted); background: transparent; }
.sx-msep { height: 1px; margin: 4px 6px; background: var(--border); }
.sx-mh { padding: 6px 10px 2px; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.sx-colorpop { padding: 8px; }
.sx-palette { display: grid; gap: 3px; margin: 6px 0; }
.sx-prow { display: flex; gap: 3px; }
.sx-sw { width: 22px; height: 22px; border: 1px solid rgba(0,0,0,.18); border-radius: 5px; cursor: pointer; padding: 0; }
.sx-sw:hover { transform: scale(1.15); }
.sx-sw.on { outline: 2px solid var(--accent); outline-offset: 1px; }
.sx-custom { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 4px 0; font-size: 12px; color: var(--muted); }
.sx-colorin { width: 44px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: transparent; cursor: pointer; }
.sx-fm { min-width: 250px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.sx-fm .sx-fl { max-height: 230px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
.sx-fl label { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
.sx-fl label:hover { background: var(--surface-2); }
.sx-fl label span.n { margin-left: auto; color: var(--muted); font-size: 11px; }
.sx-bordergrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.sx-bordergrid .sx-b { height: 32px; border: 1px solid var(--border); background: var(--surface-2); }
.sx-dim { opacity: .55; }
.sx-found { font-size: 12px; color: var(--muted); }
.sx-hit { display: flex; gap: 8px; width: 100%; padding: 6px 9px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--text); font-size: 12px; text-align: left; cursor: pointer; }
.sx-hit:hover { background: var(--accent-soft); }
.sx-hit b { flex: none; font-family: var(--mono); color: var(--accent); min-width: 44px; }
.sx-hit span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-keys { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; font-size: 13px; }
.sx-keys kbd { justify-self: end; padding: 1px 7px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 6px; background: var(--surface-2); font-size: 11.5px; }
.sx-keys h4 { grid-column: 1 / -1; margin: 8px 0 0; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.sx-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.sx-tpl { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); text-align: left; cursor: pointer; color: var(--text); }
.sx-tpl:hover { border-color: var(--accent); background: var(--accent-soft); }
.sx-tpl .icon { color: var(--accent); width: 22px; height: 22px; }
.sx-tpl b { font-size: 14px; }
.sx-tpl small { color: var(--muted); line-height: 1.4; }
@media (max-width: 760px) {
  .sx { --rail: 0px; height: calc(100dvh - var(--header-h) - 110px); min-height: 520px; border-radius: var(--radius); }
  .sx-main, .sx-main.has-insp { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .sx-rail { flex-direction: row; justify-content: flex-start; padding: 4px 8px; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; overflow-y: hidden; }
  .sx-rail .sx-b { width: 40px; height: 36px; flex: none; }
  .sx-rail .sx-b[aria-pressed="true"]::before { left: 9px; right: 9px; top: auto; bottom: -4px; width: auto; height: 3px; }
  .sx-insp { position: absolute; left: 0; right: 0; bottom: 0; z-index: 60; height: min(62%, 470px); border: 1px solid var(--border-strong); border-radius: 16px 16px 0 0; box-shadow: 0 -18px 50px -20px rgba(0,0,0,.5); }
  .sx-title { font-size: 14px; }
  .sx-top { padding: 6px 8px; gap: 6px; }
  .sx-name { width: 78px; }
  .sx-zoom input[type=range] { width: 70px; }
  .sx-status { gap: 8px; }
  .sx-sel.nf { width: 112px; }
  .sx-ac { min-width: 220px; }
}
@media (prefers-reduced-motion: reduce) { .sx *, .sx-pop { animation: none !important; transition: none !important; } }
`

export function injectStyle() {
  if (document.querySelector('style[data-sx]')) return
  const el = document.createElement('style')
  el.dataset.sx = ''
  el.textContent = CSS
  document.head.append(el)
}
