# Effective Root SFTP File Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让非 root 书签登录后的整个远程文件面板，在当前终端真实进入 UID 0 Shell 时统一使用该 root capability，并在退出 root 后自动恢复原生 SFTP。

**Architecture:** 将现有 Managed PTY 控制器泛化为可插拔协议执行器，在同一终端租约内新增严格枚举的 root 文件控制协议。文件元数据通过不可见的随机令牌控制帧传输，文件字节通过双通道握手验证的 SFTP 私有暂存区传输；SFTP 面板、安全事务和传输队列统一消费一次操作内固定的远程文件后端。

**Tech Stack:** Electron、React、JavaScript ESM、xterm.js、OSC 633/697/698、Node.js test runner、Playwright、`@electerm/ssh2` 本地 SSH/SFTP fixture。

**Command roots:** 所有 `node`、`npm`、`npx` 命令均在 `apps/electerm-agent` 目录执行；所有 `git add`、`git commit`、`git diff`、`git status` 命令均在仓库根目录执行。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/client/components/terminal/managed-pty-task-controller.js` | 让同一独占 PTY 控制器执行运维协议或 root 文件协议，并统一验证身份、退出码、取消和提示符恢复 |
| `src/client/components/sftp/privileged-file-protocol.js` | 构建固定枚举的 root 文件命令，解析 OSC 698 身份、能力、目录项、元数据和状态帧 |
| `src/client/components/sftp/privileged-file-staging.js` | 在 SFTP 家目录建立私有暂存区，执行 SFTP/root 双向挑战握手、对象分配和受限清理 |
| `src/client/components/sftp/remote-file-backends.js` | 提供原生 SFTP 后端与 root PTY 后端的统一 SFTP-like 接口 |
| `src/client/components/sftp/remote-file-capability.js` | 校验同一 SSH 标签页端点、探测有效身份并返回单次 `sftp` 或 `pty-root` capability |
| `src/client/components/terminal/terminal.jsx` | 暴露受限 root 文件 PTY 租约，不向调用方开放任意 Shell 脚本执行 |
| `src/client/components/sftp/sftp-safety-endpoint.js` | 把 SFTP 安全端点绑定到实际 SSH 终端 PID、登录身份和主机密钥指纹 |
| `src/client/components/sftp/sftp-entry.jsx` | 统一获取、固定、展示并释放文件 capability；为事务按 operation id 固定后端 |
| `src/client/components/sftp/file-item.jsx` | 双击读取、新建和编辑不再直接调用原生 SFTP |
| `src/client/components/file-transfer/file-transfer-safety.js` | 传输安全验证使用已固定远程文件后端，而不是重新抓取裸 SFTP 实例 |
| `src/client/components/file-transfer/transfer.jsx` | 整个传输生命周期固定 capability，并在结束、取消、暂停和卸载时正确收口 |
| `src/client/common/shellpilot-i18n-overrides.js` | 新增登录身份、文件操作身份、后端阶段和终端占用文案 |
| `src/client/components/sftp/sftp.styl` | 文件操作身份和 root 终端占用状态样式 |
| `test/e2e/common/local-ssh-server.js` | 模拟 OSC 698 文件协议、普通 SFTP 权限和 root-only 文件系统 |
| `test/e2e/039.operations-pty-identity.spec.js` | 将旧的“SFTP 保持登录身份”断言改成 root 文件全流程回归 |

现有 `sftp-transaction-adapter.js` 继续使用其 SFTP-like 方法集合；通过按 operation id 解析后端来避免重写已经验证过的快照、原子替换、摘要和回滚算法。

---

### Task 1: 让 Managed PTY 控制器支持受限可插拔协议

**Files:**
- Modify: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js`
- Modify: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js`

- [ ] **Step 1: 写入自定义协议的失败测试**

在现有测试 harness 上增加一个协议适配器；它必须使用独立命令、解析器和结果，不得被默认 `SHELLPILOT_OPS` 解析器接受：

```js
test('managed PTY lease executes a bounded custom protocol', async () => {
  const customParser = createHarnessParser({
    identity: { uid: '0', username: 'root' },
    result: { kind: 'probe', capabilities: ['stat', 'base64'] }
  })
  const protocol = {
    createToken: () => 'f'.repeat(48),
    buildCommand: ({ token, request }) => `file:${token}:${request.operation}`,
    createParser: () => customParser,
    readResult: parser => parser.result()
  }
  const harness = createHarness()
  const controller = createManagedPtyTaskController(harness.options)
  const lease = await controller.acquire('root-file:test')
  const promise = lease.execute({
    protocol,
    request: { operation: 'probe' }
  })

  harness.emitCustomStart({ uid: '0', username: 'root' })
  harness.emitCustomEnd({ exitCode: 0 })
  harness.finishCommand('file:' + 'f'.repeat(48) + ':probe', 0)
  harness.prompt()

  assert.deepEqual(await promise, {
    exitCode: 0,
    identity: { uid: '0', username: 'root' },
    kind: 'probe',
    capabilities: ['stat', 'base64']
  })
  assert.equal(await lease.release(), true)
})
```

- [ ] **Step 2: 运行测试并确认失败原因**

Run: `node --test test/unit-ci/managed-pty-task-controller.spec.js --test-name-pattern="bounded custom protocol"`

Expected: FAIL，`lease.execute` 仍固定构建 `buildPtyTaskCommand`，无法产生 `file:<token>:probe`。

- [ ] **Step 3: 增加默认协议与适配器校验**

在控制器文件顶部定义默认协议，并拒绝缺少必要函数的内部协议对象：

```js
function createDefaultProtocol ({ createToken }) {
  return Object.freeze({
    createToken,
    buildCommand: ({ token, request }) => buildPtyTaskCommand({
      token,
      script: request.script
    }),
    createParser: ({ token }) => createPtyTaskOutputParser({ token }),
    readResult: () => ({})
  })
}

function requireManagedProtocol (value, fallback) {
  const protocol = value || fallback
  for (const field of [
    'createToken',
    'buildCommand',
    'createParser',
    'readResult'
  ]) {
    if (typeof protocol?.[field] !== 'function') {
      throw new Error(`受控 PTY 协议缺少 ${field}`)
    }
  }
  return protocol
}
```

在 `createManagedPtyTaskController` 初始化时创建 `defaultProtocol`。在 `execute` 中用以下逻辑替换固定命令和解析器：

```js
const protocol = requireManagedProtocol(options.protocol, defaultProtocol)
const token = protocol.createToken()
const request = options.request || { script: options.script }
const command = protocol.buildCommand({ token, request })
const parser = protocol.createParser({ token, request })
```

完成时保留公共身份和退出码，并合并协议的受限结果：

```js
const protocolResult = execution.protocol.readResult(execution.parser)
resolveExecution(execution, {
  exitCode: markerExitCode,
  identity,
  ...protocolResult
})
```

把 `protocol` 保存到 `execution`；默认协议输出仍通过 `parsed.output` 发送给 `onChunk`，自定义协议没有 `output` 时按空数组处理：

```js
for (const output of parsed.output || []) options.onChunk?.(output)
```

- [ ] **Step 4: 运行 Managed PTY 全文件测试**

Run: `node --test test/unit-ci/managed-pty-task-controller.spec.js`

Expected: PASS，现有运维协议测试和新自定义协议测试全部通过。

- [ ] **Step 5: 提交协议泛化**

```bash
git add apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js
git commit -m "refactor(terminal): support bounded managed PTY protocols"
```

---

### Task 2: 定义 root 文件控制协议与流式解析器

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/privileged-file-protocol.js`
- Create: `apps/electerm-agent/test/unit-ci/privileged-file-protocol.spec.js`

