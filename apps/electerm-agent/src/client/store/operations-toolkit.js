import * as ls from '../common/safe-local-storage'
import { pinnedQuickCommandBarKey } from '../common/constants'
import { refs } from '../components/common/ref'
import { runCmd } from '../components/terminal/terminal-apis.js'
import {
  buildOperationsDiscoveryCommand,
  parseOperationsDiscoveryOutput
} from '../components/operations-toolkit/shared/capability-discovery.js'
import { getOperationsTool } from '../components/operations-toolkit/catalog/index.js'
import { createOperationsTaskRecordStore } from '../components/operations-toolkit/runtime/task-record-store.js'
import { createPtyTaskChannel } from '../components/operations-toolkit/runtime/pty-task-channel.js'
import { createOperationsTaskRunner } from '../components/operations-toolkit/runtime/task-runner.js'
import {
  createOperationsIncidentCandidate,
  createOperationsTimelineEvent
} from '../components/incidents/incident-capture.js'

const historyStorageKey = 'shellpilot-operations-task-history-v1'
const finalOperationsTaskStatuses = new Set([
  'completed',
  'cancelled',
  'cancellation-unknown',
  'timed-out',
  'failed',
  'disconnected',
  'partially-completed'
])

function endpointUser (tab = {}) {
  return tab.username || tab.user || ''
}

function endpointsMatch (left = {}, right = {}) {
  return Boolean(
    left.host &&
    endpointUser(left) &&
    left.host === right.host &&
    Number(left.port || 22) === Number(right.port || 22) &&
    endpointUser(left) === endpointUser(right)
  )
}

function resolveCurrentEndpoint () {
  const store = window.store
  const tab = store.currentTab
  const terminal = tab?.id ? refs.get('term-' + tab.id) : null
  if (!terminal?.pid || terminal.isSsh?.() !== true) return null
  if (typeof terminal.getTerminalSafetyEndpoint !== 'function') return null
  const safetyEndpoint = terminal.getTerminalSafetyEndpoint()
  if (!safetyEndpoint?.hostKeyFingerprint ||
    !safetyEndpoint?.sshTerminalPid ||
    !safetyEndpoint?.sshSessionGeneration ||
    !endpointsMatch(tab, safetyEndpoint)) return null
  return {
    tabId: safetyEndpoint.tabId,
    pid: safetyEndpoint.pid,
    terminalPid: safetyEndpoint.terminalPid,
    sshTerminalPid: safetyEndpoint.sshTerminalPid,
    sessionType: safetyEndpoint.sessionType,
    host: safetyEndpoint.host,
    port: safetyEndpoint.port,
    username: safetyEndpoint.username,
    connectionUsername: safetyEndpoint.username,
    sshSessionGeneration: safetyEndpoint.sshSessionGeneration,
    hostKeyFingerprint: safetyEndpoint.hostKeyFingerprint,
    title: tab.title || tab.name || tab.host
  }
}

function createDiscoveryNonce () {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(
    bytes,
    byte => byte.toString(16).padStart(2, '0')
  ).join('')
}

function commandOutput (response) {
  return typeof response === 'string'
    ? response
    : response?.stdout || ''
}

async function previewOperationsCapabilities (endpoint) {
  const nonce = createDiscoveryNonce()
  const command = buildOperationsDiscoveryCommand(nonce)
  const response = await runCmd(endpoint.pid, command, {
    timeoutMs: 30000,
    maxOutputBytes: 1024 * 1024
  })
  return parseOperationsDiscoveryOutput(commandOutput(response), nonce)
}

async function executeOperationsDiscoveryThroughPty (_endpoint, context) {
  const nonce = createDiscoveryNonce()
  let output = ''
  const result = await context.execute({
    taskId: `${context.taskId}-discovery`,
    script: buildOperationsDiscoveryCommand(nonce),
    timeoutMs: 30000,
    signal: context.signal,
    onChunk: chunk => { output += chunk }
  })
  context.onIdentity(result.identity)
  if (result.exitCode !== 0) {
    throw new Error('当前终端环境探测失败')
  }
  return parseOperationsDiscoveryOutput(output, nonce)
}

function createStorageAdapter () {
  return {
    read: key => ls.safeGetItemJSON(key, []),
    write: (value, key) => ls.safeSetItemJSON(key, value)
  }
}

