// Styles for Audio Studio, injected once and scoped under .as. Colors come from the site's CSS variables so light and dark both work.
const CSS = `
.as { --rail: 46px; --insp: 316px; --hw: 218px; --ph: #f43f5e; position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr);
  height: clamp(620px, calc(100dvh - var(--header-h) - 200px), 1000px); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-2); box-shadow: var(--shadow);
  font-size: 13px; color: var(--text); outline: none; -webkit-user-select: none; user-select: none; }
.tool-body.app:fullscreen .as { height: calc(100dvh - 24px); }
.as button { font-family: inherit; }
.as-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 9px 10px; border-bottom: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.as-grp { display: flex; align-items: center; gap: 2px; padding: 3px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; }
.as-sp { flex: 1 1 auto; }
.as-b { position: relative; flex: none; display: inline-grid; place-items: center; grid-auto-flow: column; gap: 6px; min-width: 34px; height: 34px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--text-2); cursor: pointer; transition: background .15s, color .15s, transform .1s; }
.as-b.wide { padding: 0 10px; font-size: 13px; font-weight: 550; }
.as-b .icon { width: 18px; height: 18px; }
.as-b:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
.as-b:active:not(:disabled) { transform: scale(.93); }
.as-b:disabled { opacity: .38; cursor: not-allowed; }
.as-b:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.as-b[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.as-b.play { background: var(--accent); color: var(--accent-text); }
.as-b.play:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
.as-b.rec { color: #ef4444; }
.as-b.rec[aria-pressed="true"] { background: #ef4444; color: #fff; animation: as-pulse 1.3s ease-in-out infinite; }
.as-b.sm { min-width: 28px; height: 28px; }
.as-b.danger:hover:not(:disabled) { color: var(--danger); background: var(--danger-soft); }
@keyframes as-pulse { 50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, .22); } }
.as [data-tip]::after { content: attr(data-tip); display: none; position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); padding: 5px 9px; border-radius: 7px; background: var(--text); color: var(--bg);
  font-size: 11.5px; font-weight: 500; line-height: 1.2; white-space: nowrap; pointer-events: none; z-index: 90; }
.as [data-tip]:hover::after, .as [data-tip]:focus-visible::after { display: block; animation: as-tip .14s .35s both; }
@keyframes as-tip { from { opacity: 0; } to { opacity: 1; } }
.as [data-tip-pos="right"]::after { left: calc(100% + 8px); top: 50%; transform: translateY(-50%); }
.as [data-tip-pos="up"]::after { top: auto; bottom: calc(100% + 8px); }
.as [data-tip-pos="end"]::after { left: auto; right: 0; transform: none; }
.as [data-tip-pos="up-end"]::after { top: auto; bottom: calc(100% + 8px); left: auto; right: 0; transform: none; }
@media (hover: none) { .as [data-tip]::after { display: none; } }
.as-clock { display: grid; gap: 0; min-width: 124px; padding: 4px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); text-align: left; cursor: pointer; position: relative; color: var(--text); }
.as-clock b { font: 600 20px/1.1 var(--mono); letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.as-clock small { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.as-fld { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.as-in, .as select.select, .as .input, .as .select { height: 32px; min-height: 0; padding: 0 9px; border-radius: 9px; font-size: 13px; }
.as .select { padding-right: 28px; background-position: right 8px center; min-width: 98px; }
.as-in { width: 54px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: var(--mono); }
.as-in::-webkit-inner-spin-button { appearance: none; margin: 0; }
.as-in { -moz-appearance: textfield; appearance: textfield; }
.as-in:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.as-meter { position: relative; display: block; width: 128px; height: 34px; border-radius: 9px; cursor: pointer; background: var(--surface-2); border: 1px solid var(--border); }
.as-meter canvas { display: block; width: 100%; height: 100%; border-radius: 8px; }
.as input.as-vol { width: 72px; min-width: 0; margin: 0; }
.as-main { display: grid; grid-template-columns: var(--rail) minmax(0, 1fr) var(--insp); min-height: 0; }
.as.no-insp .as-main { grid-template-columns: var(--rail) minmax(0, 1fr); }
.as.no-insp .as-insp { display: none; }
.as-rail { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; border-right: 1px solid var(--border); background: var(--surface); overflow-y: auto; scrollbar-width: none; }
.as-sep { flex: none; width: 24px; height: 1px; margin: 5px 0; background: var(--border); }
.as-tl { position: relative; display: grid; grid-template-columns: var(--hw) minmax(0, 1fr); grid-template-rows: 34px minmax(0, 1fr); min-width: 0; min-height: 0; background: var(--bg-2); }
.as-corner { grid-area: 1 / 1; display: flex; align-items: center; gap: 4px; padding: 0 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface); }
.as-corner .add { flex: 1; height: 26px; border: 1px dashed var(--border-strong); border-radius: 8px; background: transparent; color: var(--text-2); font-size: 12px; font-weight: 550; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; }
.as-corner .add:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.as-corner .icon { width: 14px; height: 14px; }
.as-ruler { grid-area: 1 / 2; position: relative; overflow: hidden; cursor: pointer; touch-action: none; background: var(--surface); }
.as-ruler canvas { display: block; }
.as-rph { position: absolute; left: 0; top: 0; bottom: 0; width: 0; pointer-events: none; z-index: 2; }
.as-rph::before { content: ""; position: absolute; left: -.5px; top: 12px; bottom: 0; width: 1px; background: var(--ph); }
.as-rph::after { content: ""; position: absolute; left: -6px; top: 12px; border: 6px solid transparent; border-top: 9px solid var(--ph); border-bottom: 0; }
.as-heads { grid-area: 2 / 1; overflow: hidden; border-right: 1px solid var(--border); background: var(--surface); }
.as-scroll { grid-area: 2 / 2; position: relative; overflow: auto; overscroll-behavior: contain; min-width: 0; min-height: 0; }
.as-scroll:focus { outline: none; }
.as-content { position: relative; }
.as-canvas { position: sticky; left: 0; top: 0; display: block; }
.as-playhead { position: absolute; left: 0; top: 0; width: 0; z-index: 3; pointer-events: none; will-change: transform; }
.as-playhead i { position: absolute; left: -1px; top: 0; bottom: 0; width: 2px; background: var(--ph); box-shadow: 0 0 8px rgba(244, 63, 94, .5); }
.as-range { position: absolute; z-index: 2; pointer-events: none; background: color-mix(in srgb, var(--accent) 16%, transparent); border-left: 1px solid var(--accent); border-right: 1px solid var(--accent); }
.as-loopband { position: absolute; top: 0; pointer-events: none; background: color-mix(in srgb, var(--accent-2) 7%, transparent); }
.as-empty { grid-area: 2 / 2; z-index: 5; place-self: center; width: min(440px, calc(100% - 28px)); padding: 18px; border-radius: 18px; background: color-mix(in srgb, var(--surface) 92%, transparent); border: 1px solid var(--border);
  box-shadow: var(--shadow-lg); backdrop-filter: blur(10px); display: grid; gap: 12px; text-align: center; }
.as-empty h3 { margin: 0; font-size: 17px; letter-spacing: -.01em; }
.as-empty p { margin: 0; color: var(--muted); font-size: 13px; }
.as-empty .row { justify-content: center; }
.as-insp { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); background: var(--surface); }
.as-tabs { display: flex; gap: 2px; padding: 8px 8px 0; border-bottom: 1px solid var(--border); }
.as-tab { flex: 1; height: 34px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font-weight: 600; font-size: 13px; cursor: pointer; border-radius: 8px 8px 0 0; }
.as-tab:hover { color: var(--text); background: var(--surface-2); }
.as-tab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.as-ib { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: grid; gap: 12px; align-content: start; user-select: text; }
.as-ib .field { gap: 4px; }
.as-ib .field-label { font-size: 12px; }
.as-ib input[type="range"] { width: 100%; }
.as-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.as-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.as-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.as-sw { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; }
.as-sw[aria-pressed="true"] { border-color: var(--text); box-shadow: 0 0 0 2px var(--surface) inset; }
.as-fx { border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
.as-fx > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px 7px 12px; }
.as-fx > header .switch { font-weight: 600; font-size: 13px; }
.as-fx.on { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.as-fx .body { padding: 2px 12px 12px; display: grid; gap: 10px; }
.as-fx.closed .body { display: none; }
.as-fx .chev { transition: transform .2s; }
.as-fx.closed .chev { transform: rotate(-90deg); }
.as-mini { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.as-kv { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size: 12.5px; color: var(--text-2); }
.as-kv b { font-family: var(--mono); font-weight: 500; color: var(--text); }
.as-note { font-size: 12px; color: var(--muted); line-height: 1.45; }
.as-head { position: relative; height: var(--th); padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; justify-content: center; gap: 6px; cursor: pointer; background: var(--surface); }
.as-head::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--c); }
.as-head[aria-selected="true"] { background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
.hd-top { display: flex; align-items: center; gap: 2px; }
.hd-name { min-width: 0; flex: 1; height: 24px; padding: 0 5px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text); font: 650 13px var(--font); text-overflow: ellipsis; }
.hd-name:hover { border-color: var(--border); }
.hd-name:focus { outline: none; border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--ring); }
.hd-btns { display: flex; gap: 4px; align-items: center; }
.hd-t { width: 28px; height: 24px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text-2); font: 700 11px var(--font); cursor: pointer; padding: 0; display: inline-grid; place-items: center; }
.hd-t:hover { border-color: var(--border-strong); color: var(--text); }
.hd-t[aria-pressed="true"].m { background: #f59e0b; border-color: transparent; color: #111; }
.hd-t[aria-pressed="true"].s { background: #3b82f6; border-color: transparent; color: #fff; }
.hd-t[aria-pressed="true"].r { background: #ef4444; border-color: transparent; color: #fff; }
.hd-t[aria-pressed="true"].f { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.hd-t .icon { width: 13px; height: 13px; }
.hd-sl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.hd-sl input[type="range"] { width: 100%; min-width: 0; margin: 0; }
.hd-meter { height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; }
.hd-meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #22c55e, #eab308 75%, #ef4444); transition: width .05s linear; }
.as-head[data-size="s"] .hd-sl { display: none; }
.as-status { display: flex; align-items: center; gap: 14px; padding: 3px 8px 3px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); background: var(--surface); border-radius: 0 0 var(--radius-lg) var(--radius-lg); min-height: 30px; }
.as-status .sp { flex: 1; }
.as-status .as-grp { padding: 1px; border-radius: 9px; }
.as-status .sel { color: var(--text-2); font-variant-numeric: tabular-nums; }
.as-empty[hidden], .as-busy[hidden] { display: none; }
.as-busy { position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 70; display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-radius: 999px; background: var(--text); color: var(--bg); box-shadow: var(--shadow-lg); font-size: 13px; max-width: calc(100% - 24px); }
.as-busy .spinner { border-color: color-mix(in srgb, var(--bg) 30%, transparent); border-top-color: var(--bg); }
.as-menu { position: absolute; z-index: 80; min-width: 230px; padding: 6px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg); animation: dlg-in .16s var(--ease); }
.as-mi { display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 13px; cursor: pointer; text-align: left; }
.as-mi:hover:not(:disabled), .as-mi:focus-visible { background: var(--surface-2); outline: none; }
.as-mi:disabled { opacity: .4; cursor: not-allowed; }
.as-mi .icon { width: 16px; height: 16px; color: var(--muted); }
.as-mi kbd { margin-left: auto; font: 11px var(--mono); color: var(--muted); }
.as-mi.sep { height: 1px; padding: 0; margin: 5px 4px; background: var(--border); cursor: default; }
.as-credit { margin: 10px 4px 0; font-size: 12.5px; color: var(--muted); }
.as-credit a { color: var(--accent); }
.as-keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 13px; }
.as-keys kbd { font: 12px var(--mono); padding: 1px 7px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 6px; background: var(--surface-2); justify-self: start; }
.as-tpl { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.as-tpl button { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); text-align: left; cursor: pointer; color: var(--text); }
.as-tpl button:hover { border-color: var(--accent); background: var(--accent-soft); }
.as-tpl b { font-size: 14px; }
.as-tpl span { font-size: 12px; color: var(--muted); }
@media (max-width: 900px) {
  .as { --insp: 280px; --hw: 176px; }
}
@media (max-width: 760px) {
  .as { --hw: 112px; height: clamp(560px, calc(100dvh - 120px), 900px); }
  .as-bar { gap: 6px; padding: 7px; }
  .as-clock { min-width: 94px; padding: 3px 8px; }
  .as-clock b { font-size: 16px; }
  .as-meter { width: 62px; }
  .as-vol, .as-grp.tempo { display: none; }
  .as-b.wide span { display: none; }
  .as-b { min-width: 31px; height: 32px; }
  .as-sp { display: none; }
  .as-grp.file { order: 1; } .as-bar > .as-grp:nth-child(2) { order: 2; } .as-bar > .as-b { order: 3; } .as-bar > .btn { order: 4; margin-left: auto; }
  .as-grp.tr { order: 5; } .as-clock { order: 6; } .as-meter { order: 7; }
  .as-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .as.no-insp .as-main { grid-template-columns: minmax(0, 1fr); }
  .as-rail { flex-direction: row; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; padding: 4px 8px; justify-content: flex-start; }
  .as-sep { width: 1px; height: 24px; margin: 0 5px; }
  .as-insp { position: absolute; left: 0; right: 0; bottom: 30px; z-index: 40; max-height: 64%; border-left: 0; border-top: 1px solid var(--border-strong); border-radius: 16px 16px 0 0; box-shadow: 0 -20px 50px -24px rgba(0, 0, 0, .5); }
  .as-head { padding-left: 11px; padding-right: 5px; gap: 5px; }
  .hd-sl { display: none; }
  .hd-more { display: none; }
  .as-status .hint { display: none; }
  .as-corner .add span { display: none; }
}
@media (prefers-reduced-motion: reduce) { .as-b.rec[aria-pressed="true"] { animation: none; } .as-b, .as-fx .chev, .hd-meter i { transition: none; } }
`
let injected = false
export function injectStyle() {
  if (injected && document.getElementById('as-style')) return
  injected = true
  const s = document.createElement('style')
  s.id = 'as-style'
  s.textContent = CSS
  document.head.append(s)
}
