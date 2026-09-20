# R4 项目级 CI 检查

R4 增加无交互项目门禁，复用 R3 的 artifact、脱敏、checkpoint 和完整性校验。旧 `agent/cases/coverage` 配置仍按原路径运行。CI 项目检查只写报告。R5 已为普通 run 接入本地页面，见 [R5 指南](r5-local-report.md)；不自动修复源码。

## 开始使用

```sh
canary discover --json
canary run --ci
canary run --ci --config canary.project.json
canary verify <runId> --json
```

根目录规则保持：显式 `--config` 优先，否则逐层向上查找最近配置目录；同一目录 `canary.project.json` 优先于 `canary.config.ts`。其他 JSON 文件名需显式传入。配置无效会报错，不回退到另一份配置。安装目录不代替被测项目；没有配置时 CI 返回 2。

`discover` 只读 marker，不导入配置或执行发现的脚本。Node 使用 `package.json` 中 test/lint/typecheck/build 脚本名作为候选；Python 使用 pyproject.toml/setup.py/requirements.txt；Go/Rust 只声明 marker。已识别返回 `declared`，未知返回 `blocked` 和退出码 2。**发现成功不是测试通过**。跨语言项目可以显式声明通用命令；发现器不会将全部脚本变成必需门禁。

配置可以是 `canary.config.ts` 的普通默认导出，也可使用 `@canary/core` 的 `defineProjectConfig`。JSON 示例：

```json
{
  "kind": "canary.project",
  "version": 1,
  "budgetMs": 120000,
  "checks": [
    {
      "id": "node.tests",
      "type": "command",
      "command": "node",
      "args": ["--test", "test/math.test.mjs"],
      "timeoutMs": 30000
    },
    {
      "id": "source.present",
      "type": "filesystem",
      "path": "package.json",
      "dependsOn": ["node.tests"]
    }
  ]
}
```

## 编排规则

- 按声明顺序串行执行。ID 唯一，依赖必须指向前面的检查，schema 拒绝前向依赖和环。
- 默认 `required: true`、`version: 1`、`cwd: "."`、`timeoutMs: 60000`。总执行预算默认 600000 ms；使用单调时钟。预算不包含配置导入、源码清单和历史恢复；清理及封存可能额外耗时。
- `platforms` 可选 win32/linux/darwin；不适用记录 excluded，不计为 passed。没有任何适用的必需检查返回 2。
- 依赖未 passed 时不执行依赖项，记录 blocked/dependency；必需依赖阻塞使门禁失败。取消与预算耗尽会将剩余项记录为 blocked。
- 必需断言失败返回 1。可选断言失败可保持总体 0，但结果仍显示失败、JUnit 显示 skipped。超时、取消、环境、配置、隐私与 artifact 错误不因 optional 而豁免。
- 多种失败同时发生时，退出码优先级为 6、5、3、4、10、2、1。沿用 CI v1：0 成功、1 检查失败、2 配置/发现、3 中断/超时/预算、4 环境、5 artifact、6 策略/隐私、10 内部错误。
- `retryable` 是超时/环境故障分类，不触发自动重试。项目模式不接受 agent 的 case/tag/entry/repetitions/replay/retry 参数；单项重跑与交互页面已由 [R5](r5-local-report.md)提供。

## 六类检查

