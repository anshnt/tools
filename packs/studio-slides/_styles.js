// Styles for Slides Studio. SLIDE_CSS is also embedded in exported images and the presenter window, so it must stand alone.
export const SLIDE_CSS = `
.ss-slide{position:relative;overflow:hidden;box-sizing:border-box;line-height:1.2;font-family:Arial,Helvetica,sans-serif;flex:none}
.ss-slide *{box-sizing:border-box}
.ss-el{position:absolute;transform-origin:50% 50%}
.ss-geo{position:absolute;overflow:visible;pointer-events:none}
.ss-tx{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;overflow:visible}
.ss-tc{width:100%;white-space:pre-wrap;overflow-wrap:break-word;outline:none;min-height:1em;counter-reset:ssn}
.ss-p{position:relative;min-height:1.2em;margin:0}
.ss-p[data-lv]{padding-left:calc(var(--lv,0) * 1.1em)}
.ss-p[data-bu]{padding-left:calc(.95em + var(--lv,0) * 1.1em)}
.ss-p[data-bu]::before{content:'\\2022';position:absolute;left:calc(var(--lv,0) * 1.1em);top:0}
.ss-p[data-bu][data-lv='1']::before{content:'\\25E6'}
.ss-p[data-bu][data-lv='2']::before{content:'\\25AA'}
.ss-p[data-bu][data-lv='3']::before{content:'\\2013'}
.ss-p[data-bu='num']{counter-increment:ssn;padding-left:calc(1.5em + var(--lv,0) * 1.1em)}
.ss-p[data-bu='num']::before{content:counter(ssn) '.';width:1.4em}
.ss-p:not([data-bu='num']){counter-reset:ssn}
.ss-img{display:block;width:100%;height:100%;pointer-events:none;user-select:none}
.ss-tbl{border-collapse:collapse;table-layout:fixed}
.ss-tbl td{overflow-wrap:anywhere;white-space:pre-wrap}
.ss-thumb-box{position:relative;overflow:hidden;flex:none;line-height:0}
.ss-thumb-box > .ss-slide{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}
`

const EDIT_CSS = `
.ss-edit{user-select:none;-webkit-user-select:none}
.ss-edit .ss-el:not(.ss-decor){cursor:move}
.ss-edit .ss-decor{pointer-events:none}
.ss-edit .ss-el[data-type=line]{pointer-events:none}
.ss-edit .ss-el[data-type=line] .ss-hit{pointer-events:stroke;cursor:move}
.ss-edit .ss-el:not(.ss-decor):not(.editing):hover{outline:calc(1px * var(--iz,1)) solid color-mix(in srgb,#5b4cf0 55%,transparent)}
.ss-edit .ss-el.editing{cursor:text}
.ss-edit .ss-tc[contenteditable=true]{cursor:text;user-select:text;-webkit-user-select:text}
.ss-edit .ss-tbl td[contenteditable=true]{cursor:text;user-select:text;-webkit-user-select:text;outline:calc(1px * var(--iz,1)) dashed rgba(91,76,240,.5);outline-offset:-1px}
.ss-edit .ss-p[data-hint]::after{content:attr(data-hint);opacity:.4}
.ss-imgph{position:absolute;inset:0;display:grid;place-items:center;border:2px dashed rgba(127,127,150,.6);border-radius:8px;color:rgba(110,110,135,.95);font:500 18px system-ui,sans-serif;background:rgba(127,127,150,.09);cursor:pointer;text-align:center;padding:8px}
`

