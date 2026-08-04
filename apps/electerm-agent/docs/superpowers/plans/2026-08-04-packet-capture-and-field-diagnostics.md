# Packet Capture and Field Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a dedicated, bounded packet-capture tool in Operations and add five non-duplicative read-only field diagnostics without weakening ShellPilot's execution safety model.

**Architecture:** Add a resource-sensitive risk class with a one-use confirmation bound to tool, endpoint, and normalized parameters. Implement packet capture as its own catalog module with typed filter construction and atomic no-overwrite output, while the five field diagnostics remain ordinary read-only catalog tools on the existing SSH task channel.

**Tech Stack:** Electron 41, React 19, Ant Design 6, JavaScript ES modules, Node.js test runner, Playwright, StandardJS.

---

## File map

- Create: `src/client/components/operations-toolkit/shared/resource-confirmation.js`
  - Creates and consumes one-use resource-sensitive confirmations.
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js`
  - Normalizes capture parameters, builds safe tcpdump filters, and defines the capture tool.
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js`
  - Defines the five new read-only field diagnostics.
- Modify: `src/client/components/operations-toolkit/shared/definition.js`
  - Adds and validates the resource-sensitive risk type and AI context metadata.
- Modify: `src/client/components/operations-toolkit/shared/validation.js`
  - Adds optional host/port, enum, PID, and pcap path validators.
- Modify: `src/client/components/operations-toolkit/runtime/task-runner.js`
  - Enforces confirmation consumption and one sensitive task per endpoint.
- Modify: `src/client/store/operations-toolkit.js`
  - Carries the one-use confirmation into the runner.
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
  - Registers both new diagnostic groups and resolves old IDs.
- Modify: `src/client/components/operations-toolkit/catalog/migrations.js`
  - Redirects the old capture ID to the dedicated capture tool.
- Modify: `src/client/components/operations-toolkit/workspace/parameter-value.js`
  - Evaluates parameter dependency metadata without coupling it to JSX.
- Modify: `src/client/components/operations-toolkit/workspace/parameter-form.jsx`
  - Disables the port field when the selected protocol cannot use ports.
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
  - Shows the capture confirmation and creates the one-use confirmation only after approval.
- Modify: `src/client/components/operations-toolkit/shared/ai-context.js`
  - Restricts sensitive-tool parameters and step outputs to an allowlist.
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
  - Adds Chinese and English capture-risk copy.
- Modify: `docs/USER_GUIDE_ZH.md`
  - Documents the restored capture and new diagnostic set.
- Test: `test/unit-ci/operations-toolkit-definition.spec.js`
- Create: `test/unit-ci/operations-toolkit-resource-confirmation.spec.js`
- Modify: `test/unit-ci/operations-toolkit-runner.spec.js`
- Create: `test/unit-ci/operations-toolkit-packet-capture.spec.js`
- Modify: `test/unit-ci/operations-toolkit-migrations.spec.js`
- Modify: `test/unit-ci/operations-toolkit-release-gate.spec.js`
- Create: `test/unit-ci/operations-toolkit-resource-ui.spec.js`
- Create: `test/unit-ci/operations-toolkit-field-diagnostics.spec.js`
- Modify: `test/unit-ci/operations-toolkit-ai-context.spec.js`
- Modify: `test/e2e/032.operations-toolkit.spec.js`

### Task 1: Define resource-sensitive risk and one-use confirmation

**Files:**
- Create: `test/unit-ci/operations-toolkit-resource-confirmation.spec.js`
- Modify: `test/unit-ci/operations-toolkit-definition.spec.js`
- Create: `src/client/components/operations-toolkit/shared/resource-confirmation.js`
- Modify: `src/client/components/operations-toolkit/shared/definition.js`

- [ ] **Step 1: Write the failing confirmation contract tests**

Create `test/unit-ci/operations-toolkit-resource-confirmation.spec.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const endpointKey = 'root@example.com:22'
const params = {
  protocol: 'tcp',
  interfaceName: 'eth0',
  packetCount: 100
}

test('resource confirmation is bound to tool endpoint and canonical params', async () => {
  const {
    assertOperationsResourceConfirmation,
    createOperationsResourceConfirmation
  } = await importModule(
    'src/client/components/operations-toolkit/shared/resource-confirmation.js'
  )
  const confirmation = createOperationsResourceConfirmation({
    toolId: 'network.packet-capture',
    endpointKey,
    params,
    now: () => 1000,
    createNonce: () => 'confirmation-1'
  })
  const consumedNonces = new Set()

  assert.doesNotThrow(() => assertOperationsResourceConfirmation({
    confirmation,
    toolId: 'network.packet-capture',
    endpointKey,
    params: { packetCount: 100, interfaceName: 'eth0', protocol: 'tcp' },
    consumedNonces,
    now: () => 1500
  }))
  assert.equal(consumedNonces.has('confirmation-1'), true)
  assert.throws(() => assertOperationsResourceConfirmation({
    confirmation,
    toolId: 'network.packet-capture',
    endpointKey,
    params,
    consumedNonces,
    now: () => 1600
  }), /已使用/)
})

test('resource confirmation rejects changed params endpoint and expiry', async () => {
  const {
    assertOperationsResourceConfirmation,
    createOperationsResourceConfirmation
  } = await importModule(
    'src/client/components/operations-toolkit/shared/resource-confirmation.js'
  )
  const confirmation = createOperationsResourceConfirmation({
    toolId: 'network.packet-capture',
    endpointKey,
    params,
    now: () => 1000,
    createNonce: () => 'confirmation-2'
  })

  for (const override of [
    { endpointKey: 'root@other.example:22' },
    { params: { ...params, packetCount: 101 } },
    { now: () => 62001 }
  ]) {
    assert.throws(() => assertOperationsResourceConfirmation({
      confirmation,
      toolId: 'network.packet-capture',
      endpointKey,
      params,
      consumedNonces: new Set(),
      now: () => 1500,
      ...override
    }), /确认/)
  }
})
```

Append to `test/unit-ci/operations-toolkit-definition.spec.js`:

```js
test('resource-sensitive tools require explicit confirmation metadata', async () => {
  const {
    defineOperationsTool,
    operationsRiskTypes
  } = await importModule(
    'src/client/components/operations-toolkit/shared/definition.js'
  )
  assert.equal(
    operationsRiskTypes.resourceSensitive,
    'resource-sensitive'
  )
  const tool = defineOperationsTool({
    ...validTool,
    risk: 'resource-sensitive',
    requiresConfirmation: true,
    aiContext: {
      parameterIds: ['protocol'],
      stepIds: ['capture']
    }
  })
  assert.equal(tool.requiresConfirmation, true)
  assert.equal(Object.isFrozen(tool.aiContext), true)
  assert.equal(Object.isFrozen(tool.aiContext.parameterIds), true)
  assert.equal(Object.isFrozen(tool.aiContext.stepIds), true)
  assert.throws(() => defineOperationsTool({
    ...validTool,
    risk: 'resource-sensitive'
  }), /必须确认/)
})
```

- [ ] **Step 2: Run the tests and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-resource-confirmation.spec.js test/unit-ci/operations-toolkit-definition.spec.js
```

Expected: FAIL because `resource-confirmation.js` does not exist and `resource-sensitive` is not accepted.

- [ ] **Step 3: Implement the confirmation helper**

Create `src/client/components/operations-toolkit/shared/resource-confirmation.js`:

```js
import { createTrustedOperationId } from '../../../common/safety-transactions/operation-id.js'

