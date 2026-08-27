# ExcelJS 与 Unzipper 流式读取兼容修复设计

## 目标

修复 `ExcelJS.stream.xlsx.WorkbookReader` 在当前受控依赖 `unzipper@0.12.5` 下读取合法 XLSX 时抛出 `Cannot read properties of undefined (reading 'sheets')` 的问题，同时保留现有依赖安全升级，不改动 SSH 隧道功能，也不删除兼容性回归测试。

## 已确认根因

ExcelJS 普通写入器生成的 XLSX 中，`xl/worksheets/sheet1.xml` 可能位于 `xl/workbook.xml` 之前。ExcelJS 流式读取器会把提前出现的工作表暂存，等待工作簿关系和共享字符串解析完成。

`unzipper@0.12.5` 的 `Parse` 构造器却在 Duplex 的可写端触发 `finish` 时立即手工发送可读端 `end` 与 `close`。ExcelJS 暂停 ZIP 对象流复制工作表期间，可写端可能先结束，导致其迭代器误以为 ZIP 已读完；后面的 `workbook.xml` 没有进入解析流程，暂存工作表随后访问尚未创建的 `model.sheets` 并失败。

证据：

- 聚焦回归在 Node 22.22.0 和 Node 24.18.0 均稳定复现；
- 记录到 ExcelJS 只处理到 `xl/worksheets/sheet1.xml`，没有处理最后的 `xl/workbook.xml`；
- 仅阻止 `unzipper` 构造器的过早结束监听后，同一 XLSX 可正确读出 `[["streaming", 42]]`。

## 方案比较

### 方案 A：对锁定版本应用可审计依赖补丁（采用）

使用 `patch-package` 保存 `unzipper@0.12.5` 的窄范围补丁。补丁保留解析 Promise，在 ZIP 记录解析完成后才结束可读端；解析错误仍走原有错误事件。`postinstall` 每次安装依赖时自动应用补丁。

优点：直接修复根因；所有 ExcelJS 调用方自动受益；不需要应用层全局 monkey patch；补丁文件可审查、可在依赖升级时显式失败。代价是增加一个仅用于安装阶段的开发依赖。

### 方案 B：应用内包装 ExcelJS

创建兼容入口并在运行时修改 `unzipper.Parse`。改动文件较少，但会依赖 Node 模块缓存和加载顺序，其他代码若先直接加载 ExcelJS，修复会失效，因此不采用。

### 方案 C：降级 Unzipper 或删除流式测试

降级会撤销既有依赖安全治理；删除测试只能隐藏真实兼容问题，因此不采用。

## 设计

1. 在 `package.json` 中固定 `patch-package` 的开发依赖，并让现有 `postinstall` 先应用补丁、再运行 Electron 原生依赖准备。
2. 新增 `patches/unzipper+0.12.5.patch`：
   - 保存 `_readRecord()` 返回的完整解析 Promise；
   - 继续由该 Promise 的拒绝分支发送原有解析错误；
   - 可写端 `finish` 后等待解析 Promise；仅在解析尚未自然结束可读端时补充 `push(null)`；
   - 不再在可写端结束时直接伪造 `end`/`close`。
3. 保留现有真实文件回归：普通 ExcelJS 写入器生成 XLSX，流式读取器必须正确读取工作表和行。
4. 用 `npm install` 验证补丁可从安装流程自动应用，再运行 Office 聚焦测试、依赖树、代码规范、生产构建和全量单测。

## 安全边界

- 不改变 XLSX 内容、路径校验或 Office 解压大小限制；
- 不覆盖 `node_modules` 中除 `unzipper@0.12.5/lib/parse.js` 以外的文件；
- 补丁绑定精确版本，未来升级出现上下文差异时安装必须显式失败，而不是静默跳过；
- 本次提交独立于 SSH 隧道实现，便于审查和回退。

## 验收标准

- 原失败用例从稳定 RED 变为 GREEN，并读出工作表名 `Audit` 与行 `['streaming', 42]`；
- `npm install` 自动报告并应用 `unzipper@0.12.5` 补丁；
- `npm ls --omit=dev --all` 依赖树有效；
- Office 聚焦测试、lint、compile 和全量单测均无失败。