- [ ] **Step 1: 写入请求白名单和路径编码失败测试**

```js
test('privileged file protocol accepts only fixed operations and never interpolates raw paths', async () => {
  const {
    createPrivilegedFileProtocol,
    createPrivilegedFileRequest
  } = await importModule(
    'src/client/components/sftp/privileged-file-protocol.js'
  )
  const hostile = "/root/a'; touch /tmp/pwn; printf '中文\\n*"
  const request = createPrivilegedFileRequest({
    operation: 'lstat',
    args: { path: hostile }
  })
  const protocol = createPrivilegedFileProtocol()
  const command = protocol.buildCommand({
    token: 'a'.repeat(48),
    request
  })

  assert.doesNotMatch(command, /touch \/tmp\/pwn/)
  assert.doesNotMatch(command, /中文/)
  assert.match(command, new RegExp(Buffer.from(hostile).toString('base64')))
  assert.throws(
    () => createPrivilegedFileRequest({ operation: 'shell', args: {} }),
    /不支持的 root 文件操作/
  )
})
```

- [ ] **Step 2: 写入 OSC 698 流式解析失败测试**

```js
test('privileged file parser validates identity ordered data and exit code', async () => {
  const { createPrivilegedFileProtocol } = await importModule(
    'src/client/components/sftp/privileged-file-protocol.js'
  )
  const token = 'b'.repeat(48)
  const protocol = createPrivilegedFileProtocol()
  const parser = protocol.createParser({
    token,
    request: { operation: 'list', args: { path: '/root' } }
  })
  const root64 = Buffer.from('root').toString('base64')
  const uid64 = Buffer.from('0').toString('base64')
  const name64 = Buffer.from("a\n'b").toString('base64')
  const stat64 = Buffer.from('81a4;12;10;11;0;0').toString('base64')

  parser.push(`noise\u001b]698;SHELLPILOT_FILE;${token};sta`)
  parser.push(`rt;${uid64};${root64};c2g9MSxzdGF0PTE=\u0007`)
  parser.push(`\u001b]698;SHELLPILOT_FILE;${token};data;1;1;entry;${name64};${stat64}\u0007`)
  parser.push(`\u001b]698;SHELLPILOT_FILE;${token};end;0\u0007`)

  assert.deepEqual(parser.identity(), { uid: '0', username: 'root' })
  assert.equal(parser.started(), true)
  assert.equal(parser.ended(), true)
  assert.equal(parser.exitCode(), 0)
  assert.deepEqual(protocol.readResult(parser), {
    kind: 'list',
    capabilities: { sh: true, stat: true },
    entries: [{
      name: "a\n'b",
      mode: 0o100644,
      size: 12,
      atime: 10,
      mtime: 11,
      uid: 0,
      gid: 0
    }]
  })
})
```

增加错误令牌、重复 start、乱序/重复/缺失 data、单 marker 超过 2048 字节、目录项超过 20,000、总元数据超过 4 MiB、非法 Base64/UTF-8、非法 mode/size/uid/gid 和结束退出码不一致测试。

- [ ] **Step 3: 运行测试并确认模块缺失**

Run: `node --test test/unit-ci/privileged-file-protocol.spec.js`

Expected: FAIL，提示找不到 `privileged-file-protocol.js`。

- [ ] **Step 4: 实现固定请求模型**

创建模块并导出以下不可变请求模型：

```js
const allowedOperations = new Set([
  'probe',
  'list',
  'lstat',
  'stat',
  'readlink',
  'realpath',
  'mkdir',
  'touch',
  'rename',
  'rm',
  'rmdir',
  'chmod',
  'chown',
  'copy-entry',
  'remove-entry',
  'stage-handshake',
  'stage-export',
  'stage-import',
  'stage-cleanup',
  'sha256'
])

export function createPrivilegedFileRequest ({ operation, args = {} } = {}) {
  if (!allowedOperations.has(operation)) {
    throw new Error(`不支持的 root 文件操作：${operation || '空'}`)
  }
  const normalized = {}
  for (const [key, value] of Object.entries(args)) {
    if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(key)) {
      throw new Error('root 文件操作参数名无效')
    }
    const text = String(value ?? '')
    if (text.length > 1024 * 1024) {
      throw new Error(`root 文件操作参数过长：${key}`)
    }
    normalized[key] = text
  }
  return Object.freeze({ operation, args: Object.freeze(normalized) })
}
```

- [ ] **Step 5: 实现固定 Shell 操作体**

使用客户端 Base64 编码参数，并用固定变量名解码。公共脚本只包含固定源码：

```js
function decodeAssignment (name, value) {
  const encoded = encodeUtf8Base64(value)
  return `${name}="$(printf %s '${encoded}' | base64 -d)";`
}

const operationBodies = Object.freeze({
  probe: ':',
  lstat: '__sp_emit_stat "$__sp_path" lstat',
  stat: '__sp_emit_stat "$__sp_path" stat',
  readlink: '__sp_emit_text "$(readlink -- "$__sp_path")"',
  realpath: '__sp_emit_text "$(realpath -- "$__sp_path")"',
  mkdir: 'mkdir -- "$__sp_path"',
  touch: '( umask 077; : > "$__sp_path" )',
  rename: 'mv -- "$__sp_source" "$__sp_target"',
  rm: 'rm -- "$__sp_path"',
  rmdir: 'rm -rf -- "$__sp_path"',
  chmod: 'chmod -- "$__sp_mode" "$__sp_path"',
  chown: 'chown -- "$__sp_uid:$__sp_gid" "$__sp_path"',
  'copy-entry': 'cp -a -- "$__sp_source" "$__sp_target"',
  'remove-entry': 'rm -rf -- "$__sp_path"',
  'stage-cleanup': 'rm -rf -- "$__sp_path"',
  sha256: '__sp_emit_sha256 "$__sp_path"'
})
```

`list` 使用两次相同的固定 glob 循环，第一次计算总项数，第二次用 GNU `stat -c '%f;%s;%X;%Y;%u;%g'` 逐项输出 Base64 文件名和 stat 字段。glob 固定为：

```sh
"$__sp_path"/.[!.]* "$__sp_path"/..?* "$__sp_path"/*
```

每项先执行 `[ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue`。禁止 `eval`、`xargs sh` 和把远端文件名重新解释成命令。

`stage-handshake` 验证目录不是符号链接、mode 为 `0700`、uid/gid 与 SFTP `lstat` 一致、challenge 文件 SHA-256 一致，再写入 response 文件并恢复同一 uid/gid。`stage-export` 复制固定源到固定暂存路径、拒绝目标预存在、计算摘要并 chown 给登录 uid/gid；`stage-import` 验证暂存摘要后，在调用方指定目标的同级目录创建排他临时文件、恢复 mode/uid/gid、校验摘要，再原子 rename 到指定目标。编辑保存传入事务 adapter 生成的 execution path；上传传入安全事务已经固定的最终 target path。

- [ ] **Step 6: 实现 OSC 698 包装和解析器**

协议使用以下帧：

```text
OSC 698;SHELLPILOT_FILE;<token>;start;<uid64>;<user64>;<capabilities64> BEL
OSC 698;SHELLPILOT_FILE;<token>;data;<seq>;<total>;<kind>;<field64>... BEL
OSC 698;SHELLPILOT_FILE;<token>;end;<exitCode> BEL
```

