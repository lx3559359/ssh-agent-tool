# 轮次六：测试、构建、依赖与可维护性自检

## 结论

本轮确认并修复三项发布工程缺陷：项目声明的 Node.js 下限低于锁定构建工具的真实要求；`icon` package script 指向从未存在的入口；中英文 README 要求执行不存在的 `npm run dev`。三项问题均先以契约测试复现，再修改元数据或文档。

依赖树完整，生产与全量依赖审计均为 0 漏洞。测试体系中仍有 38 个读取生产源码文本的 unit-ci 文件，但它们并不等价于 38 个无效测试：其中包含 CSS/Stylus、JSX 接线、静态安全边界和构建契约。轮次五已把一条本应验证运行行为的恢复流程正则断言替换为可执行操作测试；其余应按“行为优先、接线保留”逐步治理，不能机械删除。

## 发现与修复

| ID | 严重度 | 发现 | 证据 | 修复 |
| --- | --- | --- | --- | --- |
| R6-01 | P1 | 声明支持 Node.js `>=16.0.0`，但锁定的 Vite 8 无法在该范围的大部分版本运行 | `node_modules/vite/package.json` 要求 `^20.19.0 || >=22.12.0` | 同步 `package.json`、lockfile 根包与中英文 README；新增 engine 契约测试 |
| R6-02 | P2 | `npm run icon` 必然报模块不存在 | package script 指向 `build/bin/icon`；当前树和全部 Git 历史都不存在该文件，也无调用者 | 移除死脚本；新增所有直接 Node 脚本入口必须存在的契约测试 |
| R6-03 | P2 | README 的开发启动步骤不可执行 | 中英文 README 使用 `npm run dev`，scripts 中不存在 `dev`；真实入口为 `npm start` | 两份 README 改为 `npm start`；契约测试保证 README 引用的 `npm run` 命令均已声明 |

## TDD 证据

| 契约 | RED | GREEN |
| --- | --- | --- |
| Node engine 与锁定 Vite 一致 | 项目和 lockfile 的 `>=16.0.0` 与 Vite 要求不一致，2/2 失败 | 2/2 通过 |
| 直接 Node 脚本入口存在 | 精确报告 `icon: build/bin/icon`，1/1 失败 | 移除死入口后通过 |
| README 只引用已声明脚本 | 精确报告 `README.md: dev` 与 `README_cn.md: dev`，1/1 失败 | 改用 `npm start` 后通过 |

## 测试结构审查

- 读取源码文本的 38 个 unit-ci 文件主要承担样式、挂载、权限边界、IPC 接线及构建元数据契约；源码文本断言对重构敏感，但对无法廉价挂载 Electron/React 全栈的接线边界仍有价值。
- 已移除恢复启动流程中“搜索源码正则即可证明行为”的断言，并以成功、拒绝、异常、隐私和本地状态提交语义的执行测试替代。
- 四个根级 unit-ci 文件使用 ESM 语法，Node 会提示 `MODULE_TYPELESS_PACKAGE_JSON`。不能在应用根 package 直接增加 `type: module`，因为主进程与大量构建脚本仍是 CommonJS。该提示列为 P3 测试结构债，后续可迁移到 `.mjs` 或独立测试 package scope。
- `build` 与 `compile` 都指向 `build/bin/build.js`，属于历史/发布流程别名，不是缺失入口；保留可避免破坏现有自动化。

## 依赖与构建证据

| 检查 | 结果 |
| --- | --- |
| `npm ls --depth=0` | 通过，无 missing/extraneous 顶层依赖 |
| `npm audit --omit=dev --json` | 0 info / low / moderate / high / critical |
| `npm audit --json` | 0 info / low / moderate / high / critical |
| Node/Vite 契约 | 项目、lockfile、Vite 均为 `^20.19.0 || >=22.12.0` |
| package-script/readme 契约 | 4/4 通过 |
| `npm run lint` | 通过 |

## 与既有功能要求的关系

本轮没有修改需求矩阵或缩减功能范围。与上一份三轮功能审计基线相比，需求证据文件无差异：166 项中 159 项满足、6 项部分满足、1 项已退役。6 项部分满足仍依赖 macOS/Linux、真实服务器凭据、发布方凭据或安装后人工体验，不是本轮代码回归。

## 剩余债务

1. P1：继续按阶段拆分 `transaction-runner`、`command-entrypoint`、MCP handler；这些是当前最集中的流程耦合点。
2. P1：把 terminal shell compound parser 迁移为 tokenizer + 状态机，但必须保持现有安全用例。
3. P2：把 SFTP/terminal 巨型 class 的 IO 与生命周期控制器从 JSX 中移出。
4. P3：消除四个混合模块测试的 Node 类型提示，并逐步用可执行行为测试替换业务类源码正则断言。
5. P3：生产构建仍会报告超 500 kB chunk；应以路由/功能域懒加载为目标做独立性能改造，不能仅为消警告调整阈值。
