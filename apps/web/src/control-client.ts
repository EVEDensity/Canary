export const controlScript = String.raw`
'use strict';
const $ = id => document.getElementById(id);
let data, mode, token = '', view = 'overview', selected, pending;
const titles = {overview:['每一次进化，都有据可循。','理解质量变化、追溯版本来源，并做出受保护的决策。'],lineage:['版本之间，证据相连。','基线 → 候选 → 活动记录；实际加载经验独立核对。'],quality:['看见长期变化。','固定锚点观察累计退化；缺失测量不绘制为零。'],approvals:['让决策留下依据。','操作由受信后端执行；批准不会自动运行或部署。'],audit:['每个决定，都可追溯。','持久化请求、版本指纹和结果；未决操作阻断后续写入。']};
const labels = {'audit.reconcile':'确认已人工核对未决效果（不重放）','anchor.create':'建立固定锚点','holdout.rotate':'轮换保留集','holdout.exposure':'登记保留集暴露','soft.approve':'批准经验试验','soft.revoke':'撤销经验批准','soft.rollback':'回滚经验版本','experience.revoke':'撤销经验','hard.approve':'批准源码候选','hard.revoke':'撤销源码候选','hard.rollback':'回滚源码版本','authorization.revoke':'撤销授权','loop.stop':'停止循环','loop.takeover':'人工接管','loop.revoke':'撤销循环授权'};
function el(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n; }
function pill(v){return el('span','pill '+(['passed','completed','within_threshold','active'].includes(v)?'good':['failed','detected','pending','risk_detected'].includes(v)?'attention':''),v??'不可用');}
function metric(v,suffix=''){return typeof v==='number'&&Number.isFinite(v)?v.toFixed(2)+suffix:'不可用';}
function detail(value,label='查看证据元数据'){const d=el('details');d.append(el('summary','',label),el('pre','mono',JSON.stringify(value,null,2)));return d;}
function card(title,desc){const c=el('section','card'),h=el('div','card-head');h.append(el('h2','',title));if(desc)h.append(el('p','',desc));c.append(h);return c;}
function empty(text){return el('div','empty',text);}
function table(headers,rows){const w=el('div','table-wrap'),t=el('table'),head=el('tr');headers.forEach(h=>head.append(el('th','',h)));const th=el('thead');th.append(head);t.append(th);const b=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach(v=>{const td=el('td');td.append(v instanceof Node?v:document.createTextNode(String(v??'不可用')));tr.append(td);});b.append(tr);});t.append(b);w.append(t);return rows.length?w:empty('暂无对应证据。');}
function row(k,v){const r=el('div','row');r.append(el('span','label',k),v instanceof Node?v:el('span','mono',v??'不可用'));return r;}
function overview(root){const stats=el('div','stats');[['已记录运行',data.runs.length,'基于本地持久化结果'],['活动经验',data.activeExperience?.entries?.length??0,'不等于每次运行均已加载'],['固定锚点',data.anchors.length,'累计漂移独立观察'],['待决审计',data.audit.filter(a=>a.status==='pending'&&!a.resolution).length,'未决写入保持失败关闭']].forEach(([k,v,n])=>{const s=el('div','stat');s.append(el('div','stat-label',k),el('div','stat-value',v),el('div','stat-note',n));stats.append(s);});root.append(stats);const grid=el('div','grid'),q=card('最新实际测量','硬门禁与语义评估分开呈现'),r=data.runs[0];if(r){q.append(row('运行