# ShellPilot Quick Command Balanced Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持 SSH、SFTP、AI 和现有安全中心稳定的前提下，将服务器快捷命令按领域组件化，并新增 12 项只读排查、6 项可回滚表单维护和防火墙表单增强。

**Architecture:** `server-maintenance-commands.js` 保持唯一公共入口，领域模块分别声明系统、存储、网络、安全、服务和容器命令；共享层负责命令定义、参数校验、环境探测和安全元数据。只读命令根据远端能力选择主命令或降级命令，修改命令统一经过预检、备份、确认、执行、验证和安全中心回滚链路。

**Tech Stack:** Electron 41、React 19、Ant Design 6、Node.js ESM、Stylus、Node Test Runner、Playwright、现有 ShellPilot Safety Transactions。

---

## 文件结构

### 新建文件

- `src/client/components/quick-commands/server-maintenance/index.js`：领域命令聚合和重复 ID 防护。
- `src/client/components/quick-commands/server-maintenance/system.js`：系统与进程命令。
- `src/client/components/quick-commands/server-maintenance/storage.js`：磁盘、文件系统和 Swap 命令。
- `src/client/components/quick-commands/server-maintenance/network.js`：地址、端口、路由、DNS、HTTP、TLS 和抓包命令。
- `src/client/components/quick-commands/server-maintenance/security.js`：防火墙、SSH 安全事件和权限命令。
- `src/client/components/quick-commands/server-maintenance/services.js`：服务、日志、Nginx、Cron 和 Timer 命令。
- `src/client/components/quick-commands/server-maintenance/containers.js`：Docker 命令。
- `src/client/components/quick-commands/server-maintenance/shared/definition.js`：命令、步骤和参数定义器。
- `src/client/components/quick-commands/server-maintenance/shared/validation.js`：表单参数规则与 shell 安全引用。
- `src/client/components/quick-commands/server-maintenance/shared/discovery.js`：远端平台和工具能力探测命令及解析。
- `src/client/components/quick-commands/server-maintenance/shared/command-builders.js`：从已校验字段生成安全的 shell 赋值和命令片段。
- `src/client/components/quick-commands/server-maintenance/shared/safety-metadata.js`：回滚字段和安全事务元数据生成。
- `test/unit-ci/server-maintenance-command-registry.spec.js`：目录拆分、旧 ID 和重复 ID 测试。
- `test/unit-ci/server-maintenance-readonly-expansion.spec.js`：12 项只读命令测试。
- `test/unit-ci/server-maintenance-mutating-expansion.spec.js`：6 项修改命令与防火墙增强测试。
- `test/unit-ci/quick-command-validation.spec.js`：参数边界与命令注入测试。
- `test/e2e/032.quick-command-balanced-expansion.spec.js`：快捷命令界面和连续执行回归。

### 修改文件

- `src/client/components/quick-commands/server-maintenance-commands.js`：改为兼容聚合入口。
- `src/client/components/quick-commands/quick-command-context.js`：调用统一参数校验并提供扩充默认上下文。
- `src/client/components/quick-commands/quick-commands-box.jsx`：分组筛选、能力探测、参数错误和多选目标。
- `src/client/components/quick-commands/quick-command-item.jsx`：精简卡片信息和风险标识。
- `src/client/components/quick-commands/qm.styl`：响应式网格、表单和错误提示样式。
- `src/client/common/shellpilot-i18n-overrides.js`：新增中文界面文案。
- `test/unit-ci/server-maintenance-quick-commands.spec.js`：保留旧用例并增加兼容断言。
- `test/e2e/027.quality-core-flows.spec.js`：连续执行和安全中心完成状态回归。
- `test/e2e/030.real-server-regression.spec.js`：只读扩充命令的真实服务器白名单。

---

### Task 1: 建立领域目录并保持旧命令完全兼容

**Files:**
- Create: `src/client/components/quick-commands/server-maintenance/shared/definition.js`
- Create: `src/client/components/quick-commands/server-maintenance/index.js`
- Create: `src/client/components/quick-commands/server-maintenance/system.js`
- Create: `src/client/components/quick-commands/server-maintenance/storage.js`
- Create: `src/client/components/quick-commands/server-maintenance/network.js`
- Create: `src/client/components/quick-commands/server-maintenance/security.js`
- Create: `src/client/components/quick-commands/server-maintenance/services.js`
- Create: `src/client/components/quick-commands/server-maintenance/containers.js`
- Modify: `src/client/components/quick-commands/server-maintenance-commands.js`
- Test: `test/unit-ci/server-maintenance-command-registry.spec.js`

- [ ] **Step 1: 编写失败测试，锁定 26 个旧 ID、顺序和重复 ID 防护**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/server-maintenance-commands.js'
)).href

const oldIds = [
  'builtin-server-overview',
  'builtin-server-disk',
  'builtin-server-memory',
  'builtin-server-process-top',
  'builtin-server-network-listen',
  'builtin-server-port-process',
  'builtin-server-ip-query',
  'builtin-server-network-change-ip',
  'builtin-server-dns-check',
  'builtin-server-time-query',
  'builtin-server-firewall-status',
  'builtin-server-firewall-open-port',
  'builtin-server-service-logs',
  'builtin-server-service-status',
  'builtin-server-log-search',
  'builtin-server-nginx',
  'builtin-server-docker',
  'builtin-server-connectivity-check',
  'builtin-server-http-check',
  'builtin-server-tls-check',
  'builtin-server-directory-analysis',
  'builtin-server-process-detail',
  'builtin-server-service-action',
  'builtin-server-docker-action',
  'builtin-server-file-permission',
  'builtin-server-packet-capture'
]

