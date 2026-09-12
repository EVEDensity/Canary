export const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>canary</title>
<style>
body{font-family:system-ui;margin:0;background:#0b1120;color:#e2e8f0}
main{max-width:1180px;margin:auto;padding:28px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.card{background:#172033;border:1px solid #2b3a55;border-radius:12px;padding:16px;margin:12px 0}
.metric{font-size:28px;font-weight:700}
.muted{color:#93a4bf}
pre{white-space:pre-wrap;max-height:420px;overflow:auto;color:#bfdbfe}
a,button.link{color:#93c5fd}
.ok{color:#86efac}
.bad{color:#fca5a5}
.status-idle{color:#93a4bf}
.status-running{color:#fbbf24}
.status-completed,.status-covered,.status-final,.status-verified,.status-accepted{color:#86efac}
.status-failed,.status-uncovered{color:#fca5a5}
.status-cancelled{color:#fdba74}
.status-partial,.status-provisional{color:#fcd34d}
.status-unavailable{color:#94a3b8}
.status-preparing{color:#67e8f9}
.banner{border:1px solid #2b3a55;border-radius:8px;padding:8px 12px;margin:8px 0}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #2b3a55;font-size:12px}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.tabs button{background:#172033;color:#e2e8f0;border:1px solid #2b3a55;border-radius:8px;padding:8px 12px;cursor:pointer}
.tabs button.active{background:#1d4ed8;border-color:#60a5fa}
.actions a,.actions button{display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border-radius:8px;border:1px solid #2b3a55;background:#0f172a;color:#93c5fd;text-decoration:none;cursor:pointer}
code{background:#0f172a;padding:2px 6px;border-radius:6px}
.source{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.45;max-height:420px;overflow:auto;background:#0f172a;border-radius:8px;padding:8px;margin:8px 0}
.source .ln{display:inline-block;width:3.2em;color:#64748b;text-align:right;margin-right:12px;user-select:none}
.source .hit{background:#052e16}
.source .miss{background:#3f1d1d}
select{background:#0f172a;color:#e2e8f0;border:1px solid #2b3a55;border-radius:8px;padding:6px 8px;margin-right:8px}
@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<main>
<h1>canary</h1>
<p class="muted">Agent evaluation · runtime coverage · evidence-driven improvement · <a href="/">history</a></p>
<div id="live-banner" class="banner status-partial" hidden></div>
<!--NOSCRIPT-->
<nav class="tabs" id="tabs">
<button data-view="overview" class="active">Overview</button>
<button data-view="timeline">Run Timeline</button>
<button data-view="features">Feature Coverage</button>
<button data-view="case">Case Detail</button>
<button data-view="improve">Improvement Queue</button>
<button data-view="compare">Compare</button>
</nav>
<div class="grid">
<div class="card"><div id="status" class="metric">idle</div><div class="muted">status</div></div>
<div class="card"><div id="progress" class="metric">0/0</div><div class="muted">cases</div></div>
<div class="card"><div id="passed" class="metric">0</div><div class="muted">passed</div></div>
<div class="card"><div id="passrate" class="metric">—</div><div class="muted">pass rate</div></div>
</div>
<section class="card" data-panel="overview">
<h2>Overview</h2>
<div id="overview-metrics" class="muted">Waiting for run data…</div>
<div id="coverage">Waiting for coverage data…</div>
<p class="muted">Replay 命令：<code id="replay-cmd">canary replay &lt;runId&gt;</code></p>
<div class="actions">
<button id="replay-btn" type="button">Replay</button>
<a id="dl-json" href="#">JSON</a>
<a id="dl-md" href="#">Markdown</a>
<a id="dl-junit" href="#">JUnit</a>
</div>
<div id="replay-status" class="muted"></div>
</section>
<section class="card" data-panel="timeline" hidden>
<h2>Run Timeline</h2>
<pre id="events">Connecting…</pre>
</section>
<section class="card" data-panel="features" hidden>
<h2>Feature Coverage</h2>
<div id="features">Waiting for feature coverage…</div>
<div id="source-view"></div>
</section>
<section class="card" data-panel="case" hidden>
<h2>Case Detail</h2>
<div id="cases">Waiting for cases…</div>
<pre id="trajectory">Select a case for assertion diff, state diff and coverage evidence.</pre>
<div id="case-source"></div>
</section>
<section class="card" data-panel="improve" hidden>
<h2>Improvement Queue</h2>
<p class="muted">proposed → accepted/rejected → verified。只有 verified 会写入默认 regression 集。不改 Agent 源码。</p>
<div id="improvements">Waiting for suggestions…</div>
</section>
<section class="card" data-panel="compare" hidden>
<h2>Compare</h2>
<p class="muted">baseline / candidate 对比。选择两次 run 后查看 regressions、improvements 与 coverage delta。</p>
<p>
<select id="cmp-base"><option value="">baseline</option></select>
<select id="cmp-cand"><option value="">candidate</option></select>
<button id="cmp-go" type="button">Compare</button>
</p>
<pre id="cmp-out">Select two runs to compare.</pre>
</section>
</main>
<script>
const params=new URLSearchParams(location.search);
const runId=params.get('runId');
const $=id=>document.getElementById(id);
let coverageFingerprint='';
let current=null;
document.getElementById('tabs').onclick=function(e){
  var btn=e.target.closest('[data-view]');
  if(!btn)return;
  var name=btn.getAttribute('data-view');
  document.querySelectorAll('[data-view]').forEach(function(el){el.classList.toggle('active',el===btn);});
  document.querySelectorAll('[data-panel]').forEach(function(el){el.hidden=el.getAttribute('data-panel')!==name;});
};
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
function setBanner(text,kind){
  var el=$('live-banner');
  if(!el)return;
  if(!text){el.hidden=true;el.textContent='';el.className='banner';return;}
  el.hidden=false;el.textContent=text;el.className='banner '+(kind||'status-partial');
}
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
function coverage(c){
  if(!c)return;
  const key=JSON.stringify({s:c.status,h:c.sourceHash,l:c.lines,b:c.branches,f:c.functions,st:c.statements});
  if(key===coverageFingerprint)return;
  coverageFingerprint=key;
  if(c.status==='preparing'){
    $('coverage').innerHTML='<div class="status-preparing">preparing · scanning source maps…</div>';
    $('source-view').innerHTML='';
    return;
  }
  $('coverage').innerHTML='<div class="'+tone(c.status)+'">'+c.status+' · '+['lines','branches','functions','statements'].map(function(k){return k+': <b>'+c[k].pct+'%</b> ('+c[k].covered+'/'+c[k].total+')';}).join(' · ')+'</div>'+(c.files||[]).map(function(f){return '<div class="muted '+tone(f.status)+'">'+f.filePath+' · '+f.status+' · '+(f.quality&&f.quality.precision||'unknown')+'</div>';}).join('');
  $('features').innerHTML=(c.featureChains||[]).map(function(f){
    var locs=(f.uncoveredLocations||[]).slice(0,24).map(function(loc){return (loc.filePath||'')+':'+(loc.start&&loc.start.line||'?');}).join('<br>')||'No uncovered locations';
    return '<div class=card><b>'+f.name+'</b> · <span class="pill '+tone(f.status)+'">'+f.status+'</span> · <b>'+f.coverage.pct+'%</b> ('+f.coverage.covered+'/'+f.coverage.total+')<div class=muted>expected: '+(f.expectedCaseIds||[]).join(', ')+' · cases: '+(f.caseIds||[]).join(', ')+'</div><div class=muted>'+locs+'</div></div>';
  }).join('')||'No feature chains yet';
  $('source-view').innerHTML=sourceView(c.files);
}
function improvements(items){
  const list=items||[];
  $('improvements').innerHTML=list.length?list.map(function(s){
    var kind=s.kind?' · '+s.kind:'';
    var actions='<button type=button data-suggest="'+esc(s.id)+'" data-status="accepted">Accept</button> <button type=button data-suggest="'+esc(s.id)+'" data-status="rejected">Reject</button>'+(s.status==='accepted'?' <button type=button data-suggest="'+esc(s.id)+'" data-status="verified">Verify</button>':'');
    return '<div class=card data-suggestion="'+esc(s.id)+'"><b>'+(s.category||'')+'</b>'+kind+' · '+(s.caseId||'')+' · <span class='+(s.status==='verified'||s.status==='accepted'?'ok':'muted')+'>'+(s.status||'proposed')+'</span><div class=muted>'+(s.rationale||'')+'</div><div class=actions>'+actions+'</div></div>';
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
function render(s){
  current=s;
  $('status').className='metric '+tone(s.status);
  $('status').textContent=s.status;
  $('progress').textContent=s.completedCases+'/'+s.totalCases;
  $('passed').textContent=s.passedCases;
  $('passed').className='metric '+(s.totalCases&&s.passedCases===s.totalCases?'status-completed':(s.passedCases?'status-partial':'status-idle'));
  metrics(s);
  if(s.coverage)coverage(s.coverage);
  if(s.improvements)improvements(s.improvements);
  if($('events').getAttribute('data-from-run')!==s.runId){
    $('events').setAttribute('data-from-run',s.runId);
    $('events').textContent=(s.events&&s.events.length)?s.events.map(function(ev){return JSON.stringify(brief(ev));}).join('\\n'):'No events.';
  }
  if(s.results&&s.results.length){
    $('cases').innerHTML=s.results.map(function(x,i){
      var st=x.passed?'completed':(x.failureCategory==='cancelled'||(x.trajectory&&x.trajectory.termination==='cancelled')?'cancelled':'failed');
      return '<div><button class="'+tone(st)+'" data-index="'+i+'">'+st+' '+caseLabel(x)+'</button> · '+(x.coverage&&x.coverage.lines?x.coverage.lines.pct:0)+'% lines · <span class="'+tone(x.coverage&&x.coverage.status)+'">'+(x.coverage&&x.coverage.status||'unavailable')+'</span></div>';
    }).join('');
    $('cases').onclick=function(e){
      var btn=e.target.closest('button');
      if(!btn)return;
      var found=s.results[Number(btn.getAttribute('data-index'))];
      var asserts=(found&&found.assertions||[]).map(function(a){return (a.passed?'PASS':'FAIL')+' '+a.id+(a.message?': '+a.message:'');}).join('\\n');
      var evidence=(found&&found.coverage&&found.coverage.files||[]).map(function(f){return f.filePath+' · '+f.status+' · uncovered '+(f.uncoveredLocations&&f.uncoveredLocations.length||0);}).join('\\n');
      var diff=found&&found.stateDiff;
      var stateText=diff?'before '+JSON.stringify(diff.before,null,2)+'\\n\\nafter '+JSON.stringify(diff.after,null,2)+'\\n\\nchanged '+((diff.changed&&diff.changed.length)?diff.changed.join(', '):'(none)'):'No state snapshots.';
      $('trajectory').textContent='assertions\\n'+asserts+'\\n\\nstate diff\\n'+stateText+'\\n\\ncoverage evidence\\n'+(evidence||'none')+'\\n\\ntrajectory\\n'+JSON.stringify(found&&found.trajectory||found,null,2);
      $('case-source').innerHTML=sourceView(found&&found.coverage&&found.coverage.files);
    };
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
function compareRuns(base,cand){
  $('cmp-out').textContent='Comparing…';
  fetch('/api/compare?baseline='+encodeURIComponent(base)+'&candidate='+encodeURIComponent(cand)).then(function(r){return r.json();}).then(function(data){
    $('cmp-out').textContent=JSON.stringify(data,null,2);
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
    pollTimer=setInterval(function(){
      fetch('/api/runs/'+runId).then(function(r){if(!r.ok)throw new Error('snapshot');return r.json();}).then(function(s){
        render(s);
        if(s.status==='completed'||s.status==='failed'||s.status==='cancelled'){
          clearInterval(pollTimer);pollTimer=null;
          setBanner('Showing last snapshot. Live stream is offline.','status-partial');
        }
      }).catch(function(){setBanner('Cannot reach canary UI. Showing last known snapshot.','status-unavailable');});
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
    $('events').textContent='';
    $('coverage').innerHTML=runs.map(function(r){return '<div><a href="?runId='+r.runId+'">'+r.runId+'</a> · <span class="pill '+tone(r.status)+'">'+r.status+'</span> · '+r.passedCases+'/'+r.totalCases+' · '+r.startedAt+'</div>';}).join('')||'No historical runs. Start with canary run.';
    $('cases').textContent='Open a historical run to inspect cases.';
    $('improvements').textContent='Open a historical run to inspect the Improvement Queue.';
    $('overview-metrics').textContent='Open a run to see pass rate, latency, steps and tool calls.';
    $('replay-cmd').textContent='canary replay <runId>';
  });
}
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