export const operationsResourceConfirmationTtlMs = 60 * 1000

function canonicalize (value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    )
  }
  if (value === undefined) return null
  return value
}

export function serializeOperationsConfirmationParams (params = {}) {
  return JSON.stringify(canonicalize(params))
}

export function createOperationsResourceConfirmation ({
  toolId,
  endpointKey,
  params = {},
  now = Date.now,
  createNonce = () => createTrustedOperationId('operations-confirmation')
} = {}) {
  if (!toolId || !endpointKey) throw new Error('资源敏感确认缺少工具或端点')
  return Object.freeze({
    nonce: createNonce(),
    toolId,
    endpointKey,
    params: serializeOperationsConfirmationParams(params),
    createdAt: Number(now())
  })
}

export function assertOperationsResourceConfirmation ({
  confirmation,
  toolId,
  endpointKey,
  params = {},
  consumedNonces,
  now = Date.now
} = {}) {
  const age = Number(now()) - Number(confirmation?.createdAt)
  if (!confirmation?.nonce ||
    confirmation.toolId !== toolId ||
    confirmation.endpointKey !== endpointKey ||
    confirmation.params !== serializeOperationsConfirmationParams(params) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > operationsResourceConfirmationTtlMs) {
    throw new Error('资源敏感任务确认无效或已过期')
  }
  if (!(consumedNonces instanceof Set)) {
    throw new Error('资源敏感任务确认存储不可用')
  }
  if (consumedNonces.has(confirmation.nonce)) {
    throw new Error('资源敏感任务确认已使用')
  }
  consumedNonces.add(confirmation.nonce)
  return true
}
```

- [ ] **Step 4: Extend and validate tool definitions**

In `definition.js` add:

```js
export const operationsRiskTypes = Object.freeze({
  readonly: 'read-only',
  resourceSensitive: 'resource-sensitive',
  reversible: 'reversible-change',
  high: 'high-risk-change',
  blocked: 'non-recoverable'
})
```

After risk validation:

```js
  if (tool.risk === operationsRiskTypes.resourceSensitive &&
    tool.requiresConfirmation !== true) {
    throw new Error('资源敏感运维工具必须确认')
  }
```

Extend `freezeTool`:

```js
  if (tool.aiContext) {
    if (tool.aiContext.parameterIds) Object.freeze(tool.aiContext.parameterIds)
    if (tool.aiContext.stepIds) Object.freeze(tool.aiContext.stepIds)
    Object.freeze(tool.aiContext)
  }
```

Replace the existing shallow parameter copy in the initial tool object with:

```js
    parameters: input?.parameters
      ? input.parameters.map(parameter => ({
          ...parameter,
          options: parameter.options
            ? parameter.options.map(option => (
                typeof option === 'string' ? option : { ...option }
              ))
            : undefined,
          enabledWhen: parameter.enabledWhen
            ? {
                ...parameter.enabledWhen,
                values: [...(parameter.enabledWhen.values || [])]
              }
            : undefined
        }))
      : undefined
```

Replace the parameter block in `freezeTool` with:

```js
  if (tool.parameters) {
    tool.parameters.forEach(parameter => {
      if (parameter.options) {
        parameter.options.forEach(option => {
          if (option && typeof option === 'object') Object.freeze(option)
        })
        Object.freeze(parameter.options)
      }
      if (parameter.enabledWhen) {
        Object.freeze(parameter.enabledWhen.values)
        Object.freeze(parameter.enabledWhen)
      }
      Object.freeze(parameter)
    })
    Object.freeze(tool.parameters)
  }
```

Copy metadata in the initial tool object:

```js
    aiContext: input?.aiContext
      ? {
          ...input.aiContext,
          parameterIds: [...(input.aiContext.parameterIds || [])],
          stepIds: [...(input.aiContext.stepIds || [])]
        }
      : undefined
```

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
node --test test/unit-ci/operations-toolkit-resource-confirmation.spec.js test/unit-ci/operations-toolkit-definition.spec.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/operations-toolkit/shared/definition.js src/client/components/operations-toolkit/shared/resource-confirmation.js test/unit-ci/operations-toolkit-definition.spec.js test/unit-ci/operations-toolkit-resource-confirmation.spec.js
git commit -m "feat(operations): define resource-sensitive confirmations"
```

### Task 2: Enforce confirmation and sensitive-task concurrency

**Files:**
- Modify: `test/unit-ci/operations-toolkit-runner.spec.js`
- Modify: `test/unit-ci/operations-toolkit-release-gate.spec.js`
- Modify: `src/client/components/operations-toolkit/runtime/task-runner.js`
- Modify: `src/client/store/operations-toolkit.js`

- [ ] **Step 1: Write failing runner tests**

Add helpers:

```js
const sensitiveTool = {
  ...tool,
  id: 'network.packet-capture',
  risk: 'resource-sensitive',
  requiresConfirmation: true
}

async function confirmationFor (params = {}, nonce = 'capture-confirmation') {
  const { createOperationsResourceConfirmation } = await importModule(
    'src/client/components/operations-toolkit/shared/resource-confirmation.js'
  )
  return createOperationsResourceConfirmation({
    toolId: sensitiveTool.id,
    endpointKey: 'root@example.com:22',
    params,
    createNonce: () => nonce
  })
}
```

Add tests:

```js
test('runner requires and consumes a matching sensitive confirmation', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: { execute: async () => ({ exitCode: 0 }) },
    discover: async () => ({})
  })
  assert.throws(
    () => runner.run({ tool: sensitiveTool, endpoint, params: {} }),
    /确认/
  )
  const confirmation = await confirmationFor()
  const completed = await runner.run({
    tool: sensitiveTool,
    endpoint,
    params: {},
    confirmation
  }).completion
  assert.equal(completed.status, 'completed')
  assert.throws(
    () => runner.run({
      tool: sensitiveTool,
      endpoint,
      params: {},
      confirmation
    }),
    /已使用/
  )
})

test('runner permits only one sensitive task per endpoint', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: {
      execute: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    },
    discover: async () => ({})
  })
  const first = runner.run({
    tool: sensitiveTool,
    endpoint,
    confirmation: await confirmationFor({}, 'capture-1')
  })
  const secondConfirmation = await confirmationFor({}, 'capture-2')
  assert.throws(() => runner.run({
    tool: sensitiveTool,
    endpoint,
    confirmation: secondConfirmation
  }), /资源敏感任务/)
  await runner.cancel(first.taskId)
  assert.equal(runner.getSensitiveActiveCount('root@example.com:22'), 0)
})
```

In the release-gate source test add:

```js
  assert.match(source, /confirmation:\s*options\.confirmation/)
```

Update the existing non-read-only rejection assertion in `operations-toolkit-runner.spec.js` to expect `/只读或资源敏感/`; reversible and high-risk maintenance tools must remain rejected by this runner.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
```

Expected: FAIL because the runner rejects all non-read-only tools and the store drops confirmation.

- [ ] **Step 3: Implement runner gate**

Import and initialize the gate state inside `createOperationsTaskRunner`:

```js
import {
  assertOperationsResourceConfirmation
} from '../shared/resource-confirmation.js'
```

```js
  const sensitiveCounts = new Map()
  const consumedConfirmations = new Set()