export const APP_CSS = `
.ss{position:relative;display:flex;flex-direction:column;height:max(560px,calc(100dvh - var(--header-h) - 150px));max-height:1100px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);overflow:hidden;outline:none;font-size:13px;color:var(--text);box-shadow:var(--shadow);-webkit-tap-highlight-color:transparent}
.tool-body.app:fullscreen .ss{height:calc(100dvh - 20px);max-height:none}
.ss button,.ss input,.ss select,.ss textarea{font-family:inherit}
.ss-grow{flex:1}
.ss-top{display:flex;align-items:center;gap:3px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--surface);flex:none;overflow-x:auto;scrollbar-width:none}
.ss-top::-webkit-scrollbar,.ss-ribbon::-webkit-scrollbar{display:none}
.ss-brand{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--brand);color:#fff;flex:none}
.ss-brand .icon{width:16px;height:16px}
.ss-title{flex:0 1 230px;min-width:96px;height:32px;border:1px solid transparent;border-radius:8px;background:transparent;padding:0 8px;margin:0 4px;font-weight:600;font-size:14px;color:var(--text)}
.ss-title:hover{border-color:var(--border)}
.ss-title:focus{border-color:var(--accent);outline:none;background:var(--surface-2)}
.ss-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:32px;height:32px;padding:0 6px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--text-2);cursor:pointer;font-weight:500;flex:none;white-space:nowrap}
.ss-btn .icon{width:17px;height:17px}
.ss-btn.has-text{padding:0 10px}
.ss-btn:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
.ss-btn[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
.ss-btn:disabled{opacity:.38;cursor:default}
.ss-btn:focus-visible,.ss-sl:focus-visible,.ss-card:focus-visible,.ss-tab:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.ss-btn.danger:hover:not(:disabled){background:var(--danger-soft);color:var(--danger)}
.ss-btn[aria-expanded=true]{background:var(--surface-3)}
.ss-sep{width:1px;height:20px;background:var(--border);margin:0 5px;flex:none}
.ss-split{display:flex;flex:none;margin-left:4px;border-radius:9px;overflow:hidden;background:var(--accent);box-shadow:0 8px 18px -10px var(--accent)}
.ss-split .ss-btn{border-radius:0;color:var(--accent-text);height:32px}
.ss-split .ss-btn:hover:not(:disabled){background:rgba(255,255,255,.18);color:var(--accent-text)}
.ss-split .ss-present-more{min-width:28px;padding:0 4px;border-left:1px solid rgba(255,255,255,.25)}
.ss-zoom{min-width:52px}
.ss-ribbon{display:flex;align-items:center;gap:2px;padding:5px 10px;border-bottom:1px solid var(--border);background:var(--surface-2);overflow-x:auto;scrollbar-width:none;flex:none}
.ss-group{display:flex;align-items:center;gap:2px;flex:none}
.ss-select{height:30px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 6px;font-size:13px;min-width:0}
.ss-font{width:142px}
.ss-size{width:54px;height:30px;text-align:center;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px;-moz-appearance:textfield}
.ss-size:disabled,.ss-select:disabled,.ss-num:disabled{opacity:.45}
.ss-colorbtn{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer;font-size:13px;flex:none}
.ss-colorbtn:hover:not(:disabled){border-color:var(--border-strong)}
.ss-colorbtn:disabled{opacity:.4;cursor:default}
.ss-ribbon .ss-colorbtn{border-color:transparent;background:transparent;padding:0 7px}
.ss-ribbon .ss-colorbtn:hover:not(:disabled){background:var(--surface-3)}
.ss-chip{width:18px;height:18px;border-radius:5px;border:1px solid var(--border-strong);background:#000;flex:none}
.ss-chip.none{background:linear-gradient(135deg,transparent 45%,#d92d20 45% 55%,transparent 55%),var(--surface)}
.ss-main{flex:1;min-height:0;display:grid;grid-template-columns:196px minmax(0,1fr) 292px}
.ss-sorter{display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--border);background:var(--surface-2)}
.ss-ph{display:flex;align-items:center;gap:2px;padding:8px 6px 4px 12px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.ss-count{margin-left:6px;padding:0 6px;border-radius:999px;background:var(--surface-3);font-size:11px}
.ss-slist{flex:1;overflow:auto;padding:6px 10px 14px 8px;display:flex;flex-direction:column;gap:10px;position:relative;outline:none;min-height:0}
.ss-sl{position:relative;display:flex;gap:6px;cursor:pointer;flex:none;user-select:none}
.ss-sl .ss-n{width:16px;font-size:11px;color:var(--muted);text-align:right;padding-top:3px;flex:none}
.ss-sl .ss-thumb-box{border:2px solid var(--border);border-radius:6px;background:#fff;box-shadow:var(--shadow-sm);box-sizing:content-box}
.ss-sl:hover .ss-thumb-box{border-color:var(--border-strong)}
.ss-sl.cur .ss-thumb-box{border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}
.ss-sl.dragging{opacity:.35}
.ss-ghost{position:fixed;z-index:100000;pointer-events:none;opacity:.9;transform:rotate(-1.5deg);box-shadow:var(--shadow-lg)}
.ss-dropline{position:absolute;background:var(--accent);border-radius:3px;pointer-events:none;z-index:5}
.ss-anchor{position:fixed;width:1px;height:1px;pointer-events:none}
.ss-work{display:grid;grid-template-columns:46px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;min-height:0;min-width:0}
.ss-rail{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 5px;border-right:1px solid var(--border);background:var(--surface)}
.ss-tool{width:34px;height:34px}
.ss-canvas{position:relative;display:flex;overflow:auto;padding:26px;background:var(--bg-2);min-height:0;min-width:0;outline:none}
.ss-stage-wrap{position:relative;margin:auto;flex:none;box-shadow:0 14px 44px -14px rgba(10,10,30,.45);border-radius:2px;background:#fff}
.ss-stage{position:absolute;left:0;top:0;transform-origin:0 0;touch-action:none;background:#fff;user-select:none}
.ss-overlay{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.ss-sel-box,.ss-overlay .ss-sel{position:absolute;box-sizing:border-box;border:calc(1.5px * var(--iz,1)) solid var(--accent);pointer-events:none}
.ss-overlay .ss-sel.multi,.ss-overlay .ss-sel.editing,.ss-overlay .ss-sel.group{border-style:dashed}
.ss-overlay .ss-sel.multi{opacity:.7}
.ss-overlay .ss-sel.line{border:0}
.ss-h{position:absolute;width:calc(10px * var(--iz,1));height:calc(10px * var(--iz,1));margin:calc(-5px * var(--iz,1)) 0 0 calc(-5px * var(--iz,1));background:#fff;border:calc(1.5px * var(--iz,1)) solid var(--accent);border-radius:calc(2px * var(--iz,1));pointer-events:auto;touch-action:none;box-sizing:border-box}
.ss-h.corner{width:calc(11px * var(--iz,1));height:calc(11px * var(--iz,1));margin:calc(-5.5px * var(--iz,1)) 0 0 calc(-5.5px * var(--iz,1))}
.ss-h[data-h=nw]{left:0;top:0;cursor:nwse-resize}.ss-h[data-h=n]{left:50%;top:0;cursor:ns-resize}.ss-h[data-h=ne]{left:100%;top:0;cursor:nesw-resize}
.ss-h[data-h=e]{left:100%;top:50%;cursor:ew-resize}.ss-h[data-h=se]{left:100%;top:100%;cursor:nwse-resize}.ss-h[data-h=s]{left:50%;top:100%;cursor:ns-resize}
.ss-h[data-h=sw]{left:0;top:100%;cursor:nesw-resize}.ss-h[data-h=w]{left:0;top:50%;cursor:ew-resize}
.ss-h.rot{left:50%;top:calc(-30px * var(--iz,1));border-radius:50%;cursor:grab;display:grid;place-items:center;width:calc(18px * var(--iz,1));height:calc(18px * var(--iz,1));margin:calc(-9px * var(--iz,1)) 0 0 calc(-9px * var(--iz,1))}
.ss-h.rot .icon{width:70%;height:70%;color:var(--accent)}
.ss-h.pt{border-radius:50%;cursor:crosshair;width:calc(12px * var(--iz,1));height:calc(12px * var(--iz,1));margin:calc(-6px * var(--iz,1)) 0 0 calc(-6px * var(--iz,1))}
@media (pointer:coarse){.ss-h{width:calc(18px * var(--iz,1));height:calc(18px * var(--iz,1));margin:calc(-9px * var(--iz,1)) 0 0 calc(-9px * var(--iz,1))}.ss-h.corner{width:calc(20px * var(--iz,1));height:calc(20px * var(--iz,1));margin:calc(-10px * var(--iz,1)) 0 0 calc(-10px * var(--iz,1))}.ss-h.rot{top:calc(-40px * var(--iz,1))}}
.ss-guide{position:absolute;background:#ff3d81;pointer-events:none}
.ss-guide.v{top:0;bottom:0;width:calc(1px * var(--iz,1));margin-left:calc(-.5px * var(--iz,1))}
.ss-guide.hz{left:0;right:0;height:calc(1px * var(--iz,1));margin-top:calc(-.5px * var(--iz,1))}
.ss-marquee{position:absolute;border:calc(1px * var(--iz,1)) solid var(--accent);background:rgba(91,76,240,.12);pointer-events:none}
.ss-draw{position:absolute;border:calc(1.5px * var(--iz,1)) dashed var(--accent);background:rgba(91,76,240,.08);pointer-events:none}
.ss-draw.round{border-radius:50%}
.ss-draw.line{border:0;border-top:calc(2px * var(--iz,1)) solid var(--accent);background:none}
.ss-notes{grid-column:1/-1;border-top:1px solid var(--border);padding:6px 12px 8px;background:var(--surface)}
.ss-notes-l{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px}
.ss-notes-l .icon{width:14px;height:14px}
.ss-notes-ta{width:100%;height:54px;resize:vertical;min-height:38px;max-height:220px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;background:var(--surface-2);color:var(--text);font-size:13px;line-height:1.4}
.ss-notes-ta:focus{outline:2px solid var(--ring);border-color:var(--accent)}
.ss-insp{display:flex;flex-direction:column;min-height:0;min-width:0;border-left:1px solid var(--border);background:var(--surface)}
.ss-tabs{display:flex;border-bottom:1px solid var(--border);flex:none}
.ss-tab{flex:1;display:flex;gap:6px;align-items:center;justify-content:center;height:40px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-weight:600;cursor:pointer;font-size:13px}
.ss-tab .icon{width:15px;height:15px}
.ss-tab[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent)}
.ss-ibody{flex:1;overflow:auto;min-height:0}
.ss-pane{padding:2px 14px 18px;display:flex;flex-direction:column}
.ss-section{padding:12px 0 14px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:10px}
.ss-section:last-child{border-bottom:0}
.ss-section h3{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600}
.ss-field{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-2);min-width:0}
.ss-field>span{min-width:46px;flex:none}
.ss-field em{font-style:normal;color:var(--muted)}
.ss-field.wide>span{min-width:84px}
.ss-field.wide .ss-select,.ss-field.wide input[type=range],.ss-field.wide .ss-seg,.ss-field.wide .ss-text{flex:1;min-width:0}
.ss-num,.ss-text{width:100%;min-width:0;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 8px;font-size:13px}
.ss-num:focus,.ss-text:focus,.ss-select:focus,.ss-size:focus,.ss-hex:focus{outline:2px solid var(--ring);border-color:var(--accent)}
.ss-grid4{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ss-btnrow{display:flex;flex-wrap:wrap;gap:3px}
.ss-btnrow .ss-btn{border-color:var(--border);background:var(--surface)}
.ss-btnrow .ss-btn:hover:not(:disabled){background:var(--surface-2)}
.ss-btnrow .ss-btn[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent)}
.ss-row{display:flex;gap:14px;flex-wrap:wrap}
.ss-link{border:0;background:none;color:var(--accent);padding:2px 0;font-size:12.5px;cursor:pointer;text-align:left;font-weight:500}
.ss-link:hover:not(:disabled){text-decoration:underline}
.ss-link:disabled{opacity:.4;cursor:default}
.ss-seg{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.ss-seg button{flex:1;height:28px;border:0;background:var(--surface);color:var(--text-2);cursor:pointer;font-size:12px;padding:0 8px;border-right:1px solid var(--border);display:grid;place-items:center}
.ss-seg button:last-child{border-right:0}
.ss-seg button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);font-weight:600}
.ss-seg .icon{width:15px;height:15px}
.ss-switch{font-size:13px}
.ss-tgrid2,.ss-lgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.ss-card{display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-2);cursor:pointer;font-size:11.5px;min-width:0}
.ss-card:hover{border-color:var(--border-strong)}
.ss-card.on{border-color:var(--accent);background:var(--accent-soft);color:var(--text)}
.ss-card-thumb{border-radius:5px;overflow:hidden;border:1px solid var(--border);line-height:0;max-width:100%}
.ss-empty{display:grid;justify-items:center;gap:6px;text-align:center;padding:34px 14px;color:var(--muted)}
.ss-empty .icon{width:28px;height:28px;opacity:.6}
.ss-empty p{margin:0}
.ss-status{display:flex;gap:14px;align-items:center;padding:5px 12px;border-top:1px solid var(--border);background:var(--surface-2);color:var(--muted);font-size:12px;flex:none;overflow:hidden;white-space:nowrap}
.ss-status .ss-hint{overflow:hidden;text-overflow:ellipsis;min-width:0}
.ss-saved[data-state=saved]{color:var(--success)}
.ss-saved[data-state=failed]{color:var(--danger)}
.ss-credit{margin:10px 2px 0}
.ss-mtabs{display:none;border-top:1px solid var(--border);background:var(--surface);flex:none}
.ss-mtab{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:44px;border:0;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer}
.ss-mtab[aria-selected=true]{color:var(--accent);box-shadow:inset 0 2px 0 var(--accent)}
.ss-pop{position:absolute;z-index:40;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);padding:8px;min-width:140px;max-width:calc(100% - 12px);max-height:calc(100% - 12px);overflow:auto;animation:ss-pop .14s var(--ease)}
@keyframes ss-pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
.ss-pop-title{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;padding:2px 2px 6px}
.ss-menu{display:flex;flex-direction:column;min-width:230px;padding:0}
.ss-pop:has(.ss-menu){padding:5px}
.ss-menu hr{border:0;border-top:1px solid var(--border);margin:5px 4px}
.ss-menu-head{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:6px 10px 2px;font-weight:600}
.ss-menu-item{display:flex;align-items:center;gap:10px;padding:7px 10px;border:0;background:none;border-radius:8px;text-align:left;color:var(--text);cursor:pointer;font-size:13px;width:100%}
.ss-menu-item .icon{width:16px;height:16px;color:var(--text-2)}
.ss-menu-gap{width:16px;flex:none}
.ss-menu-item:hover:not(:disabled),.ss-menu-item:focus-visible{background:var(--surface-2);outline:0}
.ss-menu-item:disabled{opacity:.4;cursor:default}
.ss-menu-item.danger,.ss-menu-item.danger .icon{color:var(--danger)}
.ss-menu-item kbd{margin-left:auto}
.ss-menu-label{flex:1}
.ss-colors{width:238px;display:flex;flex-direction:column;gap:9px}
.ss-sw-row{display:flex;gap:6px;flex-wrap:wrap}
.ss-sw-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}
.ss-sw{width:24px;height:24px;border-radius:6px;border:1px solid var(--border-strong);cursor:pointer;padding:0}
.ss-sw.on{outline:2px solid var(--accent);outline-offset:1px}
.ss-hex-row{display:flex;gap:6px;align-items:center}
.ss-hex{flex:1;min-width:0;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 8px;font-family:var(--mono);font-size:12px}
.ss-native-color{width:34px;height:30px;padding:0;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer}
.ss-shapes{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;width:214px}
.ss-shape-pick{height:34px;border:0;background:none;border-radius:8px;color:var(--text-2);cursor:pointer;display:grid;place-items:center}
.ss-shape-pick:hover{background:var(--accent-soft);color:var(--accent)}
.ss-tgrid{display:grid;grid-template-columns:repeat(var(--cols),22px);gap:3px}
.ss-tcell{width:22px;height:18px;border:1px solid var(--border-strong);background:var(--surface);border-radius:3px;padding:0;cursor:pointer}
.ss-tcell.on{background:var(--accent);border-color:var(--accent)}
.ss-grid-label{font-size:12px;color:var(--text-2);padding:2px 2px 8px}
.ss-tip{position:absolute;z-index:60;background:#14141c;color:#fff;font-size:12px;padding:5px 9px;border-radius:7px;pointer-events:none;white-space:nowrap;box-shadow:var(--shadow)}
.ss-keys h3{margin:14px 0 6px;font-size:13px}
.ss-keys:first-child h3{margin-top:0}
.ss-tpls{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:12px 0}
.ss-tpl{display:flex;flex-direction:column;gap:3px;text-align:left;padding:12px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);cursor:pointer}
.ss-tpl span{color:var(--text-2);font-size:13px}
.ss-tpl small{color:var(--muted)}
.ss-tpl.on{border-color:var(--accent);background:var(--accent-soft)}
.ss-outline{width:100%;font-family:var(--mono);font-size:13px}
.ss-busy{position:absolute;inset:0;z-index:70;display:grid;place-items:center;background:color-mix(in srgb,var(--bg) 70%,transparent);backdrop-filter:blur(3px)}
.ss-busy-card{display:grid;gap:12px;min-width:min(320px,86%);padding:18px 20px;border-radius:14px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-lg);font-weight:600}
.ss-drop{position:absolute;inset:6px;z-index:65;display:none;place-items:center;border:2px dashed var(--accent);border-radius:12px;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);font-weight:600;font-size:16px;pointer-events:none}
.ss.dropping .ss-drop{display:grid}
.ss-present{position:fixed;inset:0;z-index:2147483000;background:#000;overflow:hidden;cursor:none;outline:none;color:#fff;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.ss-present.awake{cursor:default}
.ss-pstage,.ss-pl,.ss-pveil{position:absolute;inset:0}
.ss-pveil{z-index:3}
.ss-pbar{position:absolute;z-index:4;left:50%;bottom:18px;transform:translate(-50%,12px);display:flex;gap:4px;align-items:center;background:rgba(20,20,28,.82);color:#fff;border-radius:999px;padding:5px 8px;opacity:0;transition:opacity .25s,transform .25s;backdrop-filter:blur(8px);pointer-events:none}
.ss-present.awake .ss-pbar{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.ss-pbar button{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;border:0;background:transparent;color:#fff;cursor:pointer}
.ss-pbar button:hover{background:rgba(255,255,255,.16)}
.ss-pcount{font-variant-numeric:tabular-nums;font-size:13px;padding:0 8px;min-width:64px;text-align:center}
.ss-pprog{position:absolute;z-index:4;left:0;bottom:0;height:3px;width:100%;background:rgba(255,255,255,.1)}
.ss-pprog i{display:block;height:100%;background:#8b7dff;transition:width .3s}
.ss-btn.ss-hidden{display:none}
@media (max-width:820px){
  .ss{height:max(520px,calc(100dvh - 190px))}
  .ss-main{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
  .ss[data-pane=canvas] .ss-sorter,.ss[data-pane=canvas] .ss-insp,.ss[data-pane=slides] .ss-work,.ss[data-pane=slides] .ss-insp,.ss[data-pane=format] .ss-work,.ss[data-pane=format] .ss-sorter{display:none}
  .ss-mtabs{display:flex}
  .ss-top .has-text span,.ss-brand,.ss-top .ss-sep,.ss-zoomctl{display:none}
  .ss-top .ss-present-btn span{display:inline}
  .ss-title{flex:1 1 90px;min-width:70px}
  .ss-work{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto}
  .ss-rail{flex-direction:row;border-right:0;border-bottom:1px solid var(--border);padding:4px 8px;overflow-x:auto}
  .ss-canvas{padding:10px}
  .ss-slist{flex-direction:row;flex-wrap:wrap;align-content:flex-start;padding:12px}
  .ss-sorter{border-right:0}
  .ss-insp{border-left:0}
  .ss-notes-ta{height:40px}
  .ss-status .ss-hint{display:none}
  .ss-tool{width:38px;height:38px}
  .ss-btn{min-width:36px;height:36px}
  .ss-num,.ss-text,.ss-select,.ss-size,.ss-hex,.ss-seg button,.ss-colorbtn{min-height:36px}
  .ss-num,.ss-text,.ss-select,.ss-size,.ss-hex,.ss-notes-ta,.ss-title,.ss-outline{font-size:16px}
  .ss-font{width:130px}
}
@media (prefers-reduced-motion:reduce){.ss-pop,.ss-pbar,.ss-pprog i{animation:none;transition:none}}
`