导出协议对象：

```js
export function createPrivilegedFileProtocol () {
  return Object.freeze({
    createToken: createPtyTaskToken,
    buildCommand: buildPrivilegedFileCommand,
    createParser: createPrivilegedFileParser,
    readResult: parser => parser.result()
  })
}
```

解析器实现 `push/identity/started/ended/exitCode/result`，目录项从 mode 十六进制位推导类型，不信任远端自由文本类型。控制帧之外的普通输出不进入结果。

- [ ] **Step 7: 运行协议测试与现有运维协议测试**

Run: `node --test test/unit-ci/privileged-file-protocol.spec.js test/unit-ci/operations-toolkit-pty-protocol.spec.js`

Expected: PASS，所有协议测试通过，两个 marker 命名空间互不接受。

- [ ] **Step 8: 提交 root 文件协议**

```bash
git add apps/electerm-agent/src/client/components/sftp/privileged-file-protocol.js apps/electerm-agent/test/unit-ci/privileged-file-protocol.spec.js
git commit -m "feat(sftp): define privileged file PTY protocol"
```

---

### Task 3: 建立双通道暂存区与 root 文件后端

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/privileged-file-staging.js`
- Create: `apps/electerm-agent/src/client/components/sftp/remote-file-backends.js`
- Create: `apps/electerm-agent/test/unit-ci/privileged-file-staging.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/remote-file-backends.spec.js`

- [ ] **Step 1: 写入双通道挑战握手失败测试**

```js
test('staging session proves SFTP and root PTY see the same private directory', async () => {
  const sftp = createFakeSftp({ home: '/home/hik', uid: 1000, gid: 1000 })
  const requests = []
  const execute = async request => {
    requests.push(request)
    assert.equal(request.operation, 'stage-handshake')
    assert.equal(request.args.root.startsWith(
      '/home/hik/.shellpilot-privileged-transfers/'
    ), true)
    return {
      response: sha256(request.args.challenge + ':root'),
      uid: '1000',
      gid: '1000',
      mode: '700'
    }
  }
  const session = await createPrivilegedStagingSession({
    sftp,
    execute,
    createToken: sequenceTokens('session', 'operation', 'challenge')
  })

  assert.equal(requests.length, 1)
  assert.equal((await sftp.lstat(session.root)).mode & 0o777, 0o700)
  assert.equal(await session.release(), true)
  assert.equal(sftp.exists(session.root), false)
})
```

增加以下失败测试：SFTP `realpath` 与 root 所见路径不一致、challenge/response 不匹配、目录 mode 不是 `0700`、uid/gid 不匹配、候选目录预存在、目录或探测文件为符号链接、释放时 endpoint token 变化。所有失败均不得搜索其他服务器路径。

- [ ] **Step 2: 写入后端文件字节不经过 PTY 的失败测试**

```js
test('privileged backend stages file bytes through SFTP and sends only paths and digests to PTY', async () => {
  const secret = 'root-secret-content\n'
  const sftp = createFakeSftp({ home: '/home/hik', uid: 1000, gid: 1000 })
  const requests = []
  const lease = createFakeFileLease({
    execute: async request => {
      requests.push(request)
      if (request.operation === 'stage-export') {
        sftp.seed(request.args.stagePath, secret)
        return { sha256: sha256(secret), size: String(secret.length) }
      }
      return { ok: true }
    }
  })
  const backend = await createPrivilegedFileBackend({
    sftp,
    lease,
    identity: { uid: '0', username: 'root' },
    capabilities: { sha256: true, stat: true, base64: true }
  })

  assert.equal(await backend.readFile('/root/secret.txt'), secret)
  assert.equal(JSON.stringify(requests).includes(secret), false)
  assert.equal(requests.some(item => item.operation === 'stage-export'), true)
  await backend.release()
})
```

- [ ] **Step 3: 运行两个测试文件并确认模块缺失**

Run: `node --test test/unit-ci/privileged-file-staging.spec.js test/unit-ci/remote-file-backends.spec.js`

Expected: FAIL，提示两个生产模块不存在。

- [ ] **Step 4: 实现暂存 session**

导出：

```js
export async function createPrivilegedStagingSession ({
  sftp,
  execute,
  createToken = createPtyTaskToken
})
```

按以下固定顺序实现：

```js
const home = normalizeRemotePath(await sftp.realpath(await sftp.getHomeDir()))
const base = resolve(home, '.shellpilot-privileged-transfers')
const root = resolve(base, createToken())
await ensurePrivateDirectory(sftp, base)
await createExclusivePrivateDirectory(sftp, root)
const rootStat = await sftp.lstat(root)
const challenge = createToken()
const challengePath = resolve(root, 'challenge')
const responsePath = resolve(root, 'response')
await sftp.writeFile(challengePath, challenge, 0o600)
const response = await execute(createPrivilegedFileRequest({
  operation: 'stage-handshake',
  args: {
    root,
    challengePath,
    responsePath,
    challenge: await digestText(challenge),
    uid: rootStat.uid,
    gid: rootStat.gid,
    mode: '700'
  }
}))
const readBack = await sftp.readFile(responsePath)
assertHandshakeResponse(response, readBack, rootStat)
```

session 暴露 `allocate(direction)`、`remember(path)`、`cleanup(path)`、`release()`；所有路径必须在 `root` 之下，`release` 只删除已记录对象和本次 root。

- [ ] **Step 5: 实现两个后端**

原生后端保留对象身份并增加明确标签：

```js
export function createNativeSftpFileBackend (sftp) {
  if (!sftp) throw new Error('原生 SFTP 后端不可用')
  return Object.freeze({
    channel: 'sftp',
    runtimeIdentity: null,
    sftp,
    release: async () => true,
    backend: sftp
  })
}
```

root 后端返回 SFTP-like facade，至少实现事务适配器和文件面板实际调用的方法：

```js
const facadeMethods = [
  'list', 'lstat', 'stat', 'readlink', 'realpath',
  'readFile', 'readFileChunk', 'writeFile',
  'mkdir', 'touch', 'rename', 'rm', 'rmdir',
  'chmod', 'chown', 'copyEntry', 'removeEntry',
  'cp', 'mv', 'describeResumeEntry'
]
```

元数据和变更方法映射为固定 `lease.execute(request)`。`readFile/readFileChunk` 首次读取时执行 `stage-export`，随后调用底层 SFTP；`writeFile` 先用底层 SFTP 写入 upload stage、校验摘要，再执行 `stage-import` 到调用方传入的事务路径。按源路径缓存只读 stage，同一 operation release 时统一清理。

`list` 必须把协议字段适配成当前 SFTP 列表合同，避免 UI 层知道后端类型：

```js
return result.entries.map(entry => ({
  name: entry.name,
  type: modeToSftpType(entry.mode),
  size: entry.size,
  accessTime: entry.atime,
  modifyTime: entry.mtime,
  mode: entry.mode,
  owner: entry.uid,
  group: entry.gid
}))
```

`lstat/stat` 保持现有 transaction adapter 使用的 `{ mode, size, atime, mtime, uid, gid, type }` 形状。`release` 按“停止新请求 → 清理已记录 stage → 释放 PTY lease”的顺序执行且幂等；清理失败保留第一个错误，但仍必须尝试释放 lease。

后端对象结构固定为：

```js
return Object.freeze({
  channel: 'pty-root',
  runtimeIdentity: Object.freeze({
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: identity.username
  }),
  sftp: facade,
  backend: facade,
  staging,
  release
})
```

- [ ] **Step 6: 运行后端和现有事务适配器测试**

Run: `node --test test/unit-ci/privileged-file-staging.spec.js test/unit-ci/remote-file-backends.spec.js test/unit-ci/sftp-safety-transaction.spec.js`

Expected: PASS；现有事务 adapter 仍可使用原生 fake SFTP，新 facade 合同测试通过。

- [ ] **Step 7: 提交暂存和后端**

```bash
git add apps/electerm-agent/src/client/components/sftp/privileged-file-staging.js apps/electerm-agent/src/client/components/sftp/remote-file-backends.js apps/electerm-agent/test/unit-ci/privileged-file-staging.spec.js apps/electerm-agent/test/unit-ci/remote-file-backends.spec.js
git commit -m "feat(sftp): add privileged staging file backend"
```

---

### Task 4: 获取并绑定当前有效文件 capability

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/remote-file-capability.js`
- Create: `apps/electerm-agent/test/unit-ci/remote-file-capability.spec.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-safety-endpoint.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-safety-transaction.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/operations-toolkit-effective-identity.spec.js`

