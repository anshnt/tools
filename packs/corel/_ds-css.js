// Draw Studio styles, injected once. Every selector starts with .t-ds. Dialogs (modal() appends its <dialog> to document.body, outside .t-ds)
// wrap their body in <div class="t-ds-dlg"> and use .t-ds-dlg rules. Colours come only from the site variables, so light and dark both work.
const CSS = `
.t-ds { --ds-tool: 44px; --ds-dock: 288px; --ds-pal: 34px; position: relative; display: flex; flex-direction: column; min-width: 0; max-width: 100%; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow);
  height: max(560px, calc(100dvh - var(--header-h) - 150px)); font-size: 13px; color: var(--text); }
.tool-body.app:fullscreen .t-ds { height: calc(100dvh - 20px); }
.t-ds [hidden] { display: none !important; }
.t-ds *:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.t-ds .icon { width: 18px; height: 18px; flex: none; }
.t-ds button { font: inherit; color: inherit; }
.t-ds .ds-grow { flex: 1; min-width: 6px; }
.t-ds .ds-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.t-ds.ds-dim .ds-top, .t-ds.ds-dim .ds-pages, .t-ds.ds-dim .ds-status, .t-ds.ds-dim .ds-tools, .t-ds.ds-dim .ds-dock, .t-ds.ds-dim .ds-palette { opacity: .45; pointer-events: none; }

/* top: menus, standard bar, property bar */
.t-ds .ds-top { position: relative; z-index: 20; display: flex; flex-direction: column; min-width: 0; flex: none; }
.t-ds .ds-toprow { display: flex; align-items: center; min-width: 0; border-bottom: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(10px); flex: none; }
.t-ds .ds-menubar { display: flex; gap: 1px; padding: 2px 6px; min-width: 0; }
.t-ds .ds-topwrap { position: relative; }
.t-ds .ds-mtop { height: 28px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; cursor: pointer; }
.t-ds .ds-mtop:hover, .t-ds .ds-mtop[aria-expanded="true"] { background: var(--surface-3); }
.t-ds .ds-menu { position: absolute; top: 100%; left: 0; z-index: 30; min-width: 280px; max-width: min(360px, 90vw); max-height: min(70vh, 520px); overflow-y: auto; padding: 4px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow); }
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
.t-ds .ds-units, .t-ds .ds-selsm { height: 28px; min-height: 28px; width: auto; padding: 0 28px 0 8px; font-size: 13px; }

/* middle: toolbox and canvas */
.t-ds .ds-mid { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--ds-tool) minmax(0, 1fr) var(--ds-dock) var(--ds-pal); grid-template-rows: minmax(0, 1fr); }
.t-ds.ds-nodock { --ds-dock: 0px; }
.t-ds .ds-tools { grid-column: 1; grid-row: 1; }
.t-ds .ds-stage { grid-column: 2; grid-row: 1; }
.t-ds .ds-dock { grid-column: 3; grid-row: 1; }
.t-ds .ds-palette { grid-column: 4; grid-row: 1; }
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

/* selection handles, snap lines (screen-space overlay) */
.t-ds .ds-h { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.t-ds .ds-hrot { fill: var(--accent); stroke: var(--surface); stroke-width: 1.5; }
.t-ds .ds-hskew { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.t-ds .ds-pivot { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.t-ds path.ds-pivot { fill: none; }
.t-ds .ds-snap { stroke: var(--danger); stroke-width: 1; stroke-dasharray: 3 3; }

/* property bar fields */
.t-ds .ds-selfields, .t-ds .ds-extra { display: flex; align-items: center; gap: 4px; flex: none; }
.t-ds .ds-pf { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
.t-ds .ds-num { width: 74px; height: 28px; min-height: 28px; padding: 0 6px; font-size: 13px; }

/* status bar swatches */
.t-ds .ds-st-paint { display: inline-flex; align-items: center; gap: 5px; flex: none; }
.t-ds .ds-st-sw { width: 18px; height: 18px; padding: 0; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--surface-3); cursor: pointer; }
.t-ds .ds-st-sw[data-kind="stroke"] { border-radius: 50%; }
.t-ds .ds-st-sw.none { background: linear-gradient(to top right, transparent 44%, var(--danger) 44%, var(--danger) 56%, transparent 56%), var(--surface); }
.t-ds .ds-st-sw.mixed { background: repeating-linear-gradient(45deg, var(--surface-3) 0 4px, var(--surface) 4px 8px); }
.t-ds .ds-st-sw.empty { opacity: .35; }
.t-ds .ds-st-w { font-variant-numeric: tabular-nums; }

/* colour palette */
.t-ds .ds-palette { display: flex; flex-direction: column; align-items: center; min-width: 0; min-height: 0; border-left: 1px solid var(--border); padding: 3px 0; gap: 3px; }
.t-ds .ds-pal-head { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: none; }
.t-ds .ds-sw { width: 14px; height: 14px; padding: 0; flex: none; border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; background: var(--surface); }
.t-ds .ds-sw:hover { outline: 2px solid var(--accent); outline-offset: 0; }
.t-ds .ds-sw-x { width: 26px; height: 18px; background: linear-gradient(to top right, transparent 44%, var(--danger) 44%, var(--danger) 56%, transparent 56%), var(--surface); }
.t-ds .ds-sw-grid { display: grid; grid-template-columns: repeat(2, 14px); gap: 2px; justify-content: center; align-content: start; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0; width: 100%; scrollbar-width: none; }
.t-ds .ds-sw-grid::-webkit-scrollbar { display: none; }
.t-ds .ds-pal-empty { grid-column: 1 / -1; font-size: 10px; color: var(--muted); text-align: center; }
.t-ds .ds-pal-tabs { display: flex; flex-direction: column; gap: 1px; flex: none; width: 100%; }
.t-ds .ds-pal-tab { border: 0; border-radius: 4px; background: transparent; font-size: 9px; height: 16px; padding: 0; cursor: pointer; color: var(--muted); }
.t-ds .ds-pal-tab[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.t-ds .ds-chip, .t-ds .ds-pal-more { display: none; }

/* dockers */
.t-ds .ds-dock { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid var(--border); background: var(--surface); }
.t-ds .ds-dock-grip, .t-ds .ds-dock-head { display: none; }
.t-ds .ds-dock-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
.t-ds .ds-dsec { display: flex; flex-direction: column; min-height: min-content; flex: 1 1 auto; border-bottom: 1px solid var(--border); }
.t-ds .ds-dsec-head { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 30px; padding: 0 10px; border: 0; background: var(--surface-2); font-weight: 600; cursor: pointer; flex: none; }
.t-ds .ds-dsec-head[aria-expanded="false"] .icon { transform: rotate(-90deg); }
.t-ds .ds-dsec-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.t-ds .ds-obj { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.t-ds .ds-obj-bar { display: flex; align-items: center; gap: 2px; padding: 3px 6px; border-bottom: 1px solid var(--border); flex: none; min-width: 0; }
.t-ds .ds-tolayer { height: 28px; min-height: 28px; width: auto; max-width: 130px; padding: 0 24px 0 6px; font-size: 12px; }
.t-ds .ds-tree { flex: 1; min-height: 80px; overflow: auto; padding: 4px; }
.t-ds .ds-row { display: flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 4px 0 calc(2px + var(--d, 0) * 14px); border-radius: 6px; cursor: pointer; user-select: none; -webkit-user-select: none; white-space: nowrap; }
.t-ds .ds-row:hover { background: var(--surface-3); }
.t-ds .ds-row.ds-sel { background: var(--accent-soft); }
.t-ds .ds-r-layer { font-weight: 600; }
.t-ds .ds-r-page { font-weight: 700; margin-top: 2px; }
.t-ds .ds-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.t-ds .ds-rename { flex: 1; min-width: 0; height: 24px; min-height: 24px; padding: 0 6px; font-size: 13px; }
.t-ds .ds-off .ds-name { opacity: .5; }
.t-ds .ds-twisty { width: 18px; height: 18px; padding: 0; border: 0; background: transparent; display: grid; place-items: center; flex: none; cursor: pointer; }
.t-ds .ds-twisty .icon { width: 14px; height: 14px; }
.t-ds .ds-twisty-none { cursor: default; }
.t-ds .ds-eye, .t-ds .ds-lock { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; display: grid; place-items: center; flex: none; cursor: pointer; color: var(--text-2); }
.t-ds .ds-eye:hover, .t-ds .ds-lock:hover { background: var(--surface-3); }
.t-ds .ds-lock[aria-pressed="false"] { opacity: .4; }
.t-ds .ds-eye .icon, .t-ds .ds-lock .icon { width: 15px; height: 15px; }
.t-ds .ds-more-b { width: 100%; min-height: 26px; border: 1px dashed var(--border-strong); border-radius: 6px; background: transparent; color: var(--accent); cursor: pointer; }
.t-ds .ds-drop-above { box-shadow: inset 0 2px 0 var(--accent); }
.t-ds .ds-drop-below { box-shadow: inset 0 -2px 0 var(--accent); }
.t-ds .ds-drop-into { outline: 2px solid var(--accent); outline-offset: -2px; }
.t-ds .ds-panelsbtn { display: none; align-items: center; gap: 6px; height: 34px; margin: 2px 6px 2px 0; padding: 0 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2); cursor: pointer; }

/* colour dialog */
.t-ds-dlg .ds-cd-prev { display: flex; gap: 14px; }
.t-ds-dlg .ds-cd-sw { display: block; width: 96px; height: 38px; margin-top: 2px; border: 1px solid var(--border-strong); border-radius: 8px; }
.t-ds-dlg .ds-cd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 14px; }
.t-ds-dlg .ds-cd-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.t-ds-dlg .ds-cd-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) 64px; gap: 8px; align-items: center; }
.t-ds-dlg .ds-cd-row input[type="number"] { width: 100%; min-width: 0; }
.t-ds-dlg .ds-cd-l { font-weight: 600; color: var(--text-2); }
.t-ds-dlg .ds-cd-hex { display: flex; align-items: center; gap: 10px; }
.t-ds-dlg .ds-cd-hex input { width: 110px; }

/* text editing, page tabs, context bars, restore banner */
.t-ds .ds-textedit { position: absolute; left: 0; top: 0; z-index: 4; margin: 0; padding: 0; border: 0; outline: 0; resize: none; overflow: hidden; background: transparent; color: transparent; caret-color: var(--accent); white-space: pre; transform-origin: 0 0; box-sizing: border-box; font-synthesis: none; user-select: text; -webkit-user-select: text; }
.t-ds .ds-textedit::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); color: transparent; }
.t-ds .ds-draft { pointer-events: none; }
.t-ds .ds-fam { max-width: 140px; }
.t-ds .ds-textbar .ds-num { width: 62px; }
.t-ds .ds-preset { max-width: 96px; }
.t-ds .ds-btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.t-ds .ds-pages .ds-sep { margin: 0 3px; }
.t-ds .ds-tab-input { width: 130px; height: 24px; min-height: 24px; padding: 0 6px; font-size: 13px; }
.t-ds .ds-tab.ds-drop-before { box-shadow: inset 2px 0 0 var(--accent); }
.t-ds .ds-tab.ds-drop-after { box-shadow: inset -2px 0 0 var(--accent); }
.t-ds .ds-restore { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 10px 12px; text-align: left; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 12px; background: var(--accent-soft); }
.t-ds .ds-restore p { margin: 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }

/* drawing tools, node editing and arrange dockers */
.t-ds .ds-draftp { fill: color-mix(in srgb, var(--accent) 14%, transparent); stroke: var(--accent); stroke-width: 1.5; }
.t-ds .ds-draftl { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.t-ds .ds-node { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.t-ds .ds-node.ds-picked { fill: var(--accent); }
.t-ds .ds-node.ds-first { stroke: var(--danger); }
.t-ds .ds-hline { fill: none; stroke: var(--accent); stroke-width: 1; }
.t-ds .ds-hdl { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.t-ds .ds-dsec-shut { flex: none; min-height: 0; }
.t-ds .ds-dsec[data-section="align"], .t-ds .ds-dsec[data-section="transform"] { flex: none; }
.t-ds .ds-xpanel { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; min-width: 0; }
.t-ds .ds-xhead { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.t-ds .ds-xradio, .t-ds .ds-xtabs { display: flex; flex-wrap: wrap; gap: 4px; }
.t-ds .ds-xchip { height: 26px; padding: 0 10px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface-2); cursor: pointer; font-size: 12px; }
.t-ds .ds-xchip[aria-pressed="true"], .t-ds .ds-xchip[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.t-ds .ds-xgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.t-ds .ds-xbtn { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); cursor: pointer; text-align: left; min-width: 0; }
.t-ds .ds-xbtn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.t-ds .ds-xbtn:hover:not(:disabled) { background: var(--surface-3); }
.t-ds .ds-xbtn:disabled { opacity: .4; cursor: default; }
.t-ds .ds-xleave { display: flex; flex-direction: column; gap: 4px; }
.t-ds .ds-xrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.t-ds .ds-xname { width: 62px; font-weight: 600; }
.t-ds .ds-xcheck { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-2); }
.t-ds .ds-xnote { margin: 0; font-size: 11.5px; color: var(--muted); }
.t-ds .ds-xmain { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
.t-ds .ds-xrefs { display: grid; grid-template-columns: repeat(3, 18px); gap: 3px; flex: none; margin-top: 4px; }
.t-ds .ds-xref { width: 18px; height: 18px; padding: 0; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--surface); cursor: pointer; }
.t-ds .ds-xref[aria-checked="true"] { background: var(--accent); border-color: var(--accent); }
.t-ds .ds-xpanels { flex: 1; min-width: 0; }
.t-ds .ds-xfields { display: flex; flex-direction: column; gap: 6px; }
.t-ds .ds-xfields .ds-pf { justify-content: space-between; }
.t-ds .ds-xapply { display: flex; gap: 6px; flex-wrap: wrap; }
.t-ds .ds-nodeinfo { font-variant-numeric: tabular-nums; }

/* rulers, guides, grid, wireframe, snap chips */
.t-ds .ds-stage.ds-rulers .ds-view { inset: 20px 0 0 20px; }
.t-ds .ds-ruler { position: absolute; z-index: 3; display: block; background: var(--surface-2); touch-action: none; }
.t-ds .ds-ruler-h { left: 20px; top: 0; right: 0; height: 20px; width: calc(100% - 20px); cursor: s-resize; }
.t-ds .ds-ruler-v { left: 0; top: 20px; bottom: 0; width: 20px; height: calc(100% - 20px); cursor: e-resize; }
.t-ds .ds-corner { position: absolute; z-index: 3; left: 0; top: 0; width: 20px; height: 20px; display: grid; place-items: center; overflow: hidden; font-size: 8px; color: var(--muted); background: var(--surface-2); border-right: 1px solid var(--border-strong); border-bottom: 1px solid var(--border-strong); }
.t-ds .ds-guide { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 6 3; stroke-opacity: .85; }
.t-ds .ds-guide-sel { stroke-width: 2; stroke-dasharray: none; }
.t-ds .ds-guide-out { stroke: var(--danger); stroke-opacity: .5; }
.t-ds .ds-grid { stroke: var(--border-strong); stroke-width: 1; stroke-opacity: .5; fill: none; }
.t-ds .ds-wire { color: #1a1a2e; }
.t-ds .ds-wire image { opacity: .3; }
.t-ds .ds-wire text { fill: #1a1a2e !important; }
.t-ds .ds-snapchips { display: inline-flex; align-items: center; gap: 3px; flex: none; color: var(--muted); }
.t-ds .ds-snapchips .icon { width: 15px; height: 15px; }
.t-ds .ds-schip { height: 24px; padding: 0 9px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); cursor: pointer; font-size: 12px; }
.t-ds .ds-schip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.t-ds .ds-snap-off .ds-schip { opacity: .45; }
.t-ds .ds-ctxmenu { z-index: 45; }
.t-ds.ds-hide-palette .ds-palette, .t-ds.ds-hide-toolbox .ds-tools { display: none; }
.t-ds.ds-hide-palette { --ds-pal: 0px; }
.t-ds.ds-hide-toolbox { --ds-tool: 0px; }

/* interactive fill, transparency, properties */
.t-ds .ds-fillline { stroke-width: 1.5; }
.t-ds .ds-fillring { stroke-dasharray: 3 3; fill: none; }
.t-ds .ds-stopm { stroke: var(--surface); stroke-width: 2; paint-order: stroke; }
.t-ds .ds-stopm.ds-picked { stroke: var(--accent); stroke-width: 3; }
.t-ds .ds-kinds { display: inline-flex; gap: 2px; flex: none; }
.t-ds .ds-kindbtn { padding: 0 9px; }
.t-ds .ds-colorin, .t-ds-dlg .ds-colorin { width: 36px; height: 28px; padding: 0 2px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); cursor: pointer; flex: none; }
.t-ds-dlg .ds-colorin { width: 56px; height: 34px; }
.t-ds .ds-range { width: 150px; flex: none; height: 28px; }
.t-ds .ds-rangeout { min-width: 44px; font-variant-numeric: tabular-nums; }
.t-ds .ds-pr-sum { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.t-ds .ds-props .ds-xrow { flex-wrap: nowrap; }
.t-ds .ds-props .ds-range { width: 100%; flex: 1; min-width: 0; }
.t-ds .ds-props .ds-kinds { flex-wrap: wrap; }
.t-ds .ds-dsec[data-section="properties"] { flex: none; }

/* shortcuts sheet and command finder */
.t-ds-dlg .ds-finder { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow-y: auto; }
.t-ds-dlg .ds-fr { display: flex; justify-content: space-between; align-items: center; gap: 16px; min-height: 36px; padding: 4px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.t-ds-dlg .ds-fr:hover, .t-ds-dlg .ds-fr:focus-visible { background: var(--accent-soft); }
.t-ds-dlg .ds-fr-l { min-width: 0; overflow-wrap: anywhere; }
.t-ds-dlg .ds-fr-l small { margin-left: 8px; color: var(--muted); }
.t-ds-dlg .ds-fr-k { color: var(--muted); font-size: 12px; white-space: nowrap; }
.t-ds-dlg .ds-fr-off { opacity: .5; }
.t-ds-dlg .ds-mouse { max-height: none; }

/* dialogs */
.t-ds-dlg { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 100%; }
.t-ds-dlg .ds-list { margin: 0; padding-left: 18px; font-size: 13.5px; display: flex; flex-direction: column; gap: 4px; }
.t-ds-dlg .ds-keys { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; font-size: 13px; max-height: 60vh; overflow-y: auto; }
.t-ds-dlg .ds-keys dt { color: var(--text-2); }
.t-ds-dlg .ds-keys dd { margin: 0; color: var(--muted); text-align: right; }
.t-ds-dlg .ds-form { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.t-ds-dlg .ds-form-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; min-width: 0; }
.t-ds-dlg .ds-form-row.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.t-ds-dlg .ds-form-row > * { min-width: 0; }
.t-ds-dlg .ds-export { min-width: min(520px, 100%); }
.t-ds-dlg .ds-fmt-desc { margin: 0; }
@media (max-width: 520px) { .t-ds-dlg .ds-form-row, .t-ds-dlg .ds-form-row.three { grid-template-columns: minmax(0, 1fr); } }

@media (max-width: 860px) {
  .t-ds .ds-menubar { display: none; }
  .t-ds .ds-menubtn { display: inline-flex; }
  .t-ds .ds-panelsbtn { display: inline-flex; }
  .t-ds .ds-dockbtn { display: none; }
  .t-ds .ds-mid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto auto; }
  .t-ds .ds-stage { grid-column: 1; grid-row: 1; }
  .t-ds .ds-tools { grid-column: 1; grid-row: 2; flex-direction: row; overflow-x: auto; overflow-y: hidden; border-right: 0; border-top: 1px solid var(--border); padding: 4px 6px; }
  .t-ds .ds-palette { grid-column: 1; grid-row: 3; flex-direction: row; align-items: center; width: auto; border-left: 0; border-top: 1px solid var(--border); padding: 3px 6px; gap: 6px; }
  .t-ds .ds-pal-head { flex-direction: row; }
  .t-ds .ds-sw { width: 36px; height: 36px; border-radius: 6px; }
  .t-ds .ds-sw-x { width: 36px; height: 36px; }
  .t-ds .ds-sw-grid { display: flex; flex-wrap: nowrap; justify-content: flex-start; align-items: center; overflow-x: auto; overflow-y: hidden; min-width: 0; width: auto; gap: 4px; }
  .t-ds .ds-pal-tabs { flex-direction: row; width: auto; }
  .t-ds .ds-pal-tab { height: 36px; min-width: 44px; font-size: 12px; padding: 0 6px; border: 1px solid var(--border); background: var(--surface-2); }
  .t-ds .ds-pal-tab[aria-selected="false"] { display: none; }
  .t-ds .ds-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 60px; height: 36px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 18px; background: var(--surface-2); cursor: pointer; flex: none; font-weight: 600; }
  .t-ds .ds-chip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .t-ds .ds-pal-more { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); cursor: pointer; flex: none; }
  .t-ds .ds-dock { position: absolute; left: 0; right: 0; bottom: 0; z-index: 35; height: min(62%, 420px); border-left: 0; border-top: 1px solid var(--border-strong); border-radius: 14px 14px 0 0; box-shadow: 0 -6px 24px rgba(0, 0, 0, .2); }
  .t-ds .ds-dock-grip { display: block; width: 44px; height: 4px; margin: 6px auto 2px; border-radius: 2px; background: var(--border-strong); flex: none; }
  .t-ds .ds-dock-head { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 4px 12px; flex: none; }
  .t-ds .ds-dock-title { font-weight: 600; }
  .t-ds .ds-docname { display: none; }
  .t-ds .ds-snapchips { display: none; }
  .t-ds .ds-colorin { height: 36px; width: 44px; }
  .t-ds .ds-range { width: 120px; height: 36px; }
  .t-ds .ds-st-pos { display: none; }
  .t-ds .ds-st-w { display: none; }
  .t-ds input, .t-ds select, .t-ds .ds-units, .t-ds .ds-selsm, .t-ds .ds-num, .t-ds .ds-tolayer, .t-ds .ds-rename, .t-ds .ds-tab-input { font-size: 16px; }
  .t-ds .ds-num { height: 36px; min-height: 36px; width: 84px; }
  .t-ds .ds-row { min-height: 36px; }
  .t-ds .ds-eye, .t-ds .ds-lock { width: 36px; height: 36px; }
  .t-ds .ds-twisty { width: 36px; height: 36px; }
  .t-ds .ds-obj-bar .ds-btn { min-width: 36px; height: 36px; }
  .t-ds .ds-tolayer { height: 36px; min-height: 36px; }
  .t-ds .ds-st-sw { width: 22px; height: 22px; }
  .t-ds .ds-btn, .t-ds .ds-tab { min-height: 36px; min-width: 36px; }
  .t-ds .ds-units, .t-ds .ds-selsm { height: 36px; min-height: 36px; }
  .t-ds .ds-dsec-head, .t-ds .ds-dock-close { min-height: 36px; }
  .t-ds .ds-xchip, .t-ds .ds-xbtn { min-height: 36px; }
  .t-ds .ds-xref { width: 36px; height: 36px; }
  .t-ds .ds-xrefs { grid-template-columns: repeat(3, 36px); }
  .t-ds .ds-xcheck { min-height: 36px; }
  .t-ds .ds-xapply .btn { min-height: 36px; }
}
@media (pointer: coarse) {
  .t-ds .ds-btn, .t-ds .ds-tab { min-height: 36px; min-width: 36px; }
  .t-ds .ds-tool { width: 40px; height: 40px; }
  .t-ds .ds-mtop, .t-ds .ds-mi { min-height: 36px; }
  .t-ds .ds-eye, .t-ds .ds-lock { width: 36px; height: 36px; }
  .t-ds .ds-sw { width: 24px; height: 24px; }
  .t-ds .ds-sw-grid { grid-template-columns: repeat(2, 24px); }
}
@media (min-width: 861px) {
  .t-ds { --ds-tool: 80px; }
  .t-ds .ds-tools { display: grid; grid-template-columns: repeat(2, max-content); justify-content: center; align-content: start; overflow-x: hidden; }
}
@media (min-width: 861px) and (pointer: coarse) { .t-ds { --ds-tool: 92px; } }
@media (min-width: 861px) and (pointer: fine) {
  .t-ds .ds-tools { gap: 2px; }
  .t-ds .ds-tool { width: 34px; height: 32px; }
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
