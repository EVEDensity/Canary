#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
const home=join(homedir(),".canary"), state=join(home,"home.json"), current=join(home,"current"), staging=join(home,"staging-"+Date.now());
const source=process.env.CANARY_SOURCE; const ref=process.env.CANARY_REF||"HEAD"; if(!source) { console.error("CANARY_SOURCE is required for remote upgrade"); process.exit(2); }
const run=(c,a,cwd)=>{const r=spawnSync(c,a,{cwd,stdio:"inherit",shell:platform()==="win32"}); if(r.status!==0) throw new Error(`${c} failed (${r.status})`)};
try { mkdirSync(home,{recursive:true}); run("git",["clone","--no-checkout",source,staging]); run("git",["fetch","--tags","origin"],staging); run("git",["checkout","--detach",ref],staging); const pin=spawnSync("git",["rev-parse","HEAD"],{cwd:staging,encoding:"utf8"}).stdout.trim(); if(!pin) throw Error("cannot resolve pinned commit"); run("pnpm",["install","--frozen-lockfile"],staging); run("pnpm",["build"],staging); run("pnpm",["test"],staging); const old=existsSync(current)?current:null; const backup=join(home,"rollback-"+Date.now()); if(old) renameSync(current,backup); renameSync(staging,current); writeFileSync(state+".tmp",JSON.stringify({root:current,previousRoot:backup,ref,commit:pin,migrationVersion:3,updatedAt:new Date().toISOString()},null,2)); renameSync(state+".tmp",state); console.log(JSON.stringify({status:"upgraded",root:current,commit:pin,previousRoot:backup})); } catch(e) { if(existsSync(staging)) rmSync(staging,{recursive:true,force:true}); console.error(`offline-or-upgrade-failure: ${e.message}`); process.exit(1); }
