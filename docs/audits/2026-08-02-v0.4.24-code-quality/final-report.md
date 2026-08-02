# ShellPilot v0.4.24 代码质量三轮自检总报告

## 总结结论

本次在隔离分支 `codex/self-audit-0.4.24` 上完成了轮次四至六的使用者视角自检、代码质量审查、修复与最终差异复核。结论如下：

1. 项目不是“全局屎山”，但存在若干局部高债务核心。最需要治理的是安全事务编排、terminal/SFTP 巨型组件、MCP store mixin、shell 解析与 AI 工具分发；它们的主要问题是职责、异步状态和全局依赖集中，而不是单纯文件过长。
2. 本次确认并修复 11 项代码、生命周期或发布工程问题。修复包括删除双份快速连接解析器、恢复提示确认语义、MCP listener 生命周期与输入边界、SFTP 重试/销毁/定时器上下文、Node engine、死脚本和开发文档。
3. 之前 166 项功能要求的最终分类没有退化：159 项已满足、6 项部分满足、1 项已废止；0 项未满足、0 项未验证。部分满足项仍然只受授权外部 SFTP/隧道环境或独立网站部署限制。
4. 最新 HEAD 的完整 unit-ci、lint、生产构建、质量/恢复 E2E、性能 E2E、Windows x64 打包与 EXE 冒烟全部通过；生产与全量依赖审计均为 0 漏洞。
5. 截至 2026-08-02，GitHub 最新正式发布仍是 [ShellPilot v0.4.24](https://github.com/lx3559359/ssh-agent-tool/releases/tag/v0.4.24)，发布时间为 2026-08-01 13:55:58 UTC。本报告中的修复仅存在于本地审计分支，已发布的 v0.4.24 二进制不会自动获得这些修复。

## 三轮结果

### 轮次四：结构、重复与耦合

- 发现主进程与渲染进程各维护一份约 500 行的快速连接解析器；它们包含同一复杂度 65 的实现，存在入口间行为漂移风险。
- 保留主进程 CommonJS 解析器为唯一规范实现，渲染进程改为 13 行 ESM 薄适配器；公开导出保持不变。
- 表驱动契约覆盖 SSH 编码凭据、密码中的 `@`、IPv6、Web、SPICE、Serial、ShellPilot 协议与无效输入。
- 生产源码净删除 483 行重复实现；两份相关文件合计净减少 543 行。
- 显式复杂度扫描仍有 159 个 warning：复杂度 84、超长函数 68、参数过多 7。它们已分级登记，没有通过机械拆函数伪造改善。

### 轮次五：异步状态、可观测性与生命周期

| ID | 严重度 | 修复结果 |
| --- | --- | --- |
| R5-01 | P1 | 恢复提示只有在主进程严格返回 `true` 后才清除；`false`/reject 保留可重试状态并显示错误。 |
| R5-02 | P2 | 恢复计划加载失败继续安全降级启动，但记录不含路径、凭据或原始异常文本的稳定 quality event。 |
| R5-03 | P1 | MCP listener 重装前先移除旧 listener，重复启动 widget 不再重复执行工具。 |
| R5-04 | P1 | 修复 `retryCount = 0` 导致 SFTP `Unexpected packet` 重试分支永久不可达。 |
| R5-05 | P2 | SFTP 卸载/重复调度统一清理四个 timer、两个 debounce 和旧 handle。 |
| R5-06 | P1 | 最终复核发现旧 `initData(true)` 会把 terminalId 覆盖为布尔值；改为只重连远端且保留会话上下文，销毁 client 后再重连。 |
| R5-07 | P2 | MCP tool-call 要求非空 requestId；缺失关联键的畸形 IPC 不再产生孤立副作用。 |

恢复、MCP 与 SFTP 边界被提取成三个小型可注入模块，巨型 store/class 只保留接线。17 个 `sftp-*.spec.js` 文件最终为 160 tests / 0 failures。

### 轮次六：测试、构建、依赖与文档

- 项目原先声明 Node.js `>=16.0.0`，但锁定的 Vite 8 要求 `^20.19.0 || >=22.12.0`；package、lockfile 和中英文文档现已一致。
- 删除从未存在、也没有调用方的 `node build/bin/icon` 死脚本；契约测试会检查所有直接 Node package-script 入口。
- README 原先使用不存在的 `npm run dev`。现已恢复真实双进程开发流程：终端一 `npm start` 启动 Vite，终端二 `npm run app` 启动 Electron。
- 顶层依赖树无 missing/extraneous；生产和全量 `npm audit` 均为 0 漏洞。
- 38 个读取生产源码文本的 unit-ci 文件已分类。样式、JSX/IPC 接线和构建契约仍有价值；一条错误地用正则推断恢复行为的测试已改成执行测试。后续继续按“行为优先、接线保留”治理。
- 四个混合 ESM/CommonJS 测试文件仍会产生 `MODULE_TYPELESS_PACKAGE_JSON` 性能提示。应用根 package 不能直接改为 ESM，否则会破坏主进程与构建脚本；该项登记为 P3。

## “屎山代码”判定与治理顺序

| 优先级 | 热点 | 证据/风险 | 建议切分 |
| --- | --- | --- | --- |
| P1 | `transaction-runner.js` | 2363 行，工厂闭包约 1873 行；准备、执行、验证、回滚、恢复集中 | 保留 coordinator，按五个 phase runner 切分 |
| P1 | `command-entrypoint.js` | 工厂约 1054 行，`executeRun` 复杂度 51 | 提取 preflight policy、delegation resolver、execution coordinator |
| P1 | `terminal-safety-controller.js` | `hasOpenShellCompound` 复杂度 87，属于命令安全边界 | tokenizer 与 compound 状态机分离，必须先保留语法夹具 |
| P1 | `mcp-handler.js` | 约 1580 行、store 原型扩展和多领域工具集中 | transport、registry、SSH/SFTP adapter、store facade 四层 |
| P1 | `sftp-entry.jsx` / `terminal.jsx` | 各约 2200 行，UI、IO、生命周期与安全流程混合 | 先提 list/recovery/input/recording/drop controllers |
| P1 | `agent-tools.js` | 1610 行、工具执行分发复杂度 45 | tool registry 映射到领域 handler，风险 coordinator 单一化 |
| P2 | 规范快速连接解析器 | 333 行、复杂度 65；重复已消除 | 后续按 protocol strategy 切分，不改公开 API |

大文件不自动等于坏代码。3486 行 i18n overrides 和大部分 quick-command 目录主要是声明式数据，应通过键一致性、重复键、懒加载与领域目录治理，而不是按行数随意拆散。

## 既有功能要求复核

从需求矩阵本身重新计数，并在最新 HEAD 完成回归后，结果为：

| 状态 | 数量 | 结论 |
| --- | ---: | --- |
| 已满足 | 159 | 当前源码、运行时、桌面/E2E 或契约证据覆盖 |
| 部分满足 | 6 | 3 个完整连接 SFTP 桌面路径、2 个真实隧道路由路径、1 个网站部署路径依赖外部环境 |
| 已废止 | 1 | 旧手动终端拦截要求由明确的原生/直接输入契约替代 |
| 未满足 | 0 | 未发现当前保留要求的确认失败 |
| 未验证 | 0 | 每一项均已有处置 |

轮次四至六没有缩减功能范围。需求矩阵已追加本轮 3091-test、E2E、打包与审计证据；分类总数保持 159/6/1。

## 最终验证证据

| 门禁 | 最新 HEAD 结果 |
| --- | --- |
| `npm run test-unit-ci` | PASS：3091 tests，3085 passed，0 failed，6 skipped；288497.9392 ms |
| `npm run lint` | PASS：StandardJS exit 0 |
| `npm run build` | PASS：Vite 8.1.0，2903 modules；完整 build 约 6.25 s |
| `npm run test-quality-e2e` | PASS：2/2；隔离 SSH/SFTP/AI/update/rollback 与异常退出恢复 |
| `npm run test-performance-e2e` | PASS：1/1；startup、terminal、memory、AI budgets |
| 17 个 `sftp-*.spec.js` | PASS：160 tests，0 failed |
| `npm run package:win:dir` | PASS：285-package runtime、原生依赖重建、Electron 41.2.0 Windows x64 unpacked 包与签名步骤 |
| `npm run test-package-smoke` | PASS：最新 `dist/win-unpacked/ShellPilot.exe` 在隔离 DATA_PATH 启动并初始化 |
| `npm audit --omit=dev --json` | PASS：293 production dependencies，0 vulnerabilities |
| `npm audit --json` | PASS：1113 total dependencies，0 vulnerabilities |
| `npm ls --depth=0` | PASS：无 missing/extraneous 顶层依赖 |
| requirement matrix recount | PASS：159 已满足 / 6 部分满足 / 1 已废止 / 0 未满足 / 0 未验证 |
| 最终差异检查 | PASS：`git diff --check`；既有需求分类未被代码改动降级 |

此前功能审计的 14/14 视觉矩阵仍是 UI 需求证据；本轮没有修改视觉结构或样式，因此没有重复运行约 14.5 分钟的完整视觉矩阵。当前质量 E2E、性能 E2E、生产构建与真实包冒烟均已重跑。

## 最终差异复核

基线为 `ee6a1df`，最终代码提交前 HEAD 为 `d86da82`。截至总报告生成前，变更为 23 个文件、1213 行新增、656 行删除；生产源码为 228 行新增、533 行删除，净减少 305 行。

完整生产/test/docs 差异已复核，调用方已搜索，最终复核实际发现并修复了 SFTP terminalId 覆盖、MCP 缺失 requestId 和不完整开发启动说明。当前变更范围内未发现剩余 P0/P1/P2 实现缺陷。独立 reviewer 子代理在本环境不可用，因此使用完整差异、调用链、RED/GREEN 测试、全量回归和包级验证作为替代；合并前仍建议经过正常人类/CI 复核。

## 剩余风险与建议

- P1 结构债：安全事务、MCP、terminal、SFTP 与 AI 分发仍需按上述切分顺序逐项治理；不要一次性大重构。
- P3 构建债：Vite 仍报告 `electerm` 约 857 kB、Ant Design `es` 约 1.13 MB 的 minified chunk；性能门禁当前通过，后续以领域懒加载和真实预算为目标拆包。
- P3 工具链债：运行时准备会显示 `inflight`、`lodash.isequal`、`glob@7` 等上游传递依赖弃用警告；当前运行时和全量审计均为 0 漏洞，应等待兼容上游升级，避免强制 override 破坏 ExcelJS/Archiver。
- 外部验证债：6 项部分满足需求需要授权 SFTP/SSH tunnel 环境或网站部署；本轮没有使用正常用户凭据，也没有触碰普通用户数据目录。

## 发布建议

建议把本分支修复合并后，经过正常 CI/人工评审发布新的补丁版本（例如 v0.4.25）。不要覆盖 v0.4.24 历史资产，也不要把已发布的 v0.4.24 描述为已包含本地审计修复。

本轮未推送、未创建 PR、未发布资产、未修改线上更新状态。分支与隔离 worktree 均保留，等待使用者选择合并方式。
