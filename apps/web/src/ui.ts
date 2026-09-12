const styles = `
:root{
  --bg:#0a0a0a;--surface:#111111;--elev:#181818;--panel:#141414;
  --gold:#d4a574;--gold2:#e8c49a;--gold-dim:rgba(212,165,116,.12);--gold-line:rgba(212,165,116,.22);
  --text:#f5f0eb;--muted:#8a7f73;--faint:#5c534b;
  --ok:#6fb07a;--ok-dim:rgba(111,176,122,.16);--bad:#e05252;--bad-dim:rgba(224,82,82,.16);
  --warn:#d4a030;--cyan:#7ba4c9;
  --sans:"Segoe UI Variable Text","Segoe UI","SF Pro Text",system-ui,sans-serif;
  --display:"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif;
  --mono:"Cascadia Code","JetBrains Mono","SF Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
body{background-image:radial-gradient(1200px 600px at 12% -10%,rgba(212,165,116,.08),transparent 55%),radial-gradient(900px 500px at 110% 0,rgba(123,164,201,.06),transparent 45%)}
.grain{position:fixed;inset:0;pointer-events:none;z-index:8;opacity:.035;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
a{color:var(--gold2);text-decoration:none}
a:hover{color:#fff}
button,select,input{font:inherit;color:inherit}
button{cursor:pointer}
code,.mono{font-family:var(--mono);font-size:12px}
.shell{position:relative;z-index:1;max-width:1320px;margin:0 auto;padding:28px 28px 64px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.wordmark{font-family:var(--display);font-size:40px;line-height:1;letter-spacing:-.03em;color:var(--text);display:inline-flex;align-items:center;gap:12px}
.wordmark img.logo{width:36px;height:36px;border-radius:10px;object-fit:contain;box-shadow:0 2px 10px rgba(212,165,116,.22)}
.wordmark i{color:var(--gold);font-style:normal}
.tagline{margin:8px 0 0;color:var(--muted);font-size:13px;letter-spacing:.01em}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--gold-line);background:var(--gold-dim);color:var(--gold2);border-radius:999px;padding:5px 10px;font-size:12px}
.chip.live::before,.chip.done::before,.chip.off::before,.chip.fail::before{content:"";width:7px;height:7px;border-radius:50%}
.chip.live::before{background:var(--gold);box-shadow:0 0 0 4px rgba(212,165,116,.18);animation:pulse 1.8s ease-in-out infinite}
.chip.done::before{background:var(--ok)}
.chip.fail::before{background:var(--bad)}
.chip.off::before{background:var(--faint)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
[hidden]{display:none!important}
.banner{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid var(--gold-line);background:rgba(212,160,48,.08);border-radius:10px;padding:8px 12px;margin:0 0 14px;font-size:13px}
.banner button{border:0;background:transparent;color:var(--muted)}
.tabs{display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--surface);border:1px solid var(--gold-dim);border-radius:12px;margin:0 0 16px}
.tabs button{white-space:nowrap}
.tabs button{background:transparent;color:var(--muted);border:0;border-radius:8px;padding:8px 12px}
.tabs button:hover{color:var(--text);background:var(--gold-dim)}
.tabs button.active{background:var(--gold);color:#1a140c;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.card{background:var(--surface);border:1px solid var(--gold-dim);border-radius:14px;padding:16px}
.kpi{padding:18px 16px;min-height:96px}
.kpi .muted{margin-top:6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.metric{font-size:28px;font-weight:650;letter-spacing:-.03em;line-height:1.1}
.muted{color:var(--muted)}
.ok{color:var(--ok)}
.bad{color:var(--bad)}
.status-idle{color:var(--muted)}
.status-running{color:var(--gold)}
.status-completed,.status-covered,.status-final,.status-verified,.status-accepted{color:var(--ok)}
.status-failed,.status-uncovered{color:var(--bad)}
.status-cancelled{color:#fdba74}
.status-partial,.status-provisional{color:var(--warn)}
.status-unavailable{color:#94a3b8}
.status-preparing{color:var(--cyan)}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start;margin-top:16px}
.canvas{min-width:0}
.inspector{position:sticky;top:16px;background:var(--panel);border:1px solid var(--gold-line);border-radius:16px;padding:16px;min-height:280px}
.inspector h3{margin:0 0 8px;font-family:var(--display);font-weight:400;font-size:22px}
.inspector .hint{color:var(--faint);font-size:12px}
.split{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}
.graph-wrap{background:var(--bg);border:1px solid var(--gold-dim);border-radius:16px;overflow:hidden;height:320px}
#graph{width:100%;height:100%;display:block}
.gnode{cursor:pointer}
.gnode circle{fill:var(--elev);stroke:var(--gold);stroke-width:1.6}
.gnode.ok circle{stroke:var(--ok);fill:var(--ok-dim)}
.gnode.bad circle{stroke:var(--bad);fill:var(--bad-dim)}
.gnode.feat circle{stroke:var(--cyan);fill:rgba(123,164,201,.16)}
.gnode:hover circle,.gnode.on circle{stroke:var(--gold2);stroke-width:2.8}
.gnode text{fill:var(--muted);font-size:10px;text-anchor:middle;pointer-events:none;font-family:var(--mono)}
.gedge{stroke:rgba(212,165,116,.28);fill:none;stroke-width:1.2}
.mosaic{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.cell{border:1px solid var(--gold-dim);background:var(--elev);border-radius:8px;padding:8px 10px;min-width:72px;text-align:left;font-size:11px;color:var(--muted)}
.cell span{display:block;color:var(--text);font-family:var(--mono);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cell.ok{border-color:rgba(111,176,122,.35);background:var(--ok-dim)}
.cell.bad{border-color:rgba(224,82,82,.4);background:var(--bad-dim)}
.cell:hover,.cell.on{border-color:var(--gold);color:var(--gold2)}
.rings{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
.ring{text-align:center;background:var(--bg);border:1px solid var(--gold-dim);border-radius:12px;padding:10px 6px}
.ring svg{width:72px;height:72px;transform:rotate(-90deg)}
.ring .track{fill:none;stroke:rgba(245,240,235,.08);stroke-width:7}
.ring .val{fill:none;stroke:var(--gold);stroke-width:7;stroke-linecap:round}
.ring b{display:block;margin-top:-48px;font-size:13px}
.ring span{display:block;margin-top:28px;color:var(--muted);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.bar{height:6px;border-radius:99px;background:rgba(245,240,235,.08);overflow:hidden}
.bar i{display:block;height:100%;background:var(--gold);border-radius:inherit}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.actions a,.actions button,select,input[type=search]{border:1px solid var(--gold-line);background:var(--bg);color:var(--gold2);border-radius:8px;padding:8px 12px}
.actions a:hover,.actions button:hover{background:var(--gold-dim);color:var(--text)}
.pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid var(--gold-line);font-size:11px}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--gold-dim);font-size:13px}
.row button{border:0;background:transparent;color:inherit;padding:0;text-align:left}
.tl{display:grid;grid-template-columns:14px 1fr;gap:10px;margin:0 0 10px}
.tl i{width:10px;height:10px;border-radius:50%;background:var(--gold);margin-top:5px;box-shadow:0 0 0 4px var(--gold-dim)}
.tl.ok i{background:var(--ok);box-shadow:0 0 0 4px var(--ok-dim)}
.tl.bad i{background:var(--bad);box-shadow:0 0 0 4px var(--bad-dim)}
.tl b{display:block;font-size:12px;font-weight:600}
.kbd{font-family:var(--mono);font-size:10px;border:1px solid var(--gold-line);background:var(--gold-dim);border-radius:4px;padding:1px 5px;color:var(--gold);margin-left:4px}
.help{color:var(--faint);font-size:11px;margin:8px 0 0}
pre{white-space:pre-wrap;max-height:280px;overflow:auto;color:var(--gold2);background:var(--bg);border-radius:10px;padding:10px;font-size:12px;border:1px solid var(--gold-dim)}
details{margin-top:10px;color:var(--muted);font-size:12px}
.source{font-family:var(--mono);font-size:12px;line-height:1.45;max-height:420px;overflow:auto;background:var(--bg);border-radius:8px;padding:8px;margin:8px 0;border:1px solid var(--gold-dim)}
.source .ln{display:inline-block;width:3.2em;color:#64748b;text-align:right;margin-right:12px;user-select:none}
.source .hit{background:#102418}
.source .miss{background:#3f1d1d}
.delta{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.delta b{font-size:18px}
.queue{display:grid;gap:10px}
.queue .card{border-left:3px solid var(--gold)}
h2{font-family:var(--display);font-weight:400;font-size:26px;margin:0 0 10px}
.filter{width:100%;margin:0 0 10px}
.step{border:1px solid var(--gold-dim);border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:12px;background:var(--bg)}
.step b{color:var(--gold2)}
@media(max-width:960px){.workspace,.split,.rings{grid-template-columns:1fr}.inspector{position:static}}
@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.wordmark{font-size:32px}}
@media(prefers-reduced-motion:reduce){.chip.live::before{animation:none}}
`;

