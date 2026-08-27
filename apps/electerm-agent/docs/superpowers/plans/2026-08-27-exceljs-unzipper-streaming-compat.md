# ExcelJS 与 Unzipper 流式读取兼容修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 ExcelJS 流式读取器在 `unzipper@0.12.5` 下过早结束 ZIP 对象流的问题，并恢复全量单测绿色。

**Architecture:** 保留精确锁定的安全依赖版本，通过 `patch-package` 对 `unzipper` 的结束时序应用一个最小补丁。补丁由安装流程自动执行，现有 ExcelJS 调用方和回归测试无需应用层 monkey patch。

**Tech Stack:** Node.js、ExcelJS 4.4.0、Unzipper 0.12.5、patch-package、Node test runner、npm lockfile。

---

### Task 1: 固化失败回归与补丁安装契约

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/unit-ci/ai-artifact-office-generators.spec.js`

- [ ] **Step 1: 运行现有失败回归**

Run:

```powershell
node --test --test-name-pattern="ExcelJS streaming reader" test/unit-ci/ai-artifact-office-generators.spec.js
```

Expected: FAIL，错误为 `Cannot read properties of undefined (reading 'sheets')`。

- [ ] **Step 2: 加强回归断言**

在现有用例中收集工作表名称并断言：

```js
const worksheets = []
for await (const worksheet of reader) {
  worksheets.push(worksheet.name)
  for await (const row of worksheet) {
    rows.push(row.values.slice(1))
  }
}
assert.deepEqual(worksheets, ['Audit'])
assert.deepEqual(rows, [['streaming', 42]])
```

- [ ] **Step 3: 再次验证增强后的用例仍为 RED**

Run: 使用 Step 1 的聚焦命令。

Expected: 仍因 `model.sheets` 未创建而 FAIL，而不是语法或断言错误。

- [ ] **Step 4: 安装 patch-package 并接入 postinstall**

Run:

```powershell
npm install --save-dev --save-exact patch-package@8.0.1
```

将脚本更新为：

```json
"postinstall": "patch-package && node build/bin/post-install"
```

Expected: `package.json` 与 `package-lock.json` 精确记录 `patch-package@8.0.1`。

### Task 2: 修复 Unzipper 结束时序

**Files:**
- Create: `patches/unzipper+0.12.5.patch`
- Modify during patch generation: `node_modules/unzipper/lib/parse.js`

- [ ] **Step 1: 实现最小依赖补丁**

把构造器中的读取 Promise 保存下来，并让 `finish` 等待它：

```js
const reading = self._readRecord();
reading.catch(function(e) {
  if (!self.__emittedError || self.__emittedError !== e)
    self.emit('error', e);
});
self.on('finish', function() {
  reading.then(function() {
    if (!self._readableState.ended)
      self.push(null);
  }).catch(function() {});
});
```

删除原来在 `finish` 中直接发送 `end` 与 `close` 的代码。

- [ ] **Step 2: 生成可审计补丁**

Run:

```powershell
npx patch-package unzipper
```

Expected: 生成 `patches/unzipper+0.12.5.patch`，只修改 `lib/parse.js` 的构造器结束时序。

- [ ] **Step 3: 运行聚焦回归验证 GREEN**

Run: 使用 Task 1 Step 1 的聚焦命令。

Expected: PASS，工作表名称为 `Audit`，行内容为 `['streaming', 42]`。

### Task 3: 验证安装可重现与完整回归

**Files:**
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `patches/unzipper+0.12.5.patch`

- [ ] **Step 1: 反向移除当前补丁并验证安装恢复它**

Run:

```powershell
npx patch-package --reverse
npm install
```

Expected: 安装日志显示 `unzipper@0.12.5 ✔`，聚焦回归重新通过。

- [ ] **Step 2: 运行 Office 与依赖验证**

Run:

```powershell
node --test test/unit-ci/ai-artifact-office-generators.spec.js test/unit-ci/ai-content-ingestion.spec.js
npm ls --omit=dev --all
```

Expected: 两组测试无失败；生产依赖树退出码为 0。

- [ ] **Step 3: 运行静态与生产构建验证**

Run:

```powershell
npm run lint
npm run compile
```

Expected: lint 退出码 0；Vite 生产构建退出码 0。

- [ ] **Step 4: 运行完整单元回归**

Run:

```powershell
npm run test-unit-ci
```

Expected: 退出码 0，无失败；环境能力相关跳过项保持预期。

- [ ] **Step 5: 检查并提交独立修复**

Run:

```powershell
git diff --check
git status --short
git add apps/electerm-agent/package.json apps/electerm-agent/package-lock.json apps/electerm-agent/patches/unzipper+0.12.5.patch apps/electerm-agent/test/unit-ci/ai-artifact-office-generators.spec.js apps/electerm-agent/docs/superpowers/specs/2026-08-27-exceljs-unzipper-streaming-compat-design.md apps/electerm-agent/docs/superpowers/plans/2026-08-27-exceljs-unzipper-streaming-compat.md
git commit -m "fix(deps): restore ExcelJS streaming reads"
```

Expected: 工作树干净，修复作为独立提交位于 SSH 隧道分支之后。