```

Change the run signature:

```js
  function run ({ tool, params = {}, endpoint, confirmation }) {
```

Replace initial risk/count checks:

```js
    const resourceSensitive = tool?.risk === 'resource-sensitive'
    if (tool?.risk !== 'read-only' && !resourceSensitive) {
      throw new Error('运维任务只允许只读或资源敏感诊断工具')
    }
    const key = assertEndpoint(endpoint)
    if (resourceSensitive) {
      if ((sensitiveCounts.get(key) || 0) >= 1) {
        throw new Error('当前服务器已有资源敏感任务正在运行')
      }
      assertOperationsResourceConfirmation({
        confirmation,
        toolId: tool.id,
        endpointKey: key,
        params,
        consumedNonces: consumedConfirmations
      })
      sensitiveCounts.set(key, (sensitiveCounts.get(key) || 0) + 1)
    } else {
      if ((activeCounts.get(key) || 0) >= maxReadonlyPerEndpoint) {
        throw new Error('当前服务器同时运行的只读任务已达到上限')
      }
      activeCounts.set(key, (activeCounts.get(key) || 0) + 1)
    }
```

Remove the old unconditional count increment. In `finally`:

```js
        const countMap = resourceSensitive ? sensitiveCounts : activeCounts
        const remaining = Math.max(0, (countMap.get(key) || 1) - 1)
        if (remaining) countMap.set(key, remaining)
        else countMap.delete(key)
```

Expose:

```js
    getActiveCount: key => activeCounts.get(key) || 0,
    getSensitiveActiveCount: key => sensitiveCounts.get(key) || 0
```

- [ ] **Step 4: Pass confirmation through store**

```js
    const active = ensureRuntime(store).runner.run({
      tool,
      params,
      endpoint,
      confirmation: options.confirmation
    })
```

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
node --test test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/operations-toolkit/runtime/task-runner.js src/client/store/operations-toolkit.js test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
git commit -m "feat(operations): gate resource-sensitive tasks"
```

### Task 3: Build dedicated packet capture

**Files:**
- Create: `test/unit-ci/operations-toolkit-packet-capture.spec.js`
- Modify: `src/client/components/operations-toolkit/shared/validation.js`
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js`

- [ ] **Step 1: Write failing tests**

Create:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const capabilities = {
  interfaces: [{ name: 'eth0' }, { name: 'ens192' }]
}

test('packet capture parameters are typed bounded and discovery-backed', async () => {
  const { normalizePacketCaptureParameters } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const value = normalizePacketCaptureParameters({
    interfaceName: 'eth0',
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443,
    packetCount: 1000,
    duration: 300,
    outputPath: '/tmp/capture.pcap'
  }, capabilities)
  assert.equal(value.port, 443)
  assert.equal(value.packetCount, 1000)
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'unknown0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap'
    }, capabilities),
    /网卡/
  )
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'icmp',
      port: 53,
      outputPath: '/tmp/capture.pcap'
    }, capabilities),
    /端口/
  )
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap;id'
    }, capabilities),
    /抓包文件/
  )
  for (const unsafe of [
    { host: 'example.com;id' },
    { protocol: 'tcp\nid' },
    { packetCount: 1001 },
    { duration: 301 },
    { outputPath: '/tmp/$(id).pcap' }
  ]) {
    assert.throws(() => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap',
      ...unsafe
    }, capabilities))
  }
})

test('packet filter is constructed from validated fields', async () => {
  const { buildPacketCaptureFilter } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  assert.equal(buildPacketCaptureFilter({
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443
  }), 'tcp and host 10.0.0.8 and port 443')
  assert.equal(buildPacketCaptureFilter({
    protocol: 'any',
    host: '',
    port: ''
  }), '')
})

test('capture command is bounded private and no-overwrite', async () => {
  const { buildPacketCaptureCommands } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const commands = buildPacketCaptureCommands({
    interfaceName: 'eth0',
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443,
    packetCount: 100,
    duration: 30,
    outputPath: '/tmp/capture.pcap'
  }, capabilities)
  const source = commands.join('\n')
  assert.match(source, /umask 077/)
  assert.match(source, /timeout --signal=INT --kill-after=5 30/)
  assert.match(source, /tcpdump -nn -i 'eth0' -c 100/)
  assert.match(source, /ln -- "\$TEMP" "\$TARGET"/)
  assert.match(source, /sudo -n/)
  assert.match(source, /TEMP_INODE/)
  assert.match(source, /\[ ! -e "\$TARGET" \].*\[ ! -L "\$TARGET" \]/)
  assert.match(source, /head -n 100/)
  assert.doesNotMatch(source, /\beval\b|\bsource\b|tcpdump .+ -[XxAa]/)
})

test('capture definition is resource-sensitive', async () => {
  const { packetCaptureTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  assert.equal(packetCaptureTools.length, 1)
  assert.equal(packetCaptureTools[0].id, 'network.packet-capture')
  assert.equal(packetCaptureTools[0].risk, 'resource-sensitive')
  assert.equal(packetCaptureTools[0].requiresConfirmation, true)
  const port = packetCaptureTools[0].parameters.find(item => item.id === 'port')
  assert.equal(Object.isFrozen(port.enabledWhen), true)
  assert.equal(Object.isFrozen(port.enabledWhen.values), true)
  assert.deepEqual(
    packetCaptureTools[0].steps.map(step => step.id),
    ['preflight', 'capture', 'summary']
  )
})
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-packet-capture.spec.js
```

Expected: FAIL because module and validators do not exist.

- [ ] **Step 3: Add validators**

Append to `validation.js`:

```js
export function assertOptionalHost (value, label = '主机') {
  const normalized = String(value || '').trim()
  return normalized ? assertHost(normalized, label) : ''
}

export function assertOptionalPort (value, label = '端口') {
  if (value === undefined || value === null || value === '') return ''
  return assertPort(value, label)
}

export function assertEnumValue (value, allowed, label = '选项') {
  const normalized = String(value || '').trim()
  if (!allowed.includes(normalized)) invalid(label)
  return normalized
}

export function assertPid (value, label = 'PID') {
  if (value === undefined || value === null || value === '') return 0
  return assertIntegerRange(value, 1, 4194304, label)
}

export function assertPcapPath (value, label = '抓包文件') {
  const normalized = assertAbsolutePath(value, label)
  if (!/\.pcap$/i.test(normalized)) invalid(label)
  return normalized
}
```

- [ ] **Step 4: Implement capture module**

Create `packet-capture.js`:

```js
import { defineOperationsTool } from '../../shared/definition.js'
import {
  assertEnumValue,
  assertIntegerRange,
  assertInterface,
  assertOptionalHost,
  assertOptionalPort,
  assertPcapPath,
  shellQuote
} from '../../shared/validation.js'

const protocols = Object.freeze(['any', 'tcp', 'udp', 'icmp', 'icmp6'])

export function normalizePacketCaptureParameters (
  params = {},
  capabilities = {}
) {
  const interfaceName = assertInterface(params.interfaceName || 'any')
  const available = new Set([
    'any',
    ...(capabilities.interfaces || []).map(item => item.name)
  ])
  if (!available.has(interfaceName)) throw new Error('网卡不在当前探测结果中')
  const protocol = assertEnumValue(params.protocol || 'tcp', protocols, '协议')
  const port = assertOptionalPort(params.port)
  if (port && !['tcp', 'udp'].includes(protocol)) {
    throw new Error('只有 TCP 或 UDP 抓包可以填写端口')
  }
  return {
    interfaceName,
    protocol,
    host: assertOptionalHost(params.host),
    port,
    packetCount: assertIntegerRange(params.packetCount || 100, 1, 1000, '抓包数量'),
    duration: assertIntegerRange(params.duration || 30, 1, 300, '抓包时长'),
    outputPath: assertPcapPath(
      params.outputPath || '/tmp/shellpilot-capture.pcap'
    )
  }
}

export function buildPacketCaptureFilter (value) {
  const parts = []
  if (value.protocol && value.protocol !== 'any') parts.push(value.protocol)
  if (value.host) parts.push('host ' + value.host)
  if (value.port) parts.push('port ' + value.port)
  return parts.join(' and ')
}

export function buildPacketCaptureCommands (params = {}, capabilities = {}) {
  const value = normalizePacketCaptureParameters(params, capabilities)
  const target = shellQuote(value.outputPath)
  const interfaceName = shellQuote(value.interfaceName)
  const filter = buildPacketCaptureFilter(value)
  const filterSuffix = filter ? ' ' + filter : ''
  const preflight = [
    'set -u',
    'TARGET=' + target,
    'PARENT="$(dirname -- "$TARGET")"',
    'command -v tcpdump >/dev/null 2>&1 || { echo "未安装 tcpdump；Debian/Ubuntu: apt install tcpdump；RHEL/CentOS: yum install tcpdump"; exit 1; }',
    'for TOOL in dirname mktemp ln timeout stat head; do command -v "$TOOL" >/dev/null 2>&1 || { echo "缺少必要工具: $TOOL"; exit 1; }; done',
    '[ -d "$PARENT" ] && [ ! -L "$PARENT" ] || { echo "抓包父目录不存在或不安全"; exit 1; }',
    '[ ! -e "$TARGET" ] && [ ! -L "$TARGET" ] || { echo "抓包文件已存在，拒绝覆盖"; exit 1; }',
    '[ ' + interfaceName + ' = any ] || ip link show dev ' + interfaceName + ' >/dev/null 2>&1 || { echo "网卡不存在"; exit 1; }',
    'if [ "$(id -u)" != 0 ]; then command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1 || { echo "抓包需要 root 或免密 sudo"; exit 1; }; fi'
  ].join('\n')
  const capture = [
    'set -u',
    'umask 077',
    'TARGET=' + target,
    'PARENT="$(dirname -- "$TARGET")"',
    'TEMP="$(mktemp "$PARENT/.shellpilot-capture.XXXXXX.pcap")" || exit 1',
    'TEMP_INODE="$(stat -c %d:%i -- "$TEMP")" || exit 1',
    'cleanup_capture () { [ -n "${TEMP:-}" ] && [ -n "${TEMP_INODE:-}" ] && [ -f "$TEMP" ] && [ ! -L "$TEMP" ] && [ "$(stat -c %d:%i -- "$TEMP" 2>/dev/null)" = "$TEMP_INODE" ] && rm -f -- "$TEMP" 2>/dev/null || true; }',
    'trap cleanup_capture EXIT HUP INT TERM',
    'RUN_AS=""',
    'if [ "$(id -u)" != 0 ]; then RUN_AS="sudo -n"; fi',
    'set +e',
    'timeout --signal=INT --kill-after=5 ' + value.duration + ' $RUN_AS tcpdump -nn -i ' + interfaceName + ' -c ' + value.packetCount + ' -w "$TEMP"' + filterSuffix,
    'STATUS=$?',
    'set -e',
    'case "$STATUS" in 0|124) ;; *) echo "tcpdump 执行失败: $STATUS"; exit "$STATUS" ;; esac',
    '[ -s "$TEMP" ] || { echo "抓包文件为空"; exit 1; }',
    '[ -f "$TEMP" ] && [ ! -L "$TEMP" ] && [ "$(stat -c %d:%i -- "$TEMP")" = "$TEMP_INODE" ] || { echo "抓包临时文件已被替换"; exit 1; }',
    'ln -- "$TEMP" "$TARGET" || { echo "目标文件已存在，拒绝覆盖"; exit 1; }',
    'rm -f -- "$TEMP"; TEMP=""; TEMP_INODE=""',
    'trap - EXIT HUP INT TERM',
    'printf "capture_path=%s\\n" "$TARGET"'
  ].join('\n')
  const summary = [
    'TARGET=' + target,
    'test -r "$TARGET" || { echo "抓包文件不可读"; exit 1; }',
    'stat -c "capture_size=%s capture_mode=%a capture_owner=%U" -- "$TARGET"',
    'tcpdump -nn -r "$TARGET" -c 100 2>/dev/null | head -n 100'
  ].join('\n')
  return [preflight, capture, summary]
}

function commands (params = {}, capabilities = {}) {
  return buildPacketCaptureCommands(params, capabilities)
}

export const packetCaptureTools = Object.freeze([
  defineOperationsTool({
    id: 'network.packet-capture',
    title: '网络抓包与报文采样',
    description: '按网卡、协议、主机和端口有界抓包，并保存为不覆盖的 pcap 文件。',
    category: '网络',
    type: 'diagnostic',
    risk: 'resource-sensitive',
    requiresConfirmation: true,
    parameters: [
      { id: 'interfaceName', label: '网卡', type: 'select', source: 'interfaces', defaultValue: 'any' },
      {
        id: 'protocol',
        label: '协议',
        type: 'select',
        defaultValue: 'tcp',
        options: [
          { label: '不限协议', value: 'any' },
          { label: 'TCP', value: 'tcp' },
          { label: 'UDP', value: 'udp' },
          { label: 'ICMP', value: 'icmp' },
          { label: 'ICMPv6', value: 'icmp6' }
        ]
      },
      { id: 'host', label: '主机过滤（可选）', type: 'host', defaultValue: '' },
      {
        id: 'port',
        label: '端口过滤（可选）',
        type: 'port',
        defaultValue: '',
        enabledWhen: { id: 'protocol', values: ['tcp', 'udp'] }
      },
      { id: 'packetCount', label: '最多抓包数量', type: 'number', defaultValue: 100 },
      { id: 'duration', label: '最长时长（秒）', type: 'number', defaultValue: 30 },
      { id: 'outputPath', label: '保存路径', type: 'path', defaultValue: '/tmp/shellpilot-capture.pcap' }
    ],
    aiContext: {
      parameterIds: [
        'interfaceName', 'protocol', 'host', 'port',
        'packetCount', 'duration', 'outputPath'
      ],
      stepIds: ['preflight', 'capture', 'summary']
    },
    steps: [
      { id: 'preflight', title: '检查依赖、权限和保存路径', command: commands()[0], buildCommand: (params, capabilities) => commands(params, capabilities)[0], timeoutMs: 15000 },
      { id: 'capture', title: '执行有界抓包', command: commands()[1], buildCommand: (params, capabilities) => commands(params, capabilities)[1], timeoutMs: 330000 },
      { id: 'summary', title: '输出文件信息和报文头摘要', command: commands()[2], buildCommand: (params, capabilities) => commands(params, capabilities)[2], timeoutMs: 30000 }
    ]
  })
])
```

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
node --test test/unit-ci/operations-toolkit-packet-capture.spec.js test/unit-ci/operations-toolkit-definition.spec.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/operations-toolkit/shared/validation.js src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js test/unit-ci/operations-toolkit-packet-capture.spec.js
git commit -m "feat(operations): add bounded packet capture tool"
```

### Task 4: Register capture and repair migration

**Files:**
- Modify: `test/unit-ci/operations-toolkit-migrations.spec.js`
- Modify: `test/unit-ci/operations-toolkit-release-gate.spec.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Modify: `src/client/components/operations-toolkit/catalog/migrations.js`

- [ ] **Step 1: Change tests first**

Migration expectation and lookup:

```js
  assert.equal(
    resolveLegacyOperationsTool('builtin-server-packet-capture'),
    'network.packet-capture'
  )
  const { getOperationsTool } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  assert.equal(
    getOperationsTool('builtin-server-packet-capture').id,
    'network.packet-capture'
  )
```

Release-gate assertions:

```js
  assert.equal(diagnostics.length, 25)
  assert.equal(runbooks.length, 10)
  assert.equal(catalog.length, 35)
  assert.deepEqual(
    catalog.filter(tool => tool.risk === 'resource-sensitive').map(tool => tool.id),
    ['network.packet-capture']
  )
  assert.equal(
    catalog
      .filter(tool => tool.id !== 'network.packet-capture')
      .every(tool => tool.risk === 'read-only'),
    true
  )
```

Remove the old all-read-only assertion.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-migrations.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
```

Expected: FAIL because migration and registration are unchanged.

- [ ] **Step 3: Implement registration**

Import:

```js
import { packetCaptureTools } from './diagnostics/packet-capture.js'
import { resolveLegacyOperationsTool } from './migrations.js'
```

Add `packetCaptureTools` before `udpCheckTools`. Replace lookup:

```js
export function getOperationsTool (id) {
  const resolvedId = resolveLegacyOperationsTool(id)
  return operationsCatalog.find(tool => {
    return tool.id === id ||
      tool.id === resolvedId ||
      tool.legacyIds?.includes(id)
  }) || null
}
```

Change migration:

```js
  'builtin-server-packet-capture': 'network.packet-capture',
```

Keep the old ID hidden to avoid a duplicate card.

- [ ] **Step 4: Run and verify GREEN**

```powershell
node --test test/unit-ci/operations-toolkit-migrations.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js test/unit-ci/server-maintenance-command-registry.spec.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/client/components/operations-toolkit/catalog/index.js src/client/components/operations-toolkit/catalog/migrations.js test/unit-ci/operations-toolkit-migrations.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
git commit -m "fix(operations): restore packet capture migration"
```

### Task 5: Add dependent parameters and confirmation UI

**Files:**
- Create: `test/unit-ci/operations-toolkit-resource-ui.spec.js`
- Modify: `src/client/components/operations-toolkit/workspace/parameter-value.js`
- Modify: `src/client/components/operations-toolkit/workspace/parameter-form.jsx`
- Modify: `src/client/components/operations-toolkit/workspace/operations-workspace.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`

- [ ] **Step 1: Write failing UI tests**

Create:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

const root = path.resolve(__dirname, '../..')

test('parameter dependencies disable port outside TCP and UDP', async () => {
  const {
    isOperationsParameterEnabled,
    normalizeOperationsParameterDependencies
  } = await importModule(
    'src/client/components/operations-toolkit/workspace/parameter-value.js'
  )
  const parameter = {
    enabledWhen: { id: 'protocol', values: ['tcp', 'udp'] }
  }
  assert.equal(isOperationsParameterEnabled(parameter, { protocol: 'tcp' }), true)
  assert.equal(isOperationsParameterEnabled(parameter, { protocol: 'icmp' }), false)
  assert.deepEqual(normalizeOperationsParameterDependencies({
    parameters: [
      { id: 'protocol', defaultValue: 'tcp' },
      { id: 'port', defaultValue: '', ...parameter }
    ]
  }, { protocol: 'icmp', port: 443 }), {
    protocol: 'icmp',
    port: ''
  })
})

test('workspace confirms resource-sensitive runs and passes binding', () => {
  const workspace = fs.readFileSync(
    path.join(root, 'src/client/components/operations-toolkit/workspace/operations-workspace.jsx'),
    'utf8'
  )
  assert.match(workspace, /Modal\.confirm/)
  assert.match(workspace, /createOperationsResourceConfirmation/)
  assert.match(workspace, /risk === 'resource-sensitive'/)
  assert.match(workspace, /runOperationsTool/)
  assert.match(workspace, /\{ confirmation \}/)
  assert.match(workspace, /shellpilotOperationsCaptureConfirmTitle/)
  assert.match(workspace, /shellpilotOperationsRunSensitive/)
})
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-resource-ui.spec.js
```

Expected: FAIL.

- [ ] **Step 3: Add dependency helper**

Append:

```js
export function isOperationsParameterEnabled (parameter = {}, values = {}) {
  if (!parameter.enabledWhen) return true
  const allowed = parameter.enabledWhen.values || []
  return allowed.includes(values[parameter.enabledWhen.id])
}

export function normalizeOperationsParameterDependencies (tool, values = {}) {
  const normalized = { ...values }
  for (const parameter of tool?.parameters || []) {
    if (isOperationsParameterEnabled(parameter, normalized)) continue
    normalized[parameter.id] = parameter.defaultValue ?? ''
  }
  return normalized
}
```

In `parameter-form.jsx`, compute:

```js
        const parameterEnabled = isOperationsParameterEnabled(parameter, values)
```

Set:

```js
          disabled: disabled || !parameterEnabled,
```

Import `normalizeOperationsParameterDependencies` in `operations-workspace.jsx` and replace `handleParamChange` with:

```js
  function handleParamChange (id, value) {
    setParams(current => normalizeOperationsParameterDependencies(
      selectedTool,
      { ...current, [id]: value }
    ))
  }
```

- [ ] **Step 4: Add confirmation handling**

Add Ant Design `Modal` and these imports, then replace the handler:

```js
import {
  createOperationsResourceConfirmation
} from '../shared/resource-confirmation.js'
import {
  normalizeOperationsParameterDependencies
} from './parameter-value.js'
```

```jsx
  function executeRun (tool, values, confirmation) {
    try {
      const active = store.runOperationsTool(
        tool.id,
        values,
        confirmation ? { confirmation } : {}
      )
      active.completion.catch(error => window.store.onError(error))
    } catch (error) {
      message.warning(error?.message || String(error))
    }
  }

  function handleRun (tool = selectedTool, values = params) {
    if (tool.risk !== 'resource-sensitive') {
      executeRun(tool, values)
      return
    }
    Modal.confirm({
      title: e('shellpilotOperationsCaptureConfirmTitle'),
      content: (
        <div className='operations-sensitive-confirmation'>
          <p>{e('shellpilotOperationsCaptureConfirmHint')}</p>
          <dl>
            <dt>{e('shellpilotOperationsCurrentServerLabel')}</dt>
            <dd>{endpointKey}</dd>
            {(tool.parameters || []).map(parameter => (
              <div key={parameter.id}>
                <dt>{parameter.label}</dt>
                <dd>{String(values[parameter.id] ?? '')}</dd>
              </div>
            ))}
          </dl>
        </div>
      ),
      okText: e('shellpilotOperationsConfirmCapture'),
      cancelText: e('cancel'),
      onOk: () => {
        const confirmation = createOperationsResourceConfirmation({
          toolId: tool.id,
          endpointKey,
          params: values
        })
        executeRun(tool, values, confirmation)
      }
    })
  }
```

Use an orange tag:

```jsx
            <Tag color={tool.risk === 'resource-sensitive' ? 'orange' : 'green'}>
              {tool.risk === 'resource-sensitive'
                ? e('shellpilotOperationsResourceSensitive')
                : (script
                    ? tf('shellpilotOperationsRunbookStepCount', {
                      count: tool.steps.length
                    })
                    : e('shellpilotOperationsReadonly'))}
            </Tag>
```

Button branch:

```jsx
                : (tool.risk === 'resource-sensitive'
                    ? e('shellpilotOperationsRunSensitive')
                    : (script
                        ? e('shellpilotOperationsRunScript')
                        : e('shellpilotOperationsRunReadonly')))}
```

Hint branch:

```jsx
                : (tool.risk === 'resource-sensitive'
                    ? e('shellpilotOperationsSensitiveConfirmationRequired')
                    : (script
                        ? e('shellpilotOperationsRunbookNoConfirmation')
                        : e('shellpilotOperationsNoConfirmation')))}
```

- [ ] **Step 5: Add bilingual copy**

Chinese:

```js
    shellpilotOperationsResourceSensitive: '资源敏感',
    shellpilotOperationsRunSensitive: '确认并开始抓包',
    shellpilotOperationsSensitiveConfirmationRequired: '会读取网络流量并创建 pcap 文件，运行前需要确认',
    shellpilotOperationsCaptureConfirmTitle: '确认抓包范围',
    shellpilotOperationsCaptureConfirmHint: '请核对服务器、过滤范围、包数、时长和保存路径。',
    shellpilotOperationsCurrentServerLabel: '目标服务器',
    shellpilotOperationsConfirmCapture: '确认抓包',
```

English:

```js
    shellpilotOperationsResourceSensitive: 'Resource-sensitive',
    shellpilotOperationsRunSensitive: 'Confirm and Capture',
    shellpilotOperationsSensitiveConfirmationRequired: 'Reads network traffic and creates a pcap file; confirmation is required.',
    shellpilotOperationsCaptureConfirmTitle: 'Confirm Capture Scope',
    shellpilotOperationsCaptureConfirmHint: 'Review the server, filters, packet limit, duration, and output path.',
    shellpilotOperationsCurrentServerLabel: 'Target server',
    shellpilotOperationsConfirmCapture: 'Start Capture',
```

- [ ] **Step 6: Test and lint**

```powershell
node --test test/unit-ci/operations-toolkit-resource-ui.spec.js test/unit-ci/operations-toolkit-ai-context.spec.js
npx standard src/client/components/operations-toolkit/workspace/parameter-value.js src/client/components/operations-toolkit/workspace/parameter-form.jsx src/client/components/operations-toolkit/workspace/operations-workspace.jsx src/client/common/shellpilot-i18n-overrides.js
```

Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```powershell
git add src/client/components/operations-toolkit/workspace/parameter-value.js src/client/components/operations-toolkit/workspace/parameter-form.jsx src/client/components/operations-toolkit/workspace/operations-workspace.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/operations-toolkit-resource-ui.spec.js
git commit -m "feat(operations): confirm packet capture scope"
```

### Task 6: Add five read-only field diagnostics

**Files:**
- Create: `test/unit-ci/operations-toolkit-field-diagnostics.spec.js`
- Create: `src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js`
- Modify: `src/client/components/operations-toolkit/catalog/index.js`
- Modify: `test/unit-ci/operations-toolkit-release-gate.spec.js`

- [ ] **Step 1: Write failing tests**

Create:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const expectedIds = [
  'process.abnormal-state',
  'system.file-descriptor-pressure',
  'storage.mount-filesystem-health',
  'storage.block-device-health',
  'system.time-synchronization'
]

test('field diagnostics expose five stable read-only tools', async () => {
  const { advancedSystemTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js'
  )
  assert.deepEqual(advancedSystemTools.map(tool => tool.id), expectedIds)
  assert.equal(advancedSystemTools.every(tool => tool.risk === 'read-only'), true)
  assert.equal(advancedSystemTools.every(tool => tool.steps.length > 0), true)
})

test('process detail accepts optional PID without reading secrets', async () => {
  const {
    buildProcessAbnormalStateCommand,
    normalizeProcessParameters
  } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js'
  )
  assert.equal(normalizeProcessParameters({ pid: '' }).pid, 0)
  assert.equal(normalizeProcessParameters({ pid: 123 }).pid, 123)
  assert.throws(() => normalizeProcessParameters({ pid: '1;id' }), /PID/)
  const command = buildProcessAbnormalStateCommand({ pid: 123 })
  assert.match(command, /\/proc\/123\/status/)
  assert.doesNotMatch(command, /\/environ|\/cmdline/)
})