- [ ] **Step 1: 写入 root、非 root 和端点错配失败测试**

```js
test('capability resolver pins root backend only to the exact SSH terminal', async () => {
  const terminal = createTerminalStub({
    endpoint: terminalEndpoint({ username: 'hik', fingerprint: 'SHA256:one' }),
    identity: { uid: '0', username: 'root' }
  })
  const capability = await acquireRemoteFileCapability({
    operationId: 'file-op-1',
    tab: tab({ username: 'hik' }),
    sftp: createFakeSftp(),
    getTerminal: () => terminal
  })

  assert.equal(capability.channel, 'pty-root')
  assert.deepEqual(capability.runtimeIdentity, {
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: 'root'
  })
  assert.equal(terminal.owner(), 'root-file:file-op-1')
  await capability.release()
})

test('capability resolver releases PTY and uses native SFTP after exit root', async () => {
  const terminal = createTerminalStub({
    endpoint: terminalEndpoint({ username: 'hik' }),
    identity: { uid: '1000', username: 'hik' }
  })
  const capability = await acquireRemoteFileCapability({
    operationId: 'file-op-2',
    tab: tab({ username: 'hik' }),
    sftp: createFakeSftp(),
    getTerminal: () => terminal
  })

  assert.equal(capability.channel, 'sftp')
  assert.equal(terminal.owner(), '')
})
```

增加 host、port、username、tabId、PID 和 fingerprint 任一不同即拒绝的测试；终端忙、密码提示、TUI 和跟踪失败返回稳定错误码 `REMOTE_FILE_IDENTITY_UNAVAILABLE`，不得回用旧 root capability。

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test test/unit-ci/remote-file-capability.spec.js`

Expected: FAIL，提示找不到 capability 模块。

- [ ] **Step 3: 在 Terminal 暴露固定文件请求租约**

导入 `createPrivilegedFileProtocol`，新增：

```js
acquireRemoteFilePtyTask = async ownerId => {
  const lease = await this.operationsPtyTaskController.acquire(
    `root-file:${ownerId}`
  )
  const protocol = createPrivilegedFileProtocol()
  return Object.freeze({
    execute: (request, options = {}) => lease.execute({
      protocol,
      request,
      ...options
    }),
    release: lease.release
  })
}
```

该方法只接收 `createPrivilegedFileRequest` 生成的固定枚举请求；SFTP 组件不能传入 `script`。现有 `acquireOperationsPtyTask` 保持不变，两者共享一个控制器锁。

- [ ] **Step 4: 强化 SFTP 安全端点**

扩展 `buildSftpSafetyEndpoint` 参数：

```js
export function buildSftpSafetyEndpoint ({
  tab = {},
  terminalId,
  terminalEndpoint = {}
} = {})
```

校验 `terminalEndpoint` 的 host、port、username/connectionUsername 和 tabId 与 tab 一致，返回值保留旧字段并新增：

```js
connectionUsername: username,
hostKeyFingerprint: requiredIdentity(
  terminalEndpoint.hostKeyFingerprint,
  '主机密钥指纹'
),
sshTerminalPid: requiredIdentity(
  terminalEndpoint.terminalPid || terminalEndpoint.pid,
  'SSH 终端进程标识'
)
```

`SftpEntry.getSftpSafetyEndpoint` 必须从同一标签页读取真实终端端点，不再仅依赖 SFTP client 的 `terminalId`：

```js
const terminal = refs.get('term-' + this.props.tab.id)
return buildSftpSafetyEndpoint({
  tab: this.props.tab,
  terminalId: this.terminalId,
  terminalEndpoint: terminal?.getTerminalSafetyEndpoint?.()
})
```

`pid` 继续使用现有 `sftp:<tabId>:<terminalId>`，保证旧恢复记录合同不被改写；新增 `sshTerminalPid` 与 `hostKeyFingerprint` 用于阻止 SFTP reconnect 或 SSH reconnect 后复用旧 root capability。

- [ ] **Step 5: 实现 capability resolver**

```js
export async function acquireRemoteFileCapability ({
  operationId,
  tab,
  sftp,
  getTerminal,
  signal,
  onIdentity
}) {
  const terminal = getTerminal(tab.id)
  const terminalEndpoint = terminal?.getTerminalSafetyEndpoint?.()
  assertExactRemoteFileEndpoint({ tab, terminalEndpoint })
  const pty = await terminal.acquireRemoteFilePtyTask(operationId)
  try {
    const probe = await pty.execute(createPrivilegedFileRequest({
      operation: 'probe'
    }), { signal })
    onIdentity?.({
      loginUsername: tab.username,
      effectiveUid: probe.identity.uid,
      effectiveUsername: probe.identity.username,
      channel: probe.identity.uid === '0' ? 'pty-root' : 'sftp'
    })
    if (probe.identity.uid !== '0') {
      await pty.release()
      return createNativeSftpFileBackend(sftp)
    }
    return createPrivilegedFileBackend({
      sftp,
      lease: pty,
      identity: probe.identity,
      capabilities: probe.capabilities
    })
  } catch (cause) {
    await pty.release().catch(() => false)
    throw remoteFileIdentityUnavailable(cause)
  }
}
```

`remoteFileIdentityUnavailable` 设置 `code = 'REMOTE_FILE_IDENTITY_UNAVAILABLE'`，保留 cause，不把任何旧身份作为 fallback。

- [ ] **Step 6: 运行端点、capability 和运维身份回归**

Run: `node --test test/unit-ci/remote-file-capability.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/operations-toolkit-effective-identity.spec.js`

Expected: PASS；运维任务仍保留登录身份，SFTP endpoint 现在额外绑定 fingerprint 和真实 SSH PID。

- [ ] **Step 7: 提交 capability 层**

```bash
git add apps/electerm-agent/src/client/components/sftp/remote-file-capability.js apps/electerm-agent/test/unit-ci/remote-file-capability.spec.js apps/electerm-agent/src/client/components/terminal/terminal.jsx apps/electerm-agent/src/client/components/sftp/sftp-safety-endpoint.js apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/test/unit-ci/sftp-safety-transaction.spec.js apps/electerm-agent/test/unit-ci/operations-toolkit-effective-identity.spec.js
git commit -m "feat(sftp): resolve current terminal file capability"
```

---

### Task 5: 将浏览、双击读取和新建统一路由到固定后端

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/file-item.jsx`
- Create: `apps/electerm-agent/test/unit-ci/sftp-effective-file-routing.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-navigation-ui.spec.js`

