import { controlStyles } from "./control-styles.js";
import { controlScript } from "./control-client.js";
export { controlStyles, controlScript };
export function renderControlPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Canary · Quality control</title><link rel="stylesheet" href="/control.css"><script src="/control.js" defer></script></head><body>
<a class="skip" href="#main">跳转到主内容</a>
<aside class="sidebar"><a class="brand" href="/" aria-label="Canary home"><span class="brand-icon">c</span>canary<span class="brand-dot">®</span></a><div class="workspace"><span class="eyebrow">LOCAL WORKSPACE</span><strong id="projectName">正在连接项目</strong><span class="local"><i></i> 本地证据 · 无云端依赖</span></div><nav aria-label="Control navigation"><button class="nav active" data-view="overview"><span>◈</span>总览 Overview</button><button class="nav" data-view="lineage"><span>⑂</span>版本谱系 Lineage</button><button cl