// Draw Studio styles, injected once. Every selector starts with .t-ds. Dialogs (modal() appends its <dialog> to document.body, outside .t-ds)
// wrap their body in <div class="t-ds-dlg"> and use .t-ds-dlg rules. Colours come only from the site variables, so light and dark both work.
const CSS = `
.t-ds { --ds-tool: 44px; position: relative; display: flex; flex-direction: column; min-width: 0; max-width: 100%; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow);
  height: max(560px, calc(100dvh - var(--header-h) - 150px)); font-size: 13px; color: var(--text); }
.tool-body.app:fullscreen .t-ds { height: calc(100dvh - 20px); }
.t-ds [hidden] { display: none !important; }
.t-ds *:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.t-ds .icon { width: 18px; height: 18px; flex: none; }
.t-ds button { font: inherit; color: inherit; }
.t-ds .ds-grow { flex: 1; min-width: 6px; }
.t-ds .ds-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.t-ds.ds-dim .ds-top, .t-ds.ds-dim .ds-pages, .t-ds.ds-dim .ds-status, .t-ds.ds-dim .ds-tools { opacity: .45; pointer-events: none; }

/* top: menus, standard bar, property bar */
.t-ds .ds-top { position: relative; z-index: 20; display: flex; flex-direction: column; min-width: 0; flex: none; }
.t-ds .ds-toprow { display: flex; align-items: center; min-width: 0; border-bottom: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(10px); flex: none; }
.t-ds .ds-menubar { display: flex; gap: 1px; padding: 2px 6px; min-width: 0; }
.t-ds .ds-topwrap { position: relative; }
.t-ds .ds-mtop { height: 28px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; cursor: pointer; }
.t-ds .ds-mtop:hover, .t-ds .ds-mtop[aria-expanded="true"] { background: var(--surface-3); }
.t-ds .ds-menu { position: absolute; top: 100%; left: 0; z-index: 30; min-width: 240px; max-width: min(340px, 90vw); max-height: min(70vh, 520px); overflow-y: auto; padding: 4px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow); }
.t-ds .ds-mi { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 24px; min-height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; }
.t-ds .ds-mi:hover:not(:disabled), .t-ds .ds-mi:focus-visible { background: var(--accent-soft); }
.t-ds .ds-mi:disabled { opacity: .4; cursor: default; }
.t-ds .ds-mi[aria-checked="true"] .ds-mi-l::before { content: "\\2713"; margin-right: 6px; color: var(--accent); }
.t-ds .ds-mi-k { color: var(--muted); font-size: 12px; white-space: nowrap; }
.t-ds .ds-msep { height: 1px; margin: 4px 6px; background: var(--border); }
.t-ds .ds-mhead { padding: 6px 10px 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.t-ds .ds-menubtn { display: none; align-items: center; gap: 6px; height: 34px; margin: 2px 6px; padding: 0 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2); cursor: pointer; }
.t-ds .ds-msheet { position: absolute; inset: 0; z-index: 40; overflow-y: auto; padding: 8px; background: var(--surface); }
.t-ds .ds-msheet-close { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 40px; padding: 0 12px; margin-bottom: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); cursor: pointer; font-weight: 600; }
.t-ds .ds-msheet-head { display: flex; width: 100%; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 12px; border: 0; border-bottom: 1px solid var(--border); background: transparent; font-weight: 600; cursor: pointer; }
.t-ds .ds-msheet-head[aria-expanded="true"] .icon { transform: rotate(180deg); }
.t-ds .ds-msheet-body { padding: 4px 4px 8px; }

.t-ds .ds-std, .t-ds .ds-prop { display: flex; align-items: center; gap: 3px; padding: 3px 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--border); flex: none; }
.t-ds .ds-std::-webkit-scrollbar, .t-ds .ds-prop::-webkit-scrollbar, .t-ds .ds-tabstrip::-webkit-scrollbar, .t-ds .ds-tools::-webkit-scrollbar { display: none; }
.t-ds .ds-prop { min-height: 36px; color: var(--text-2); }
.t-ds .ds-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; min-width: 30px; padding: 0 6px; border: 1px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; flex: none; white-space: nowrap; }
.t-ds .ds-btn:hover:not(:disabled) { background: var(--surface-3); }
.t-ds .ds-btn:disabled { opacity: .38; cursor: default; }
.t-ds .ds-zoomval { min-width: 54px; font-variant-numeric: tabular-nums; }
.t-ds .ds-sep { width: 1px; height: 20px; margin: 0 5px; background: var(--border); flex: none; }
.t-ds .ds-docname { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); padding: 0 8px; flex: 0 1 auto; }
.t-ds .ds-prop-t { white-space: nowrap; }
.t-ds .ds-unitlbl { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); flex: none; }
.t-ds .ds-units { height: 28px; min-height: 28px; width: auto; padding: 0 28px 0 8px; font-size: 13px; }

/* middle: toolbox and canvas */
.t-ds .ds-mid { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--ds-tool) minmax(0, 1fr); }
.t-ds .ds-tools { display: flex; flex-direction: column; gap: 4px; padding: 6px 4px; min-width: 0; overflow-y: auto; border-right: 1px solid var(--border); scrollbar-width: none; }
.t-ds .ds-tool { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border: 1px solid transparent; border-radius: 9px; background: transparent; cursor: pointer; }
.t-ds .ds-tool:hover { background: var(--surface-3); }
.t-ds .ds-tool[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.t-ds .ds-stage { position: relative; min-width: 0; min-height: 0; }
.t-ds .ds-view { position: absolute; inset: 0; overflow: hidden; background: var(--surface-3); touch-action: none; outline: none; user-select: none; -webkit-user-select: none; }
.t-ds .ds-view:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.t-ds .ds-view.ds-panning, .t-ds .ds-view.ds-panning * { cursor: grabbing !important; }
.t-ds .ds-view.ds-space { cursor: grab; }
.t-ds .ds-view > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: hidden; }
.t-ds .ds-ov { pointer-events: none; }
.t-ds .ds-paper { fill: #fff; }
.t-ds .ds-shadow { fill: rgba(10, 10, 30, .22); }
.t-ds .ds-layer.ds-locked, .t-ds [data-lock] { pointer-events: none; }
.t-ds .ds-wire path { fill: none; stroke: currentColor; stroke-width: 1px; vector-effect: non-scaling-stroke; }
.t-ds .ds-selbox { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 3; fill: none; }
.t-ds .ds-marquee { fill: color-mix(in srgb, var(--accent) 10%, transparent); stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; }
.t-ds .ds-empty { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--surface-3) 82%, transparent); backdrop-filter: blur(3px); }
.t-ds .ds-empty-card { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: min(440px, 100%); padding: 22px 20px; text-align: center; background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 16px; box-shadow: var(--shadow); }
.t-ds .ds-empty-card.drag { border-color: var(--accent); background: var(--accent-soft); }
.t-ds .ds-empty-card h3 { margin: 0; font-size: 17px; }
.t-ds .ds-empty-card p { margin: 0; color: var(--text-2); font-size: 13.5px; }
.t-ds .ds-empty-card .icon { width: 28px; height: 28px; color: var(--accent); }
.t-ds .ds-empty-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.t-ds .ds-busy { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--surface) 55%, transparent); }
.t-ds .ds-busy-card { display: flex; flex-direction: column; gap: 10px; width: min(360px, 100%); padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); }
.t-ds .ds-busy-t { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.t-ds .ds-busy-bar { height: 6px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.t-ds .ds-busy-bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.t-ds .ds-busy-bar.ind i { width: 35%; animation: ds-slide 1.1s ease-in-out infinite alternate; }
@keyframes ds-slide { from { margin-left: 0; } to { margin-left: 65%; } }
.t-ds .ds-dropnote { position: absolute; inset: 8px; z-index: 6; display: none; place-items: center; border: 2px dashed var(--accent); border-radius: 14px; background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent); font-weight: 600; pointer-events: none; }
.t-ds .ds-stage.ds-drag .ds-dropnote { display: grid; }

/* page tabs and status */
.t-ds .ds-pages { display: flex; align-items: center; gap: 2px; padding: 2px 6px 0; min-width: 0; border-top: 1px solid var(--border); flex: none; }
.t-ds .ds-tabstrip { display: flex; gap: 2px; min-width: 0; flex: 1; overflow-x: auto; scrollbar-width: none; }
.t-ds .ds-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0; background: transparent; cursor: pointer; white-space: nowrap; flex: none; color: var(--text-2); }
.t-ds .ds-tab:hover { background: var(--surface-3); }
.t-ds .ds-tab[aria-selected="true"] { background: var(--surface-2); border-color: var(--border); color: var(--text); font-weight: 600; }
.t-ds .ds-tab .spinner { width: 12px; height: 12px; border-width: 2px; }
.t-ds .ds-status { display: flex; align-items: center; gap: 12px; min-height: 26px; padding: 2px 10px; min-width: 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; flex: none; white-space: nowrap; overflow: hidden; }
.t-ds .ds-st-msg { overflow: hidden; text-overflow: ellipsis; min-width: 0; color: var(--text-2); }
.t-ds .ds-st-notes { border: 0; background: transparent; color: var(--accent); cursor: pointer; text-decoration: underline; padding: 0; font-size: 12px; }
.t-ds .ds-st-pos, .t-ds .ds-st-zoom { font-variant-numeric: tabular-nums; }

/* dialogs */
.t-ds-dlg { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 100%; }
.t-ds-dlg .ds-list { margin: 0; padding-left: 18px; font-size: 13.5px; display: flex; flex-direction: column; gap: 4px; }
.t-ds-dlg .ds-keys { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; font-size: 13px; max-height: 60vh; overflow-y: auto; }
.t-ds-dlg .ds-keys dt { color: var(--text-2); }
.t-ds-dlg .ds-keys dd { margin: 0; color: var(--muted); text-align: right; }

@media (max-width: 860px) {
  .t-ds .ds-menubar { display: none; }
  .t-ds .ds-menubtn { display: inline-flex; }
  .t-ds .ds-mid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .t-ds .ds-tools { order: 2; flex-direction: row; overflow-x: auto; overflow-y: hidden; border-right: 0; border-top: 1px solid var(--border); padding: 4px 6px; }
  .t-ds .ds-docname { display: none; }
  .t-ds .ds-st-pos { display: none; }
  .t-ds input, .t-ds select, .t-ds .ds-units { font-size: 16px; }
}
@media (pointer: coarse) {
  .t-ds .ds-btn, .t-ds .ds-tab { min-height: 36px; min-width: 36px; }
  .t-ds .ds-tool { width: 40px; height: 40px; }
  .t-ds .ds-mtop, .t-ds .ds-mi { min-height: 36px; }
}
@media (prefers-reduced-motion: reduce) { .t-ds *, .t-ds *::before { transition: none !important; animation-duration: .01ms !important; } }
`

let styled = false
/** Append the one <style id="ds-style"> (idempotent). */
export function ensureStyle() {
  if (styled && document.getElementById('ds-style')) return
  styled = true
  const el = document.createElement('style')
  el.id = 'ds-style'
  el.textContent = CSS
  document.head.append(el)
}
export const CSS_TEXT = CSS
