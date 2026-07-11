# Long Log and Archive Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本地文件和 SFTP 文件提供内存有界的区间读取、日志搜索，以及 `.gz`、`.zip`、`.tar.gz` 压缩日志安全读取接口。

**Architecture:** 读取能力放在 Electron 主进程和 SFTP 会话层，渲染层只接收结构化结果。普通日志通过统一的字节区间契约读取；压缩包先流式落入客户端临时目录，再由受限归档读取器枚举或读取单个文本成员，绝不在远程服务器解压。

**Tech Stack:** Node.js CommonJS、`fs/promises`、SFTP read stream、Node `zlib`、现有 `tar` 依赖、`yauzl@3.4.0`、Node test runner。

---

## 文件结构

- Create: `src/app/common/file-range.js`：区间参数归一化、UTF-8 边界和结构化结果。
- Create: `src/app/common/log-search.js`：在有界读取器上执行关键词搜索。
- Create: `src/app/common/archive-reader.js`：归档类型识别、安全限制、成员枚举和文本读取。
- Modify: `src/app/lib/fs.js`：暴露本地区间、搜索、归档读取接口。
- Modify: `src/app/server/sftp-file.js`：实现 SFTP 区间读取和归档临时文件下载。
- Modify: `src/app/server/session-sftp.js`：暴露 SFTP 新接口。
- Modify: `src/app/common/constants.js`：允许新 SFTP IPC 方法。
- Modify: `src/client/common/constants.js`：允许渲染端调用新 SFTP 方法。
- Create: `test/unit-ci/file-range.spec.js`：本地区间和 UTF-8 边界测试。
- Create: `test/unit-ci/log-search.spec.js`：分块搜索测试。
- Create: `test/unit-ci/archive-reader.spec.js`：三种归档和安全限制测试。
- Modify: `test/unit-ci/session-sftp.spec.js`：真实本地 SSH/SFTP 服务器集成测试。
- Modify: `package.json`、`package-lock.json`：加入直接依赖 `yauzl@3.4.0`。

### Task 1: 本地文本区间读取契约

**Files:**
- Create: `src/app/common/file-range.js`
- Modify: `src/app/lib/fs.js`
- Create: `test/unit-ci/file-range.spec.js`

- [ ] **Step 1: 编写失败测试**

测试必须覆盖小文件、256 KB 有界读取、非零偏移、文件尾部、UTF-8 中文边界和二进制拒绝：

```js
test('reads a bounded UTF-8 range with continuation metadata', async () => {
  const content = '第一行\n第二行\n第三行'
  fs.writeFileSync(file, content)
  const result = await fsExport.readFileRange(file, {
    offset: 0,
    maxBytes: 10
  })
  assert.equal(result.offset, 0)
  assert.equal(result.totalBytes, Buffer.byteLength(content))
  assert.equal(result.hasMore, true)
  assert.equal(result.binary, false)
  assert.equal(Buffer.byteLength(result.content), result.bytesRead)
  assert.equal(result.nextOffset, result.bytesRead)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/file-range.spec.js`

Expected: FAIL，提示 `fsExport.readFileRange is not a function`。

- [ ] **Step 3: 实现最小区间读取器**

`file-range.js` 导出以下稳定契约：