- [ ] **Step 1: 写入当前失败的完整路由测试**

```js
test('root file mode routes list read create and metadata through one capability', async () => {
  const calls = []
  const backend = createBackendSpy(calls)
  const harness = createSftpEntryHarness({
    acquire: async () => ({
      channel: 'pty-root',
      runtimeIdentity: rootRuntimeIdentity,
      backend,
      sftp: backend,
      release: async () => calls.push(['release'])
    })
  })

  await harness.entry.remoteList(false, '/root')
  await harness.entry.readRemoteFile('/root/app.conf')
  await harness.entry.createRemoteFile({
    path: '/root/new-dir',
    isDirectory: true
  })

  assert.deepEqual(calls.map(call => call[0]), [
    'list', 'release',
    'readFile', 'release',
    'mkdir', 'release'
  ])
  assert.equal(harness.entry.state.remoteFileIdentity.effectiveUsername, 'root')
})
```

再加源代码合同测试，禁止 `file-item.jsx` 中出现 `props.sftp.readFile`、`props.sftp.mkdir`、`props.sftp.touch`，禁止 `sftp-entry.jsx` 的 `sftpList` 固定调用裸 SFTP。

- [ ] **Step 2: 运行测试并确认旧代码直接调用裸 SFTP**

Run: `node --test test/unit-ci/sftp-effective-file-routing.spec.js test/unit-ci/sftp-navigation-ui.spec.js`

Expected: FAIL，calls 未经过 capability，源代码仍匹配 `props.sftp.readFile`。

- [ ] **Step 3: 在 SftpEntry 增加单次操作 helper**

constructor 增加：

```js
this.remoteFileOperationBackends = new Map()
this.remoteFileOperationSequence = 0
this.remoteFileOperations = new Set()
this.remoteFileUnmounted = false
```

state 增加：

```js
remoteFileIdentity: {
  loginUsername: props.tab.username || '',
  effectiveUid: '',
  effectiveUsername: '',
  channel: 'unknown'
}
```

新增公共方法：

```js
acquireRemoteFileOperation = async ({ id, signal } = {}) => {
  const operationId = id ||
    `file-ui-${this.props.tab.id}-${++this.remoteFileOperationSequence}`
  return acquireRemoteFileCapability({
    operationId,
    tab: this.props.tab,
    sftp: this.sftp,
    getTerminal: tabId => refs.get('term-' + tabId),
    signal,
    onIdentity: remoteFileIdentity => {
      if (!this.remoteFileUnmounted) this.setState({ remoteFileIdentity })
    }
  })
}

withRemoteFileOperation = async (options, work) => {
  const capability = await this.acquireRemoteFileOperation(options)
  this.remoteFileOperations.add(capability)
  try {
    return await work(capability.backend, capability)
  } finally {
    this.remoteFileOperations.delete(capability)
    await capability.release()
  }
}
```

`componentWillUnmount` 先设置 `this.remoteFileUnmounted = true`，再对 `remoteFileOperations` 中的 capability 执行 `Promise.allSettled` 释放，并清空 `remoteFileOperationBackends`；释放函数必须幂等，避免和正常 `finally` 冲突。

- [ ] **Step 4: 路由列表、读取、link 解析和新建**

把 `sftpList` 改成接收统一 backend；`remoteList` 在已经建立连接后用 `withRemoteFileOperation` 执行列表。连接创建和 `getHomeDir` 仍由原生 SFTP 完成，实际目标目录列表由选定后端完成。

当前 `remoteList` 会在 `setState` callback 和 1 秒 timer 中异步调用 `updateRemoteList`。把第一次符号链接解析移入同一个 `withRemoteFileOperation` 回调并 `await` 完成后再提交 state；1 秒后的补偿刷新必须调用新的 `remoteList(true, remotePath)`，重新探测并获取新 capability，禁止闭包继续使用已经 release 的 root backend。单元测试用 `release` 后拒绝调用的 spy 验证没有晚到的 `readlink/stat`。

新增：

```js
readRemoteFile = path => this.withRemoteFileOperation(
  { id: `editor-read:${path}` },
  backend => backend.readFile(path)
)

createRemoteFile = ({ path, isDirectory }) => this.withRemoteFileOperation(
  { id: `create:${path}` },
  backend => isDirectory ? backend.mkdir(path) : backend.touch(path)
)
```

`resolveRemoteLink`、`remoteDel` 也改为显式 backend 参数。`getFileProps` 传递 `readRemoteFile` 和 `createRemoteFile`。

- [ ] **Step 5: 修改 FileItem 调用方**

```js
fetchEditorText = async (path, type) => (
  typeMap.remote === type
    ? this.props.readRemoteFile(path)
    : window.fs.readFile(path)
)

remoteCreateNew = async file => {
  const path = resolve(this.props.remotePath, file.nameTemp)
  const result = await this.props.createRemoteFile({
    path,
    isDirectory: file.isDirectory
  }).then(() => true).catch(window.store.onError)
  if (result) await this.props.remoteList()
}
```

删除固定 500ms 新建等待；操作完成协议已经确认远端状态。

- [ ] **Step 6: 运行定向测试**

Run: `node --test test/unit-ci/sftp-effective-file-routing.spec.js test/unit-ci/sftp-navigation-ui.spec.js test/unit-ci/sftp-refresh-behavior.spec.js`

Expected: PASS；列表、双击读取、新建和刷新全部走同一后端接口。

- [ ] **Step 7: 提交基础 UI 路由**

```bash
git add apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/src/client/components/sftp/file-item.jsx apps/electerm-agent/test/unit-ci/sftp-effective-file-routing.spec.js apps/electerm-agent/test/unit-ci/sftp-navigation-ui.spec.js
git commit -m "fix(sftp): route browsing through effective file identity"
```

---

