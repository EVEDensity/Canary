# Contributing to Canary

Bug reports, documentation improvements, translations and code contributions are welcome. For substantial changes, open an Issue to discuss scope and compatibility.

## Development

Use Node.js 24, Git and pnpm 10.15.0.

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
```

Build workspace packages before running examples or integration tests. Preview the website with `pnpm site:dev`.

## Validation

```bash
pnpm check
pnpm site:build
pnpm i18n:check
```

Run the checks relevant to your change. Preserve assertions, public schemas, CLI exit codes and artifact compatibility. Document migrations when contracts change.

## Pull requests

`main` is the deployment branch. Develop fixes and features on separate branches and merge through reviewed PRs. Every branch runs CI; website deployment, GitHub Releases and npm publication are restricted to `main`. Track functional changes in Issues with scope and acceptance criteria.

`main` 为部署分支。功能与修复在独立分支开发，经 PR 评审后合并。所有分支运行 CI，官网部署、GitHub Release 和 npm 发布仅允许从 `main` 执行；功能任务通过 Issue 明确范围与验收标准。

- Describe the change and how it was verified.
- Update affected guides and translations.
- Use Conventional Commits, such as `fix(trace): preserve failure evidence`.
- Keep credentials, personal data and execution artifacts out of commits.

### Responsibilities / 贡献分工

Record implementation, review and verification contributions in the PR template using GitHub usernames and specific work. Only credit work actually performed. Use GitHub's review request controls to request a review; an `@mention` alone does not assign one.

在 PR 中记录实现、评审与验证的实际贡献，注明 GitHub 用户名和完成内容。通过 GitHub 的评审请求指定评审人；仅 `@` 不等于分配任务。

Review ownership is maintained in [.github/CODEOWNERS](.github/CODEOWNERS). Currently, @EVEDensity maintains the project. Add collaborators with write access as module ownership is agreed. GitHub automatically requests eligible code owners on non-draft PRs; PR authors cannot review their own changes.

维护职责由 `CODEOWNERS` 管理，目前由 @EVEDensity 维护。新增成员获得写权限、确认模块分工后，再配置对应负责人；非草稿 PR 会自动请求符合条件的代码负责人评审，作者不能评审自己的 PR。

## Releases

Merge into `main` to publish an unreleased version from the root `package.json` after CI succeeds. The Release workflow checks out the exact validated commit, validates and builds the project, generates categorized release notes, and attaches workspace package archives, the website bundle and SHA-256 checksums. Existing versions are skipped; update the root and affected package versions for the next release. Tag pushes do not trigger publication. Manual Release runs must select `main`. Versions with a prerelease suffix are marked as prereleases.

GitHub Releases require Actions with write access to repository contents; no npm token is required. Retry a failed run from Actions. npm publication is a separate opt-in checkbox when manually running Release and requires `NPM_TOKEN`.

Release notes credit merged PRs with their authors and links, grouped by labels in `.github/release.yml`. The linked PR records each contributor's work. Direct commits do not provide the same PR attribution; prefer PRs for collaborative changes. Release credits describe contributions, while `CODEOWNERS` defines ongoing review ownership.

发布说明按标签分类，自动列出合并的 PR、作者和链接，具体贡献分工可进入 PR 查看。协作变更优先通过 PR 合并；直接提交不具备相同的 PR 归属信息。发布署名表示实际贡献，`CODEOWNERS` 表示长期维护与评审职责。

For the website, select **Settings → Pages → GitHub Actions**, set the Actions repository variable `CANARY_PAGES_ENABLED` to `true`, and run **Canary website**. After deployment succeeds, use `https://evedensity.github.io/Canary/` as the repository website.

Test and verification logs belong in ignored `.canary/logs/`. Review staged files before submitting. Issue reports should include versions, expected and actual behavior, and a minimal reproduction with sensitive values removed.

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Contributions use [Apache-2.0](LICENSE); retain applicable third-party license notices.
