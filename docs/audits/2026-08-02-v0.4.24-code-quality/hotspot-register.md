# ShellPilot v0.4.24 代码热点登记

## 判定方法

本登记不把“文件长”直接等同于“屎山”。热点同时参考以下信号：

- 单个函数承担多个生命周期或业务阶段；
- 圈复杂度高，分支依赖隐式状态；
- 主进程、渲染进程或 UI/存储层存在重复实现和跨层耦合；
- 依赖 `window.store` 等全局对象，难以隔离测试；
- 错误、定时器、监听器或连接句柄没有清晰的归属和收口；
- 测试只能读取源码文本，而不能执行行为。

翻译表、协议目录和快速命令目录即使行数很高，只要主要是声明式数据，就不按同等风险处理。

## 高优先级热点

| 优先级 | 文件/入口 | 证据 | 风险 | 建议切分缝 | 本轮处置 |
| --- | --- | --- | --- | --- | --- |
| P1 | `src/client/common/safety-transactions/transaction-runner.js` / `createTransactionRunner` | 文件 2363 行；工厂闭包约 1873 行 | 同一闭包协调分类、审计、持久化、执行、验证、回滚、恢复，修改一阶段容易影响另一阶段 | 先按 prepare/execute/verify/rollback/recover 五个 phase runner 切分，保留统一 coordinator 和不可变 operation 模型 | 登记；已有大量安全事务回归，禁止本轮无行为收益的大拆分 |
| P1 | `src/client/common/safety-transactions/command-entrypoint.js` / `createSafetyCommandEntrypoint` | 工厂闭包约 1054 行；`executeRun` 复杂度 51 | 授权、只读委托、恢复委托、确认、队列和执行路径互相穿插 | 提取 preflight policy、delegation resolver、execution coordinator；入口只负责顺序 | 登记，待单独安全事务里程碑处理 |
| P1 | `src/client/components/terminal/terminal-safety-controller.js` / `hasOpenShellCompound` | 圈复杂度 87，为全项目最高 | 手写 shell 词法/复合结构判断属于安全边界，遗漏分支会误判命令完整性 | 将 tokenizer 与 compound-state machine 分离，使用表驱动语法夹具覆盖 Bash 结构 | 登记；当前测试覆盖广，不能只为降复杂度改写 |
| P1 | `src/client/store/mcp-handler.js` / 默认 store mixin | 文件 1580 行；单闭包约 1480 行；18 处 `window.store` | 工具注册、取消、SSH/SFTP 适配和 store 原型扩展集中，隔离测试困难 | 按 transport、tool registry、SSH/SFTP adapter、store facade 四层拆分 | 轮次五已提取并修复幂等 IPC listener；其余职责拆分继续登记 |
| P1 | `src/client/components/sftp/sftp-entry.jsx` / `Sftp` | 类 2209 行，方法覆盖挂载、列表、编辑、删除、备份、恢复和渲染 | UI 状态、远端 IO 与安全事务在一个类中，任何修改回归面大 | 先抽 `sftp-list-controller` 与 `sftp-recovery-controller`，组件保留 view state；复用现有 transaction adapter | 轮次五已提取 retry/timer/debounce 生命周期策略；控制器拆分继续登记 |
| P1 | `src/client/components/terminal/terminal.jsx` / `Term` | 类 2195 行；36 处 `window.store` | xterm 生命周期、输入、日志、拖放、搜索、AI、安全执行和 JSX 混合 | 继续沿已有 safety controller 分离 input controller、recording controller、drop controller | 登记；轮次五核对监听器、addon 和 timer 清理 |
| P1 | `src/client/components/ai/agent-tools.js` / `executeResolvedAgentTool` | 文件 1610 行；执行分发复杂度 45 | 描述符、风险准备、批处理和各领域工具实现共享巨大 switch | 以 tool registry 映射到 terminal/SFTP/artifact/bookmark handlers，风险 coordinator 保持单一 | 登记，避免在无端到端工具契约时迁移 |

