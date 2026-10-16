# Repair verification

Run and seal a failing baseline, commit the fix and regression test, then run and seal the candidate. Keep original check declarations unchanged and add a dedicated command check that explicitly executes the regression file.

```bash
canary repair-verify <baselineRun> <candidateRun> \
  --regression regression.check --test regression.test.mjs --execute
```

Without `--execute`, the command reviews conditions and reports evidence insufficient. With authorization it restores both recorded versions, copies the exact candidate regression file into the baseline checkout and executes the candidate check plan against baseline production code. Dependencies and external conditions follow the reproduction boundary; missing conditions remain blocked.

For projects with dependencies, first use `--prepare` with the same regression selection, install locked dependencies in the returned independent directories, then execute with `--workspace <beforeWorkspace>` and `--candidate-workspace <candidateWorkspace>`. Neither preparation nor execution installs packages automatically.

A verified result requires assertion failure at a regression source location on baseline code, a passing candidate, all retained original checks passing, unchanged regression bytes and no unexpected production changes during execution. The before run explicitly records its hybrid basis: baseline production source with candidate test input. Hashes and manifests link all three runs.

Both original and candidate runs must retain matching execution boundary observations in sealed `execution-source.json` files. The receipt includes both under `executionSources`; missing historical proofs require fresh runs. These compare source identities before execution and after cleanup, rather than continuously monitoring every filesystem operation. Project commands remain trusted code.

The restored baseline must match its recorded commit across tracked ordinary files. Verification compares tracked bytes and the Git HEAD, index, status and inventory before and after execution. Unsupported special tracked files or resource budgets prevent a `verified` result; the current budget is 10,000 tracked files, 16 MiB per file and 256 MiB total. A source mutation remains evidence insufficient even when a regression assertion fails.

Git text checkout rules may change line endings. Restoration accepts a line-ending conversion only when its bytes match the sealed source-inventory hash, then checks the Git blob and index identities. Other content differences remain invalid.

Deleted test files, added skip/todo/only and removed or changed checks prevent verification. Other assertion edits are review advisories, not claims about test semantics. This is bounded repair evidence, not proof of overall correctness. The workspace's evidence view links the original failure, before-regression execution and candidate.

## 中文说明

先封存原失败，再提交修复与回归测试，并封存候选运行。保留原检查声明，新增直接执行回归文件的检查。上面的命令将同一份回归测试放入旧版本独立副本，记录修复前失败、修复后通过及原检查仍通过的证据。删除或跳过测试会阻止验证；不能确定的断言语义变化只提示人工复核。页面“证据与比较”可沿原失败、回归执行和修复提交查看证据。