const page = `
<div class="grain" aria-hidden="true"></div>
<div class="shell">
<header class="top">
  <div>
    <a class="wordmark" href="/"><img src="/logo.png" class="logo" alt="Canary logo" />can<i>ary</i></a>
    <p class="tagline">Agent evaluation · runtime coverage · evidence-driven improvement · <a href="/">history</a></p>
  </div>
  <div class="meta">
    <span id="run-chip" class="chip mono">no run</span>
    <span id="live-chip" class="chip off">idle</span>
  </div>
</header>
<div id="live-banner" class="banner status-partial" hidden></div>
<!--NOSCRIPT-->
<nav class="tabs" id="tabs" aria-label="Views">
<button data-view="overview" class="active">Overview</button>
<button data-view="timeline">Run Timeline</button>
<button data-view="features">Feature Coverage</button>
<button data-view="case">Case Detail</button>
<button data-view="improve">Improvement Queue</button>
<button data-view="compare">Compare</button>
</nav>
<div class="grid">
<div class="card kpi"><div id="status" class="metric">idle</div><div class="muted">status</div></div>
<div class="card kpi"><div id="progress" class="metric">0/0</div><div class="muted">cases</div></div>
<div class="card kpi"><div id="passed" class="metric">0</div><div class="muted">passed</div></div>
<div class="card kpi"><div id="passrate" class="metric">—</div><div class="muted">pass rate</div></div>
</div>
<div class="workspace">
<div class="canvas">
<section class="card" data-panel="overview">
<h2>Overview</h2>
<div id="overview-metrics" class="muted">Waiting for run data…</div>
<div class="graph-wrap" id="graph-wrap"><svg id="graph" role="img" aria-label="Case and feature graph"></svg></div>
<div id="mosaic" class="mosaic"></div>
<div id="rings" class="rings"></div>
<div id="coverage">Waiting for coverage data…</div>
<p class="muted">Replay 命令：<code id="replay-cmd">canary replay &lt;runId&gt;</code></p>
<div class="actions">
<button id="replay-btn" type="button">Replay</button>
<a id="dl-json" href="#">JSON</a>
<a id="dl-md" href="#">Markdown</a>
<a id="dl-junit" href="#">JUnit</a>
</div>
<div id="replay-status" class="muted"></div>
<p class="help">Click a node or tile to inspect. Shortcuts <span class="kbd">1</span>–<span class="kbd">6</span> switch views · <span class="kbd">/</span> filters cases.</p>
</section>
<section class="card" data-panel="timeline" hidden>
<h2>Run Timeline</h2>
<div id="timeline-view"></div>
<details><summary>Raw event log</summary><pre id="events">Connecting…</pre></details>
</section>
<section class="card" data-panel="features" hidden>
<h2>Feature Coverage</h2>
<div id="features">Waiting for feature coverage…</div>
<div id="source-view"></div>
</section>
<section class="card" data-panel="case" hidden>
<h2>Case Detail</h2>
<input id="case-filter" class="filter" type="search" placeholder="Filter cases" aria-label="Filter cases">
<div id="cases">Waiting for cases…</div>
<div id="trace-view"></div>
<pre id="trajectory">Select a case for assertion diff, state diff and coverage evidence.</pre>
<div id="case-source"></div>
</section>
<section class="card" data-panel="improve" hidden>
<h2>Improvement Queue</h2>
<p class="muted">proposed → accepted/rejected → verified。只有 verified 会写入默认 regression 集。不改 Agent 源码。</p>
<div id="improvements" class="queue">Waiting for suggestions…</div>
</section>
<section class="card" data-panel="compare" hidden>
<h2>Compare</h2>
<p class="muted">baseline / candidate 对比。选择两次 run 后查看 regressions、improvements 与 coverage delta。</p>
<p class="actions">
<select id="cmp-base"><option value="">baseline</option></select>
<select id="cmp-cand"><option value="">candidate</option></select>
<button id="cmp-go" type="button">Compare</button>
</p>
<div id="cmp-viz"></div>
<pre id="cmp-out">Select two runs to compare.</pre>
</section>
</div>
<aside class="inspector" id="inspector">
<h3>Inspector</h3>
<p class="hint">Click a node, tile, or event.</p>
<div id="inspector-body"></div>
</aside>
</div>
</div>
`;