### Task 6: 将编辑保存、权限、改名、删除、备份和恢复绑定到 operation backend

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-editor-permission-error.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-safety-transaction.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-editor-permission.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-fast-delete.spec.js`

- [ ] **Step 1: 写入 root editor-save 的失败测试**

```js
test('editor save binds snapshot execute verify and rollback to the same root backend', async () => {
  const native = createFakeSftp({ deny: ['/root/app.conf'] })
  const root = createFakeSftp({
    '/root/app.conf': { type: 'file', content: 'old\n', mode: 0o600, uid: 0, gid: 0 }
  })
  const harness = createSftpEntryHarness({ native, effectiveBackend: root })

  const result = await harness.entry.saveRemoteEditorFile({
    path: '/root/app.conf',
    text: 'new\n',
    mode: 0o600
  })

  assert.equal(result, true)
  assert.equal(root.text('/root/app.conf'), 'new\n')
  assert.equal(native.calls.some(call => call.path === '/root/app.conf'), false)
  const operation = await harness.latestOperation()
  assert.deepEqual(operation.metadata.runtimeIdentity, rootRuntimeIdentity)
  assert.equal(harness.entry.remoteFileOperationBackends.size, 0)
})
```

增加 chmod、rename、安全删除、快速删除、快速备份和恢复的 root backend 测试；恢复在当前非 root 时必须得到 `REMOTE_FILE_ROOT_REQUIRED`，再次 root 后通过。

- [ ] **Step 2: 运行定向测试并确认 prepare 仍解析裸 SFTP**

Run: `node --test test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-fast-delete.spec.js`

Expected: FAIL，adapter 的 `getSftp` 仍始终返回 `this.sftp`，root-only 目标无法 prepare。

- [ ] **Step 3: 让安全请求接受已固定 operation id 和运行身份**

扩展 `prepareSftpSafetyOperation`：

```js
prepareSftpSafetyOperation = async ({
  id,
  action,
  paths,
  type,
  requestedMode,
  expected,
  title,
  signal,
  metadata
}, { backend, runtimeIdentity } = {}) => {
  const request = buildSideEffectSafetyRequest({
    id: id || `sftp-${action}-${Date.now()}-${generate()}`,
    source: 'sftp',
    endpoint: this.getSftpSafetyEndpoint(),
    title,
    effect: {
      adapter: 'sftp',
      action,
      paths,
      resources: Object.values(paths).map(path => ({ path, type })),
      type,
      requestedMode,
      expected: expected || {}
    },
    metadata: {
      sftpSafetyTransaction: true,
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      ...metadata
    }
  })
  request.signal = signal
  if (backend) this.remoteFileOperationBackends.set(request.id, backend)
  return this.sftpSafetyRunner.prepare(request)
}
```

constructor 中的 adapter 改成：

```js
this.sftpSafetyAdapter = createSftpTransactionAdapter({
  getSftp: operation => (
    this.remoteFileOperationBackends.get(operation?.id) || this.sftp
  )
})
```

- [ ] **Step 4: 用一次 capability 包住完整确认和执行**

先把现有 `runSftpSafetyOperation` 中 prepare 之后的第 740-766 行逻辑原样抽取为已定义 helper；其输入不再隐式依赖局部变量：

```js
confirmAndExecutePreparedOperation = async (
  operation,
  spec,
  options = {}
) => {
  let confirmationDetails = options.confirmationDetails
  if (!confirmationDetails && options.buildConfirmationDetails) {
    try {
      confirmationDetails = await options.buildConfirmationDetails(operation)
    } catch (error) {
      if (error?.name === 'AbortError') {
        await this.sftpSafetyRunner.cancel(operation.id)
        throw error
      }
      confirmationDetails = {
        path: Object.values(spec.paths || {})[0] || ''
      }
    }
  }
  const confirmed = await this.confirmPreparedSftpOperation(
    options.confirmTitle || `确认${spec.title || '执行 SFTP 修改'}？`,
    confirmationDetails
  )
  if (!confirmed) {
    await this.sftpSafetyRunner.cancel(operation.id)
    return false
  }
  return this.sftpSafetyRunner.execute(operation.id, {
    confirmed: true,
    sideEffectInput: options.input,
    signal: options.signal
  })
}
```

然后让 `runSftpSafetyOperation` 在生成 operation id 后先 acquire，再 prepare、构建预览、等待确认和 execute；finally 删除 map 并 release：

```js
const operationId = `sftp-${spec.action}-${Date.now()}-${generate()}`
return this.withRemoteFileOperation({ id: operationId, signal: spec.signal }, async (
  backend,
  capability
) => {
  this.remoteFileOperationBackends.set(operationId, backend)
  try {
    const operation = await this.prepareSftpSafetyOperation({
      ...spec,
      id: operationId
    }, {
      backend,
      runtimeIdentity: capability.runtimeIdentity
    })
    return await this.confirmAndExecutePreparedOperation(operation, spec, options)
  } finally {
    this.remoteFileOperationBackends.delete(operationId)
  }
})
```

`saveRemoteEditorFiles` 的整批审查只 acquire 一次 capability，并为每个 operation id 绑定同一个 backend，直到全部选中项执行、取消或失败后统一释放。

- [ ] **Step 5: 路由所有修改与恢复调用**

- `changeRemoteFileMode`、`renameRemoteFile`、`saveRemoteEditorFile(s)`、`deleteRemoteFilesWithSafety` 通过上述 runner 路径。
- `quickDeleteRemoteFiles` 在确认后用 `withRemoteFileOperation` 把 backend 传给 `executeFastRemoteDelete`。
- `quickBackupRemoteFiles` 和 `restoreSftpRecord` 用同一次 backend 调用现有 backup/restore helpers。
- FTP 分支保持裸 FTP 行为，不探测 PTY。
- `rollbackSafetyOperation` 获取 operation 后重新 acquire；若 metadata.runtimeIdentity.channel 是 `pty-root` 而探测不是 UID 0，抛出 `REMOTE_FILE_ROOT_REQUIRED`，不调用普通 SFTP rollback。

- [ ] **Step 6: 更新权限错误使用真实运行身份**

`formatSftpEditorSaveError` 接受：

```js
{
  path,
  loginUsername,
  effectiveUsername,
  channel
}
```

root 后端失败显示“SSH 登录：hik，文件操作：root（当前终端）”；原生后端显示“SFTP 身份：hik”。删除“终端 su 永远不会改变文件操作”这一已经过时的绝对提示。

- [ ] **Step 7: 运行修改动作和事务回归**

Run: `node --test test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-fast-delete.spec.js test/unit-ci/sftp-effective-file-routing.spec.js`

Expected: PASS；所有修改动作使用固定 backend，operation map 在成功、取消和失败后均为空。

- [ ] **Step 8: 提交安全事务路由**

```bash
git add apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/src/client/components/sftp/sftp-editor-permission-error.js apps/electerm-agent/test/unit-ci/sftp-safety-transaction.spec.js apps/electerm-agent/test/unit-ci/sftp-editor-permission.spec.js apps/electerm-agent/test/unit-ci/sftp-fast-delete.spec.js
git commit -m "fix(sftp): execute mutations with effective root backend"
```

---

### Task 7: 让上传、下载和目录传输使用 root 暂存后端

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sftp/remote-file-backends.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/file-transfer/file-transfer-safety.js`
- Modify: `apps/electerm-agent/src/client/components/file-transfer/transfer.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-transfer-safety.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/privileged-file-transfer.spec.js`

- [ ] **Step 1: 写入 root 上传和下载失败测试**

```js
test('privileged upload transfers to stage then installs the verified target', async () => {
  const { backend, nativeSftp, ptyRequests } = await createPrivilegedBackendHarness()
  const events = []
  const transport = await backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: { mode: 0o600, atomicUpload: true },
    onData: data => events.push(['data', data]),
    onEnd: data => events.push(['end', data]),
    onError: error => events.push(['error', error.message])
  })

  await nativeSftp.finishUpload(transport)

  assert.equal(nativeSftp.lastUpload.remotePath.startsWith(
    '/home/hik/.shellpilot-privileged-transfers/'
  ), true)
  assert.equal(ptyRequests.some(request => (
    request.operation === 'stage-import' &&
    request.args.targetPath === '/root/app.conf'
  )), true)
  assert.deepEqual(events.at(-1)[0], 'end')
})
```

下载测试必须先 `stage-export`，再从 stage 通过 SFTP 下载；取消在两个阶段都清理，暂停/继续只代理底层 SFTP transport 且不释放 root capability。

- [ ] **Step 2: 写入 Transfer 生命周期固定 capability 的失败测试**

```js
test('transfer pins one effective backend through pause resume completion and release', async () => {
  const session = createTransferCapabilitySpy()
  const harness = createTransferHarness({ session })
  await harness.init()
  await harness.pause()
  await harness.resume()
  await harness.complete()

  assert.equal(session.acquireCount, 1)
  assert.equal(session.backend.uploadCalls, 1)
  assert.equal(session.releaseCount, 1)
  assert.deepEqual(harness.task.metadata.runtimeIdentity, rootRuntimeIdentity)
})
```

