# Canary verification Skill / Canary 验证 Skill

Canary includes the official `canary-verify` Agent Skill at `integrations/skills/canary-verify/`. Its short `SKILL.md` entry points to bundled references for checks and diagnosis, reproduction, and repair/change verification. It uses the existing `canary run --ci`, `diagnostics`, `reproduce`, `repair-verify` and `change-verify` commands within the user's current task and authorization.

Canary 在 `integrations/skills/canary-verify/` 提供官方 `canary-verify` Agent Skill。入口按当前任务加载检查与诊断、复现、修复或变更验证参考，不隐含编辑源码、依赖安装、联网、凭据、提交或合并许可。

## Install in a project / 项目内安装

After installing Canary from its GitHub source, run from your target project:

```sh
canary skill install
canary skill status --json
```

The CLI resolves the current project even from its subdirectories. The default destination is `<project>/.agents/skills/canary-verify/`. To select a project explicitly:

```sh
canary skill install --project <directory>
```

The source checkout also provides a direct Node entry that does not require a global Canary launcher, a Python interpreter, an npm account or an npm publication:

```sh
node /path/to/Canary/scripts/install-skill.mjs install --project <directory>
```

Use Node.js 24 or later, the current Canary runtime. Skill delivery copies bundled local files and makes no network request. Running verification still requires the Canary CLI and the project's own prerequisites.

GitHub Releases also include `canary-verify-skill-v<version>.zip` containing the `canary-verify/` folder and its license. Verify its checksum in `SHA256SUMS` before manual extraction into a client-specific project directory. A manually copied Skill has no Canary ownership record; the managed installer preserves it and refuses to overwrite it. Use the CLI installer for managed updates and rollback.

默认安装到目标项目的 `.agents/skills/canary-verify/`。源码安装后可使用 `canary skill install`，也可用当前 Node 直接执行 `scripts/install-skill.mjs`，无需 Python、npm 账号或 npm 发布。安装器只复制本地包，联网或依赖准备由用户任务单独决定。

## Update, roll back and withdraw / 更新、回滚与撤回

After updating the Canary source installation, review the packaged Skill changes and run:

```sh
canary skill update --project <directory>
canary skill status --project <directory> --json
canary skill rollback --project <directory>
canary skill remove --project <directory>
```

Repeated installation of identical content returns `unchanged`. `install` refuses to replace a different installed version; `update` is the explicit replacement action. A successful update retains one previous package snapshot. `rollback` restores that snapshot and consumes it. `remove` withdraws the managed Skill; it keeps project evidence and the parent Skill directories. Every action is also available through the direct Node script with the same flags.

`.canary-skill.json` records ownership, the destination, every bundled file's SHA-256 and size, an aggregate package hash, and the previous snapshot when available. Staging precedes directory replacement; a failed replacement restores the previous directory. Hashes detect changed bytes and do not authenticate a package producer. Review the Canary checkout as you would other project code.

重复安装相同内容返回 `unchanged`；不同版本必须显式 `update`。成功更新保留一个上版快照，`rollback` 恢复并消耗快照，`remove` 撤回已归属的 Skill。记录保存每个文件的 SHA-256、大小和整体内容哈希；目录替换失败会恢复原目录。哈希用于检测变化，不能证明作者身份。

## Destination and conflicts / 安装位置与冲突

If your client discovers a different project Skill directory, choose it explicitly and keep the directory name `canary-verify`:

```sh
canary skill install --project <directory> --dest .claude/skills/canary-verify
```

The destination must stay inside the selected project. The installer does not select a global Skill directory, follow symbolic links/junctions or overwrite an existing Skill without a valid matching Canary ownership record. Use the same `--project` and `--dest` for status, update, rollback and removal.

`SKILL_UNMANAGED` means the existing directory belongs to the user or another installer. Review and move it yourself or choose an unused project destination. `SKILL_LOCAL_CHANGES` means recorded files were edited/deleted or extra files/directories appeared; all content is preserved. Run `status --json` to inspect conflicts, save your changes, and restore the recorded content before updating or removing. There is no force-overwrite flag.

`SKILL_STATE_INVALID` preserves the package when its ownership or rollback record cannot be validated. Recover the original record or use a fresh destination. `SKILL_BUSY` preserves a competing operation's lock; wait for it to finish, or inspect the reported local lock after confirming that operation ended. Missing project/options return exit 2; delivery conflicts return exit 1. A modified `status` also returns exit 1.

显式 `--dest` 只接受项目内、末级名称为 `canary-verify` 的目录。安装器保护无归属的用户 Skill、全局 Skill、符号链接和 junction，不提供强制覆盖。修改或新增文件、空目录也会阻止更新、回滚和移除；先用 `status --json` 查看冲突，保存个人修改并恢复归属记录中的内容。

## Format and client coverage / 格式与客户端范围

The official package follows the [Agent Skills specification](https://agentskills.io/specification): matching lowercase folder/name, required YAML `name` and `description`, and references relative to the Skill root. Installation tests validate these fields and links and exercise actual install, repeat, update, conflict preservation, rollback and removal on disk with Node.

The packaged Skill and local delivery workflow are available. This round has not tested discovery or invocation in every Agent Skills client; a compatible file format does not establish full client support. Use your client's current Skill discovery instructions and reload its project context when required. Explicit invocation can use `$canary-verify` in clients that support that syntax.

官方包按 Agent Skills 规范检查命名、frontmatter 和相对引用，并实际测试安装、重复安装、更新、冲突保护、回滚和移除。本轮尚未逐客户端实测发现与调用，不宣传所有客户端完整兼容；按所用客户端的当前发现规则安装并按需重载。

## Experience drafts / 经验草稿

`canary experience export-skill <experienceId>` exports an advisory project draft after its existing evidence, validation and approval requirements pass. Its output under `.canary/skill-drafts/` is distinct from the official verification Skill. Export does not install a Skill or activate an experience. Review the draft before choosing any client installation workflow; the official installer manages only the bundled `canary-verify` package.

`experience export-skill` 的输出是经过现有证据、验证和审批流程的项目建议草稿，保存在 `.canary/skill-drafts/`。导出不等于安装或激活；官方安装器只管理随源码提供的 `canary-verify` 包。