test('field diagnostics stay bounded and non-mutating', async () => {
  const { advancedSystemTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js'
  )
  const commands = advancedSystemTools
    .flatMap(tool => tool.steps.map(step => step.command))
    .join('\n')
  assert.match(commands, /head -n|tail -n|timeout/)
  assert.doesNotMatch(
    commands,
    /\b(?:rm|mv|mount|umount|kill|renice|fsck)\b|systemctl\s+(?:restart|stop|start)|timedatectl\s+set|smartctl\s+-t/
  )
  assert.match(commands, /smartctl -H -A/)
  assert.match(commands, /\/proc\/self\/mountstats/)
  assert.match(commands, /chronyc tracking/)
})
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-field-diagnostics.spec.js
```

Expected: FAIL.

- [ ] **Step 3: Implement tool module**

Create `advanced-system.js`:

```js
import { defineOperationsTool } from '../../shared/definition.js'
import { assertPid } from '../../shared/validation.js'

function tool (id, title, category, command, extra = {}) {
  return defineOperationsTool({
    id,
    title,
    description: extra.description || title,
    category,
    type: 'diagnostic',
    risk: 'read-only',
    parameters: extra.parameters,
    steps: [{
      id: 'collect',
      title: '采集有界只读信息',
      command,
      buildCommand: extra.buildCommand,
      timeoutMs: extra.timeoutMs || 60000
    }]
  })
}

