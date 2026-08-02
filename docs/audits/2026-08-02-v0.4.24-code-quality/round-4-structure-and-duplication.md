# 轮次四：结构、重复与耦合自检

## 结论

项目不是“全局不可维护”的屎山，但存在一组局部高债务核心：安全事务编排、terminal/SFTP 巨型组件、MCP store mixin 和 AI 工具分发。它们的问题来自职责和状态集中，不只是行数。双份快速连接解析器是本轮找到并安全消除的明确重复实现。

## 使用者路径

本轮以使用者可能触发的快速连接入口为主路径，覆盖：

- 命令行和 deep link 使用主进程解析器；
- 快速连接 UI 与 tab options 使用渲染进程入口；
- SSH 编码凭据、密码中的 `@`、IPv6、Web、SPICE、Serial、ShellPilot 应用协议和无效输入。

改动前，两条路径各保存一份约 500 行、复杂度 65 的实现，仅导出语法不同。任何未来修复都必须人工同步，否则同一个连接字符串可能因入口不同而得到不同结果。

## RED 证据

先将测试改为：

- 表驱动比较主进程规范实现与渲染进程入口的结果；
- 要求渲染进程入口引用规范实现且保持为不超过 30 个非空行的薄适配器。

首次运行：

`node --test test/unit-ci/quick-connect.spec.js`

结果为 11 项中 10 通过、1 失败。失败项准确指出 `src/client/common/parse-quick-connect.js` 不引用规范实现，仍包含完整解析器；不是语法错误或测试装配错误。

## 修复

- 保留 `src/app/common/parse-quick-connect.js` 为唯一规范实现。
- 将 `src/client/common/parse-quick-connect.js` 从约 496 行改为 13 行 ESM 适配器。
- 保持 `parseQuickConnect`、`getDefaultPort`、`getSupportedProtocols`、`SUPPORTED_PROTOCOLS`、`DEFAULT_PORTS`、`OPTS_DENY_LIST` 的具名导出不变。
- 将九个重复加载渲染模块的测试合并为一次加载、十二组输入的表驱动契约测试。

两份变更合计 56 行新增、599 行删除，净减少 543 行。生产端直接消除了 483 行重复实现；复杂度扫描不再把同一个 333 行/复杂度 65 的函数报告两次。

## 结构扫描结果

使用显式解析配置运行：

```text
npx --no-install eslint src/client src/app --ext .js,.jsx --no-eslintrc \
  --env es2022,browser,node \
  --parser-options {ecmaVersion:latest,sourceType:module,ecmaFeatures:{jsx:true}} \
  --rule complexity:[warn,20] \
  --rule max-depth:[warn,5] \
  --rule max-lines-per-function:[warn,200] \
  --rule max-params:[warn,6] --format compact
```

修复后结果：

| 指标 | 数量 |
| --- | ---: |
| 圈复杂度 warning | 84 |
| 超长函数 warning | 68 |
| 参数过多 warning | 7 |
| 合计 warning | 159 |
| 扫描器伪错误 | 1 |

伪错误来自 `--no-eslintrc` 模式没有加载 StandardJS 的 `n` 插件，却遇到源码中的 `eslint-disable n/no-callback-literal` 注释；它不是生产代码错误。此前直接运行裸 ESLint 得到的 916 个解析错误同样是未加载项目 parser 设置造成的工具误用，未计入缺陷。

最高复杂度包括：

- `hasOpenShellCompound`：87；
- `parseQuickConnect`：65；
- `validateNormalizedValue`、shortcut handler：55；
- tree drop：54；
- safety `executeRun`：51；
- SFTP context menu、agent skill validator：49；
- agent loop、agent tool dispatch：45。

最高超长函数包括：

- `createTransactionRunner`：约 1873 行；
- MCP store mixin：约 1480 行；
- `createSafetyCommandEntrypoint`：约 1054 行；
- quick command box：约 1012 行；
- AI config：约 828 行。

详细分类、切分缝和优先级见 [hotspot-register.md](hotspot-register.md)。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node --test test/unit-ci/quick-connect.spec.js` | 11/11 通过 |
| `npx --no-install standard src/client/common/parse-quick-connect.js test/unit-ci/quick-connect.spec.js` | 通过，无输出 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；Vite 2900 modules，15.47 秒；完整 build 25.976 秒 |

构建仍报告既有的 500 kB 以上 chunk 提示；这不由快速连接适配器引入，纳入轮次六的包体/构建债务检查。

## 本轮未做的事

没有把 159 个 warning 直接变成阻断门禁，也没有在缺少行为收益时强拆安全事务或 terminal/SFTP 大类。此类大改会把“可见的复杂度”变成“分散的复杂度”，并扩大 v0.4.24 修正候选的回归面。它们已按风险登记，后续应一项一项用行为测试驱动切分。
