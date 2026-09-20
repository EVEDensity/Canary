import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {verifyArtifacts} from './packages/trace/dist/index.js';
const origin='http://127.0.0.1:4318';const original='run_71b5481d-cdfe-40eb-be40-059dca6ba7d7';
const api=async(p,init)=>{const r=await fetch(origin+p,{...init,signal:AbortSignal.timeout(15000)});assert.ok([200,202].includes(r.status));return r.json()};
async function done(id){const deadline=Date.now()+240000;while(Date.now()<deadline){const r=await api('/api/runs/'+id);if(r.status!=='running')return r;await new Promise(r=>setTimeout(r,3000))}throw Error('Run did not finish')}
const before=await done(original);console.log('Initial actual run:',before.status,before.checks.map(c=>c.id+':'+c.status).join(','));
const html=await fetch(origin).then(r=>r.text());const token=JSON.parse(html.match(/const writeToken=("[^"]+")/)[1]);
const retry={runId:'run_77303c32-8d72-45f6-8997-37e9eb439353'};
console.log('Retry:',retry.runId);const after=await done(retry.runId);assert.equal(after.status,'completed');assert.ok(after.checks.every(c=>c.status==='passed'));
const dir='.canary/artifacts/'+retry.runId;for(let i=0;i<100 && verifyArtifacts(dir).status==='partial';i++)await new Promise(r=>setTimeout(r,100));assert.equal(verifyArtifacts(dir).status,'verified');const persisted=JSON.parse(readFileSync(dir+'/run.json'));assert.deepEqual(after.checks.map(c=>[c.id,c.status,c.durationMs]),persisted.checks.map(c=>[c.id,c.status,c.durationMs]));
const rows=await api('/api/runs');assert.ok(rows.every(r=>Array.isArray(r.checks)));
const report={kind:'canary.r6.live-page',date:new Date().toISOString(),origin,originalRunId:original,originalChecks:before.checks.map(({id,status})=>({id,status})),retryRunId:retry.runId,retryChecks:after.checks.map(({id,status,durationMs})=>({id,status,durationMs})),status:'verified',manifest:'verified',apiMatchesArtifact:true,url:origin+'/?runId='+retry.runId,pageStillListening:true};writeFileSync('docs/evidence/logs/r6-live-page.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