export function normalizeProcessParameters (params = {}) {
  return { pid: assertPid(params.pid) }
}

export function buildProcessAbnormalStateCommand (params = {}) {
  const { pid } = normalizeProcessParameters(params)
  const overview = [
    'printf "## 资源热点\\n"',
    'ps -eo pid,ppid,user,stat,psr,%cpu,%mem,etime,wchan:32,comm --sort=-%cpu | head -n 61',
    'printf "## 僵尸与不可中断进程\\n"',
    'ps -eo pid,ppid,user,stat,etime,wchan:32,comm | awk \'NR == 1 || $4 ~ /^[ZD]/\' | head -n 100',
    'printf "## 调度压力\\n"',
    'cat /proc/pressure/cpu /proc/pressure/io /proc/pressure/memory 2>/dev/null || true'
  ]
  if (!pid) return overview.join('; ')
  return overview.concat([
    'printf "## PID ' + pid + '\\n"',
    'test -r /proc/' + pid + '/status || { echo "进程不存在或无权读取"; exit 1; }',
    'sed -n "1,80p" /proc/' + pid + '/status',
    'ps -L -p ' + pid + ' -o pid,tid,psr,stat,%cpu,%mem,wchan:32,comm | head -n 200',
    'printf "wchan="; cat /proc/' + pid + '/wchan 2>/dev/null || true',
    'sed -n "1,80p" /proc/' + pid + '/limits 2>/dev/null || true',
    'printf "fd_count="; find /proc/' + pid + '/fd -maxdepth 1 -type l 2>/dev/null | head -n 10001 | wc -l'
  ]).join('; ')
}