test('server maintenance registry keeps every existing command id in order', async () => {
  const { getServerMaintenanceQuickCommands } = await import(moduleUrl)
  const ids = getServerMaintenanceQuickCommands().map(item => item.id)
  assert.deepEqual(ids.slice(0, oldIds.length), oldIds)
  assert.equal(new Set(ids).size, ids.length)
})
```

- [ ] **Step 2: 运行测试确认在目录拆分前测试可执行**

Run: `node --test test/unit-ci/server-maintenance-command-registry.spec.js`

Expected: PASS，说明测试已正确读取当前公共入口；后续拆分必须持续保持 PASS。

- [ ] **Step 3: 提取共享定义器并按 ID 将现有对象原样移动到领域模块**

```js
// shared/definition.js
export const COMMON_DELAY = 100
export const BUILTIN = '内置'
export const MAINTENANCE = '服务器维护'
export const READ_ONLY = '只读'
export const NEED_EDIT = '需编辑'

export function step (command, delay = COMMON_DELAY) {
  return { command, delay }
}

export function defineCommand (item) {
  const params = [...(item.params || [])]
  if (item.mutatesServer) {
    if (!params.some(param => param.name === '回滚脚本')) {
      params.push({
        name: '回滚脚本',
        label: '回滚脚本',
        type: 'hidden',
        defaultValue: '{{回滚脚本}}',
        help: '由 ShellPilot 自动生成并保存到服务器 /tmp/shellpilot-rollback 目录。'
      })
    }
    if (!params.some(param => param.name === '确认执行')) {
      params.push({
        name: '确认执行',
        label: '确认执行',
        type: 'select',
        defaultValue: 'no',
        help: '默认只预览，只有选择“是”才执行修改。',
        options: [
          { label: '否，只预览', value: 'no' },
          { label: '是，执行修改', value: 'yes' }
        ]
      })
    }
  }
  return {
    inputOnly: false,
    advancedUsage: item.advancedUsage || [],
    ...item,
    params,
    labels: [BUILTIN, MAINTENANCE, ...(item.labels || [])]
  }
}

export function inputParam (name, label, defaultValue, help, placeholder = '') {
  return { name, label, type: 'input', defaultValue, help, placeholder }
}

export function numberParam (name, label, defaultValue, help, min = 1, max = 10000) {
  return { name, label, type: 'number', defaultValue, help, min, max }
}

export function selectParam (name, label, defaultValue, help, options) {
  return { name, label, type: 'select', defaultValue, help, options }
}
```

Move the complete command objects without changing IDs, labels, parameters or command text:

```text
system.js: overview, memory, process-top, time-query, process-detail
storage.js: disk, directory-analysis
network.js: network-listen, port-process, ip-query, network-change-ip,
            dns-check, connectivity-check, http-check, tls-check, packet-capture
security.js: firewall-status, firewall-open-port, file-permission
services.js: service-logs, service-status, log-search, nginx, service-action
containers.js: docker, docker-action
```

- [ ] **Step 4: 实现稳定聚合器，发现重复 ID 时立即失败**

```js
// server-maintenance/index.js
import { systemCommands } from './system.js'
import { storageCommands } from './storage.js'
import { networkCommands } from './network.js'
import { securityCommands } from './security.js'
import { serviceCommands } from './services.js'
import { containerCommands } from './containers.js'

const LEGACY_ORDER = [
  'builtin-server-overview', 'builtin-server-disk', 'builtin-server-memory',
  'builtin-server-process-top', 'builtin-server-network-listen',
  'builtin-server-port-process', 'builtin-server-ip-query',
  'builtin-server-network-change-ip', 'builtin-server-dns-check',
  'builtin-server-time-query', 'builtin-server-firewall-status',
  'builtin-server-firewall-open-port', 'builtin-server-service-logs',
  'builtin-server-service-status', 'builtin-server-log-search',
  'builtin-server-nginx', 'builtin-server-docker',
  'builtin-server-connectivity-check', 'builtin-server-http-check',
  'builtin-server-tls-check', 'builtin-server-directory-analysis',
  'builtin-server-process-detail', 'builtin-server-service-action',
  'builtin-server-docker-action', 'builtin-server-file-permission',
  'builtin-server-packet-capture'
]

export function buildServerMaintenanceCommands () {
  const commands = [
    ...systemCommands,
    ...storageCommands,
    ...networkCommands,
    ...securityCommands,
    ...serviceCommands,
    ...containerCommands
  ]
  const duplicate = commands.find((item, index) => (
    commands.findIndex(candidate => candidate.id === item.id) !== index
  ))
  if (duplicate) {
    throw new Error(`Duplicate server maintenance command id: ${duplicate.id}`)
  }
  const legacyIndex = new Map(LEGACY_ORDER.map((id, index) => [id, index]))
  const originalIndex = new Map(commands.map((item, index) => [item.id, index]))
  return commands.sort((left, right) => {
    const leftOrder = legacyIndex.get(left.id)
    const rightOrder = legacyIndex.get(right.id)
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
    if (leftOrder !== undefined) return -1
    if (rightOrder !== undefined) return 1
    return originalIndex.get(left.id) - originalIndex.get(right.id)
  })
}
```

```js
// server-maintenance-commands.js
import { buildServerMaintenanceCommands } from './server-maintenance/index.js'

