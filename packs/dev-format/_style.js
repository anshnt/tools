// Styles for the developer tools. Every selector starts with .df- (or .t-df), so nothing leaks into other tools.
// Colors come from the site's CSS variables; syntax colors are defined once per theme on .t-df.
export const CSS = `
@property --df-a { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
.t-df { --df-lh: 21px; --df-pad: 12px; --df-h: clamp(260px, 48vh, 520px);
  --df-kw: #7c3aed; --df-str: #0b7f57; --df-num: #c2410c; --df-bool: #a21caf; --df-null: #6b7280; --df-key: #1d4ed8; --df-com: #858596;
  --df-fn: #0369a1; --df-attr: #b4308b; --df-punc: #7a7a8c; --df-add: rgba(18,128,74,.14); --df-add-strong: rgba(18,128,74,.34);
  --df-rem: rgba(217,45,32,.12); --df-rem-strong: rgba(217,45,32,.3); --df-chg: rgba(234,160,20,.16); --df-chg-strong: rgba(234,160,20,.38);
  position: relative; isolation: isolate; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
:root[data-theme="dark"] .t-df { --df-kw: #c4b5fd; --df-str: #6ee7b7; --df-num: #fdba74; --df-bool: #f0abfc; --df-null: #9ca3af; --df-key: #93c5fd; --df-com: #7c7c90;
  --df-fn: #7dd3fc; --df-attr: #f9a8d4; --df-punc: #8b8b9e; --df-add: rgba(52,211,153,.13); --df-add-strong: rgba(52,211,153,.32);
  --df-rem: rgba(248,113,113,.13); --df-rem-strong: rgba(248,113,113,.32); --df-chg: rgba(251,191,36,.13); --df-chg-strong: rgba(251,191,36,.3); }
/* empty slots (errors, notices, stats) must not add a flex gap */
.t-df > div:empty { display: none; }
@media (max-width: 720px) { .t-df { --df-lh: 24px; --df-pad: 10px; --df-h: clamp(230px, 40vh, 400px); } }

/* ---- aurora backdrop ---- */
.df-aurora { position: absolute; inset: -60px -24px auto; height: 300px; z-index: -1; pointer-events: none; overflow: hidden; opacity: .5;
  -webkit-mask-image: linear-gradient(#000 30%, transparent); mask-image: linear-gradient(#000 30%, transparent); }
:root[data-theme="dark"] .df-aurora { opacity: .62; }
.df-aurora i { position: absolute; border-radius: 50%; filter: blur(54px); animation: df-drift 16s ease-in-out infinite alternate; }
.df-aurora i:nth-child(1) { width: 340px; height: 190px; left: 2%; top: -50px; background: #818cf8; }
.df-aurora i:nth-child(2) { width: 300px; height: 170px; left: 38%; top: -70px; background: #f472b6; animation-duration: 21s; animation-delay: -5s; }
.df-aurora i:nth-child(3) { width: 320px; height: 180px; right: 0; top: -40px; background: #fb923c; animation-duration: 25s; animation-delay: -11s; }
@keyframes df-drift { to { transform: translate3d(50px, 26px, 0) scale(1.15); } }

/* ---- toolbar ---- */
.df-bar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding: 9px 12px; border-radius: 20px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 74%, transparent); -webkit-backdrop-filter: blur(14px) saturate(1.5); backdrop-filter: blur(14px) saturate(1.5); box-shadow: var(--shadow-sm); }
@media (min-width: 900px) { .df-bar.df-sticky { position: sticky; top: calc(var(--header-h) + 10px); z-index: 20; } }
.df-opt { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.df-ol { font-size: 11.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.df-spacer { flex: 1; }
.df-bar .seg button { min-height: 30px; padding: 0 11px; font-size: 13px; }
.df-bar .switch { min-height: 30px; font-size: 13.5px; }
.df-bar .select { height: 34px; border-radius: 10px; font-size: 13.5px; min-width: 130px; width: auto; }
.df-bar .input { height: 34px; border-radius: 10px; width: 84px; font-size: 13.5px; }
.df-bar kbd { font: 500 11px var(--mono); padding: 2px 6px; border-radius: 6px; background: rgba(255,255,255,.22); margin-left: 2px; }
@media (max-width: 720px) { .df-bar kbd { display: none; } }

/* ---- frames: editors and code views ---- */
.df-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: stretch; }
.df-grid.df-wide-left { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); }
@media (max-width: 900px) { .df-grid, .df-grid.df-wide-left { grid-template-columns: minmax(0, 1fr); } }
.df-frame { position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: 20px; background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow); overflow: hidden; transition: border-color .25s, box-shadow .3s, transform .25s var(--ease); }
.df-frame::before { content: ""; position: absolute; inset: 0; padding: 1.5px; border-radius: inherit; pointer-events: none; z-index: 3; opacity: 0; transition: opacity .35s;
  background: conic-gradient(from var(--df-a), #6366f1, #a855f7, #ec4899, #f97316, #6366f1);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  animation: df-spin 5s linear infinite; }
.df-frame:focus-within::before { opacity: 1; }
.df-frame:focus-within { box-shadow: 0 18px 50px -24px color-mix(in srgb, var(--accent) 60%, transparent); }
@keyframes df-spin { to { --df-a: 360deg; } }
.df-frame.df-drag { border-color: var(--accent); box-shadow: 0 0 0 4px var(--ring); }
.df-frame.df-drag .df-body::after { content: "Drop a file to load it"; position: absolute; inset: 8px; z-index: 6; display: grid; place-items: center; border-radius: 14px;
  border: 2px dashed var(--accent); background: color-mix(in srgb, var(--surface) 86%, transparent); font-weight: 600; color: var(--accent); }
.df-head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--border); min-height: 50px;
  background: linear-gradient(var(--surface), color-mix(in srgb, var(--surface-2) 70%, var(--surface))); }
.df-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 650; font-size: 14px; letter-spacing: -.01em; min-width: 0; }
.df-title .icon { color: var(--accent); width: 17px; height: 17px; }
.df-title span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.df-actions { margin-left: auto; display: flex; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
.df-head .btn-sm { height: 32px; padding: 0 10px; }
.df-copied .icon { color: var(--success); animation: df-pop .4s var(--spring); }
.df-body { position: relative; display: flex; height: var(--df-h); min-height: 0; background: var(--surface); }
.df-gutter { flex: none; position: relative; overflow: hidden; min-width: calc(var(--df-gw, 2ch) + 22px); background: color-mix(in srgb, var(--surface-2) 80%, var(--surface)); border-right: 1px solid var(--border);
  font: 12px/var(--df-lh) var(--mono); color: var(--muted); text-align: right; user-select: none; -webkit-user-select: none; }
.df-gi { padding: var(--df-pad) 10px var(--df-pad) 8px; white-space: pre; will-change: transform; }
.df-gutter .df-gmark { position: absolute; left: 0; right: 0; height: var(--df-lh); background: color-mix(in srgb, var(--danger) 28%, transparent); will-change: transform; }
.df-main { position: relative; flex: 1; min-width: 0; }
.df-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.df-mark { position: absolute; left: 0; right: 0; height: var(--df-lh); will-change: transform; }
.df-mark.error { background: color-mix(in srgb, var(--danger) 13%, transparent); box-shadow: inset 3px 0 0 var(--danger); animation: df-fade .4s; }
.df-ta, .df-pre { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; border: 0; outline: 0; resize: none; background: transparent; color: var(--text);
  padding: var(--df-pad) 14px; font: 13px/var(--df-lh) var(--mono); tab-size: 2; -moz-tab-size: 2; white-space: pre; overflow: auto; overscroll-behavior: contain; }
@media (max-width: 720px) { .df-ta, .df-pre { font-size: 16px; } .df-gutter { font-size: 13px; } }
.df-ta::placeholder { color: var(--muted); opacity: .75; white-space: pre-wrap; }
.df-ta::selection, .df-pre ::selection { background: color-mix(in srgb, var(--accent) 32%, transparent); }
.df-pre code { font: inherit; }
.df-pre.df-fresh code { animation: df-in .45s var(--ease); }
.df-body.df-stale .df-pre { opacity: .42; filter: saturate(.4); transition: opacity .25s; }
.df-empty-ov { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; text-align: center; color: var(--muted); padding: 24px; pointer-events: none; font-size: 14px; }
.df-empty-ov .df-orb { width: 66px; height: 66px; border-radius: 22px; display: grid; place-items: center; color: var(--accent);
  background: radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--accent) 24%, transparent), color-mix(in srgb, var(--accent-2) 12%, transparent)); border: 1px solid var(--border);
  animation: df-float 4.5s ease-in-out infinite; }
.df-empty-ov .df-orb .icon { width: 28px; height: 28px; }
.df-foot { display: flex; align-items: center; gap: 6px 14px; padding: 6px 14px; border-top: 1px solid var(--border); font: 11.5px var(--mono); color: var(--muted); flex-wrap: wrap; min-height: 32px;
  background: color-mix(in srgb, var(--surface-2) 60%, var(--surface)); }
.df-foot b { color: var(--text-2); font-weight: 600; }
.df-foot .df-fr { margin-left: auto; }
.df-frame.df-flash-ok::after, .df-frame.df-flash-err::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2.5px; z-index: 4; pointer-events: none; animation: df-sweep .9s var(--ease) forwards; }
.df-frame.df-flash-ok::after { background: linear-gradient(90deg, transparent, var(--success), #34d399, transparent); }
.df-frame.df-flash-err::after { background: linear-gradient(90deg, transparent, var(--danger), #fb7185, transparent); }
.df-frame.df-shake { animation: df-shake .38s; }
@keyframes df-sweep { from { transform: translateX(-100%); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
@keyframes df-shake { 20%, 60% { transform: translateX(-4px); } 40%, 80% { transform: translateX(4px); } }
@keyframes df-in { from { opacity: .35; transform: translateY(5px); } }
@keyframes df-fade { from { opacity: 0; } }
@keyframes df-pop { 0% { transform: scale(.4); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }
@keyframes df-float { 50% { transform: translateY(-6px) rotate(-3deg); } }
@keyframes df-rise { from { opacity: 0; transform: translateY(10px) scale(.98); } }

/* ---- syntax tokens ---- */
.tk-k { color: var(--df-key); } .tk-s { color: var(--df-str); } .tk-n { color: var(--df-num); } .tk-b { color: var(--df-bool); } .tk-nl { color: var(--df-null); font-style: italic; } .tk-p { color: var(--df-punc); }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-operator { color: var(--df-kw); }
.hljs-string, .hljs-regexp, .hljs-template-string, .hljs-addition, .hljs-meta .hljs-string { color: var(--df-str); }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-link { color: var(--df-num); }
.hljs-comment, .hljs-quote { color: var(--df-com); font-style: italic; }
.hljs-title, .hljs-section { color: var(--df-fn); }
.hljs-attr, .hljs-attribute, .hljs-property, .hljs-variable, .hljs-template-variable, .hljs-selector-class, .hljs-selector-id, .hljs-selector-attr, .hljs-selector-pseudo { color: var(--df-attr); }
.hljs-built_in, .hljs-type, .hljs-name, .hljs-tag, .hljs-params { color: var(--df-key); }
.hljs-literal, .hljs-boolean { color: var(--df-bool); }
.hljs-meta { color: var(--df-com); }
.hljs-deletion { color: var(--danger); }
.hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }

/* ---- chips, samples, errors, verdicts ---- */
.df-chip { display: inline-flex; align-items: center; gap: 7px; padding: 3px 11px 3px 9px; border-radius: 999px; font: 600 12px var(--font); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); animation: df-pop .35s var(--spring); }
.df-chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.df-chip.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, transparent); } .df-chip.ok::before { background: var(--success); box-shadow: 0 0 0 0 var(--success); animation: df-ping 1.8s infinite; }
.df-chip.err { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 28%, transparent); } .df-chip.err::before { background: var(--danger); }
.df-chip.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 28%, transparent); } .df-chip.warn::before { background: var(--warning); }
@keyframes df-ping { 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.df-samples { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; animation: df-rise .4s var(--ease) both; }
.df-samples .df-ol { margin-right: 2px; display: inline-flex; align-items: center; gap: 6px; }
.df-samples .df-ol .icon { width: 14px; height: 14px; color: var(--accent-2); }
.df-sample { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; font-size: 13px; font-weight: 550;
  transition: transform .2s var(--spring), border-color .2s, box-shadow .2s, color .2s; }
.df-sample:hover { transform: translateY(-2px); border-color: var(--accent); color: var(--accent); box-shadow: 0 10px 22px -14px var(--accent); }
.df-sample:active { transform: scale(.96); }
.df-sample .icon { width: 15px; height: 15px; }
.df-err { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 18px; background: var(--danger-soft); border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border)); animation: df-rise .35s var(--ease) both; min-width: 0; }
.df-err-head { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.df-err-head .icon { color: var(--danger); margin-top: 2px; }
.df-err-msg { flex: 1; min-width: 200px; font-weight: 600; overflow-wrap: anywhere; }
.df-pos { font: 600 12px var(--mono); padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); white-space: nowrap; }
.df-hint { font-size: 13.5px; color: var(--text-2); }
.df-errbtns { display: flex; gap: 8px; flex-wrap: wrap; }
.df-fr-box { font: 12.5px/1.6 var(--mono); border-radius: 12px; background: var(--surface); border: 1px solid var(--border); overflow: auto; max-width: 100%; padding: 6px 0; }
.df-fl { display: flex; white-space: pre; padding-right: 14px; min-width: max-content; }
.df-fl .n { flex: none; width: 46px; text-align: right; padding-right: 12px; color: var(--muted); user-select: none; }
.df-fl.bad { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.df-fl.bad .n { color: var(--danger); font-weight: 700; }
.df-fl.caret { color: var(--danger); font-weight: 800; }
.df-verdict { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-radius: 22px; border: 1px solid; animation: df-rise .4s var(--ease) both; min-width: 0; flex-wrap: wrap; }
.df-verdict.ok { background: linear-gradient(120deg, var(--success-soft), var(--surface)); border-color: color-mix(in srgb, var(--success) 32%, var(--border)); }
.df-verdict .df-vi { width: 52px; height: 52px; border-radius: 18px; display: grid; place-items: center; flex: none; color: #fff; background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 12px 26px -12px #10b981; animation: df-pop .5s var(--spring); }
.df-verdict .df-vi .icon { width: 28px; height: 28px; stroke-width: 2.6; }
.df-verdict h3 { font-size: 19px; letter-spacing: -.02em; }
.df-verdict p { color: var(--muted); font-size: 13.5px; margin-top: 2px; }
.df-stats { animation: df-rise .4s var(--ease) both; }
.df-stats .stat .value { font-size: 22px; }
.df-note { animation: df-rise .35s var(--ease) both; }

/* ---- meter (size savings) ---- */
.df-meter { display: grid; gap: 8px; }
.df-meter-bar { height: 12px; border-radius: 999px; background: var(--surface-3); overflow: hidden; position: relative; }
.df-meter-bar i { position: absolute; inset: 0 auto 0 0; width: 100%; border-radius: inherit; background: var(--brand); background-size: 200% 100%; transform-origin: left; animation: df-grow 1s var(--ease) both, shimmer 3s linear infinite; }
@keyframes df-grow { from { transform: scaleX(1); } }

/* ---- tree viewer ---- */
.df-tree { font: 13px/1.5 var(--mono); padding: 10px 8px 16px; overflow: auto; max-height: 640px; min-height: 220px; }
.df-n, .df-n ul { list-style: none; margin: 0; padding: 0; }
.df-kids { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .22s var(--ease); }
.df-open > .df-kids { grid-template-rows: 1fr; }
.df-noanim .df-kids, .df-noanim .df-chev { transition: none; }
.df-kids > ul { overflow: hidden; min-height: 0; margin-left: 15px; padding-left: 8px; border-left: 1px dashed var(--border-strong); }
.df-r { display: flex; align-items: baseline; gap: 6px; padding: 1px 8px 1px 2px; border-radius: 8px; min-height: 24px; position: relative; cursor: default; }
.df-r:hover { background: var(--surface-2); }
.df-r.sel { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
.df-r:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.df-r.hit .df-kv { background: var(--df-chg-strong); border-radius: 5px; }
.df-chev { width: 16px; height: 16px; flex: none; color: var(--muted); transition: transform .2s var(--ease); align-self: center; }
.df-open > .df-r .df-chev { transform: rotate(90deg); }
.df-leaf { width: 16px; flex: none; }
.df-kv { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.df-sum { color: var(--muted); font-size: 12px; margin-left: 4px; }
.df-more { margin: 4px 0 4px 20px; }
.df-rowact { margin-left: auto; display: none; gap: 2px; align-self: center; }
.df-r:hover .df-rowact, .df-r.sel .df-rowact { display: flex; }
.df-rowact button { border: 0; background: var(--surface); color: var(--text-2); border: 1px solid var(--border); border-radius: 7px; height: 22px; padding: 0 7px; font: 600 11px var(--font); cursor: pointer; }
.df-rowact button:hover { color: var(--accent); border-color: var(--accent); }
@media (hover: none) { .df-rowact { display: flex; } }
.df-detail { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface-2) 60%, var(--surface)); font: 12.5px var(--mono); min-height: 52px; }
.df-detail code { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 3px 9px; overflow-wrap: anywhere; color: var(--df-attr); }
.df-results { max-height: 220px; overflow: auto; border-top: 1px solid var(--border); }
.df-results button { display: flex; gap: 10px; width: 100%; text-align: left; padding: 7px 14px; border: 0; background: transparent; cursor: pointer; font: 12.5px var(--mono); color: var(--text-2); }
.df-results button:hover, .df-results button:focus-visible { background: var(--surface-2); outline: none; }
.df-results .p { color: var(--df-attr); flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.df-results .v { color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.df-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; }
.df-search .input { width: 100%; max-width: 360px; }

/* ---- diff ---- */
.df-sbs-wrap { overflow: auto; max-height: 720px; }
.df-sbs { display: grid; grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr); font: 12.5px/1.55 var(--mono); min-width: 640px; }
.df-sbs > div { padding: 1px 10px; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 21px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
.df-sbs > .ln { text-align: right; color: var(--muted); user-select: none; padding: 1px 8px; min-width: 42px; background: color-mix(in srgb, var(--surface-2) 70%, var(--surface)); }
.df-sbs > .add { background: var(--df-add); } .df-sbs > .rem { background: var(--df-rem); } .df-sbs > .chg { background: var(--df-chg); } .df-sbs > .nil { background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--border) 60%, transparent) 6px 7px); }
.df-sbs > .hunk { grid-column: 1 / -1; padding: 6px 14px; text-align: center; color: var(--accent); background: var(--accent-soft); cursor: pointer; font: 600 12px var(--font); }
.df-sbs > .hunk:hover { text-decoration: underline; }
.df-sbs mark.a, .df-inline mark.a { background: var(--df-add-strong); color: inherit; border-radius: 3px; padding: 0 1px; }
.df-sbs mark.r, .df-inline mark.r { background: var(--df-rem-strong); color: inherit; border-radius: 3px; padding: 0 1px; text-decoration: line-through; text-decoration-thickness: 1px; }
.df-sbs > .row-in { animation: df-fade .4s both; }
.df-inline { font: 13px/1.65 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; padding: 14px 16px; max-height: 560px; overflow: auto; }
.df-uni { font: 12.5px/1.55 var(--mono); }
.df-uni > div { display: flex; white-space: pre-wrap; overflow-wrap: anywhere; padding: 0 12px 0 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent); }
.df-uni .ln { flex: none; width: 46px; text-align: right; padding: 1px 8px; color: var(--muted); user-select: none; background: color-mix(in srgb, var(--surface-2) 70%, var(--surface)); }
.df-uni .sg { flex: none; width: 20px; text-align: center; color: var(--muted); }
.df-uni .tx { flex: 1; min-width: 0; padding: 1px 0; }
.df-uni .add { background: var(--df-add); } .df-uni .rem { background: var(--df-rem); }
.df-uni .hunk { justify-content: center; padding: 6px 14px; color: var(--accent); background: var(--accent-soft); cursor: pointer; font: 600 12px var(--font); }
.df-chg-list { display: flex; flex-direction: column; }
.df-chg-row { display: grid; grid-template-columns: 74px minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1fr); gap: 4px 12px; padding: 9px 14px; border-bottom: 1px solid var(--border); font: 12.5px var(--mono); align-items: start; animation: df-rise .35s var(--ease) both; }
.df-chg-row:last-child { border-bottom: 0; }
.df-chg-row .path { color: var(--df-attr); overflow-wrap: anywhere; }
.df-chg-row .val { overflow-wrap: anywhere; white-space: pre-wrap; min-width: 0; }
.df-chg-row .val.rem { color: var(--danger); } .df-chg-row .val.add { color: var(--success); }
.df-chg-row .val.none { color: var(--muted); }
@media (max-width: 720px) { .df-chg-row { grid-template-columns: minmax(0, 1fr); } }
.df-tag { display: inline-flex; align-items: center; justify-content: center; height: 22px; padding: 0 9px; border-radius: 999px; font: 700 11px var(--font); letter-spacing: .03em; text-transform: uppercase; }
.df-tag.add { background: var(--df-add); color: var(--success); } .df-tag.rem { background: var(--df-rem); color: var(--danger); } .df-tag.chg { background: var(--df-chg); color: var(--warning); }

/* ---- markdown ---- */
.df-md { padding: 18px 22px 26px; overflow: auto; height: 100%; color: var(--text-2); font-size: 15.5px; line-height: 1.7; overflow-wrap: anywhere; }
.df-md > :first-child { margin-top: 0; }
.df-md h1, .df-md h2, .df-md h3, .df-md h4, .df-md h5, .df-md h6 { color: var(--text); letter-spacing: -.02em; line-height: 1.25; margin: 1.5em 0 .5em; }
.df-md h1 { font-size: 1.9em; padding-bottom: .3em; border-bottom: 1px solid var(--border); } .df-md h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid var(--border); } .df-md h3 { font-size: 1.25em; }
.df-md p, .df-md ul, .df-md ol, .df-md pre, .df-md blockquote, .df-md table { margin: 0 0 1em; }
.df-md a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.df-md code { font: .88em var(--mono); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: .12em .4em; }
.df-md pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; overflow: auto; line-height: 1.55; }
.df-md pre code { background: none; border: 0; padding: 0; font-size: 13px; }
.df-md blockquote { border-left: 4px solid var(--accent); background: var(--accent-soft); margin-left: 0; padding: 8px 16px; border-radius: 0 12px 12px 0; color: var(--text-2); }
.df-md blockquote > :last-child { margin-bottom: 0; }
.df-md table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
.df-md th, .df-md td { border: 1px solid var(--border); padding: 7px 12px; } .df-md th { background: var(--surface-2); color: var(--text); }
.df-md img { max-width: 100%; border-radius: 10px; } .df-md hr { border: 0; border-top: 1px solid var(--border); margin: 1.6em 0; }
.df-md li > input[type=checkbox] { margin-right: 8px; vertical-align: middle; }
.df-md ul:has(> li > input[type=checkbox]) { list-style: none; padding-left: 4px; }
.df-md-body { padding: 0; flex-direction: column; overflow: hidden; }
.df-md-tools { display: flex; gap: 2px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; background: color-mix(in srgb, var(--surface-2) 55%, var(--surface)); }
.df-md-tools .btn { height: 32px; width: 34px; padding: 0; }
.df-md-tools .sep { width: 1px; background: var(--border); margin: 4px 6px; }
.df-pane-fill { flex: 1; min-height: 0; position: relative; }
.df-md-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }

/* ---- string escaper cards ---- */
.df-cards { columns: 3 300px; column-gap: 14px; }
.df-card { break-inside: avoid; margin: 0 0 14px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); overflow: hidden;
  transition: transform .3s var(--ease), box-shadow .3s, border-color .3s; animation: df-rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); }
.df-card:hover { transform: translateY(-4px); box-shadow: 0 22px 44px -26px color-mix(in srgb, var(--cc, var(--accent)) 70%, #000); border-color: color-mix(in srgb, var(--cc, var(--accent)) 45%, var(--border)); }
.df-card-h { display: flex; align-items: center; gap: 10px; padding: 11px 12px 8px 14px; }
.df-card-h .tile { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: var(--cc, var(--accent)); background: color-mix(in srgb, var(--cc, var(--accent)) 14%, transparent); font: 700 12px var(--mono); flex: none; }
.df-card-h b { font-size: 14px; } .df-card-h small { color: var(--muted); font-size: 12px; display: block; }
.df-card-h .btn { margin-left: auto; }
.df-card pre { margin: 0; padding: 4px 14px 14px; font: 12.5px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; color: var(--text); }
.df-card pre.na { color: var(--muted); font-style: italic; }
.df-ent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); gap: 8px; }
.df-ent { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 2px 10px; padding: 8px 10px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; text-align: left;
  transition: transform .2s var(--spring), border-color .2s, box-shadow .2s; font-family: var(--mono); }
.df-ent:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 10px 22px -16px var(--accent); }
.df-ent .g { grid-row: span 2; font: 500 22px var(--font); text-align: center; color: var(--text); }
.df-ent .nm { font-size: 12px; color: var(--df-attr); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .df-ent .nu { font-size: 11px; color: var(--muted); }

@media (prefers-reduced-motion: reduce) { .df-aurora i, .df-frame::before, .df-empty-ov .df-orb, .df-chip::before { animation: none !important; } .df-frame:focus-within::before { opacity: 1; } }
@media print { .df-aurora { display: none; } }
`