const fdPressureCommand = [
  'printf "## system file handles\\n"',
  'cat /proc/sys/fs/file-nr /proc/sys/fs/file-max 2>/dev/null',
  'printf "## current limit\\n"; ulimit -n',
  'printf "## socket summary\\n"; ss -s 2>/dev/null || netstat -s 2>/dev/null | head -n 120',
  'printf "## top process fd counts\\n"',
  'SCANNED=0; for PROC in /proc/[0-9]*; do [ "$SCANNED" -lt 2048 ] || break; SCANNED=$((SCANNED + 1)); PID=$(basename "$PROC"); COUNT=$(find "$PROC/fd" -maxdepth 1 -type l 2>/dev/null | head -n 10001 | wc -l); COMM=$(cat "$PROC/comm" 2>/dev/null); printf "%s %s %s\\n" "$COUNT" "$PID" "$COMM"; done | sort -nr | head -n 40'
].join('; ')

const mountHealthCommand = [
  'printf "## mounts\\n"; findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS | head -n 300',
  'printf "## local capacity\\n"; timeout 10 df -hT -x nfs -x nfs4 -x cifs 2>&1 | head -n 200',
  'printf "## read-only mounts\\n"; findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS | awk \'$4 ~ /(^|,)ro(,|$)/\' | head -n 100',
  'printf "## remote mounts\\n"; grep -E "[[:space:]](nfs|nfs4|cifs)[[:space:]]" /proc/mounts 2>/dev/null | head -n 100 || true',
  'command -v nfsstat >/dev/null 2>&1 && nfsstat -m 2>/dev/null | head -n 160 || printf "nfsstat=unsupported; install nfs-common/nfs-utils with apt/yum\\n"',
  'printf "## mountstats\\n"; sed -n "1,400p" /proc/self/mountstats 2>/dev/null',
  '(journalctl -k --since "-24 hours" --no-pager 2>/dev/null || dmesg 2>/dev/null) | grep -Ei "nfs|cifs|stale|read-only|I/O error" | tail -n 160 || true'
].join('; ')