function taskMatchesActiveIncident (store, task) {
  const incident = store.activeIncident
  if (!incident?.id || !task?.endpoint) return false
  const endpointRefs = new Set([
    task.endpoint.tabId,
    task.endpoint.bookmarkId
  ].filter(Boolean).map(String))
  if (!endpointRefs.size) return false
  if (endpointRefs.has(String(incident.endpointRef || ''))) return true
  return (incident.sessionRefs || [])
    .some(reference => endpointRefs.has(String(reference)))
}

function captureCompletedOperationsTask (store, task) {
  if (!finalOperationsTaskStatuses.has(task?.status)) return
  const candidate = createOperationsIncidentCandidate(task)
  if (candidate) store.captureIncidentCandidateSafely(candidate)
  if (taskMatchesActiveIncident(store, task)) {
    store.appendIncidentTimelineEvent(
      store.activeIncident.id,
      createOperationsTimelineEvent(task)
    ).catch(() => {})
  }
}

function createRuntime (store) {
  const taskStore = createOperationsTaskRecordStore({
    storage: createStorageAdapter(),
    storageKey: historyStorageKey
  })
  const channel = createPtyTaskChannel({
    getTerminal: tabId => refs.get('term-' + tabId)
  })
  const runner = createOperationsTaskRunner({
    channel,
    taskStore,
    onTaskChange: task => {
      const current = store.operationsTasks.filter(item => item.id !== task.id)
      store.operationsTasks = [task, ...current]
      captureCompletedOperationsTask(store, task)
    },
    discover: executeOperationsDiscoveryThroughPty
  })
  store.operationsHistory = taskStore.list()
  return { runner, taskStore }
}

export default Store => {
  let runtime = null
  const ensureRuntime = store => {
    if (!runtime) runtime = createRuntime(store)
    return runtime
  }

  Store.prototype.openOperationsToolkit = function (tab = 'quick') {
    window.store.operationsToolkitTab = tab
    window.store.openQuickCommandBar = true
  }

  Store.prototype.closeOperationsToolkit = function () {
    ls.setItem(pinnedQuickCommandBarKey, 'n')
    window.store.pinnedQuickCommandBar = false
    window.store.openQuickCommandBar = false
  }

  Store.prototype.runOperationsTool = function (
    toolId,
    params = {},
    options = {}
  ) {
    const store = window.store
    const endpoint = options.endpoint || resolveCurrentEndpoint()
    if (!endpoint) throw new Error('连接 SSH 服务器后才可执行运维工具')
    const tool = getOperationsTool(toolId)
    if (!tool) throw new Error('未找到指定的运维工具')
    const active = ensureRuntime(store).runner.run({
      tool,
      params,
      endpoint,
      confirmation: options.confirmation
    })
    store.activeOperationsTaskId = active.taskId
    const completion = active.completion.then(task => {
      store.operationsHistory = ensureRuntime(store).taskStore.list()
      return task
    })
    return { ...active, completion }
  }

  Store.prototype.refreshOperationsCapabilities = async function () {
    const store = window.store
    const endpoint = resolveCurrentEndpoint()
    if (!endpoint) {
      store.operationsCapabilities = null
      store.operationsCapabilitiesEndpointKey = ''
      store.operationsDiscoveryStatus = 'disconnected'
      return null
    }
    store.operationsDiscoveryStatus = 'loading'
    store.operationsDiscoveryError = ''
    try {
      const capabilities = await previewOperationsCapabilities(endpoint)
      store.operationsCapabilities = capabilities
      store.operationsCapabilitiesEndpointKey =
        `${endpoint.connectionUsername}@${endpoint.host}:${endpoint.port}`
      store.operationsDiscoveryStatus = 'ready'
      return capabilities
    } catch (error) {
      store.operationsCapabilities = null
      store.operationsDiscoveryStatus = 'failed'
      store.operationsDiscoveryError = String(error?.message || error)
      throw error
    }
  }

  Store.prototype.cancelOperationsTask = async function (taskId) {
    if (!runtime) return false
    const cancelled = await runtime.runner.cancel(taskId)
    window.store.operationsHistory = runtime.taskStore.list()
    return cancelled
  }

  Store.prototype.clearOperationsHistory = function () {
    const store = window.store
    ensureRuntime(store).taskStore.clear()
    store.operationsHistory = []
  }

  Store.prototype.getCurrentOperationsEndpoint = resolveCurrentEndpoint
}