```js
const DEFAULT_RANGE_BYTES = 256 * 1024
const MAX_RANGE_BYTES = 1024 * 1024
const { isLikelyBinaryBuffer } = require('./file-preview')

const isContinuationByte = byte => (byte & 0xc0) === 0x80

function trimIncompleteTail (buffer) {
  let start = buffer.length - 1
  while (start >= 0 && isContinuationByte(buffer[start])) start -= 1
  if (start < 0) return Buffer.alloc(0)
  const lead = buffer[start]
  const expected = lead <= 0x7f ? 1 : lead <= 0xdf ? 2 : lead <= 0xef ? 3 : 4
  return buffer.length - start < expected ? buffer.subarray(0, start) : buffer
}

function normalizeRangeOptions ({ offset = 0, maxBytes = DEFAULT_RANGE_BYTES } = {}) {
  return {
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
    maxBytes: Number.isSafeInteger(maxBytes) && maxBytes > 0
      ? Math.min(maxBytes, MAX_RANGE_BYTES)
      : DEFAULT_RANGE_BYTES
  }
}

async function readTextRange ({ size, read }, options = {}) {
  const normalized = normalizeRangeOptions(options)
  const totalBytes = await size()
  const raw = await read(normalized.offset, normalized.maxBytes + 4)
  let head = 0
  while (head < raw.length && isContinuationByte(raw[head])) head += 1
  const actualOffset = normalized.offset + head
  const bounded = raw.subarray(head, head + normalized.maxBytes)
  const safe = trimIncompleteTail(bounded)
  const binary = isLikelyBinaryBuffer(safe)
  return {
    content: binary ? '' : safe.toString('utf8'),
    binary,
    offset: actualOffset,
    nextOffset: actualOffset + safe.length,
    totalBytes,
    bytesRead: safe.length,
    hasMore: actualOffset + safe.length < totalBytes
  }
}

module.exports = {
  DEFAULT_RANGE_BYTES,
  MAX_RANGE_BYTES,
  normalizeRangeOptions,
  readTextRange
}
```

