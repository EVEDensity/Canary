import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
export interface SpoolOptions { root: string; maxBytes?: number; retentionMs?: number; }
export class FailureSpool {
  private readonly maxBytes: number; private readonly retentionMs: number;
  constructor(private readonly options: SpoolOptions) { this.maxBytes=options.maxBytes??10*1024*1024; this.retentionMs=options.retentionMs??7*24*60*60*1000; }
  private async dir(){ await mkdir(this.options.root,{recursive:true,mode:0o700}); return this.options.root; }
  async enqueue(value: unknown): Promise<boolean> { const dir=await this.dir(); const data=JSON.stringify(value); if(Buffer.byteLength(data)>this.maxBytes) return false; const files=await readdir(dir); let total=0; for(const f of files){ try{total+=(await stat(join(dir,f))).size;}catch{} } if(total+Buffer.byteLength(data)>this.maxBytes)return false; await writeFile(join(dir,`${Date.now()}-${Math.random().toString(16).slice(2)}.json`),data,{mode:0o600}); return true; }
  async flush(send:(value: unknown)=>Promise<boolean>, now=Date.now()): Promise<{sent:number; retained:number}> { const dir=await this.dir(); let sent=0,retained=0; for(const f of await readdir(dir)){ const p=join(dir,f); try { const st=await stat(p); if(now-st.mtimeMs>this.retentionMs){await rm(p);continue;} const ok=await send(JSON.parse(await readFile(p,"utf8"))); if(ok){await rm(p);sent++;}else retained++; } catch { retained++; } } return {sent,retained}; }
}