export function getServerMaintenanceQuickCommands () {
  return buildServerMaintenanceCommands()
}
```

- [ ] **Step 5: 运行兼容测试和现有快捷命令测试**

Run: `node --test test/unit-ci/server-maintenance-command-registry.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js`

Expected: PASS，26 个旧 ID、旧表单、网络探测和回滚断言均保持不变。

- [ ] **Step 6: 提交目录拆分**

```bash
git add src/client/components/quick-commands/server-maintenance-commands.js src/client/components/quick-commands/server-maintenance test/unit-ci/server-maintenance-command-registry.spec.js
git commit -m "refactor: split server maintenance quick commands by domain"
```

---

### Task 2: 建立统一参数校验、环境探测与安全元数据

**Files:**
- Create: `src/client/components/quick-commands/server-maintenance/shared/validation.js`
- Create: `src/client/components/quick-commands/server-maintenance/shared/discovery.js`
- Create: `src/client/components/quick-commands/server-maintenance/shared/command-builders.js`
- Create: `src/client/components/quick-commands/server-maintenance/shared/safety-metadata.js`
- Modify: `src/client/components/quick-commands/server-maintenance/shared/definition.js`
- Modify: `src/client/components/quick-commands/quick-command-context.js`
- Modify: `src/client/components/quick-commands/quick-commands-box.jsx`
- Test: `test/unit-ci/quick-command-validation.spec.js`

- [ ] **Step 1: 编写参数边界与命令注入失败测试**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const validationUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/server-maintenance/shared/validation.js'
)).href

test('quick command validators reject shell injection and invalid network values', async () => {
  const { validateValue, quoteShellValue } = await import(validationUrl)
  assert.equal(validateValue('hostname', 'web-01.example.com'), '')
  assert.match(validateValue('hostname', 'web;reboot'), /主机名/)
  assert.match(validateValue('cidr', '10.0.0.999/24'), /CIDR/)
  assert.match(validateValue('port', '70000'), /端口/)
  assert.match(validateValue('service', 'nginx;id'), /服务名/)
  assert.equal(quoteShellValue("a'b"), "'a'\\''b'")
})
```

- [ ] **Step 2: 运行测试确认模块尚不存在**

Run: `node --test test/unit-ci/quick-command-validation.spec.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现明确类型校验和 shell 单引号引用**

```js
const patterns = {
  hostname: /^(?=.{1,253}$)(?!-)[a-zA-Z0-9.-]+(?<!-)$/,
  service: /^[a-zA-Z0-9_.@:-]+$/,
  interface: /^[a-zA-Z0-9_.:-]+$/,
  path: /^\/[a-zA-Z0-9_./@:+-]+$/,
  cron: /^(@(reboot|hourly|daily|weekly|monthly|yearly)|([^\s]+\s+){4}[^\s]+)$/
}

function isIpv4 (value) {
  const parts = value.split('.')
  return parts.length === 4 && parts.every(part => /^\d+$/.test(part) && Number(part) <= 255)
}

function isIpv6 (value) {
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value)
}

export function validateValue (type, rawValue, options = {}) {
  const value = String(rawValue ?? '').trim()
  if (options.required && !value) return `${options.label || '参数'}不能为空`
  if (!value) return ''
  if (type === 'port') return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535 ? '' : '端口必须是 1-65535'
  if (type === 'ipv4') return isIpv4(value) ? '' : 'IPv4 地址格式不正确'
  if (type === 'cidr') {
    const [ip, prefix] = value.split('/')
    const validPrefix = /^\d+$/.test(prefix)
    const valid = (isIpv4(ip) && validPrefix && Number(prefix) <= 32) ||
      (isIpv6(ip) && validPrefix && Number(prefix) <= 128)
    return valid ? '' : 'CIDR 格式不正确'
  }
  return patterns[type] && !patterns[type].test(value) ? `${options.label || '参数'}格式不正确` : ''
}

