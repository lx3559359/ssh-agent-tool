import * as ls from '../common/safe-local-storage'
import { refs } from '../components/common/ref'
import {
  cancelRunCmd,
  runCmd
} from '../components/terminal/terminal-apis.js'
import {
  buildOperationsDiscoveryCommand,
  parseOperationsDiscoveryOutput
} from '../components/operations-toolkit/shared/capability-discovery.js'
import { getOperationsTool } from '../components/operations-toolkit/catalog/index.js'
import { createOperationsTaskRecordStore } from '../components/operations-toolkit/runtime/task-record-store.js'
import { createSshTaskChannel } from '../components/operations-toolkit/runtime/ssh-task-channel.js'
import { createOperationsTaskRunner } from '../components/operations-toolkit/runtime/task-runner.js'

const historyStorageKey = 'shellpilot-operations-task-history-v1'

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
  if (!endpointsMatch(tab, terminal.props?.tab || {})) return null
  return {
    tabId: tab.id,
    pid: terminal.pid,
    host: tab.host,
    port: Number(tab.port || 22),
    username: endpointUser(tab),
    title: tab.title || tab.name || tab.host
  }
}

function createStorageAdapter () {
  return {
    read: key => ls.safeGetItemJSON(key, []),
    write: (value, key) => ls.safeSetItemJSON(key, value)
  }
}

function createRuntime (store) {
  const taskStore = createOperationsTaskRecordStore({
    storage: createStorageAdapter(),
    storageKey: historyStorageKey
  })
  const channel = createSshTaskChannel({ runCmd, cancelRunCmd })
  const runner = createOperationsTaskRunner({
    channel,
    taskStore,
    onTaskChange: task => {
      const current = store.operationsTasks.filter(item => item.id !== task.id)
      store.operationsTasks = [task, ...current]
    },
    discover: async endpoint => {
      const nonce = `ops${Date.now()}${Math.random().toString(36).slice(2)}`
      const command = buildOperationsDiscoveryCommand(nonce)
      const response = await runCmd(endpoint.pid, command, {
        timeoutMs: 30000,
        maxOutputBytes: 1024 * 1024
      })
      return parseOperationsDiscoveryOutput(response?.stdout || '', nonce)
    }
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
    const active = ensureRuntime(store).runner.run({ tool, params, endpoint })
    store.activeOperationsTaskId = active.taskId
    active.completion.then(() => {
      store.operationsHistory = ensureRuntime(store).taskStore.list()
    })
    return active
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
