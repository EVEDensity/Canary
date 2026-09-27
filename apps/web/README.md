# canary local web UI

## 目标

以本地页面实时展示 Run、Case、Trajectory、Feature Coverage、源码位置、失败证据和 baseline/candidate 对比。

## 边界

- 页面只通过本地 API/SSE 消费 Result Store；不直接调用模型、工具或 Node inspector。
- POST replay / 建议写接口需要 `x-canary-write-token`（CLI 会注入页面）。CORS 不是授权。
- provisional、final、partial、unavailable 必须可见；UI 不改变评测结果。
- 默认不暴露到局域网，不保存 API Key，不把原始敏感 Trace 默认上传云端。

## 诊断与比较

“改进建议”把失败、分类、错误证据、复现、修复后重跑和前后比较串在同一问题卡中。项目重跑及 Agent 重放只有在运行谱系、原始输入/断言和封存证据通过校验后，才显示“重跑已验证”；历史失败仍保留。只读页面会禁用重跑操作。

“证据与比较”展示配对样本、改善、回归、缺席项和不确定性。少量样本、不同检查计划、重跑子集或未经人工校准的模型评分显示“证据不足”；状态变化不自动成为发布或因果结论。
