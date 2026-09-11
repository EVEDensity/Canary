# canary local web UI

## 目标

以本地页面实时展示 Run、Case、Trajectory、Feature Coverage、源码位置、失败证据和 baseline/candidate 对比。

## 边界

- 页面只通过本地 API/SSE 消费 Result Store；不直接调用模型、工具或 Node inspector。
- provisional、final、partial、unavailable 必须可见；UI 不改变评测结果。
- 默认不暴露到局域网，不保存 API Key，不把原始敏感 Trace 默认上传云端。