## 中优先级热点

| 优先级 | 文件/入口 | 证据 | 建议 |
| --- | --- | --- | --- |
| P2 | `src/app/common/parse-quick-connect.js` / `parseQuickConnect` | 唯一实现仍有 333 行、复杂度 65 | 后续按 protocol strategy 分离 serial/web/spice/auth/opts；本轮先消除双份实现，避免两个复杂函数继续漂移 |
| P2 | `src/client/components/quick-commands/server-maintenance/shared/validation.js` / `validateNormalizedValue` | 复杂度 55 | 用 validator map 替换类型分支链，每个验证器保持纯函数 |
| P2 | `src/client/components/shortcuts/shortcut-handler.js` | 回调复杂度 55 | 将快捷键解析、上下文资格和动作路由分离 |
| P2 | `src/client/components/setting-panel/on-tree-drop.js` | 复杂度 54 | 将拖放合法性、目标解析和 mutation plan 拆成纯函数 |
| P2 | `src/app/server/session-ssh.js` | 文件 1397 行；`getSshDiagnosis` 复杂度 42；`sshConnect` 复杂度 24 | 先把诊断规则表、认证策略、jump host 和 tunnel runtime 分离；保持 `TerminalSshBase` API |
| P2 | `src/app/lib/ai.js` | 文件 1390 行；请求函数参数最多 11 个 | 分为 client factory、model discovery、health、stream session、error policy；用 options object 收口参数 |
| P2 | `src/client/components/file-transfer/transfer.jsx` | 文件 1389 行；`onEnd` 复杂度 33 | 将传输状态机和 UI 分离，复用 operation task adapter |
| P2 | `src/app/widgets/widget-mcp-server.js` / `registerTools` | 方法约 679 行 | 采用按领域注册器组合，避免一个方法注册所有工具 |

## 低风险大文件与误报防护

| 文件 | 行数 | 分类 | 结论 |
| --- | ---: | --- | --- |
| `src/client/common/shellpilot-i18n-overrides.js` | 3486 | 双语数据目录 | 体积大但不是同等级编排债务；应通过键一致性和重复键测试治理，不按业务函数拆分 |
| `src/client/components/quick-commands/server-maintenance/network.js` | 1330 | 以声明式命令目录为主 | 可按领域懒加载优化包体，但不因行数直接判定为屎山 |
| `src/client/components/quick-commands/server-maintenance/system.js` | 972 | 以声明式命令目录为主 | 同上 |

## 全局性债务指标

轮次四修复后的静态快照：

- `window.store`：718 处；最高单文件为 `ai-chat-history-item.jsx` 37、`terminal.jsx` 36、`store/common.js` 35。
- `window.translate`：266 处。
- 空 `catch` 或空 `.catch` 的窄模式匹配：84 处。它们是审查候选，不等同于 84 个缺陷。
- 客户端 `setTimeout`/`setInterval`：103 处。
- `AbortController`：19 处；`addEventListener`：109 处。
- 读取生产源码文本的 unit-ci 文件：38 个，其中样式和接线契约有保留价值，业务行为类断言应逐步替换。
- 显式 ES2022/JSX 复杂度扫描：159 个 warning，构成为复杂度 84、超长函数 68、参数过多 7；另有 1 个因未加载 StandardJS 插件而产生的扫描器伪错误。

这些数值用于定位和观察趋势，不作为一次性清零目标。若直接把当前基线设成严格门禁，会鼓励机械拆函数和隐藏复杂度，而不是改善设计。

## 建议治理顺序

1. 先处理安全边界的可测试纯函数：terminal shell parser、quick-command validator。
2. 再拆异步编排器：command entrypoint、transaction runner、MCP handler。
3. 然后把 SFTP/terminal 巨型组件的控制器从 JSX 中移出。
4. 最后按领域拆 AI 工具注册和主进程 AI 服务，并配合包体分块。

每一步都应保持原公开 API，先建立行为测试和资源生命周期测试，再移动实现。
