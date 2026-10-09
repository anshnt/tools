// Styles for Video Studio, scoped under .vs (one <style> tag, removed when the tool is left). Colors come from the site's CSS variables.
const CSS = `
.vs { --vs-video:#3b82f6; --vs-image:#14b8a6; --vs-title:#f59e0b; --vs-audio:#22c55e; --head:136px; --tl-h:clamp(262px, 36vh, 330px);
  display:grid; grid-template-rows:auto minmax(0,1fr) var(--tl-h) auto; gap:8px; min-width:0;
  height:clamp(680px, calc(100dvh - 118px), 1100px); }
.tool-body.app:fullscreen .vs { height:calc(100dvh - 20px); }
.vs *:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.vs-panel { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow-sm); min-width:0; min-height:0; overflow:hidden; display:flex; flex-direction:column; }
.vs-bar { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; padding:6px 8px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow-sm); position:relative; z-index:20; }
.vs-bar .btn { flex:none; }
.vs-name { width:170px; max-width:100%; height:34px; padding:0 10px; font-weight:600; border-radius:10px; border:1px solid transparent; background:transparent; color:var(--text); min-width:0; }
.vs-name:hover { border-color:var(--border); } .vs-name:focus { border-color:var(--accent); background:var(--surface-2); outline:none; }
.vs-sep { width:1px; height:22px; background:var(--border); margin:0 3px; flex:none; }
.vs-grow { flex:1 1 8px; min-width:0; }
.vs-status { font-size:12px; color:var(--muted); display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.vs-status i { width:7px; height:7px; border-radius:50%; background:var(--success); display:inline-block; }
.vs-status.saving i { background:var(--warning); }
.vs [data-tip] { position:relative; }
.vs [data-tip]:hover::after, .vs [data-tip]:focus-visible::after { content:attr(data-tip); position:absolute; z-index:60; top:calc(100% + 7px); left:50%; transform:translateX(-50%); white-space:nowrap; background:var(--text); color:var(--bg);
  font:500 12px/1 var(--font); padding:6px 8px; border-radius:7px; pointer-events:none; box-shadow:var(--shadow); }
.vs [data-tip-pos="t"]:hover::after, .vs [data-tip-pos="t"]:focus-visible::after { top:auto; bottom:calc(100% + 7px); }
.vs [data-tip-pos="r"]:hover::after, .vs [data-tip-pos="r"]:focus-visible::after { top:50%; left:calc(100% + 8px); transform:translateY(-50%); }
.vs [data-tip-pos="l"]:hover::after, .vs [data-tip-pos="l"]:focus-visible::after { top:50%; left:auto; right:calc(100% + 8px); transform:translateY(-50%); }
@media (hover:none) { .vs [data-tip]:hover::after { display:none; } }
.vs-seg { display:inline-flex; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:2px; gap:2px; }
.vs-seg button { border:0; background:transparent; color:var(--text-2); height:28px; padding:0 9px; border-radius:8px; font-size:12.5px; font-weight:550; cursor:pointer; display:inline-flex; align-items:center; gap:5px; min-width:32px; justify-content:center; }
.vs-seg button[aria-pressed="true"], .vs-seg button.on { background:var(--surface); color:var(--text); box-shadow:var(--shadow-sm); }
.vs-seg button:hover { color:var(--text); }
.vs .btn.on { background:var(--accent-soft); color:var(--accent); border-color:color-mix(in srgb, var(--accent) 35%, transparent); }

.vs-main { display:grid; grid-template-columns:minmax(210px,270px) minmax(0,1fr) minmax(250px,300px); gap:8px; min-height:0; }
.vs-ph { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; border-bottom:1px solid var(--border); font-weight:650; font-size:13px; letter-spacing:-.01em; flex:none; }
.vs-ph small { font-weight:500; color:var(--muted); font-size:12px; }
.vs-scrollbox { overflow:auto; min-height:0; flex:1; }
.vs-media .dropzone { margin:10px; padding:12px; }
.vs-media .dropzone .dz-hint { display:none; }
.vs-mlist { display:grid; gap:6px; padding:0 10px 10px; }
.vs-mi { display:grid; grid-template-columns:62px minmax(0,1fr) auto; gap:9px; align-items:center; padding:6px; border:1px solid var(--border); border-radius:11px; background:var(--surface); cursor:grab; }
.vs-mi:hover { border-color:var(--border-strong); background:var(--surface-2); }
.vs-mi.bad { border-color:var(--danger); }
.vs-mt { width:62px; height:42px; border-radius:7px; background:var(--surface-3) center/cover no-repeat; display:grid; place-items:center; color:var(--muted); overflow:hidden; }
.vs-mt[data-kind=audio] { color:var(--vs-audio); }
.vs-mn { min-width:0; }
.vs-mn b { display:block; font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vs-mn span { display:block; font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vs-mi .btn { height:30px; width:30px; padding:0; }
.vs-tip { margin:0 10px 10px; padding:9px 11px; font-size:12px; color:var(--muted); background:var(--surface-2); border-radius:10px; line-height:1.45; }

.vs-mon { display:flex; flex-direction:column; min-width:0; min-height:0; }
.vs-stage { flex:1; min-height:160px; position:relative; display:grid; place-items:center; overflow:hidden; background:var(--surface-3); border-radius:var(--radius) var(--radius) 0 0; }
.vs-frame { position:relative; background:#000; box-shadow:0 14px 40px -14px rgba(0,0,0,.55); outline:1px solid var(--border-strong); touch-action:none; }
.vs-frame canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
.vs-frame .ov { pointer-events:none; }
.vs-frame .base { cursor:default; } .vs-frame.drag .base { cursor:move; }
.vs-empty { position:absolute; inset:0; display:grid; place-content:center; justify-items:center; gap:10px; text-align:center; color:#fff; padding:16px; background:linear-gradient(180deg, rgba(0,0,0,.2), rgba(0,0,0,.55)); }
.vs-empty b { font-size:15px; } .vs-empty span { font-size:12.5px; opacity:.8; max-width:260px; }
.vs-busy { position:absolute; left:10px; top:10px; z-index:3; background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:5px 11px 5px 9px; font-size:12px; display:flex; align-items:center; gap:7px; box-shadow:var(--shadow); }
.vs-transport { display:flex; align-items:center; gap:4px; padding:8px 10px; border-top:1px solid var(--border); flex:none; flex-wrap:wrap; }
.vs-tc { font:500 13px var(--mono); color:var(--text); padding:0 8px; white-space:nowrap; }
.vs-tc span { color:var(--muted); }
.vs-play { width:44px !important; height:38px; border-radius:12px; }

.vs-insp .vs-scrollbox { padding-bottom:12px; }
.vs-sec { padding:11px 12px; border-bottom:1px solid var(--border); }
.vs-sec:last-child { border-bottom:0; }
.vs-sec > h4 { margin:0 0 8px; font-size:11px; letter-spacing:.07em; text-transform:uppercase; color:var(--muted); font-weight:650; display:flex; justify-content:space-between; align-items:center; }
.vs-f { display:grid; grid-template-columns:70px minmax(0,1fr) 60px; align-items:center; gap:8px; margin:7px 0; font-size:12.5px; }
.vs-f > label, .vs-f > span.l { color:var(--text-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:default; }
.vs-f input[type=range] { width:100%; min-width:0; accent-color:var(--accent); }
.vs-f.wide { grid-template-columns:70px minmax(0,1fr); }
.vs-num { height:28px; width:100%; min-width:0; padding:0 6px; border:1px solid var(--border); background:var(--surface); border-radius:7px; font:12px var(--mono); color:var(--text); text-align:right; }
.vs-num:focus { border-color:var(--accent); outline:none; }
.vs-in { height:32px; width:100%; min-width:0; padding:0 9px; border:1px solid var(--border); background:var(--surface); border-radius:9px; font-size:13px; color:var(--text); }
textarea.vs-in { height:auto; padding:8px 9px; resize:vertical; min-height:64px; line-height:1.35; }
.vs-in:focus { border-color:var(--accent); outline:none; }
select.vs-in { appearance:auto; }
.vs-color { height:28px; width:100%; padding:2px; border:1px solid var(--border); border-radius:7px; background:var(--surface); cursor:pointer; }
.vs-btnrow { display:flex; flex-wrap:wrap; gap:6px; }
.vs-btnrow .btn { height:30px; font-size:12.5px; padding:0 10px; }
.vs-note { font-size:12px; color:var(--muted); line-height:1.45; margin:6px 0 0; }
.vs-kbd { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12.5px; }

.vs-tl { display:grid; grid-template-columns:46px minmax(0,1fr); min-height:0; }
.vs-rail { display:flex; flex-direction:column; gap:4px; padding:6px 5px; border-right:1px solid var(--border); background:var(--surface-2); align-items:center; }
.vs-rail .btn { width:34px; height:34px; padding:0; }
.vs-rail .vs-sep { width:22px; height:1px; margin:3px 0; }
.vs-tlm { display:flex; flex-direction:column; min-width:0; min-height:0; }
.vs-tlbar { display:flex; align-items:center; gap:6px; padding:4px 8px; border-bottom:1px solid var(--border); flex:none; flex-wrap:wrap; }
.vs-tlbar .btn { height:30px; padding:0 9px; }
.vs-tlbar input[type=range] { width:110px; accent-color:var(--accent); }
.vs-scroll { flex:1; overflow:auto; position:relative; background:var(--bg-2); overscroll-behavior:contain; min-height:0; }
.vs-inner { position:relative; min-height:100%; }
.vs-rulerrow { position:sticky; top:0; z-index:6; display:flex; height:26px; background:var(--surface); border-bottom:1px solid var(--border); }
.vs-corner { position:sticky; left:0; z-index:8; flex:none; width:var(--head); background:var(--surface); border-right:1px solid var(--border); font-size:11px; color:var(--muted); display:flex; align-items:center; padding-left:10px; }
.vs-ruler { position:relative; flex:none; height:100%; cursor:ew-resize; touch-action:none; }
.vs-tick { position:absolute; top:4px; font:500 10.5px var(--mono); color:var(--muted); padding-left:4px; border-left:1px solid var(--border-strong); height:22px; pointer-events:none; white-space:nowrap; }
.vs-phh { position:absolute; top:0; width:13px; height:16px; margin-left:-6.5px; background:var(--danger); clip-path:polygon(0 0,100% 0,100% 55%,50% 100%,0 55%); z-index:3; pointer-events:none; }
.vs-phl { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; z-index:4; pointer-events:none; background:var(--danger); }
.vs-snap { position:absolute; top:26px; bottom:0; width:0; z-index:4; pointer-events:none; border-left:1px dashed var(--accent); display:none; }
.vs-row { display:flex; border-bottom:1px solid var(--border); position:relative; }
.vs-head { position:sticky; left:0; z-index:5; flex:none; width:var(--head); background:var(--surface); border-right:1px solid var(--border); display:flex; align-items:center; gap:1px; padding:0 3px 0 9px; min-width:0; }
.vs-head b { flex:1; min-width:0; font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.vs-head .btn { width:22px; height:24px; padding:0; border-radius:7px; flex:none; }
.vs-head .btn .icon { width:14px; height:14px; }
.vs-head .rm { display:none; } .vs-head:hover .rm, .vs-head:focus-within .rm { display:inline-flex; }
.vs-head .btn.off { color:var(--danger); }
.vs-row[data-kind=video] .vs-head { box-shadow:inset 3px 0 0 var(--vs-video); }
.vs-row[data-kind=title] .vs-head { box-shadow:inset 3px 0 0 var(--vs-title); }
.vs-row[data-kind=audio] .vs-head { box-shadow:inset 3px 0 0 var(--vs-audio); }
.vs-lane { position:relative; flex:none; background:repeating-linear-gradient(90deg, transparent 0 79px, color-mix(in srgb, var(--border) 60%, transparent) 79px 80px); }
.vs-row.locked .vs-lane { background-color:color-mix(in srgb, var(--surface-3) 60%, transparent); }
.vs-row.dropok .vs-lane { background-color:var(--accent-soft); }
.vs-clip { --k:var(--vs-video); position:absolute; top:3px; bottom:3px; border-radius:8px; overflow:hidden; cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none;
  background:color-mix(in srgb, var(--k) 58%, var(--surface-3)); border:1px solid color-mix(in srgb, var(--k) 80%, #000); box-shadow:0 1px 2px rgba(0,0,0,.18); }
.vs-clip[data-kind=image] { --k:var(--vs-image); } .vs-clip[data-kind=title] { --k:var(--vs-title); } .vs-clip[data-kind=audio] { --k:var(--vs-audio); }
.vs-clip.sel { z-index:2; box-shadow:0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
.vs-clip.moving { cursor:grabbing; opacity:.92; z-index:3; }
.vs-clip.missing { background:repeating-linear-gradient(45deg, var(--danger-soft) 0 8px, transparent 8px 16px); border-color:var(--danger); }
.vs-row.locked .vs-clip { cursor:not-allowed; opacity:.75; }
.vs[data-tool=razor] .vs-clip { cursor:crosshair; }
.vs-film { position:absolute; inset:0; overflow:hidden; }
.vs-tile { position:absolute; top:0; bottom:0; background-repeat:no-repeat; opacity:.95; }
.vs-wave { position:absolute; inset:0; background-repeat:no-repeat; opacity:.9; }
.vs-cname { position:absolute; left:7px; top:3px; right:7px; z-index:2; font-size:11px; font-weight:650; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.8); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; }
.vs-clip[data-kind=title] .vs-cname { top:50%; transform:translateY(-50%); color:#2a1600; text-shadow:none; }
.vs-trim { position:absolute; top:0; bottom:0; width:9px; z-index:3; cursor:ew-resize; }
.vs-trim.l { left:0; } .vs-trim.r { right:0; }
.vs-clip:hover .vs-trim, .vs-clip.sel .vs-trim { background:rgba(255,255,255,.3); }
.vs-tm { position:absolute; top:0; bottom:0; z-index:1; pointer-events:none; }
.vs-tm.in.black { left:0; background:linear-gradient(90deg, rgba(0,0,0,.85), transparent); }
.vs-tm.out.black { right:0; background:linear-gradient(270deg, rgba(0,0,0,.85), transparent); }
.vs-tm.in.crossfade { left:0; background:linear-gradient(135deg, rgba(255,255,255,.55) 0 49%, rgba(255,255,255,.9) 49% 51%, transparent 51%); }
.vs-tm.out.fade { right:0; background:linear-gradient(225deg, rgba(255,255,255,.55) 0 49%, rgba(255,255,255,.9) 49% 51%, transparent 51%); }
.vs-fade { position:absolute; top:0; bottom:0; z-index:1; pointer-events:none; background:linear-gradient(90deg, rgba(0,0,0,.45), transparent); }
.vs-fade.out { background:linear-gradient(270deg, rgba(0,0,0,.45), transparent); }

.vs-foot { display:flex; flex-wrap:wrap; gap:6px 14px; justify-content:space-between; align-items:center; font-size:12.5px; color:var(--muted); padding:0 4px; }
.vs-foot a { color:var(--accent); text-decoration:underline; text-underline-offset:2px; }
.vs-foot button { background:none; border:0; padding:0; color:var(--accent); cursor:pointer; text-decoration:underline; text-underline-offset:2px; font-size:inherit; }
.vs-mtabs { display:none; }
.vs-menu { position:fixed; z-index:200; min-width:190px; background:var(--surface); border:1px solid var(--border-strong); border-radius:12px; box-shadow:var(--shadow-lg); padding:5px; display:grid; gap:1px; }
.vs-menu button { display:flex; align-items:center; gap:9px; height:34px; padding:0 10px; border:0; background:transparent; border-radius:8px; color:var(--text); font-size:13px; cursor:pointer; text-align:left; }
.vs-menu button:hover, .vs-menu button:focus-visible { background:var(--surface-2); outline:none; }
.vs-exp video { width:100%; max-height:240px; background:#000; border-radius:12px; }
.vs-exp .row { align-items:center; }
.vs-confirm p { margin:0 0 6px; }

@media (max-width:1100px) { .vs-main { grid-template-columns:minmax(190px,230px) minmax(0,1fr) minmax(230px,260px); } }
@media (max-width:860px) {
  .vs { display:flex; flex-direction:column; height:auto; --head:78px; }
  .vs-main { display:contents; }
  .vs-bar { order:0; } .vs-mon { order:1; } .vs-tl { order:2; height:310px; flex:none; } .vs-mtabs { order:3; display:flex; justify-content:center; } .vs-media, .vs-insp { order:4; } .vs-foot { order:5; }
  .vs-stage { flex:none; width:100%; aspect-ratio:var(--ar, 1.78); max-height:54vh; min-height:0; border-radius:var(--radius) var(--radius) 0 0; }
  .vs-mon { flex:none; }
  .vs-media, .vs-insp { max-height:380px; flex:none; }
  .vs[data-m="media"] .vs-insp, .vs[data-m="inspector"] .vs-media { display:none; }
  .vs-name { flex:1 1 100%; width:auto; } .vs-bar .vs-sep { display:none; }
  .vs-head b { display:none; }
  .vs-head { padding-left:6px; }
  .vs-tlbar input[type=range] { width:70px; }
}
@media (prefers-reduced-motion:reduce) { .vs * { transition:none !important; animation:none !important; } }
`

export function injectStyle() {
  const el = document.createElement('style')
  el.dataset.vs = ''
  el.textContent = CSS
  document.head.append(el)
  return () => el.remove()
}