export const PRESENTER_CSS = `
html,body{margin:0;height:100%;background:#0b0b10;color:#f3f3f8;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}
.pv{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);gap:16px;height:100vh;padding:16px;box-sizing:border-box}
.pv-main,.pv-side{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
.pv-cur{position:relative;flex:1;min-height:0;background:#000;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px #2a2a36}
.pv-next{position:relative;height:28vh;min-height:120px;background:#000;border-radius:10px;overflow:hidden;flex:none;box-shadow:0 0 0 1px #2a2a36}
.pv-notes{flex:1;min-height:80px;overflow:auto;background:#14141c;border-radius:10px;padding:12px 14px;line-height:1.5;white-space:pre-wrap;outline:none}
.pv-notes.empty{color:#7c7c8c;font-style:italic}
.pv-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9d9dab;display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600}
.pv-timer{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap}
.pv-timer small{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9d9dab}
.pv-elapsed{font-size:36px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.pv-clock{font-size:20px;font-variant-numeric:tabular-nums;line-height:1.5}
.pv-nav,.pv-fs{display:flex;gap:6px}
.pv button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:9px;border:1px solid #2f2f3c;background:#1b1b25;color:#f3f3f8;cursor:pointer;font:inherit}
.pv button:hover{background:#262633}
.pv .icon,.pv svg{width:16px;height:16px;flex:none}
.pv-fs button span{display:none}
.pv-fs button{padding:0 8px;height:26px}
.pv-nav button{flex:1;justify-content:center}
@media (max-width:760px){.pv{grid-template-columns:1fr;grid-template-rows:auto;height:auto;min-height:100vh}.pv-cur{height:45vh;flex:none}}
`

let injected = false
export function ensureStyles() {
  if (injected && document.getElementById('ss-style')) return
  injected = true
  const st = document.createElement('style')
  st.id = 'ss-style'
  st.textContent = SLIDE_CSS + EDIT_CSS + APP_CSS
  document.head.append(st)
}