export function quoteShellValue (value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`
}

export function validateQuickCommandParams (item, values) {
  return (item.params || []).reduce((errors, param) => {
    const message = validateValue(param.validationType, values[param.name], param)
    if (message) errors[param.name] = message
    return errors
  }, {})
}
```

`command-builders.js` 使用 `quoteShellValue` 生成 `NAME='value'` 赋值；不允许修改类命令直接把未校验的表单值拼进 shell。Cron 任务命令和抓包自定义过滤器允许业务语法，但拒绝换行、NUL 字符和未闭合引号，并始终显示最终命令预览。

- [ ] **Step 4: 实现一次性远端能力探测与解析**

```js
export function buildMaintenanceDiscoveryCommand () {
  return [
    'printf "__SHELLPILOT_CAP_BEGIN__\\n"',
    'printf "os=%s\\n" "$(. /etc/os-release 2>/dev/null; printf %s "${ID:-unknown}")"',
    'printf "init=%s\\n" "$(command -v systemctl >/dev/null 2>&1 && printf systemd || printf other)"',
    'for tool in iostat mpstat lsof ethtool ss netstat journalctl docker timedatectl; do command -v "$tool" >/dev/null 2>&1 && printf "tool=%s\\n" "$tool"; done',
    'printf "__SHELLPILOT_CAP_END__\\n"'
  ].join('; ')
}

export function parseMaintenanceDiscoveryOutput (output = '') {
  const body = output.match(/__SHELLPILOT_CAP_BEGIN__([\s\S]*?)__SHELLPILOT_CAP_END__/)
  if (!body) throw new Error('未获取到完整的服务器能力探测结果')
  const lines = body[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const tools = lines.filter(line => line.startsWith('tool=')).map(line => line.slice(5))
  return {
    os: lines.find(line => line.startsWith('os='))?.slice(3) || 'unknown',
    init: lines.find(line => line.startsWith('init='))?.slice(5) || 'other',
    tools
  }
}
```

- [ ] **Step 5: 为所有修改命令生成统一预检和验证元数据**

```js
export function createMutationSafetyMetadata ({ title, backupTargets, verifyCommands }) {
  return {
    title,
    minFreeKb: 10240,
    backupTargets,
    verifyCommands,
    rollbackDirectory: '/tmp/shellpilot-rollback',
    requireConfirmation: true
  }
}

export function buildMutationPreflight (metadata) {
  return [
    'set -u',
    'ROLLBACK_DIR=/tmp/shellpilot-rollback',
    'FREE_KB=$(df -Pk /tmp 2>/dev/null | awk "NR==2 {print \\$4}")',
    `if [ -z "$FREE_KB" ] || [ "$FREE_KB" -lt ${metadata.minFreeKb} ]; then echo "回滚目录可用空间不足"; exit 1; fi`,
    'mkdir -p "$ROLLBACK_DIR" || { echo "无法创建回滚目录"; exit 1; }'
  ].join('\n')
}
```

每个修改命令声明至少一个 `verifyCommands` 项；备份或预检失败时在进入修改命令前退出。

- [ ] **Step 6: 在确认执行前校验参数并显示字段错误**

```js
const errors = validateQuickCommandParams(pendingCommand.item, pendingCommand.paramValues)
if (Object.keys(errors).length) {
  setPendingCommand(current => ({ ...current, paramErrors: errors }))
  return
}
```

`renderPendingParam` 在每个控件下读取 `pendingCommand.paramErrors?.[param.name]`，使用 `status='error'` 和独立错误说明，不把错误文本叠在输入框上。

- [ ] **Step 7: 运行校验、旧表单和安全入口测试**

Run: `node --test test/unit-ci/quick-command-validation.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js test/unit-ci/safety-entrypoint-integration.spec.js`

Expected: PASS，恶意参数被拒绝，旧命令仍可生成，安全入口没有回归。

- [ ] **Step 8: 提交共享能力**

```bash
git add src/client/components/quick-commands/server-maintenance/shared src/client/components/quick-commands/quick-command-context.js src/client/components/quick-commands/quick-commands-box.jsx test/unit-ci/quick-command-validation.spec.js
git commit -m "feat: add validated quick command discovery foundation"
```

---

### Task 3: 新增系统领域只读排查命令

**Files:**
- Modify: `src/client/components/quick-commands/server-maintenance/system.js`
- Modify: `src/client/components/quick-commands/server-maintenance/services.js`
- Test: `test/unit-ci/server-maintenance-readonly-expansion.spec.js`

- [ ] **Step 1: 编写 CPU、内核、启动和定时任务失败测试**

```js
for (const id of [
  'builtin-server-cpu-pressure',
  'builtin-server-kernel-errors',
  'builtin-server-boot-history',
  'builtin-server-scheduled-tasks'
]) {
  assert.ok(byId.has(id), `missing ${id}`)
  assert.ok(byId.get(id).labels.includes('只读'))
  assert.equal(byId.get(id).mutatesServer, undefined)
}
assert.match(textOf('builtin-server-cpu-pressure'), /mpstat|vmstat/)
assert.match(textOf('builtin-server-kernel-errors'), /journalctl -k|dmesg/)
assert.match(textOf('builtin-server-boot-history'), /last -x|list-boots/)
assert.match(textOf('builtin-server-scheduled-tasks'), /systemctl list-timers|crontab/)
```

- [ ] **Step 2: 运行测试确认缺少新 ID**

Run: `node --test test/unit-ci/server-maintenance-readonly-expansion.spec.js`

Expected: FAIL with `missing builtin-server-cpu-pressure`。

- [ ] **Step 3: 添加四个只读命令，命令中包含主路径和降级路径**

```js
defineCommand({
  id: 'builtin-server-cpu-pressure',
  name: 'CPU 负载与压力',
  description: '查看负载、运行队列、CPU 使用率和系统压力指标。',
  usage: '用于判断 CPU 饱和、运行队列堆积或 I/O 等待问题。',
  labels: [READ_ONLY, '系统'],
  commands: [step([
    'uptime',
    'if command -v mpstat >/dev/null 2>&1; then mpstat -P ALL 1 3; else vmstat 1 4; fi',
    'for file in /proc/pressure/cpu /proc/pressure/io /proc/pressure/memory; do [ -r "$file" ] && { echo "--- $file"; cat "$file"; }; done'
  ].join('\n'))]
})
```

内核异常使用 `journalctl -k -p warning..alert --since '-24 hours'` 并降级到 `dmesg -T`；启动历史使用 `last -x -n 30` 和 `journalctl --list-boots`；定时任务使用 `systemctl list-timers --all --no-pager`、当前用户 `crontab -l` 与 `/etc/cron.*` 清单。

- [ ] **Step 4: 运行系统领域测试**

Run: `node --test test/unit-ci/server-maintenance-readonly-expansion.spec.js`

Expected: 系统领域四项 PASS，其余尚未实现的断言继续 FAIL；用测试名称过滤验证本任务：`--test-name-pattern="system readonly"` 时全部 PASS。

- [ ] **Step 5: 提交系统领域命令**

```bash
git add src/client/components/quick-commands/server-maintenance/system.js src/client/components/quick-commands/server-maintenance/services.js test/unit-ci/server-maintenance-readonly-expansion.spec.js
git commit -m "feat: add system diagnostic quick commands"
```

---

### Task 4: 新增存储领域只读排查命令

**Files:**
- Modify: `src/client/components/quick-commands/server-maintenance/storage.js`
- Test: `test/unit-ci/server-maintenance-readonly-expansion.spec.js`

- [ ] **Step 1: 添加磁盘 I/O、inode 挂载和已删除文件失败测试**

```js
for (const id of [
  'builtin-server-disk-io',
  'builtin-server-inode-mount',
  'builtin-server-deleted-open-files'
]) assert.ok(byId.has(id), `missing ${id}`)

assert.match(textOf('builtin-server-disk-io'), /iostat|diskstats/)
assert.match(textOf('builtin-server-inode-mount'), /df -i|findmnt/)
assert.match(textOf('builtin-server-deleted-open-files'), /lsof \+L1|\/proc\/.*\/fd/)
```

- [ ] **Step 2: 运行存储测试确认失败**

Run: `node --test --test-name-pattern="storage readonly" test/unit-ci/server-maintenance-readonly-expansion.spec.js`

Expected: FAIL，三个存储 ID 尚不存在。

- [ ] **Step 3: 添加三个存储命令和工具降级逻辑**

```js
defineCommand({
  id: 'builtin-server-disk-io',
  name: '磁盘 I/O 状态',
  description: '查看磁盘延迟、繁忙度、队列和吞吐变化。',
  usage: '用于排查磁盘响应慢、I/O 等待高和存储瓶颈。',
  labels: [READ_ONLY, '存储'],
  commands: [step('if command -v iostat >/dev/null 2>&1; then iostat -xz 1 3; else echo "未安装 iostat，显示 vmstat 与磁盘计数器"; vmstat 1 4; cat /proc/diskstats; fi')]
})
```

inode 命令执行 `df -iP`、`findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS` 并降级读取 `/proc/mounts`；已删除文件优先 `lsof +L1`，降级用 `find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200`。

- [ ] **Step 4: 运行存储领域测试**

Run: `node --test --test-name-pattern="storage readonly" test/unit-ci/server-maintenance-readonly-expansion.spec.js`

Expected: PASS。

- [ ] **Step 5: 提交存储领域命令**

```bash
git add src/client/components/quick-commands/server-maintenance/storage.js test/unit-ci/server-maintenance-readonly-expansion.spec.js
git commit -m "feat: add storage diagnostic quick commands"
```

---

### Task 5: 新增网络、安全和容器只读排查命令

**Files:**
- Modify: `src/client/components/quick-commands/server-maintenance/network.js`
- Modify: `src/client/components/quick-commands/server-maintenance/security.js`
- Modify: `src/client/components/quick-commands/server-maintenance/containers.js`
- Test: `test/unit-ci/server-maintenance-readonly-expansion.spec.js`

- [ ] **Step 1: 添加五项剩余只读命令失败测试**

```js
for (const id of [
  'builtin-server-network-errors',
  'builtin-server-tcp-states',
  'builtin-server-route-mtu',
  'builtin-server-ssh-security-events',
  'builtin-server-docker-health-storage'
]) assert.ok(byId.has(id), `missing ${id}`)

assert.match(textOf('builtin-server-network-errors'), /ip -s link|ethtool/)
assert.match(textOf('builtin-server-tcp-states'), /ss -s|netstat/)
assert.match(textOf('builtin-server-route-mtu'), /ip route|ip rule|ip link/)
assert.match(textOf('builtin-server-ssh-security-events'), /auth\.log|secure|journalctl/)
assert.match(textOf('builtin-server-docker-health-storage'), /docker ps|docker system df/)
```

- [ ] **Step 2: 运行测试确认五项缺失**

Run: `node --test --test-name-pattern="network security container readonly" test/unit-ci/server-maintenance-readonly-expansion.spec.js`

Expected: FAIL。

- [ ] **Step 3: 实现网络错误、TCP 状态和路由 MTU 命令**

```js
defineCommand({
  id: 'builtin-server-network-errors',
  name: '网卡错误与丢包',
  description: '查看网卡收发、丢包、错误、链路和速率。',
  usage: '用于排查链路不稳、丢包、协商异常和网卡错误。',
  labels: [READ_ONLY, '网络'],
  commands: [step([
    'ip -s link',
    'for iface in $(ls /sys/class/net 2>/dev/null); do echo "--- $iface"; [ -r "/sys/class/net/$iface/operstate" ] && cat "/sys/class/net/$iface/operstate"; command -v ethtool >/dev/null 2>&1 && ethtool "$iface" 2>/dev/null | grep -E "Speed|Duplex|Link detected"; done'
  ].join('\n'))]
})
```

TCP 状态优先 `ss -s` 和 `ss -tan` 聚合，降级 `netstat -ant`；路由 MTU 执行 `ip route show table all`、`ip rule`、`ip -details link`。

- [ ] **Step 4: 实现 SSH 安全事件和 Docker 健康存储命令**

```js
const sshLogCommand = [
  'if command -v journalctl >/dev/null 2>&1; then journalctl -u ssh -u sshd --since "-24 hours" --no-pager 2>/dev/null | grep -Ei "failed|invalid|accepted|disconnect" | tail -n 200;',
  'elif [ -r /var/log/auth.log ]; then grep -Ei "failed|invalid|accepted|disconnect" /var/log/auth.log | tail -n 200;',
  'elif [ -r /var/log/secure ]; then grep -Ei "failed|invalid|accepted|disconnect" /var/log/secure | tail -n 200;',
  'else echo "未找到可读的 SSH 安全日志"; fi'
].join(' ')
```

Docker 命令先验证 `command -v docker`，随后执行 `docker ps -a --format`、`docker inspect` 健康与重启计数摘要、`docker system df`；Docker 不存在时输出可理解提示并以只读完成状态结束。

- [ ] **Step 5: 运行完整 12 项只读测试**

Run: `node --test test/unit-ci/server-maintenance-readonly-expansion.spec.js`

Expected: PASS，12 个新 ID 均只读、命令含主路径和降级路径。

- [ ] **Step 6: 提交网络、安全和容器命令**

```bash
git add src/client/components/quick-commands/server-maintenance/network.js src/client/components/quick-commands/server-maintenance/security.js src/client/components/quick-commands/server-maintenance/containers.js test/unit-ci/server-maintenance-readonly-expansion.spec.js
git commit -m "feat: add network security and container diagnostics"
```

---

### Task 6: 新增主机名、hosts 和时区表单维护

**Files:**
- Modify: `src/client/components/quick-commands/server-maintenance/system.js`
- Modify: `src/client/components/quick-commands/server-maintenance/network.js`
- Modify: `src/client/components/quick-commands/server-maintenance/shared/safety-metadata.js`
- Test: `test/unit-ci/server-maintenance-mutating-expansion.spec.js`

- [ ] **Step 1: 编写三项修改命令的备份、确认和回滚失败测试**

```js
for (const id of [
  'builtin-server-hostname-change',
  'builtin-server-hosts-manage',
  'builtin-server-timezone-change'
]) {
  const item = byId.get(id)
  assert.ok(item, `missing ${id}`)
  assert.equal(item.mutatesServer, true)
  assert.equal(item.confirmRequired, true)
  assert.equal(item.rollback.pathParam, '回滚脚本')
  assert.ok(item.params.some(param => param.name === '确认执行'))
  assert.ok(item.verification?.length >= 1)
  assert.match(textOf(id), /shellpilot-rollback/)
}
```

- [ ] **Step 2: 运行测试确认三个 ID 缺失**

Run: `node --test test/unit-ci/server-maintenance-mutating-expansion.spec.js`

Expected: FAIL with `missing builtin-server-hostname-change`。

- [ ] **Step 3: 实现统一修改命令元数据生成器**

```js
export function withRollback (item, options) {
  return {
    ...item,
    mutatesServer: true,
    confirmRequired: true,
    rollback: {
      title: options.title,
      pathParam: '回滚脚本',
      actionParam: options.actionParam,
      mutatingValues: options.mutatingValues,
      confirmParam: '确认执行',
      confirmValue: 'yes'
    }
  }
}
```

- [ ] **Step 4: 实现三项表单，默认全部为预览**

```js
defineCommand(withRollback({
  id: 'builtin-server-hostname-change',
  name: '修改主机名',
  description: '检测当前主机名并安全修改，可选择同步 /etc/hosts。',
  usage: '修改前备份 hosts，验证 hostnamectl 结果后可在安全中心回滚。',
  labels: [NEED_EDIT, '系统', '高风险'],
  editBeforeRun: true,
  params: [
    inputParam('新主机名', '新主机名', '', '填写完整主机名，例如 web-01.example.com'),
    selectParam('同步Hosts', '同步 /etc/hosts', 'yes', '同步更新本机名称映射', [
      { label: '是', value: 'yes' }, { label: '否', value: 'no' }
    ])
  ],
  commands: [step(HOSTNAME_CHANGE_COMMAND)]
}, { title: '主机名修改', actionParam: '确认执行', mutatingValues: ['yes'] }))
```

`HOSTNAME_CHANGE_COMMAND`、`HOSTS_MANAGE_COMMAND` 和 `TIMEZONE_CHANGE_COMMAND` 必须依次完成：读取原状态、创建带任务时间戳的备份、生成 `/tmp/shellpilot-rollback/*.sh`、仅在 `确认执行=yes` 时修改、执行验证并打印回滚脚本路径。时区使用 `timedatectl set-timezone`，不可用时拒绝修改而不是猜测系统文件。

- [ ] **Step 5: 运行修改命令和注入测试**

Run: `node --test test/unit-ci/server-maintenance-mutating-expansion.spec.js test/unit-ci/quick-command-validation.spec.js`

Expected: PASS，非法主机名、IP、路径不进入命令，三个操作均可预览和回滚。

- [ ] **Step 6: 提交三项维护表单**

```bash
git add src/client/components/quick-commands/server-maintenance/system.js src/client/components/quick-commands/server-maintenance/network.js src/client/components/quick-commands/server-maintenance/shared/safety-metadata.js test/unit-ci/server-maintenance-mutating-expansion.spec.js
git commit -m "feat: add rollback-safe host configuration forms"
```

---

### Task 7: 新增 Swap、服务开机策略、Cron 表单并增强防火墙

**Files:**
- Modify: `src/client/components/quick-commands/server-maintenance/storage.js`
- Modify: `src/client/components/quick-commands/server-maintenance/services.js`
- Modify: `src/client/components/quick-commands/server-maintenance/security.js`
- Modify: `src/client/components/quick-commands/quick-command-service-discovery.js`
- Test: `test/unit-ci/server-maintenance-mutating-expansion.spec.js`
- Test: `test/unit-ci/quick-command-service-discovery.spec.js`

- [ ] **Step 1: 编写 Swap、开机策略、Cron 和防火墙增强失败测试**

```js
for (const id of [
  'builtin-server-swap-manage',
  'builtin-server-service-boot-policy',
  'builtin-server-cron-manage'
]) assert.ok(byId.has(id), `missing ${id}`)

assert.deepEqual(param('builtin-server-service-boot-policy', '服务名称').sources, ['systemd'])
assert.equal(param('builtin-server-service-boot-policy', '服务名称').multiple, true)
assert.deepEqual(param('builtin-server-firewall-open-port', '操作').options.map(item => item.value), ['allow', 'deny'])
assert.ok(param('builtin-server-firewall-open-port', '来源CIDR'))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit-ci/server-maintenance-mutating-expansion.spec.js test/unit-ci/quick-command-service-discovery.spec.js`

Expected: FAIL，三个新 ID 和防火墙新参数不存在。

- [ ] **Step 3: 实现 Swap 与服务开机策略表单**

```js
const swapParams = [
  selectParam('操作', '操作', 'status', '默认只查看，选择创建、启用、禁用或删除后才修改', [
    { label: '查看状态', value: 'status' },
    { label: '创建并启用', value: 'create' },
    { label: '启用', value: 'enable' },
    { label: '禁用', value: 'disable' },
    { label: '删除', value: 'remove' }
  ]),
  inputParam('Swap路径', 'Swap 文件路径', '/swapfile', '必须是绝对路径'),
  numberParam('大小MB', '大小（MB）', 2048, '创建前检查可用磁盘空间', 64, 1048576)
]
```

Swap 修改前备份 `/etc/fstab` 并记录 `swapon --show`；开机策略使用自动发现的 systemd 服务多选值，逐项保存 `is-enabled` 原状态，回滚时恢复每项原策略。

- [ ] **Step 4: 实现 Cron 表单和防火墙 allow/deny、CIDR、协议参数**

```js
const cronParams = [
  selectParam('操作', '操作', 'list', '默认只列出任务', [
    { label: '查看任务', value: 'list' },
    { label: '新增任务', value: 'add' },
    { label: '禁用任务', value: 'disable' },
    { label: '删除任务', value: 'remove' }
  ]),
  inputParam('计划表达式', '计划表达式', '0 2 * * *', '支持标准五段 Cron 或 @daily 等别名'),
  inputParam('任务命令', '任务命令', '', '显示完整预览后执行，不允许换行和 NUL 字符'),
  inputParam('匹配标识', '匹配标识', '', '禁用或删除时精确匹配 ShellPilot 标识')
]
```

防火墙保留旧 ID `builtin-server-firewall-open-port`，新增 `操作`、`来源CIDR`，生成 firewalld、ufw、iptables/nftables 对应的添加或删除命令；执行前导出原规则到回滚目录。

- [ ] **Step 5: 运行修改、发现和安全事务测试**

Run: `node --test test/unit-ci/server-maintenance-mutating-expansion.spec.js test/unit-ci/quick-command-service-discovery.spec.js test/unit-ci/safety-transaction-domain.spec.js test/unit-ci/safety-entrypoint-integration.spec.js`

Expected: PASS，所有修改命令默认只读或预览，确认后才生成可追踪安全事务。

- [ ] **Step 6: 提交维护表单和防火墙增强**

```bash
git add src/client/components/quick-commands/server-maintenance/storage.js src/client/components/quick-commands/server-maintenance/services.js src/client/components/quick-commands/server-maintenance/security.js src/client/components/quick-commands/quick-command-service-discovery.js test/unit-ci/server-maintenance-mutating-expansion.spec.js test/unit-ci/quick-command-service-discovery.spec.js
git commit -m "feat: add rollback-safe service storage and firewall forms"
```

---

### Task 8: 完成分组筛选、自动探测与响应式界面

**Files:**
- Modify: `src/client/components/quick-commands/quick-commands-box.jsx`
- Modify: `src/client/components/quick-commands/quick-command-item.jsx`
- Modify: `src/client/components/quick-commands/qm.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `test/unit-ci/server-maintenance-quick-commands.spec.js`
- Test: `test/e2e/032.quick-command-balanced-expansion.spec.js`

- [ ] **Step 1: 编写界面结构和 1366 宽度失败测试**

```js
test('quick command panel groups commands and keeps cards visible at 1366 width', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await openQuickCommands(page)
  await expect(page.locator('[data-testid="quick-command-group-filter"]')).toBeVisible()
  await expect(page.locator('[data-testid="quick-command-risk-filter"]')).toBeVisible()
  const box = await page.locator('.qm-list-wrap').boundingBox()
  expect(box.x + box.width).toBeLessThanOrEqual(1366)
  await expect(page.locator('.qm-list-wrap')).toHaveCSS('overflow-x', 'hidden')
})
```

- [ ] **Step 2: 运行 E2E 确认筛选器尚不存在**

Run: `npx playwright test test/e2e/032.quick-command-balanced-expansion.spec.js --workers=1`

Expected: FAIL，找不到 `quick-command-group-filter`。

- [ ] **Step 3: 添加领域和风险筛选，不改变现有搜索与排序**

```jsx
<Segmented
  data-testid='quick-command-group-filter'
  value={groupFilter}
  options={groupOptions}
  onChange={setGroupFilter}