- [ ] **Step 3: 运行测试并确认传输仍抓取 `capability.sftp`**

Run: `node --test test/unit-ci/privileged-file-transfer.spec.js test/unit-ci/sftp-transfer-safety.spec.js`

Expected: FAIL，Transfer 尚未 acquire/pin 文件 capability，上传目标仍是真实 root 路径。

- [ ] **Step 4: 在 root backend 实现 upload/download transport proxy**

`upload`：分配 upload stage，调用底层 `sftp.upload`；底层 `onEnd` 后执行 SHA-256 校验和 `stage-import`，只有安装及验证成功才调用外层 `onEnd`。`pause/resume/cancel/interrupt/destroy` 代理到底层 transport；cancel/interrupt 同时登记 stage cleanup。

`download`：先执行 `stage-export` 固定源快照和摘要，再调用底层 `sftp.download`；底层结束后校验已传输大小，清理 stage，再调用外层 `onEnd`。

返回的 proxy 结构：

```js
return Object.freeze({
  pause: () => inner?.pause(),
  resume: () => inner?.resume(),
  cancel: () => cancel('cancelled'),
  interrupt: () => cancel('interrupted'),
  destroy: () => inner?.destroy()
})
```

目录传输继续由 `transfer.jsx` 遍历；`backend.list/mkdir/upload/download` 已覆盖 root-only 目录和逐文件暂存。

- [ ] **Step 5: 在 SftpEntry 暴露 transfer capability**

```js
acquireTransferFileCapability = ({ transferId, signal }) => (
  this.acquireRemoteFileOperation({
    id: `transfer:${transferId}`,
    signal
  })
)
```

- [ ] **Step 6: 在 Transfer 固定 session**

在 `initTransfer` 的任何 `remoteCheckExist` 之前调用：

```js
ensureRemoteFileSession = async () => {
  if (this.remoteFileSession) return this.remoteFileSession
  const capability = refs.get('sftp-' + this.tabId)
  this.remoteFileSession = await capability.acquireTransferFileCapability({
    transferId: this.props.transfer.id
  })
  return this.remoteFileSession
}
```

`remoteCheckExist`、`list`、`mkdir`、`mvOrCp`、`transferFile` 和 `transferFileAsSubTransfer` 使用 `remoteFileSession.backend`。`file-transfer-safety.js` 的 source pin 保存 `{ capability, backend }`；兼容字段 `sftp` 指向同一个 backend facade，避免跨主机验证重新获取裸 SFTP。

在 `onEnd/cancelAndWait/componentWillUnmount` 中先完成/取消安全事务和 stage cleanup，再调用一次 `remoteFileSession.release()`；暂停不释放。增加 idempotent `releaseRemoteFileSession` 防止多终态重复释放。

- [ ] **Step 7: 保存 transfer 运行身份**

`beginTransferTask` metadata、transfer history 和安全事务 metadata 增加：

```js
runtimeIdentity: this.remoteFileSession?.runtimeIdentity || {
  channel: 'sftp',
  effectiveUsername: this.getTransferTaskEndpoint().username
}
```

登录 endpoint.username 保持 hik，不改成 root。

- [ ] **Step 8: 运行传输相关测试**

Run: `node --test test/unit-ci/privileged-file-transfer.spec.js test/unit-ci/sftp-transfer-safety.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/operation-task-store.spec.js`

Expected: PASS；大文件字节只经过 SFTP，root lease 在传输终态后释放一次。

- [ ] **Step 9: 提交特权传输**

```bash
git add apps/electerm-agent/src/client/components/sftp/remote-file-backends.js apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/src/client/components/file-transfer/file-transfer-safety.js apps/electerm-agent/src/client/components/file-transfer/transfer.jsx apps/electerm-agent/test/unit-ci/sftp-transfer-safety.spec.js apps/electerm-agent/test/unit-ci/privileged-file-transfer.spec.js
git commit -m "feat(sftp): transfer root files through verified staging"
```

---

### Task 8: 显示真实登录身份与文件操作身份

**Files:**
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp.styl`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Create: `apps/electerm-agent/test/unit-ci/sftp-effective-identity-ui.spec.js`
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`

- [ ] **Step 1: 写入双身份和忙碌状态失败测试**

```js
test('remote panel shows login and effective file identities without rewriting the tab', () => {
  const source = readSource('src/client/components/sftp/sftp-entry.jsx')
  assert.match(source, /remoteFileIdentity/)
  assert.match(source, /shellpilotSftpLoginIdentity/)
  assert.match(source, /shellpilotSftpEffectiveFileIdentity/)
  assert.doesNotMatch(source, /tab\.username\s*=\s*.*effective/)
})
```

渲染测试分别断言：普通 SFTP 显示“文件操作：hik（SFTP）”；root 显示“文件操作：root（当前终端）”；未知显示“文件操作：未知”；root lease 占用时显示“远程文件操作正在使用终端”和取消说明。

- [ ] **Step 2: 运行测试并确认文案缺失**

Run: `node --test test/unit-ci/sftp-effective-identity-ui.spec.js`

Expected: FAIL，远程面板标题仍只有 `{username}@{host}`。

- [ ] **Step 3: 渲染双身份状态**

在 `renderSftpPanelTitle` 中保留真实 endpoint 行，并新增：

```jsx
<span className='sftp-panel-identities'>
  <span>{formatShellPilotTranslation(
    e,
    'shellpilotSftpLoginIdentity',
    { username }
  )}</span>
  <span className={`sftp-file-identity is-${remoteFileIdentity.channel}`}>
    {formatEffectiveFileIdentity(remoteFileIdentity, e)}
  </span>
</span>
```

root transfer/session 持有 lease 时增加 `aria-live="polite"` 状态，不覆盖传输进度坞。

- [ ] **Step 4: 新增中英文文案和样式**

中文：

```text
SSH 登录：{username}
文件操作：{username}（当前终端）
文件操作：{username}（SFTP）
文件操作：未知
远程文件操作正在使用当前终端；完成或取消前终端输入已锁定。
无法确认当前 Shell 身份，远程文件操作尚未发送。
```

英文提供语义对应的 `SSH login`、`File operations`、`current terminal`、`SFTP`、`Unknown`、busy 和 unavailable 文案。

样式使用现有字号、颜色 token 和焦点规则；root badge 不使用仅靠红/绿表达的状态。

- [ ] **Step 5: 更新用户指南中过时说明**

把第 7.6 和 21.8 节“终端 su 不会改变文件操作”的绝对说明改为：原生 SFTP 登录身份不会改变；当同一终端可可靠确认 UID 0 时，ShellPilot 会通过受控终端和私有 SFTP 暂存区执行完整 root 文件操作。说明终端忙、chroot 映射失败、基础命令缺失和退出 root 后的行为。

- [ ] **Step 6: 运行 UI、i18n 和文档合同测试**

Run: `node --test test/unit-ci/sftp-effective-identity-ui.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/sftp-editor-permission.spec.js`

Expected: PASS；双身份清晰，旧误导说明不再存在。

- [ ] **Step 7: 提交身份 UI 和指南**

```bash
git add apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx apps/electerm-agent/src/client/components/sftp/sftp.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/sftp-effective-identity-ui.spec.js apps/electerm-agent/docs/USER_GUIDE_ZH.md
git commit -m "feat(sftp): show effective root file identity"
```