`fs.js` 使用 `fss.open().read()` 提供 `size` 和 `read` 回调，并确保 `finally` 关闭句柄。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test test/unit-ci/file-range.spec.js test/unit-ci/file-preview.spec.js test/unit-ci/file-preview-utf8-boundary.spec.js`

Expected: PASS，现有 64 KB 预览行为不变。

- [ ] **Step 5: 提交**

```bash
git add src/app/common/file-range.js src/app/lib/fs.js test/unit-ci/file-range.spec.js
git commit -m "feat: add bounded local file range reading"
```

### Task 2: SFTP 区间读取

**Files:**
- Modify: `src/app/server/sftp-file.js`
- Modify: `src/app/server/session-sftp.js`
- Modify: `src/app/common/constants.js`
- Modify: `src/client/common/constants.js`
- Modify: `test/unit-ci/session-sftp.spec.js`

- [ ] **Step 1: 编写失败集成测试**

在现有本地 SSH/SFTP 测试服务器中写入中文大日志，并验证连续区间不会重复或遗漏：

```js
const first = await sftp.readFileRange(file, { offset: 0, maxBytes: 128 })
const second = await sftp.readFileRange(file, {
  offset: first.nextOffset,
  maxBytes: 128
})
assert.equal(first.hasMore, true)
assert.equal(second.offset, first.nextOffset)
assert.equal(first.content + second.content, content.slice(
  0,
  (first.content + second.content).length
))
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/session-sftp.spec.js`

Expected: FAIL，提示 `sftp.readFileRange is not a function`。

- [ ] **Step 3: 实现 SFTP 区间适配器**

在 `sftp-file.js` 中通过 `sftp.stat()` 获取大小，通过 `createReadStream({ start, end })` 收集最多 `maxBytes + 4` 字节，然后调用 Task 1 的 `readTextRange`。禁止调用现有 `readRemoteFile`，避免整文件缓冲。

在会话类中暴露：

```js
readFileRange (remotePath, options) {
  return readRemoteFileRange(this.sftp, remotePath, options)
}
```

并把 `readFileRange` 加入主进程和客户端的 `instSftpKeys` 白名单。

- [ ] **Step 4: 运行 SFTP 和 IPC 质量测试**

Run: `node --test test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-preview-integration-quality.spec.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/app/server/sftp-file.js src/app/server/session-sftp.js src/app/common/constants.js src/client/common/constants.js test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-preview-integration-quality.spec.js
git commit -m "feat: add bounded SFTP file range reading"
```

### Task 3: 长日志关键词搜索

**Files:**
- Create: `src/app/common/log-search.js`
- Modify: `src/app/lib/fs.js`
- Modify: `src/app/server/session-sftp.js`
- Create: `test/unit-ci/log-search.spec.js`

- [ ] **Step 1: 编写失败测试**

```js
test('searches a large log without loading it all at once', async () => {
  const calls = []
  const result = await searchTextReader({
    async readFileRange (options) {
      calls.push(options)
      return pages.shift()
    }
  }, {
    query: 'ERROR',
    maxMatches: 3,
    contextLines: 1
  })
  assert.equal(result.matches.length, 3)
  assert.equal(result.truncated, true)
  assert.ok(calls.every(call => call.maxBytes <= 256 * 1024))
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/log-search.spec.js`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现有界搜索**

导出：

```js
async function searchTextReader (reader, {
  query,
  caseSensitive = false,
  maxMatches = 100,
  contextLines = 2,
  startOffset = 0
})
```

每次调用 `reader.readFileRange({ offset, maxBytes: 256 * 1024 })`，只保留跨块未完成行和命中前后上下文。结果包含 `matches`、`scannedBytes`、`totalBytes`、`nextOffset`、`truncated`。空关键词、超过 256 字符的关键词和二进制内容返回结构化中文错误。

- [ ] **Step 4: 接入本地与 SFTP**

`fsExport.searchFileText(filePath, options)` 和 `Sftp.searchFileText(remotePath, options)` 都复用 `searchTextReader`，不复制搜索算法。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test test/unit-ci/log-search.spec.js test/unit-ci/file-range.spec.js test/unit-ci/session-sftp.spec.js`

Expected: PASS。

```bash
git add src/app/common/log-search.js src/app/lib/fs.js src/app/server/session-sftp.js test/unit-ci/log-search.spec.js test/unit-ci/session-sftp.spec.js
git commit -m "feat: add bounded long log search"
```

### Task 4: 安全归档读取核心

**Files:**
- Create: `src/app/common/archive-reader.js`
- Create: `test/unit-ci/archive-reader.spec.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 添加 ZIP 直接依赖**

Run: `npm install --save-exact yauzl@3.4.0`

Expected: `package.json` 和锁文件只增加 `yauzl` 及其必要传递依赖。

- [ ] **Step 2: 编写三种格式和攻击样例的失败测试**

测试生成 `.gz`、`.zip`、`.tar.gz`，并覆盖：成员枚举、读取单个文本成员、`../escape.log`、绝对路径、符号链接、二进制成员、成员数量上限、单成员大小上限和损坏归档。

核心断言：

```js
const listing = await listArchive(file)
assert.deepEqual(listing.entries.map(item => item.path), ['app.log'])
const result = await readArchiveTextEntry(file, 'app.log', { maxBytes: 32 })
assert.equal(result.content, 'ERROR example\n')
assert.equal(result.binary, false)
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `node --test test/unit-ci/archive-reader.spec.js`

Expected: FAIL，提示 `archive-reader` 模块不存在。

- [ ] **Step 4: 实现归档读取器**

导出固定接口：

```js
const ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxPreviewBytes: 1024 * 1024
})

function validateArchiveEntryPath (entryPath) {
  const normalized = String(entryPath || '').replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('压缩成员路径无效')
  }
  if (normalized.split('/').includes('..')) {
    throw new Error('压缩成员包含路径穿越')
  }
  return normalized
}

function detectArchiveType (filePath) {
  const value = String(filePath || '').toLowerCase()
  if (value.endsWith('.tar.gz') || value.endsWith('.tgz')) return 'tar.gz'
  if (value.endsWith('.zip')) return 'zip'
  if (value.endsWith('.gz')) return 'gz'
  throw new Error('仅支持 .gz、.zip 和 .tar.gz 压缩日志')
}

// listArchive(filePath, options) 返回 { type, entries, totalUncompressedBytes }。
// readArchiveTextEntry(filePath, entryPath, options) 返回与 readTextRange
// 一致的 content、binary、bytesRead、hasMore，并增加 archiveType 和 entryPath。
```

`.gz` 使用 `zlib.createGunzip()`；`.zip` 使用 `yauzl.open(..., { lazyEntries: true, validateEntrySizes: true })`；`.tar.gz` 使用现有 `tar.t({ file, onentry })`。所有流在达到上限后立即销毁，错误统一包装为包含格式和阶段的中文错误。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test test/unit-ci/archive-reader.spec.js`

Expected: PASS。

```bash
git add src/app/common/archive-reader.js test/unit-ci/archive-reader.spec.js package.json package-lock.json
git commit -m "feat: add safe compressed log reader"
```

### Task 5: 本地与 SFTP 归档适配

**Files:**
- Modify: `src/app/lib/fs.js`
- Modify: `src/app/server/sftp-file.js`
- Modify: `src/app/server/session-sftp.js`
- Modify: `src/app/common/constants.js`
- Modify: `src/client/common/constants.js`
- Modify: `test/unit-ci/session-sftp.spec.js`

- [ ] **Step 1: 编写失败测试**

本地测试直接调用：

```js
await fsExport.listArchive(filePath)
await fsExport.readArchiveTextEntry(filePath, 'app.log', { maxBytes: 64 })
```

SFTP 集成测试上传归档后调用同名方法，并断言远程目录没有新增解压文件。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/archive-reader.spec.js test/unit-ci/session-sftp.spec.js`

Expected: FAIL，提示适配方法不存在。

- [ ] **Step 3: 实现本地适配**

`fsExport.listArchive` 和 `fsExport.readArchiveTextEntry` 直接调用归档读取核心，不创建额外副本。

- [ ] **Step 4: 实现 SFTP 临时文件适配**

新增 `withRemoteArchiveTempFile(sftp, remotePath, action)`：

```js
const tempPath = path.join(tempDir, `shellpilot-archive-${uid()}${extension}`)
try {
  await pipeline(sftp.createReadStream(remotePath), fs.createWriteStream(tempPath))
  return await action(tempPath)
} finally {
  await fss.rm(tempPath, { force: true }).catch(log.error)
}
```

下载前用 SFTP `stat` 检查源文件大小，默认拒绝超过 2 GB 的压缩包。临时文件名不包含远程路径和账号信息。把 `listArchive`、`readArchiveTextEntry` 加入两端 SFTP IPC 白名单。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test test/unit-ci/archive-reader.spec.js test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-preview-integration-quality.spec.js`

Expected: PASS，临时目录无残留。

```bash
git add src/app/lib/fs.js src/app/server/sftp-file.js src/app/server/session-sftp.js src/app/common/constants.js src/client/common/constants.js test/unit-ci/archive-reader.spec.js test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-preview-integration-quality.spec.js
git commit -m "feat: expose archive reading for local and SFTP files"
```

### Task 6: 回归验证和阶段验收

**Files:**
- Modify only if a failing regression test identifies a root cause.

- [ ] **Step 1: 运行专项测试**

Run:

```bash
node --test test/unit-ci/file-range.spec.js test/unit-ci/log-search.spec.js test/unit-ci/archive-reader.spec.js test/unit-ci/file-preview.spec.js test/unit-ci/file-preview-utf8-boundary.spec.js test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-preview-integration-quality.spec.js
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行完整单元测试和代码规范**

Run: `npm run lint`

Expected: exit code 0。

Run: `npm run test-unit-ci`

Expected: 0 failed。

- [ ] **Step 3: 运行编译验证**

Run: `npm run compile`

Expected: exit code 0，构建产物生成成功。

- [ ] **Step 4: 检查工作区和提交阶段验收记录**

Run: `git status --short`

Expected: 只保留任务开始前已经存在的无关改动；不修改 `npm/electerm` 和旧的未跟踪文档。

如验证过程中没有代码修复，不创建空提交；将测试结果记录在任务最终报告中。本阶段不打包、不发布、不上传魔搭或 GitHub Release。
