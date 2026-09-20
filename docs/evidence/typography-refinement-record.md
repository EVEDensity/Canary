# 工作台字体与排版修订

- 字体：Inter Variable + Noto Sans SC Variable，Fontsource 5.3.0，随 @canary/web 发布，使用本地 HTTP 字体路由，保留 OFL 授权。
- 来源：[Inter](https://fontsource.org/fonts/inter)、[Noto Sans SC](https://fontsource.org/fonts/noto-sans-sc)。
- 中文和英文共享字重层级；正文 14px、卡片标题 16px、辅助信息 12–13px、主要指标 30–36px。品牌小字和页脚保留 10–11px。
- 增大按钮高度、说明行高，允许运行信息与指标说明自然换行。
- 趋势图按容器实际宽度绘制，避免固定 720 单位画布在手机上连同文字一起缩小。
- 字体子集按 unicode-range 加载，包内总资源约 4.85 MB；页面不请求外部字体 CDN。

## 验证

Web build、Web 20 项测试、根目录 lint 通过。HTTP 测试遍历字体 CSS 引用的全部 WOFF2 路径，检查 MIME、HEAD、文件签名及非法路径/方法。1440px 桌面与 390px 手机浏览器检查；手机文档宽度与可视宽度均为 375px，无横向溢出。

本次调整为展示层与字体资源服务；覆盖率数据仍保留真实来源和精度说明，未改变检查与证据判定。