const blockHealthCommand = [
  'printf "## block devices\\n"; lsblk -e 7 -o NAME,KNAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,ROTA,RO,MODEL,SERIAL | head -n 160',
  'printf "## software raid\\n"; cat /proc/mdstat 2>/dev/null || true',
  'command -v mdadm >/dev/null 2>&1 && mdadm --detail --scan 2>/dev/null | head -n 100 || printf "mdadm=unsupported; install mdadm with apt/yum\\n"',
  'printf "## kernel storage warnings\\n"; (journalctl -k --since "-24 hours" --no-pager 2>/dev/null || dmesg 2>/dev/null) | grep -Ei "I/O error|medium error|critical medium|blk_update|nvme.*error|ata.*error|resetting link|md.*degrad" | tail -n 200 || true',
  'if command -v smartctl >/dev/null 2>&1; then smartctl --scan-open 2>/dev/null | awk \'{print $1}\' | head -n 8 | while IFS= read -r DEVICE; do case "$DEVICE" in /dev/*) printf "## SMART %s\\n" "$DEVICE"; timeout 10 smartctl -H -A "$DEVICE" 2>&1 | grep -Ei "SMART overall-health|SMART Health Status|PASSED|FAILED|Reallocated|Pending|Offline_Uncorrectable|Media_Wearout|Percentage Used|Critical Warning" | head -n 80 ;; esac; done; else printf "smartctl=unsupported; install smartmontools with apt/yum\\n"; fi'
].join('; ')

const timeSyncCommand = [
  'printf "## local time\\n"; date -Ins; date -u -Ins',
  'command -v timedatectl >/dev/null 2>&1 && { timedatectl status 2>&1; timedatectl show -p NTPSynchronized -p TimeUSec -p Timezone 2>&1; } || true',
  'command -v chronyc >/dev/null 2>&1 && { printf "## chrony tracking\\n"; chronyc tracking 2>&1; printf "## chrony sources\\n"; chronyc sources -v 2>&1 | head -n 80; } || printf "chronyc=unsupported; install chrony with apt/yum\\n"',
  'command -v ntpq >/dev/null 2>&1 && { printf "## ntpq\\n"; ntpq -pn 2>&1 | head -n 80; } || true',
  'systemctl show systemd-timesyncd chronyd ntpd --no-pager --property=Id,LoadState,ActiveState,SubState 2>/dev/null || true'
].join('; ')

export const advancedSystemTools = Object.freeze([
  tool(
    'process.abnormal-state',
    '异常进程与阻塞状态排查',
    '系统',
    buildProcessAbnormalStateCommand(),
    {
      parameters: [
        { id: 'pid', label: 'PID（可选）', type: 'number', defaultValue: '' }
      ],
      buildCommand: params => buildProcessAbnormalStateCommand(params)
    }
  ),
  tool(
    'system.file-descriptor-pressure',
    '文件描述符与 Socket 压力',
    '系统',
    fdPressureCommand,
    { timeoutMs: 90000 }
  ),
  tool(
    'storage.mount-filesystem-health',
    '挂载点与远程文件系统健康',
    '存储',
    mountHealthCommand,
    { timeoutMs: 90000 }
  ),
  tool(
    'storage.block-device-health',
    '磁盘、SMART 与 RAID 健康',
    '存储',
    blockHealthCommand,
    { timeoutMs: 120000 }
  ),
  tool(
    'system.time-synchronization',
    '系统时间与同步状态',
    '系统',
    timeSyncCommand
  )
])
```

- [ ] **Step 4: Register and update release count**

In `catalog/index.js`, import and place `advancedSystemTools` after `systemStorageTools`:

```js
import { advancedSystemTools } from './diagnostics/advanced-system.js'
```

Then update the release-gate counts:

```js
  assert.equal(diagnostics.length, 30)
  assert.equal(runbooks.length, 10)
  assert.equal(catalog.length, 40)