const client = `
const params=new URLSearchParams(location.search);
const runId=params.get('runId');
const $=id=>document.getElementById(id);
let coverageFingerprint='';
let current=null;
let selectedIndex=-1;
function showView(name){
  document.querySelectorAll('[data-view]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-view')===name);});
  document.querySelectorAll('[data-panel]').forEach(function(el){el.hidden=el.getAttribute('data-panel')!==name;});
}
document.getElementById('tabs').onclick=function(e){
  var btn=e.target.closest('[data-view]');
  if(!btn)return;
  showView(btn.getAttribute('data-view'));
};
document.addEventListener('keydown',function(e){
  var tag=e.target&&e.target.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  var map={Digit1:'overview',Digit2:'timeline',Digit3:'features',Digit4:'case',Digit5:'improve',Digit6:'compare'};
  if(map[e.code])showView(map[e.code]);
  if(e.key==='/'){e.preventDefault();var f=$('case-filter');showView('case');if(f)f.focus();}
});
function esc(value){return String(value==null?'':value).replace(/[&<>]/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[ch];});}
function tone(status){
  var n=String(status||'idle');
  if(n==='completed'||n==='covered'||n==='verified'||n==='accepted'||n==='passed'||n==='final')return 'status-completed';
  if(n==='running')return 'status-running';
  if(n==='failed'||n==='uncovered')return 'status-failed';
  if(n==='cancelled')return 'status-cancelled';
  if(n==='partial'||n==='provisional')return 'status-partial';
  if(n==='unavailable')return 'status-unavailable';
  if(n==='preparing')return 'status-preparing';
  return 'status-idle';
}
function setLive(kind,text){
  var el=$('live-chip');
  if(!el)return;
  el.className='chip '+(kind||'off');
  el.textContent=text||kind||'idle';
}
function setBanner(text,kind){
  var el=$('live-banner');
  if(!el)return;
  if(!text){el.hidden=true;el.textContent='';el.className='banner';return;}
  el.hidden=false;
  el.className='banner '+(kind||'status-partial');
  el.innerHTML='<span>'+esc(text)+'</span><button type="button" data-dismiss="banner">Dismiss</button>';
}
document.addEventListener('click',function(e){
  if(e.target&&e.target.getAttribute&&e.target.getAttribute('data-dismiss')==='banner')setBanner('');
});
function brief(ev){
  return {type:ev.type,caseId:ev.caseId||(ev.result&&ev.result.caseId),executionId:ev.executionId,passed:ev.result&&ev.result.passed,event:ev.event&&ev.event.type,error:ev.error,status:ev.status,completedCases:ev.completedCases,repetition:ev.repetition||(ev.result&&ev.result.repetition)};
}
const log=x=>{$('events').textContent=JSON.stringify(brief(x),null,2)+'\\n'+$('events').textContent;};
function sourceView(files){
  return (files||[]).map(function(f){
    if(!f.sourceText) return '<div class=muted>'+esc(f.filePath)+' · no source text</div>';
    var uncovered={};
    (f.uncoveredLocations||[]).forEach(function(loc){if(loc.start)uncovered[loc.start.line]=true;});
    var covered={};
    (f.coveredLineNumbers||[]).forEach(function(n){covered[n]=true;});
    var lines=String(f.sourceText).split('\\n');
    return '<div class=source><div class=muted>'+esc(f.filePath)+'</div>'+lines.map(function(line,i){
      var n=i+1;
      var cls=covered[n]?'hit':(uncovered[n]?'miss':'');
      return '<div class="'+cls+'"><span class=ln>'+n+'</span>'+esc(line)+'</div>';
    }).join('')+'</div>';
  }).join('')||'';
}
function shortName(id){
  var s=String(id||'');
  return s.length>18?s.slice(0,16)+'…':s;
}
function inspect(html){$('inspector-body').innerHTML=html;}
function ring(pct,label){
  var r=34,c=2*Math.PI*r,p=Math.max(0,Math.min(100,Number(pct)||0)),off=c*(1-p/100);
  var color=p>=90?'var(--ok)':p>=60?'var(--gold)':'var(--bad)';
  return '<div class="ring"><svg viewBox="0 0 84 84" aria-label="'+esc(label)+' '+p+'%"><circle class="track" cx="42" cy="42" r="34"/><circle class="val" cx="42" cy="42" r="34" stroke="'+color+'" stroke-dasharray="'+c.toFixed(2)+'" stroke-dashoffset="'+off.toFixed(2)+'"/></svg><b>'+p+'%</b><span>'+esc(label)+'</span></div>';
}
function drawRings(c){
  if(!c||!$('rings'))return;
  if(c.status==='preparing'){$('rings').innerHTML='<div class="status-preparing">preparing</div>';return;}
  $('rings').innerHTML=['lines','branches','functions','statements'].map(function(k){return ring(c[k]&&c[k].pct,k);}).join('');
}
function drawMosaic(s){
  var el=$('mosaic');
  if(!el)return;
  var results=s.results||[];
  el.innerHTML=results.map(function(r,i){
    var ms=r.metrics&&r.metrics.latencyMs||0;
    var h=Math.max(28,Math.min(64,8+Math.round(ms/60)));
    return '<button type="button" class="cell '+(r.passed?'ok':'bad')+(i===selectedIndex?' on':'')+'" data-index="'+i+'" style="height:'+h+'px" title="'+esc(caseLabel(r))+' · '+ms+'ms"><span>'+esc(r.caseId)+'</span>'+ms+'ms</button>';
  }).join('');
  el.onclick=function(e){
    var btn=e.target.closest('[data-index]');
    if(!btn)return;
    openCase(Number(btn.getAttribute('data-index')));
  };
}
function drawGraph(s){
  var el=$('graph');
  if(!el)return;
  var results=s.results||[];
  var features=(s.coverage&&s.coverage.featureChains)||[];
  var wrap=$('graph-wrap');
  var w=Math.max((wrap&&wrap.clientWidth)||720,280);
  var n=results.length, f=features.length;
  var cols=Math.min(Math.max(n,1),8);
  var rows=Math.max(1,Math.ceil(n/cols));
  var h=Math.max(220,Math.min(f?92+rows*72:48+rows*72,360));
  el.setAttribute('viewBox','0 0 '+w+' '+h);
  wrap.style.height=h+'px';
  if(!n&&!f){el.innerHTML='';return;}
  var pad=36, inner=w-pad*2;
  var fpts=features.map(function(feat,i){
    return {x:pad+((i+0.5)/Math.max(f,1))*inner,y:36,feat:feat};
  });
  var pts=results.map(function(r,i){
    var col=i%cols, row=Math.floor(i/cols);
    return {x:pad+((col+0.5)/cols)*inner,y:(f?96:40)+row*68,i:i,ok:r.passed,id:r.caseId};
  });
  var edges='';
  fpts.forEach(function(fp){
    (fp.feat.caseIds||[]).concat(fp.feat.expectedCaseIds||[]).forEach(function(id){
      var p=pts.find(function(x){return x.id===id;});
      if(p)edges+='<path class="gedge" d="M'+fp.x+' '+fp.y+' C '+fp.x+' '+(fp.y+40)+', '+p.x+' '+(p.y-40)+', '+p.x+' '+p.y+'"/>';
    });
  });
  var nodes=fpts.map(function(fp){
    return '<g class="gnode feat" data-feat="'+esc(fp.feat.featureId||fp.feat.name)+'" transform="translate('+fp.x+','+fp.y+')"><title>'+esc(fp.feat.name)+'</title><circle r="12"/><text y="28">'+esc(shortName(fp.feat.name||fp.feat.featureId))+'</text></g>';
  }).join('')+pts.map(function(p){
    return '<g class="gnode '+(p.ok?'ok':'bad')+(p.i===selectedIndex?' on':'')+'" data-index="'+p.i+'" transform="translate('+p.x+','+p.y+')"><title>'+esc(p.id)+'</title><circle r="11"/><text y="26">'+esc(shortName(p.id))+'</text></g>';
  }).join('');
  el.innerHTML=edges+nodes;
  el.onclick=function(e){
    var g=e.target.closest('[data-index]');
    if(g){openCase(Number(g.getAttribute('data-index')));return;}
    var feat=e.target.closest('[data-feat]');
    if(!feat)return;
    var id=feat.getAttribute('data-feat');
    var found=((s.coverage&&s.coverage.featureChains)||[]).find(function(x){return (x.featureId||x.name)===id;});
    if(!found)return;
    inspect('<div class="pill '+tone(found.status)+'">'+esc(found.status)+'</div><h3 style="margin:8px 0">'+esc(found.name)+'</h3><p class="muted">'+found.coverage.pct+'% · '+found.coverage.covered+'/'+found.coverage.total+'</p><p class="muted">cases: '+(found.caseIds||[]).join(', ')+'</p><p class="muted">expected: '+(found.expectedCaseIds||[]).join(', ')+'</p>');
    showView('features');
  };
}
function drawTimeline(s){
  var el=$('timeline-view');
  if(!el)return;
  var events=s.events||[];
  el.innerHTML=events.length?events.map(function(ev,i){
    var b=brief(ev);
    var label=b.type+(b.caseId?' · '+b.caseId:'');
    var klass=b.passed===true?'ok':b.passed===false?'bad':'';
    return '<div class="tl '+klass+'" data-ev="'+i+'"><i></i><div><b>'+esc(label)+'</b><span class="muted">'+(b.passed===true?'passed':b.passed===false?'failed':(b.status||''))+'</span></div></div>';
  }).join(''):'<div class="muted">No events.</div>';
  el.onclick=function(e){
    var row=e.target.closest('[data-ev]');
    if(!row)return;
    var ev=events[Number(row.getAttribute('data-ev'))];
    inspect('<p class="muted">timeline</p><pre>'+esc(JSON.stringify(brief(ev),null,2))+'</pre>');
  };
}
function coverage(c){
  if(!c)return;
  const key=JSON.stringify({s:c.status,h:c.sourceHash,l:c.lines,b:c.branches,f:c.functions,st:c.statements});
  if(key===coverageFingerprint)return;
  coverageFingerprint=key;
  if(c.status==='preparing'){
    $('coverage').innerHTML='<div class="status-preparing">preparing · scanning source maps…</div>';
    $('source-view').innerHTML='';
    drawRings(c);
    return;
  }
  $('coverage').innerHTML='<div class="'+tone(c.status)+'">'+c.status+' · '+['lines','branches','functions','statements'].map(function(k){return k+': <b>'+c[k].pct+'%</b> ('+c[k].covered+'/'+c[k].total+')';}).join(' · ')+'</div>'+(c.files||[]).map(function(f){return '<div class="muted '+tone(f.status)+'">'+esc(f.filePath)+' · '+f.status+' · '+(f.quality&&f.quality.precision||'unknown')+'</div>';}).join('');
  $('features').innerHTML=(c.featureChains||[]).map(function(f){
    var locs=(f.uncoveredLocations||[]).slice(0,24).map(function(loc){return (loc.filePath||'')+':'+(loc.start&&loc.start.line||'?');}).join('<br>')||'No uncovered locations';
    var pct=f.coverage&&f.coverage.pct||0;
    return '<div class=card data-feat-card="'+esc(f.featureId||f.name)+'"><b>'+esc(f.name)+'</b> · <span class="pill '+tone(f.status)+'">'+f.status+'</span> · <b>'+pct+'%</b> ('+f.coverage.covered+'/'+f.coverage.total+')<div class="bar" style="margin:8px 0"><i style="width:'+pct+'%"></i></div><div class=muted>expected: '+(f.expectedCaseIds||[]).join(', ')+' · cases: '+(f.caseIds||[]).join(', ')+'</div><div class=muted>'+locs+'</div></div>';
  }).join('')||'No feature chains yet';
  $('source-view').innerHTML=sourceView(c.files);
  drawRings(c);
}
function improvements(items){
  const list=items||[];
  $('improvements').innerHTML=list.length?list.map(function(s){
    var kind=s.kind?' · '+s.kind:'';
    var actions='<button type=button data-suggest="'+esc(s.id)+'" data-status="accepted">Accept</button> <button type=button data-suggest="'+esc(s.id)+'" data-status="rejected">Reject</button>'+(s.status==='accepted'?' <button type=button data-suggest="'+esc(s.id)+'" data-status="verified">Verify</button>':'');
    return '<div class=card data-suggestion="'+esc(s.id)+'"><b>'+(s.category||'')+'</b>'+kind+' · '+(s.caseId||'')+' · <span class='+(s.status==='verified'||s.status==='accepted'?'ok':'muted')+'>'+(s.status||'proposed')+'</span><div class=muted>'+(s.rationale||'')+'</div><div class="actions">'+actions+'</div></div>';
  }).join(''):'No improvement suggestions.';
}
$('improvements').onclick=function(e){
  var btn=e.target.closest('[data-suggest]');
  if(!btn||!runId)return;
  fetch('/api/runs/'+runId+'/improvements/'+encodeURIComponent(btn.getAttribute('data-suggest')),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:btn.getAttribute('data-status')})}).then(function(r){return r.json().then(function(data){return {ok:r.ok,data:data};});}).then(function(res){
    if(!res.ok){$('improvements').insertAdjacentHTML('afterbegin','<div class=bad>'+esc(res.data.error||'decision failed')+'</div>');return;}
    return fetch('/api/runs/'+runId+'/improvements').then(function(r){return r.json();}).then(improvements);
  }).catch(function(err){$('improvements').insertAdjacentHTML('afterbegin','<div class=bad>'+esc(err)+'</div>');});
};
function metrics(s){
  var results=s.results||[];
  var failed=Math.max(0,(s.completedCases||0)-(s.passedCases||0));
  var rate=s.totalCases?Math.round((s.passedCases||0)*1000/s.totalCases)/10:0;
  $('passrate').textContent=rate+'%';
  var latency=0,steps=0,tools=0,timeouts=0,loops=0;
  results.forEach(function(r){
    latency+=r.metrics&&r.metrics.latencyMs||0;
    steps+=r.metrics&&r.metrics.steps||0;
    tools+=r.metrics&&r.metrics.toolCalls||0;
    if(r.failureCategory==='timeout'||(r.trajectory&&r.trajectory.termination==='timeout'))timeouts+=1;
    if(r.failureCategory==='loop'||(r.trajectory&&r.trajectory.termination==='loop_detected'))loops+=1;
  });
  var avg=results.length?Math.round(latency/results.length):0;
  var reps=results.filter(function(r){return r.repetitionTotal>1;}).length;
  $('overview-metrics').innerHTML='pass '+ (s.passedCases||0)+' · fail '+failed+' · latency avg <b>'+avg+'ms</b> · steps <b>'+steps+'</b> · tool calls <b>'+tools+'</b> · timeout '+timeouts+' · loop '+loops+(reps?' · repetitions '+reps:'')+(s.replayOf?' · replay of '+s.replayOf:'');
  $('replay-cmd').textContent='canary replay '+s.runId;
  $('dl-json').href='/api/runs/'+s.runId+'/report/json';
  $('dl-md').href='/api/runs/'+s.runId+'/report/markdown';
  $('dl-junit').href='/api/runs/'+s.runId+'/report/junit';
  ['dl-json','dl-md','dl-junit'].forEach(function(id){$(id).setAttribute('download','');});
}
function caseLabel(x){
  return (x.repetition&&x.repetitionTotal&&x.repetitionTotal>1)?x.caseId+' #'+x.repetition:x.caseId;
}
function renderTrace(found){
  var events=(found&&found.trajectory&&found.trajectory.events)||[];
  if(!events.length){$('trace-view').innerHTML='';return;}
  $('trace-view').innerHTML=events.map(function(ev){
    return '<div class="step"><b>'+esc(ev.type)+'</b> <span class="muted">'+esc(ev.timestamp||'')+'</span></div>';
  }).join('');
}
function openCase(i){
  if(!current||!current.results)return;
  var found=current.results[i];
  if(!found)return;
  selectedIndex=i;
  document.querySelectorAll('.cell,[data-index].gnode').forEach(function(el){
    el.classList.toggle('on',Number(el.getAttribute('data-index'))===i);
  });
  var asserts=(found.assertions||[]).map(function(a){return (a.passed?'PASS':'FAIL')+' '+a.id+(a.message?': '+a.message:'');}).join('\\n');
  var evidence=(found.coverage&&found.coverage.files||[]).map(function(f){return f.filePath+' · '+f.status+' · uncovered '+(f.uncoveredLocations&&f.uncoveredLocations.length||0);}).join('\\n');
  var diff=found.stateDiff;
  var stateText=diff?'before '+JSON.stringify(diff.before,null,2)+'\\n\\nafter '+JSON.stringify(diff.after,null,2)+'\\n\\nchanged '+((diff.changed&&diff.changed.length)?diff.changed.join(', '):'(none)'):'No state snapshots.';
  $('trajectory').textContent='assertions\\n'+asserts+'\\n\\nstate diff\\n'+stateText+'\\n\\ncoverage evidence\\n'+(evidence||'none')+'\\n\\ntrajectory\\n'+JSON.stringify(found.trajectory||found,null,2);
  $('case-source').innerHTML=sourceView(found.coverage&&found.coverage.files);
  renderTrace(found);
  var ms=found.metrics&&found.metrics.latencyMs||0;
  inspect('<div class="pill '+tone(found.passed?'completed':'failed')+'">'+(found.passed?'passed':'failed')+'</div><h3 style="margin:8px 0">'+esc(caseLabel(found))+'</h3><p class="muted">'+ms+'ms · steps '+(found.metrics&&found.metrics.steps||0)+' · tools '+(found.metrics&&found.metrics.toolCalls||0)+'</p>'+(found.failureCategory?'<p class="bad">'+esc(found.failureCategory)+'</p>':'')+'<div>'+(found.assertions||[]).map(function(a){return '<div class="row"><span>'+esc(a.id)+'</span><span class="'+(a.passed?'ok':'bad')+'">'+(a.passed?'pass':'fail')+'</span></div>';}).join('')+'</div>');
}
function renderCases(s){
  var q=(($('case-filter')&&$('case-filter').value)||'').toLowerCase();
  $('cases').innerHTML=(s.results||[]).map(function(x,i){
    if(q&&String(x.caseId).toLowerCase().indexOf(q)<0)return '';
    var st=x.passed?'completed':(x.failureCategory==='cancelled'||(x.trajectory&&x.trajectory.termination==='cancelled')?'cancelled':'failed');
    return '<div class="row"><button class="'+tone(st)+'" data-index="'+i+'">'+st+' '+esc(caseLabel(x))+'</button> · '+(x.coverage&&x.coverage.lines?x.coverage.lines.pct:0)+'% lines · <span class="'+tone(x.coverage&&x.coverage.status)+'">'+(x.coverage&&x.coverage.status||'unavailable')+'</span></div>';
  }).join('')||'<div class="muted">No matching cases.</div>';
  $('cases').onclick=function(e){
    var btn=e.target.closest('button');
    if(!btn)return;
    openCase(Number(btn.getAttribute('data-index')));
  };
}
if($('case-filter'))$('case-filter').oninput=function(){if(current)renderCases(current);};
function render(s){
  current=s;
  $('status').className='metric '+tone(s.status);
  $('status').textContent=s.status;
  $('progress').textContent=s.completedCases+'/'+s.totalCases;
  $('passed').textContent=s.passedCases;
  $('passed').className='metric '+(s.totalCases&&s.passedCases===s.totalCases?'status-completed':(s.passedCases?'status-partial':'status-idle'));
  $('run-chip').textContent=s.runId||'no run';
  if(s.status==='running')setLive('live','live');
  else if(s.status==='failed')setLive('fail','failed');
  else if(s.status==='completed')setLive('done','snapshot');
  else setLive('off',s.status||'idle');
  metrics(s);
  if(s.coverage)coverage(s.coverage);
  if(s.improvements)improvements(s.improvements);
  if($('events').getAttribute('data-from-run')!==s.runId){
    $('events').setAttribute('data-from-run',s.runId);
    $('events').textContent=(s.events&&s.events.length)?s.events.map(function(ev){return JSON.stringify(brief(ev));}).join('\\n'):'No events.';
  }
  drawGraph(s);
  drawMosaic(s);
  drawTimeline(s);
  if(s.results&&s.results.length){
    renderCases(s);
    if(selectedIndex<0){
      var fail=s.results.findIndex(function(r){return !r.passed;});
      openCase(fail>=0?fail:0);
    }
  }
}
function fillCompare(runs){
  var html=runs.map(function(r){return '<option value="'+r.runId+'">'+r.runId+' · '+r.status+' · '+r.passedCases+'/'+r.totalCases+'</option>';}).join('');
  $('cmp-base').innerHTML='<option value="">baseline</option>'+html;
  $('cmp-cand').innerHTML='<option value="">candidate</option>'+html;
  var base=params.get('baseline');
  var cand=params.get('candidate');
  if(base)$('cmp-base').value=base;
  if(cand)$('cmp-cand').value=cand;
  if(base&&cand) compareRuns(base,cand);
}
function renderCompare(data){
  $('cmp-out').textContent=JSON.stringify(data,null,2);
  var d=data.coverageDelta||{};
  var sign=function(n){return (n>0?'+':'')+(Math.round(n*10)/10);};
  $('cmp-viz').innerHTML='<div class="delta"><div class="card"><div class="muted">verdict</div><b class="'+tone(data.verdict==='reject'?'failed':data.verdict==='improve'?'completed':'idle')+'">'+esc(data.verdict)+'</b></div><div class="card"><div class="muted">lines</div><b>'+sign(d.lines||0)+'</b></div><div class="card"><div class="muted">branches</div><b>'+sign(d.branches||0)+'</b></div><div class="card"><div class="muted">functions</div><b>'+sign(d.functions||0)+'</b></div></div><div class="muted">regressions: '+((data.regressions||[]).join(', ')||'none')+'</div><div class="muted">improvements: '+((data.improvements||[]).join(', ')||'none')+'</div>';
}
function compareRuns(base,cand){
  $('cmp-out').textContent='Comparing…';
  fetch('/api/compare?baseline='+encodeURIComponent(base)+'&candidate='+encodeURIComponent(cand)).then(function(r){return r.json();}).then(function(data){
    renderCompare(data);
  }).catch(function(err){$('cmp-out').textContent=String(err);});
}
$('cmp-go').onclick=function(){
  var base=$('cmp-base').value;
  var cand=$('cmp-cand').value;
  if(!base||!cand){$('cmp-out').textContent='Select two runs to compare.';return;}
  compareRuns(base,cand);
};
$('replay-btn').onclick=function(){
  if(!runId)return;
  $('replay-status').textContent='Replaying…';
  fetch('/api/runs/'+runId+'/replay',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json().then(function(data){return {ok:r.ok,data:data};});}).then(function(res){
    $('replay-status').textContent=res.data.command||JSON.stringify(res.data);
    if(res.ok&&res.data.replayRunId) location.search='?runId='+encodeURIComponent(res.data.replayRunId);
  }).catch(function(err){$('replay-status').textContent=String(err);});
};
fetch('/api/runs').then(function(r){return r.json();}).then(fillCompare).catch(function(){});
if(runId){
  var liveSource=null, pollTimer=null, sseErrors=0;
  function startPoll(){
    if(pollTimer)return;
    setBanner('Live stream disconnected. Polling snapshot…','status-partial');
    setLive('off','polling');
    pollTimer=setInterval(function(){
      fetch('/api/runs/'+runId).then(function(r){if(!r.ok)throw new Error('snapshot');return r.json();}).then(function(s){
        render(s);
        if(s.status==='completed'||s.status==='failed'||s.status==='cancelled'){
          clearInterval(pollTimer);pollTimer=null;
          setBanner('');
          setLive(s.status==='failed'?'fail':'done', s.status==='failed'?'failed':'snapshot');
        }
      }).catch(function(){setBanner('Cannot reach canary UI. Showing last known snapshot.','status-unavailable');setLive('off','offline');});
    },2000);
  }
  function connectEvents(){
    if(!window.EventSource){setBanner('EventSource unavailable. Polling snapshot…','status-partial');startPoll();return;}
    liveSource=new EventSource('/api/runs/'+runId+'/events');
    function handle(type,e,fn){var data=JSON.parse(e.data);log({type:type,runId:data.runId||data.payload&&data.payload.runId,status:data.status,completedCases:data.completedCases,caseId:data.caseId,error:data.error});if(fn)fn(data);}
    liveSource.addEventListener('run.snapshot',function(e){sseErrors=0;setBanner('');handle('run.snapshot',e,render);});
    liveSource.addEventListener('run.updated',function(e){handle('run.updated',e,render);});
    liveSource.addEventListener('run.finished',function(e){handle('run.finished',e,render);});
    liveSource.addEventListener('run.replay',function(e){handle('run.replay',e,render);});
    liveSource.addEventListener('run.error',function(e){handle('run.error',e);});
    liveSource.addEventListener('case.started',function(e){handle('case.started',e);});
    liveSource.addEventListener('case.finished',function(e){handle('case.finished',e);fetch('/api/runs/'+runId).then(function(r){return r.json();}).then(render);});
    liveSource.addEventListener('coverage.updated',function(e){handle('coverage.updated',e,coverage);});
    liveSource.onmessage=function(e){log(JSON.parse(e.data));};
    liveSource.onerror=function(){
      sseErrors+=1;
      setBanner('Live stream interrupted. Reconnecting…','status-partial');
      if(sseErrors>=3){liveSource.close();startPoll();}
    };
  }
  connectEvents();
  fetch('/api/runs/'+runId).then(function(r){return r.json();}).then(render);
  fetch('/api/runs/'+runId+'/improvements').then(function(r){return r.json();}).then(improvements).catch(function(){});
}else{
  fetch('/api/runs').then(function(r){return r.json();}).then(function(runs){
    $('status').textContent='history';
    $('status').className='metric status-idle';
    setLive('off','history');
    $('events').textContent='';
    $('coverage').innerHTML=runs.map(function(r){return '<div class="row"><a href="?runId='+r.runId+'">'+r.runId+'</a> · <span class="pill '+tone(r.status)+'">'+r.status+'</span> · '+r.passedCases+'/'+r.totalCases+' · '+r.startedAt+'</div>';}).join('')||'No historical runs. Start with canary run.';
    $('cases').textContent='Open a historical run to inspect cases.';
    $('improvements').textContent='Open a historical run to inspect the Improvement Queue.';
    $('overview-metrics').textContent='Open a run to see pass rate, latency, steps and tool calls.';
    $('replay-cmd').textContent='canary replay <runId>';
    inspect('<p class="muted">Open a historical run to inspect the graph, coverage rings, and traces.</p>');
  });
}
`;