/>
<Select
  data-testid='quick-command-risk-filter'
  value={riskFilter}
  options={riskOptions}
  onChange={setRiskFilter}
/>
```

过滤逻辑使用命令 `labels`：领域选择匹配“系统、存储、网络、安全、服务、容器”；风险选择匹配“只读、需编辑、高风险、可回滚”。搜索仍匹配名称、用途和标签。

- [ ] **Step 4: 调整卡片和表单样式**

```stylus
.qm-list-wrap
  display grid
  grid-template-columns repeat(auto-fit, minmax(230px, 1fr))
  gap 10px
  overflow-x hidden
  overflow-y auto

.qm-item
  min-width 0
  border-radius 8px

.qm-item-desc
  display -webkit-box
  -webkit-line-clamp 2
  -webkit-box-orient vertical
  overflow hidden

@media (max-width: 1450px)
  .qm-list-wrap
    grid-template-columns repeat(3, minmax(0, 1fr))

@media (max-width: 1100px)
  .qm-list-wrap
    grid-template-columns repeat(2, minmax(0, 1fr))
```

参数错误使用 `.qm-command-param-error` 独占一行；自动识别控件提供“检测中、重新检测、手动输入”三种状态；日间和夜间颜色均使用现有主题变量。

- [ ] **Step 5: 补充中文文案并运行组件静态断言**

Run: `node --test test/unit-ci/server-maintenance-quick-commands.spec.js`

Expected: PASS，页面包含领域筛选、风险筛选、参数错误、自动检测和快捷回滚入口。

- [ ] **Step 6: 运行 1366 与 1920 E2E**

Run: `npx playwright test test/e2e/032.quick-command-balanced-expansion.spec.js --workers=1`

Expected: PASS，卡片无横向截断，表单可滚动，日间/夜间关键文字可见。

- [ ] **Step 7: 提交界面改造**

```bash
git add src/client/components/quick-commands/quick-commands-box.jsx src/client/components/quick-commands/quick-command-item.jsx src/client/components/quick-commands/qm.styl src/client/common/shellpilot-i18n-overrides.js test/unit-ci/server-maintenance-quick-commands.spec.js test/e2e/032.quick-command-balanced-expansion.spec.js
git commit -m "feat: improve quick command discovery and responsive layout"
```

---

### Task 9: 打通完成状态、安全中心和按钮式回滚回归

**Files:**
- Modify: `test/unit-ci/safety-entrypoint-integration.spec.js`
- Modify: `test/unit-ci/safety-operation-center-actions.spec.js`
- Modify: `test/e2e/027.quality-core-flows.spec.js`

- [ ] **Step 1: 增加连续命令和修改任务状态测试**

```js
test('completed quick commands release the safety execution slot', async () => {
  const first = await executeQuickCommand('builtin-server-overview')
  expect(first.status).toBe('completed')
  await expectSafetyRunningCount(0)
  const second = await executeQuickCommand('builtin-server-memory')
  expect(second.status).toBe('completed')
  await expectSafetyRunningCount(0)
})
```

- [ ] **Step 2: 增加安全中心“立即回滚、保留修改、查看备份”测试**

```js
assert.deepEqual(record.actions.map(action => action.id), [
  'rollback',
  'keep',
  'open-backup',
  'view-log'
])
assert.equal(record.rollback.status, 'available')
assert.ok(record.rollback.scriptPath.startsWith('/tmp/shellpilot-rollback/'))
```

- [ ] **Step 3: 运行测试，确认现有安全事务是否已满足新元数据**

Run: `node --test test/unit-ci/safety-entrypoint-integration.spec.js test/unit-ci/safety-operation-center-actions.spec.js`

Expected: 若新命令缺少元数据则 FAIL；仅在失败断言指向的共享元数据或动作适配器中补齐，不改终端执行核心。

- [ ] **Step 4: 复用现有安全事务完成元数据绑定**

```js
const safetyMetadata = {
  operationId: item.id,
  operationName: item.name,
  category: item.labels.find(label => domainLabels.includes(label)),
  rollbackTitle: item.rollback?.title,
  rollbackPath: values[item.rollback?.pathParam],
  verification: item.verification || []
}
```

快捷命令完成、失败、取消和连接中断都调用现有终态收口函数；禁止新增第二套任务状态存储。

- [ ] **Step 5: 运行安全中心和质量 E2E**

Run: `node --test test/unit-ci/safety-entrypoint-integration.spec.js test/unit-ci/safety-operation-center-actions.spec.js test/unit-ci/safety-operation-center.spec.js`

Run: `npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1`

Expected: PASS，连续快捷命令不阻塞，修改记录展示按钮式回滚和备份入口。

- [ ] **Step 6: 提交安全中心回归**

```bash
git add test/unit-ci/safety-entrypoint-integration.spec.js test/unit-ci/safety-operation-center-actions.spec.js test/e2e/027.quality-core-flows.spec.js src/client/components/quick-commands/server-maintenance/shared/safety-metadata.js
git commit -m "test: cover quick command completion and rollback actions"
```

---

### Task 10: 完整回归、真实服务器只读验证和本地构建

**Files:**
- Modify: `test/e2e/030.real-server-regression.spec.js`
- Do not modify: `package.json` version

- [ ] **Step 1: 将 12 项新命令加入真实服务器只读白名单**

```js
const allowedReadonlyQuickCommandIds = [
  'builtin-server-cpu-pressure',
  'builtin-server-disk-io',
  'builtin-server-inode-mount',
  'builtin-server-deleted-open-files',
  'builtin-server-kernel-errors',
  'builtin-server-boot-history',
  'builtin-server-network-errors',
  'builtin-server-tcp-states',
  'builtin-server-route-mtu',
  'builtin-server-ssh-security-events',
  'builtin-server-scheduled-tasks',
  'builtin-server-docker-health-storage'
]
```

真实服务器测试断言命令结束状态不是 `running`，输出不包含未替换占位符；6 项修改命令只验证表单预览和 `确认执行=no`，不得执行写入。

- [ ] **Step 2: 运行新增和相关单元测试**

Run: `node --test test/unit-ci/server-maintenance-command-registry.spec.js test/unit-ci/server-maintenance-readonly-expansion.spec.js test/unit-ci/server-maintenance-mutating-expansion.spec.js test/unit-ci/quick-command-validation.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js test/unit-ci/quick-command-service-discovery.spec.js test/unit-ci/safety-entrypoint-integration.spec.js test/unit-ci/safety-operation-center-actions.spec.js`

Expected: PASS，0 failures。

- [ ] **Step 3: 运行全量单元测试**

Run: `npm run test-unit-ci`

Expected: PASS；允许仓库既有明确标记的 skip，不允许新增失败。

- [ ] **Step 4: 运行关键 E2E**

Run: `npx playwright test test/e2e/027.quality-core-flows.spec.js test/e2e/032.quick-command-balanced-expansion.spec.js --workers=1`

Expected: PASS，快捷命令、终端、安全中心和响应式布局均通过。

- [ ] **Step 5: 在凭据可用时运行真实服务器只读测试**

Run: `npm run test-real-server-e2e`

Expected: PASS；若认证失败，记录为外部阻塞，不尝试修改服务器，也不把认证失败描述为功能通过。

- [ ] **Step 6: 执行 lint、编译和本地打包冒烟**

Run: `npx standard src/client/components/quick-commands/server-maintenance-commands.js src/client/components/quick-commands/server-maintenance/**/*.js src/client/components/quick-commands/quick-command-context.js src/client/components/quick-commands/quick-commands-box.jsx src/client/components/quick-commands/quick-command-item.jsx test/unit-ci/server-maintenance-*.spec.js test/unit-ci/quick-command-validation.spec.js`

Run: `npm run b`

Run: `npm run test-package-smoke`

Expected: 全部 PASS；生成的本地可执行文件版本仍为 `0.4.8`，不触发在线发布。

- [ ] **Step 7: 最终检查变更范围并提交回归测试**

```bash
git diff --check
git status --short
git add test/e2e/030.real-server-regression.spec.js
git commit -m "test: verify balanced quick command expansion"
```

完成后向用户提供唯一最新本地构建路径、测试统计、真实服务器验证结果和未发布说明。未经用户明确确认，不修改版本号、不创建 GitHub Release、不同步魔塔更新源。
