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
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.tabs button{background:#172033;color:#e2e8f0;border:1px solid #2b3a55;border-radius:8px;padding:8px 12px;cursor:pointer}
.tabs button.active{background:#1d4ed8;border-color:#60a5fa}
.actions a,.actions button{display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border-radius:8px;border:1px solid #2b3a55;background:#0f172a;color:#93c5fd;text-decoration:none;cursor:pointer}
code{background:#0f172a;padding:2px 6px;border-radius:6px}
@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<main>
<h1>canary</h1>
<p class="muted">Agent evaluation · runtime coverage · evidence-driven improvement · <a href="/">history</a></p>
<nav class="tabs" id="tabs">
<button data-view="overview" class="active">Overview</button>
<button data-view="timeline">Run Timeline</button>
<button data-view="features">Feature Coverage</button>
<button data-view="case">Case Detail</button>
<button data-view="improve">Improvement Queue</button>
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
</section>
<section class="card" data-panel="case" hidden>
<h2>Case Detail</h2>
<div id="cases">Waiting for cases…</div>
<pre id="trajectory">Select a case for assertion diff and coverage evidence.</pre>
</section>
<section class="card" data-panel="improve" hidden>
<h2>Improvement Queue</h2>
<div id="improvements">Waiting for suggestions…</div>
</section>
</main>
<script>
const runId=new URLSearchParams(location.search).get('runId');
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
function brief(ev){
  return {type:ev.type,caseId:ev.caseId||(ev.result&&ev.result.caseId),executionId:ev.executionId,passed:ev.result&&ev.result.passed,event:ev.event&&ev.event.type,error:ev.error,status:ev.status,completedCases:ev.completedCases};
}
const log=x=>{$('events').textContent=JSON.stringify(brief(x),null,2)+'\\n'+$('events').textContent;};
function coverage(c){
  const key=JSON.stringify({s:c.status,h:c.sourceHash,l:c.lines,b:c.branches,f:c.functions,st:c.statements});
  if(key===coverageFingerprint)return;
  coverageFingerprint=key;
  $('coverage').innerHTML='<div>'+c.status+' · '+['lines','branches','functions','statements'].map(function(k){return k+': <b>'+c[k].pct+'%</b> ('+c[k].covered+'/'+c[k].total+')';}).join(' · ')+'</div>'+(c.files||[]).map(function(f){return '<div class=muted>'+f.filePath+' · '+f.status+' · '+(f.quality&&f.quality.precision||'unknown')+'</div>';}).join('');
  $('features').innerHTML=(c.featureChains||[]).map(function(f){
    var locs=(f.uncoveredLocations||[]).slice(0,24).map(function(loc){return (loc.filePath||'')+':'+(loc.start&&loc.start.line||'?');}).join('<br>')||'No uncovered locations';
    return '<div class=card><b>'+f.name+'</b> · '+f.status+' · <b>'+f.coverage.pct+'%</b> ('+f.coverage.covered+'/'+f.coverage.total+')<div class=muted>expected: '+(f.expectedCaseIds||[]).join(', ')+' · cases: '+(f.caseIds||[]).join(', ')+'</div><div class=muted>'+locs+'</div></div>';
  }).join('')||'No feature chains yet';
}
function improvements(items){
  const list=items||[];
  $('improvements').innerHTML=list.length?list.map(function(s){return '<div><b>'+(s.category||'')+'</b> · '+(s.caseId||'')+' · '+(s.status||'proposed')+'<div class=muted>'+(s.rationale||'')+'</div></div>';}).join(''):'No improvement suggestions.';
}
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
  $('overview-metrics').innerHTML='pass '+ (s.passedCases||0)+' · fail '+failed+' · latency avg <b>'+avg+'ms</b> · steps <b>'+steps+'</b> · tool calls <b>'+tools+'</b> · timeout '+timeouts+' · loop '+loops+(s.replayOf?' · replay of '+s.replayOf:'');
  $('replay-cmd').textContent='canary replay '+s.runId;
  $('dl-json').href='/api/runs/'+s.runId+'/report/json';
  $('dl-md').href='/api/runs/'+s.runId+'/report/markdown';
  $('dl-junit').href='/api/runs/'+s.runId+'/report/junit';
  ['dl-json','dl-md','dl-junit'].forEach(function(id){$(id).setAttribute('download','');});
}
function render(s){
  current=s;
  $('status').textContent=s.status;
  $('progress').textContent=s.completedCases+'/'+s.totalCases;
  $('passed').textContent=s.passedCases;
  metrics(s);
  if(s.coverage)coverage(s.coverage);
  if(s.improvements)improvements(s.improvements);
  if($('events').getAttribute('data-from-run')!==s.runId){
    $('events').setAttribute('data-from-run',s.runId);
    $('events').textContent=(s.events&&s.events.length)?s.events.map(function(ev){return JSON.stringify(brief(ev));}).join('\\n'):'No events.';
  }
  if(s.results&&s.results.length){
    $('cases').innerHTML=s.results.map(function(x){return '<div><button data-case="'+x.caseId+'">'+(x.passed?'passed':'failed')+' '+x.caseId+'</button> · '+(x.coverage&&x.coverage.lines?x.coverage.lines.pct:0)+'% lines</div>';}).join('');
    $('cases').onclick=function(e){
      var btn=e.target.closest('button');
      if(!btn)return;
      var found=s.results.find(function(r){return r.caseId===btn.getAttribute('data-case');});
      var asserts=(found&&found.assertions||[]).map(function(a){return (a.passed?'PASS':'FAIL')+' '+a.id+(a.message?': '+a.message:'');}).join('\\n');
      var evidence=(found&&found.coverage&&found.coverage.files||[]).map(function(f){return f.filePath+' · '+f.status+' · uncovered '+(f.uncoveredLocations&&f.uncoveredLocations.length||0);}).join('\\n');
      $('trajectory').textContent='assertions\\n'+asserts+'\\n\\ncoverage evidence\\n'+(evidence||'none')+'\\n\\ntrajectory\\n'+JSON.stringify(found&&found.trajectory||found,null,2);
    };
  }
}
$('replay-btn').onclick=function(){
  if(!runId)return;
  $('replay-status').textContent='Replaying…';
  fetch('/api/runs/'+runId+'/replay',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json().then(function(data){return {ok:r.ok,data:data};});}).then(function(res){
    $('replay-status').textContent=res.data.command||JSON.stringify(res.data);
    if(res.ok&&res.data.replayRunId) location.search='?runId='+encodeURIComponent(res.data.replayRunId);
  }).catch(function(err){$('replay-status').textContent=String(err);});
};
if(runId){
  const es=new EventSource('/api/runs/'+runId+'/events');
  function handle(type,e,fn){var data=JSON.parse(e.data);log({type:type,runId:data.runId,status:data.status,completedCases:data.completedCases});fn(data);}
  es.addEventListener('run.snapshot',function(e){handle('run.snapshot',e,render);});
  es.addEventListener('run.updated',function(e){handle('run.updated',e,render);});
  es.addEventListener('run.finished',function(e){handle('run.finished',e,render);});
  es.addEventListener('run.replay',function(e){handle('run.replay',e,render);});
  es.addEventListener('coverage.updated',function(e){handle('coverage.updated',e,coverage);});
  es.onmessage=function(e){log(JSON.parse(e.data));};
  fetch('/api/runs/'+runId).then(function(r){return r.json();}).then(render);
  fetch('/api/runs/'+runId+'/improvements').then(function(r){return r.json();}).then(improvements).catch(function(){});
}else{
  fetch('/api/runs').then(function(r){return r.json();}).then(function(runs){
    $('status').textContent='history';
    $('events').textContent='';
    $('coverage').innerHTML=runs.map(function(r){return '<div><a href="?runId='+r.runId+'">'+r.runId+'</a> · '+r.status+' · '+r.passedCases+'/'+r.totalCases+' · '+r.startedAt+'</div>';}).join('')||'No historical runs. Start with canary run.';
    $('cases').textContent='Open a historical run to inspect cases.';
    $('improvements').textContent='Open a historical run to inspect the Improvement Queue.';
    $('overview-metrics').textContent='Open a run to see pass rate, latency, steps and tool calls.';
    $('replay-cmd').textContent='canary replay <runId>';
  });
}
</script>
</body>
</html>`;