export const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>canary</title>
<link rel="icon" type="image/png" href="/favicon.ico" />
<link rel="apple-touch-icon" href="/logo.png" />
<style>
${styles}
</style>
</head>
<body>
${page}
<script>
${client}
</script>
</body>
</html>`;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] ?? ch));
}

function statusTone(status: string | undefined): string {
  const n = status || "idle";
  if (n === "completed" || n === "covered" || n === "verified" || n === "accepted" || n === "passed" || n === "final") return "status-completed";
  if (n === "running") return "status-running";
  if (n === "failed" || n === "uncovered") return "status-failed";
  if (n === "cancelled") return "status-cancelled";
  if (n === "partial" || n === "provisional") return "status-partial";
  if (n === "unavailable") return "status-unavailable";
  if (n === "preparing") return "status-preparing";
  return "status-idle";
}

export function renderPage(run?: {
  runId: string;
  status: string;
  totalCases: number;
  passedCases: number;
  results?: Array<{ caseId: string; passed: boolean }>;
  coverage?: { status?: string };
}): string {
  const noscript = run
    ? `<noscript><section class="card"><h2>Snapshot (no JavaScript)</h2>
<p>Live SSE is unavailable. This is the last persisted snapshot.</p>
<p class="${statusTone(run.status)}">status: ${escapeHtml(run.status)}</p>
<p>cases: ${run.passedCases}/${run.totalCases} · coverage: ${escapeHtml(run.coverage?.status ?? "unavailable")}</p>
<ul>${(run.results ?? []).map((result) => `<li class="${statusTone(result.passed ? "completed" : "failed")}">${escapeHtml(result.caseId)} · ${result.passed ? "passed" : "failed"}</li>`).join("")}</ul>
<p><a href="/api/runs/${encodeURIComponent(run.runId)}">JSON snapshot</a> · <a href="/api/runs/${encodeURIComponent(run.runId)}/report/markdown">Markdown report</a></p>
</section></noscript>`
    : `<noscript><section class="card"><p>Enable JavaScript for the live dashboard, or open <a href="/api/runs">/api/runs</a> for JSON history.</p></section></noscript>`;
  return html.replace("<!--NOSCRIPT-->", noscript);
}
