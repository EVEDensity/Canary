# 暖白分析工作台：设计依据与验收

## 已确认的用户偏好

用户不接受原深蓝配色与平均分布的卡片，要求联网参考国际获奖面板、重新组织信息并提升交互。用户已选择暖白、石墨文字与珊瑚橙强调。

## 官方奖项参考

- [SAP Fiori Embedded Analytics](https://www.red-dot.org/project/sap-fiori-embedded-analytics-integrated-business-intelligence-26201)，Red Dot Design Concept 2016：官方介绍强调从聚合指标下钻到具体事件。本次用于指导“图表 → 检查抽屉 → 完整执行视图”。
- [Samsung Clinician Dashboard](https://www.red-dot.org/de/project/samsung-clinician-dashboard-49216)，Red Dot Brands & Communication Design 2020：围绕实时监控和任务优先级组织信息。本次将待处理事项置于主趋势旁，形成独立关注区。
- [Darqube](https://www.red-dot.org/project/darqube-55053)，Red Dot Brands & Communication Design 2021：官方强调可调整的分析工作区。本次提供通过率 / 耗时切换及历史窗口选择，保持同类型数据的上下文。

以上为设计原则参考，Canary 未获得这些奖项，也未复制获奖产品素材。配色来自用户选择。

## 新的信息布局

顶部依次为运行选择、紧凑的运行身份行和无重复卡片边框的指标带。首页以宽幅趋势为主，右侧为关注区；下方依次呈现执行耗时、覆盖范围和结果分布。日志及证据保留独立侧栏入口。

## 交互与边界

- 趋势支持通过率 / 秒数切换；耗时仅使用同时具有有效开始、结束时间的记录。
- 数据点悬停或键盘聚焦显示读数、时间、ID 与状态；点击或 Enter 选择运行。重复轮询不重建未变化的趋势图，避免打断聚焦。
- 耗时条目打开原生模态详情抽屉，保留运行 ID、状态、耗时及脱敏输出。支持 Escape、关闭按钮以及进入完整检查视图。
- 视图过渡与条形变化使用轻量动效，尊重 reduced-motion 偏好。
- 未采集、近似映射和重试子集继续明确标注；不制造完整仓库覆盖率。

## 验收

Web 构建与 20 项测试通过；浏览器使用真实历史记录验证通过率 / 耗时切换、检查详情抽屉、Escape 关闭、Tab 聚焦读数。桌面 1440 像素视口文档宽度 1425，无横向溢出。正式 4318 页面在 390 像素视口下文档宽度 375，错误提示为空，窄屏导航与内容排列已检查。本次不替代 R6 的真实平台与 Pi 证据。