- **command**：`command`、`args`、`expectedExit`（默认 0）。通过 argv 启动，`shell: false`；`node` 使用当前 Canary Node 可执行文件。Windows `.cmd` 不能直接当可执行文件使用，可显式使用 `node --run test` 调用项目脚本，或指定包管理器的 JS 入口。脚本及其依赖属于受信任代码。
- **process**：与 command 相同，增加必填 `readyText`。stdout 出现指定文本后终止该进程树并记为通过；提前退出则失败。它是启动就绪探针，不保持服务供后续项共享。
- **http**：`url`、`allowOutbound: true`、`expectedStatus`（默认 200）。包括 loopback 在内都需显式授权；只发 GET，不跟随重定向、不保存 body，拒绝 URL 凭据及非 HTTP(S) 协议。连接失败归环境，超时归 3。
- **filesystem**：相对 cwd 的 `path`，`expectation` 为 file/directory/absent，文件可附加 SHA-256。只读断言；cwd 和目标须位于项目根内，检查已有祖先的真实路径以拒绝 symlink 逃逸。
- **docker**：`container` 和 `expectedState`（running/exited）。只执行 `docker inspect --format {{.State.Status}}`；不拉取镜像或启动/删除容器。CLI/daemon 不可用归环境；预算内未响应归超时。本轮 Docker daemon 未运行，实机成功证据仍为 blocked。
- **agent**：`config` 指向同一项目根中的旧式 agent 配置。独立子 CLI 运行 `--ci`，验证其 CI schema、退出码和封存状态，再把子 runId、artifactPath、manifestHash 绑定到检查结果。拒绝递归项目配置和跨 artifact 集合子配置。子运行后续损坏或哈希变化，父运行完整性检查也失败；保留父运行时历史清理保护引用的子运行。

## 环境、报告与证据

子进程只继承 PATH/SystemRoot/WINDIR/COMSPEC/PATHEXT 和显式 `envAllowlist`，再加入运行专用 TMP/TEMP/TMPDIR/CANARY_TMPDIR/CANARY_WORKDIR/CANARY_RUN_ID。结果记录实际环境变量名，不记录值。已知敏感环境值和 token 模式在内存输出、持久化、报告和 CI 边界脱敏。

命令 stdout/stderr 总捕获上限 64 Ki 字符，超限丢弃整段，避免截断的凭据前缀被保留；持久化摘要各限 2048 字符并标记 `outputTruncated`。命令、参数、cwd、耗时、进程退出码、分类及是否执行都保存在 `checks.json`/`run.json`，不将项目检查伪造成 agent EvalResult。

CI stdout 仍是单行 `canary.ci` v1，`capabilities.scope` 为 `project-checks`；旧 agent 仍是 `configured-agent-cases`。`summary.failed` 包含失败和 blocked；excluded 不计为 passed。请以 exitCode 作为门禁，可选失败会体现在 summary 中。

每次运行写入 `check-plan.json`、`discovery.json`、`source-inventory.json`、`checks.json`、`run.json`、`checkpoint.json`、`report.json`、`report.md`、`report.xml` 及 CI envelope。所有文件纳入 R3 manifest。封存前回收进程树和临时目录；异常保留 partial checkpoint，后续运行复用 R3 恢复。

源码清单记录常见 JS/TS/Python/Go/Rust、JSON/YAML/TOML/lock 文件的字节哈希；跳过 symlink、.git、.canary、node_modules、dist/build/target、venv 和缓存。限制为 10000 个文件、单文件 16 MiB、总量 256 MiB，超限 blocked。清单明确声明范围，不声称覆盖所有二进制输入、网络状态或依赖安装内容；执行摘要记录配置、检查计划、源码清单、锁文件和允许的非敏感环境摘要。

配置和命令以当前用户权限运行；env 白名单及路径约束不构成 OS 沙箱。根进程退出后脱离跟踪的后台服务不属于该进程树回收保证。跨平台进程约束属于 R6/R7 的后续验收。agent 检查的配置导入也在子进程预算内；内部 `--agent-check` 防止项目配置递归，子 CLI 只能恢复自己拥有的 checkpoint。

## 本仓库复验

```sh
pnpm build
pnpm check
pnpm verify:r4 --out docs/evidence/logs/r4-acceptance.json
```

`canary.project.json` 对 Canary 自身运行 typecheck 和既有 agent 回归；不会递归调用整套验收。Node/Python fixture 位于 `scripts/fixtures/r4`，验收复制到带空格的临时项目，通过实际全局启动器执行成功与失败分支，再核对源码未变化。Python 需要可用的 `python` 命令，fixture 使用标准库 unittest，无第三方 Python 依赖。

默认发现不会越过 `.canary` 目录边界，避免 artifact/tmp 中的临时项目误用外层总计划。临时项目内自己的配置和显式 `--config` 仍有效。