```

- [ ] **Step 5: Run and verify GREEN**

```powershell
node --test test/unit-ci/operations-toolkit-field-diagnostics.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js test/unit-ci/operations-toolkit-system-storage.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js src/client/components/operations-toolkit/catalog/index.js test/unit-ci/operations-toolkit-field-diagnostics.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
git commit -m "feat(operations): add field diagnostic tools"
```

### Task 7: Bound AI context and update guidance

**Files:**
- Modify: `test/unit-ci/operations-toolkit-ai-context.spec.js`
- Modify: `src/client/components/operations-toolkit/shared/ai-context.js`
- Modify: `docs/USER_GUIDE_ZH.md`

- [ ] **Step 1: Write failing context test**

Append:

```js
test('resource-sensitive AI context includes only allowlisted params and steps', async () => {
  const { buildOperationsAIContext } = await loadModule(
    'src/client/components/operations-toolkit/shared/ai-context.js'
  )
  const value = buildOperationsAIContext({
    tool: {
      title: '网络抓包与报文采样',
      risk: 'resource-sensitive',
      parameters: [
        { id: 'protocol', label: '协议' },
        { id: 'outputPath', label: '保存路径' },
        { id: 'secret', label: '不应发送' }
      ],
      aiContext: {
        parameterIds: ['protocol', 'outputPath'],
        stepIds: ['capture', 'summary']
      }
    },
    task: {
      toolId: 'network.packet-capture',
      endpointKey: 'root@example.com:22',
      status: 'completed',
      params: {
        protocol: 'tcp',
        outputPath: '/tmp/capture.pcap',
        secret: 'do-not-send'
      },
      steps: [
        { id: 'capture', title: '抓包', output: 'capture_size=1024' },
        { id: 'summary', title: '摘要', output: '10.0.0.1.443 > 10.0.0.2.50000' },
        { id: 'binary', title: '二进制', output: 'PCAP-BINARY-MARKER' }
      ]
    }
  })
  assert.match(value, /协议.*tcp/)
  assert.match(value, /\/tmp\/capture\.pcap/)
  assert.doesNotMatch(value, /do-not-send|PCAP-BINARY-MARKER/)
})
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/unit-ci/operations-toolkit-ai-context.spec.js
```

Expected: FAIL.

- [ ] **Step 3: Filter context**

After the initial parts:

```js
  const sensitive = tool?.risk === 'resource-sensitive'
  const allowedParameterIds = new Set(tool?.aiContext?.parameterIds || [])
  if (sensitive) {
    for (const parameter of tool?.parameters || []) {
      if (!allowedParameterIds.has(parameter.id)) continue
      const value = task?.params?.[parameter.id]
      if (value === undefined || value === null || value === '') continue
      parts.push(`${parameter.label}：${String(value)}`)
    }
  }
  const allowedStepIds = new Set(tool?.aiContext?.stepIds || [])
```

Change loop:

```js
  for (const step of task?.steps || []) {
    if (sensitive && !allowedStepIds.has(step.id)) continue
```

- [ ] **Step 4: Update user guide**

Under 8.2:

```markdown
- 独立抓包可选择真实网卡、TCP/UDP/ICMP、可选主机和端口、最多包数、最长时长和 `.pcap` 保存路径。
- 抓包属于资源敏感诊断：执行前必须核对范围并确认；目标文件已存在时不会覆盖。
```

Under 8.3:

```markdown
新增现场排查包括异常进程与 D/Z 状态、文件描述符与 Socket 压力、NFS/CIFS 挂载健康、SMART/软 RAID 健康以及时间同步状态。缺少 `smartctl`、`mdadm`、`chronyc` 等可选工具时只显示降级结果和安装建议，不会自动安装。

抓包生成的 pcap 二进制文件不会自动发送给 AI；“交给 AI 分析”只包含结构化范围、文件元数据和有限报文头摘要。
```

- [ ] **Step 5: Run and verify GREEN**

```powershell
node --test test/unit-ci/operations-toolkit-ai-context.spec.js test/unit-ci/operations-toolkit-packet-capture.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/operations-toolkit/shared/ai-context.js test/unit-ci/operations-toolkit-ai-context.spec.js docs/USER_GUIDE_ZH.md
git commit -m "docs(operations): document capture privacy boundaries"
```

### Task 8: E2E and complete verification

**Files:**
- Modify: `test/e2e/032.operations-toolkit.spec.js`
- Verify: all files from Tasks 1-7

- [ ] **Step 1: Update disconnected Operations E2E**

Change count 24 to 30 and add:

```js
    await workspace.locator('.operations-tool-list').getByText('网络抓包与报文采样').click()
    await expect(workspace.locator('.operations-tool-title')).toContainText('网络抓包与报文采样')
    await expect(workspace.locator('.operations-tool-title')).toContainText('资源敏感')
    await expect(workspace.locator('label')).toContainText([
      '网卡',
      '协议',
      '主机过滤（可选）',
      '端口过滤（可选）',
      '最多抓包数量',
      '最长时长（秒）',
      '保存路径'
    ])
    await expect(workspace.locator('.operations-run-actions')).toContainText(
      '连接后运行'
    )
```

Do not perform a real capture in disconnected E2E.

- [ ] **Step 2: Run focused tests**

```powershell
node --test test/unit-ci/operations-toolkit-definition.spec.js test/unit-ci/operations-toolkit-resource-confirmation.spec.js test/unit-ci/operations-toolkit-runner.spec.js test/unit-ci/operations-toolkit-packet-capture.spec.js test/unit-ci/operations-toolkit-migrations.spec.js test/unit-ci/operations-toolkit-resource-ui.spec.js test/unit-ci/operations-toolkit-field-diagnostics.spec.js test/unit-ci/operations-toolkit-ai-context.spec.js test/unit-ci/operations-toolkit-release-gate.spec.js
```

Expected: PASS, zero failures.

- [ ] **Step 3: Run neighboring regressions**

```powershell
$operationsTests = Get-ChildItem test/unit-ci/operations-toolkit-*.spec.js | ForEach-Object FullName
node --test $operationsTests test/unit-ci/server-maintenance-command-registry.spec.js test/unit-ci/server-maintenance-quick-commands.spec.js test/unit-ci/quick-command-validation.spec.js
```

Expected: PASS; legacy capture registry remains intact.

- [ ] **Step 4: Run lint and all unit tests**

```powershell
npm run lint
npm run test-unit-ci
```

Expected: exit 0.

- [ ] **Step 5: Build and run E2E**

```powershell
npm run vite-build
npx playwright test test/e2e/032.operations-toolkit.spec.js --workers=1
```

Expected: build and E2E PASS.

- [ ] **Step 6: Audit commands**

```powershell
$auditMatches = rg -n "eval|source |tcpdump .*-[XxAa]|smartctl -t|timedatectl set|systemctl (start|stop|restart)|\b(fsck|mount|umount|kill|renice)\b" src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js
if ($LASTEXITCODE -eq 0) { $auditMatches; throw 'Unsafe diagnostic command found' }
if ($LASTEXITCODE -ne 1) { throw 'Command audit could not run' }
```

Expected: no unsafe match.

- [ ] **Step 7: Review diff and tree**

```powershell
git diff --check
git diff --stat master...HEAD
git status --short
```

Expected: no whitespace errors and only plan-scoped implementation files.

- [ ] **Step 8: Commit E2E**

```powershell
git add test/e2e/032.operations-toolkit.spec.js
git commit -m "test(operations): cover restored capture catalog"
```

- [ ] **Step 9: Request code review**

Use `superpowers:requesting-code-review`. Review:

- one-use confirmation binding and expiry;
- no-overwrite pcap publication;
- cancellation and timeout cleanup ownership;
- injection through capture parameters;
- no process environment or full command-line collection;
- no automatic pcap upload to AI;
- unrelated user changes untouched.

- [ ] **Step 10: Apply accepted findings with TDD**

For each accepted finding, add a failing regression test, run RED, implement the minimum correction, rerun focused and broad checks, and commit separately.
