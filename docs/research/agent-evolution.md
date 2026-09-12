# Agent 进化资料与 Canary 的取舍

> 检索/核对窗口：本地 2026-09-13（Asia/Shanghai），对应 UTC 2026-09-12。本轮调用联网检索工具后，工具没有返回可用正文，因此另以 HTTPS 直接读取下列官方规范、工程文章和论文摘要。没有复现实验论文，也没有据其数字给 Canary 作效果保证。

## 1. 自循环的研究依据

| 来源                                                                       | 可借鉴的方向                                             | 对 Canary 的工程取舍与限制                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Reflexion，arXiv:2303.11366](https://arxiv.org/abs/2303.11366)            | 利用语言反馈和经验记忆改善后续尝试，而非必须更新模型权重 | 支持默认软进化方向；经验必须经过验证、限定作用域并在下一次实际加载                        |
| [GEPA，arXiv:2507.19457](https://arxiv.org/abs/2507.19457)                 | 使用执行反馈和反思搜索改善提示策略                       | 可研究候选生成与多目标筛选；不是把每条失败直接追加到 Prompt，也不是普遍优于其他方法的保证 |
| [Darwin Gödel Machine，arXiv:2505.22954](https://arxiv.org/abs/2505.22954) | 对 Agent 程序提出修改并用经验评估筛选                    | 支持将代码候选纳入硬进化研究；不能据论文认为任意用户项目可安全自动改写                    |
| [ACE，arXiv:2510.04618](https://arxiv.org/abs/2510.04618)                  | 通过结构化上下文适配累积策略，关注反复重写中的信息损失   | 经验库需要增量、来源、冲突和过期管理，而非无限增长或每轮整本重写                          |

以上是对摘要所述方法方向的归纳。**Canary 的设计推论**是组合“有来源的经验 / 候选搜索 / 冻结评估 / 受控激活”，不是复制某个研究系统或承诺论文基准收益。

## 2. 评估与隔离的工程依据

- [Anthropic：Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)：区分任务、trial、grader 和实际 outcome；不以 Agent 声称完成代替结果验证。Canary 因此优先修复 case/trial 完整性、实际状态检查和可解释准入。
- [Anthropic：Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)：文件系统和网络限制共同构成隔离的重要部分。Canary 的 Node 子进程不是相同级别的边界；自动写之前需要独立的隔离验收。
- [Inspect：Sandboxing](https://inspect.aisi.org.uk/sandboxing.html)：工具调用逻辑与其在隔离环境执行的工作有区别。配置 sandbox 不代表评估 harness 的每一段代码都在容器里；Canary 需具体说明 config、predicate、Agent、工具、Judge 和应用器各自运行位置。

这些来源支持设计方向，但不证明 Canary 当前具备相关能力，也不构成对任一操作系统隔离实现的认证。

## 3. MCP 必须按版本讨论

### 2025-11-25 及之前的兼容目标

[2025-11-25 Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)规定 initialize 握手与版本/能力协商。当前简化 stdio 调用路径不能据此被称为完整旧版客户端。

### 2026-07-28 的现代协议

[2026-07-28 Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)区分 modern、legacy、dual-era：现代请求携带版本、身份与能力元数据，旧版使用 initialize。兼容回退因传输而异。**所以不能把 RFC 中“补 initialize”泛化为所有版本的唯一完成标准。** 应固定所支持版本/SDK/宿主，分别做互操作和失败测试。

[2026-07-28 Sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling)明确将 Sampling 标为弃用，建议新实现不要采用，并说明至少保留十二个月才具备移除资格。弃用不等于立即删除，也不代表所有旧宿主已改变。

**Canary 的设计选择**：不把 Sampling 作为新架构的 Judge/宿主推理依赖。Skill 组织宿主完成分析，Canary 接收结构化提案；独立 Judge 使用用户明确授权且可审计的 Provider。不得把“通过 MCP”理解为可以读取宿主 API Key 或保证复用订阅。

## 4. Skill 与 MCP 的边界

Skill 是宿主侧工作流程说明，MCP 是工具/资源接口；两者互补而不是安全等级的二选一。首阶段优先一个宿主的 Skill + CLI，确有多宿主/结构化服务需求再增加 Canary MCP Server。

这里不承诺不同宿主都支持字面 `/canary`，也不提供未经实测的安装路径/调用语法。具体宿主版本的官方用法、触发方式与权限行为须在 S-01/S-02 中重新核对并记录真实集成结果。本轮没有执行 Codex/Claude/Cursor 宿主互操作测试。

## 5. 结论落点

- [产品架构](../design/product-architecture.md)：无 LLM 基础评估、Skill/可选 MCP、显式 Judge。
- [理想自循环](../design/agent-loop.md)：证据→候选→独立验证→授权激活→观察/回退。
- [硬规范](../design/evolution-policy.md)：把自然语言意图变成真实的权限、预算和准入控制。
- [任务总表](../roadmap/README.md)：先解决现有错误，再逐步开放自动化。

后续实施时重新核对在线规范，不把此处日期快照当成永久事实。