---

### Task 9: 扩展本地 SSH/SFTP fixture 并完成 root 文件 E2E

**Files:**
- Modify: `apps/electerm-agent/test/e2e/common/local-ssh-server.js`
- Modify: `apps/electerm-agent/test/e2e/common/local-sftp-fixture.js`
- Modify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/real-server-e2e-hygiene.spec.js`

- [ ] **Step 1: 先把旧 E2E 断言改成目标行为**

将测试名称改为：

```js
test('operations and the complete remote file panel inherit su root then return to the login identity', async () => {
```

在 `su root` 后加入：

```js
await openRemoteFilePanel(page)
await expect(page.locator('.sftp-file-identity')).toContainText(
  '文件操作：root（当前终端）'
)
await gotoRemotePath(page, '/root-only')
await openRemoteEditor(page, 'app.conf')
await expect(remoteEditor(page)).toContainText('enabled=false')
await replaceRemoteEditorText(page, 'enabled=true\n')
await saveRemoteEditor(page)
await expect.poll(() => fixture.readRootFile('/root-only/app.conf'))
  .toBe('enabled=true\n')
```

继续覆盖上传、下载、新建目录、改名、chmod、安全删除和快速删除。执行 `exit` 后刷新 root-only 路径，断言身份显示 hik 且访问按普通 SFTP 权限失败。保留原有运维任务和抓包断言，证明两条 capability 共存。

- [ ] **Step 2: 运行 E2E 并确认当前设计断言失败**

Run: `npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1`

Expected: FAIL，旧 fixture 不识别 OSC 698，远程面板仍无法浏览 `/root-only`。

- [ ] **Step 3: 扩展 fixture 的 root-only 文件模型**

`createLocalSftpFixture` 增加：

```js
rootOnly: {
  '/root-only/app.conf': {
    content: 'enabled=false\n',
    mode: 0o600,
    uid: 0,
    gid: 0
  }
},
readRootFile,
writeRootFile,
listRootDirectory,
statRootPath
```

普通 SFTP 对 `/root-only` 返回 permission denied；对 `.shellpilot-privileged-transfers` 允许当前登录用户读写。fixture 记录 `privilegedFileRequests`、`stagingReads`、`stagingWrites` 和 `stagingCleanups`。

- [ ] **Step 4: 在 local SSH server 模拟 OSC 698**

增加 `parsePrivilegedFileCommand` 和：

```js
function privilegedFileMarker (token, phase, ...fields) {
  return `\u001b]698;SHELLPILOT_FILE;${token};${phase};${fields.join(';')}\u0007`
}
```

只有 `shellState.identity.uid === '0'` 时允许 root-only 操作。按生产协议回应 probe、list、stat、握手、stage export/import、mkdir/touch/rename/remove/chmod/hash；响应内容来自 fixture 的 root-only 模型，不调用宿主机 root 权限。

`su root` 后仍故意让 Shell Integration 失效，确保客户端先重跟踪当前 root Shell 再运行文件协议。

- [ ] **Step 5: 增加取消和退出 root 回归**

E2E 触发一个可取消 root 下载，按 `Ctrl+C`，断言 transfer、PTY 和 stage 均收口。随后执行 `exit`，下一次文件操作必须产生新的 probe，不能复用前一个 root token。

- [ ] **Step 6: 运行 E2E 和 hygiene 测试**

Run: `npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1`

Expected: PASS，1 test、0 failures。

Run: `node --test test/unit-ci/real-server-e2e-hygiene.spec.js`

Expected: PASS；fixture 不连接外部服务器，生产 E2E 没有硬编码用户服务器或凭据。

- [ ] **Step 7: 提交完整 E2E**

```bash
git add apps/electerm-agent/test/e2e/common/local-ssh-server.js apps/electerm-agent/test/e2e/common/local-sftp-fixture.js apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js apps/electerm-agent/test/unit-ci/real-server-e2e-hygiene.spec.js
git commit -m "test(e2e): verify su-aware root file operations"
```

---

### Task 10: 完整回归、构建与最终一致性检查

**Files:**
- Modify only if a verification failure identifies a requirement-related defect in files already listed above.

- [ ] **Step 1: 运行全部定向单元测试**

Run:

```bash
node --test test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/privileged-file-protocol.spec.js test/unit-ci/privileged-file-staging.spec.js test/unit-ci/remote-file-backends.spec.js test/unit-ci/remote-file-capability.spec.js test/unit-ci/sftp-effective-file-routing.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-fast-delete.spec.js test/unit-ci/privileged-file-transfer.spec.js test/unit-ci/sftp-transfer-safety.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/sftp-effective-identity-ui.spec.js test/unit-ci/operations-toolkit-effective-identity.spec.js
```

Expected: PASS，0 failures。

- [ ] **Step 2: 运行完整 unit-ci**

Run: `npm run test-unit-ci`

Expected: PASS，0 failures、0 cancelled。

- [ ] **Step 3: 运行 lint**

Run: `npm run lint`

Expected: exit 0，无 StandardJS 错误。

- [ ] **Step 4: 运行身份和 SFTP E2E**

Run: `npx playwright test test/e2e/039.operations-pty-identity.spec.js test/e2e/005.local-ssh-lifecycle.spec.js --workers=1`

Expected: PASS，0 failures。

- [ ] **Step 5: 运行传输与交互性能回归**

Run: `npm run test-performance-e2e`

Expected: PASS；文件内容不进入 PTY 控制帧，列表和批量操作没有破坏交互性能门槛。

- [ ] **Step 6: 运行生产构建**

Run: `npm run vite-build`

Expected: exit 0，renderer 生产 bundle 构建成功。

- [ ] **Step 7: 检查身份隔离和旧断言**

Run:

```bash
rg -n "SFTP keeps the login identity|终端.*su.*不会改变.*文件操作|endpoint\.(username|connectionUsername)\s*=\s*.*effective|tab\.username\s*=\s*.*effective" src test docs
```

Expected: 无旧行为断言，无把有效 root 身份写回 endpoint 或 tab 的赋值。

- [ ] **Step 8: 检查工作区和提交最终修正**

Run: `git status --short`

只检查并暂存本计划涉及的文件；保留用户原有的无关修改。若前述验证导致了必要修正，先运行 `git diff --name-only` 并逐项确认都属于本计划，然后使用对应 Task 中列出的精确 `git add` 文件清单提交：

```bash
git commit -m "fix(sftp): close effective root file regressions"
```

若没有必要修正，不创建空提交。

---

## 实施完成检查表

- [ ] 当前 UID 0 时，list/stat/read/write/upload/download/create/rename/delete/chmod/batch/directory 全部使用一次操作内固定的 root backend。
- [ ] 执行 `exit` 后下一次 probe 返回登录用户并恢复原生 SFTP。
- [ ] 大文件字节只经过 SFTP 暂存，不进入 PTY 或终端普通输出。
- [ ] SFTP/root 暂存路径完成双向挑战，不支持路径映射时明确失败。
- [ ] 快照、原子替换、摘要、确认、恢复和快速删除保护不退化。
- [ ] 登录 endpoint 始终保留真实书签账号和主机密钥。
- [ ] 成功、取消、断线和结果未知时 capability、监听器、operation backend map 与 stage 正确收口。
- [ ] 定向测试、完整 unit-ci、lint、E2E、性能回归和生产构建均以最新输出通过。
