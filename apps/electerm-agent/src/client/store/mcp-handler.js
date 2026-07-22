/**
 * MCP (Model Context Protocol) handler for store
 * Handles IPC requests from the MCP server widget
 */

import uid from '../common/uid'
import { settingMap } from '../common/constants'
import { refs, refsStatic, refsTabs, refsTransfers } from '../components/common/ref'
import { runCmd } from '../components/terminal/terminal-apis'
import deepCopy from 'json-deep-copy'
import {
  getLocalFileInfo,
  getRemoteFileInfo,
  getFolderFromFilePath
} from '../components/sftp/file-read'
import {
  fixBookmarkData,
  validateBookmarkData
} from '../components/bookmark-form/fix-bookmark-default'
import newTerm from '../common/new-terminal'
import {
  runZmodemDownloadSafety,
  runZmodemUploadSafety
} from './mcp-zmodem-safety.js'
import { createBackgroundTaskRegistry } from '../common/safety-transactions/background-task-registry.js'
import { decodeUtf8Chunk } from '../common/utf8-chunk.js'
import { paginateAgentList } from '../common/agent-pagination.js'
import {
  assertSessionResourceTabId,
  filterSessionResourcesByTabId
} from '../common/session-resource-guard.js'
import {
  buildTransferSafetyPlan,
  captureLocalTransferSource,
  verifyLocalTransferSource
} from '../components/file-transfer/file-transfer-safety.js'

function mcpAbortError (message = 'MCP operation cancelled') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function assertMcpActive (signal, message) {
  if (signal?.aborted) throw mcpAbortError(message)
}

function abortableDelay (milliseconds, signal, message) {
  assertMcpActive(signal, message)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    function done () {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted () {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      reject(mcpAbortError(message))
    }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

function abortableMcpOperation (operation, signal, message) {
  assertMcpActive(signal, message)
  const pending = Promise.resolve(operation)
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', aborted)
    function aborted () {
      if (settled) return
      settled = true
      cleanup()
      reject(mcpAbortError(message))
    }
    signal.addEventListener('abort', aborted, { once: true })
    pending.then(value => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
  })
}

export default Store => {
  // Initialize MCP handler - called when MCP widget is started
  Store.prototype.initMcpHandler = function () {
    const { ipcOnEvent } = window.pre
    // Listen for MCP requests from main process
    ipcOnEvent('mcp-request', (event, request) => {
      const { requestId, action, data } = request
      if (action === 'tool-call') {
        window.store.handleMcpToolCall(requestId, data.toolName, data.args)
      }
    })
  }

  // Handle individual tool calls
  Store.prototype.handleMcpToolCall = async function (requestId, toolName, args) {
    const { store } = window

    try {
      let result

      switch (toolName) {
        // Bookmark operations
        case 'list_bookmarks':
          result = store.mcpListBookmarks(args)
          break
        case 'get_bookmark':
          result = store.mcpGetBookmark(args)
          break
        case 'add_bookmark':
          result = await store.mcpAddBookmark(args)
          break
        case 'edit_bookmark':
          result = store.mcpEditBookmark(args)
          break
        case 'delete_bookmark':
          result = store.mcpDeleteBookmark(args)
          break
        case 'open_bookmark':
          result = store.mcpOpenBookmark(args)
          break

        // Bookmark group operations
        case 'list_bookmark_groups':
          result = store.mcpListBookmarkGroups()
          break
        case 'add_bookmark_group':
          result = await store.mcpAddBookmarkGroup(args)
          break
        /*
        case 'list_quick_commands':
          result = store.mcpListQuickCommands()
          break
        case 'add_quick_command':
          result = store.mcpAddQuickCommand(args)
          break
        case 'run_quick_command':
          result = store.mcpRunQuickCommand(args)
          break
        case 'delete_quick_command':
          result = store.mcpDeleteQuickCommand(args)
          break
          */
        // Tab operations
        case 'list_tabs':
          result = store.mcpListTabs()
          break
        case 'get_active_tab':
          result = store.mcpGetActiveTab()
          break
        case 'switch_tab':
          result = store.mcpSwitchTab(args)
          break
        case 'close_tab':
          result = store.mcpCloseTab(args)
          break
        case 'reload_tab':
          result = store.mcpReloadTab(args)
          break
        case 'duplicate_tab':
          result = store.mcpDuplicateTab(args)
          break
        case 'open_local_terminal':
          result = store.mcpOpenLocalTerminal()
          break
        case 'open_tab':
          result = store.mcpOpenTab(args)
          break

        // Terminal operations
        case 'send_terminal_command':
          result = await store.mcpSendTerminalCommand(args)
          break
        case 'get_terminal_selection':
          result = store.mcpGetTerminalSelection(args)
          break
        case 'get_terminal_output':
          result = store.mcpGetTerminalOutput(args)
          break
        case 'wait_for_terminal_idle':
          result = await store.mcpWaitForTerminalIdle(args)
          break
        case 'get_terminal_status':
          result = store.mcpGetTerminalStatus(args)
          break
        case 'cancel_terminal_command':
          result = await store.mcpCancelTerminalCommand(args)
          break

        // Background task operations
        case 'run_background_command':
          result = await store.mcpRunBackgroundCommand(args)
          break
        case 'get_background_task_status':
          result = await store.mcpGetBackgroundTaskStatus(args)
          break
        case 'get_background_task_log':
          result = await store.mcpGetBackgroundTaskLog(args)
          break
        case 'cancel_background_task':
          result = await store.mcpCancelBackgroundTask(args)
          break

        // SFTP operations
        case 'sftp_list':
          result = await store.mcpSftpList(args)
          break
        case 'sftp_del':
          result = await store.mcpSftpDel(args)
          break
        case 'sftp_stat':
          result = await store.mcpSftpStat(args)
          break
        case 'sftp_read_file':
          result = await store.mcpSftpReadFile(args)
          break

        // File transfer operations
        case 'sftp_upload':
          result = await store.mcpSftpUpload(args)
          break
        case 'sftp_download':
          result = await store.mcpSftpDownload(args)
          break

        // Transfer list/history operations
        case 'sftp_transfer_list':
          result = store.mcpSftpTransferList()
          break
        case 'sftp_transfer_history':
          result = store.mcpSftpTransferHistory()
          break

        // Zmodem (trzsz/rzsz) operations
        case 'zmodem_upload':
          result = await store.mcpZmodemUpload(args)
          break
        case 'zmodem_download':
          result = await store.mcpZmodemDownload(args)
          break

        // Settings operations
        case 'get_settings':
          result = store.mcpGetSettings()
          break

        default:
          throw new Error(`Unknown tool: ${toolName}`)
      }

      window.api.sendMcpResponse({
        requestId,
        result
      })
    } catch (error) {
      window.api.sendMcpResponse({
        requestId,
        error: error.message
      })
    }
  }

  // ==================== Bookmark APIs ====================

  const bookmarkSensitiveFields = [
    'password', 'privateKey', 'passphrase', 'certificate', 'proxy',
    'connectionHoppings', 'sshTunnels'
  ]
  const bookmarkFeatureFields = [
    'connectionHoppings', 'sshTunnels', 'quickCommands', 'runScripts'
  ]

  function sanitizeBookmark (b) {
    const safe = Object.fromEntries(
      Object.entries(b).filter(([k]) => !bookmarkSensitiveFields.includes(k))
    )
    for (const key of bookmarkFeatureFields) {
      if (Array.isArray(b[key]) && b[key].length) {
        safe[`has${key.charAt(0).toUpperCase() + key.slice(1)}`] = true
      }
    }
    return safe
  }

  Store.prototype.mcpListBookmarks = function () {
    return deepCopy(window.store.bookmarks).map(sanitizeBookmark)
  }

  Store.prototype.mcpGetBookmark = function (args) {
    const { store } = window
    const bookmark = store.bookmarks.find(b => b.id === args.id)
    if (!bookmark) {
      throw new Error(`Bookmark not found: ${args.id}`)
    }
    return deepCopy(sanitizeBookmark(bookmark))
  }

  Store.prototype.mcpAddBookmark = async function (args) {
    const { store } = window
    const bookmark = fixBookmarkData({
      id: uid(),
      ...args
    })

    const { valid, errors } = validateBookmarkData(bookmark)
    if (!valid) {
      throw new Error(errors.join(', '))
    }

    store.addItem(bookmark, settingMap.bookmarks)

    return {
      success: true,
      id: bookmark.id,
      message: `Bookmark "${bookmark.title}" created`
    }
  }

  Store.prototype.mcpEditBookmark = function (args) {
    const { store } = window
    const { id, updates } = args

    const bookmark = store.bookmarks.find(b => b.id === id)
    if (!bookmark) {
      throw new Error(`Bookmark not found: ${id}`)
    }

    store.editItem(id, updates, settingMap.bookmarks)

    return {
      success: true,
      message: `Bookmark "${bookmark.title}" updated`
    }
  }

  Store.prototype.mcpDeleteBookmark = function (args) {
    const { store } = window
    store.delBookmark({ id: args.id })

    return {
      success: true,
      message: `Bookmark "${args.id}" deleted`
    }
  }

  Store.prototype.mcpOpenBookmark = function (args) {
    const { store } = window
    const bookmark = store.bookmarks.find(b => b.id === args.id)
    if (!bookmark) {
      throw new Error(`Bookmark not found: ${args.id}`)
    }

    store.onSelectBookmark(args.id)

    return {
      success: true,
      message: `Opened bookmark "${bookmark.title}"`
    }
  }

  // ==================== Bookmark Group APIs ====================

  Store.prototype.mcpListBookmarkGroups = function () {
    return deepCopy(window.store.bookmarkGroups)
  }

  Store.prototype.mcpAddBookmarkGroup = async function (args) {
    const { store } = window
    const group = {
      id: uid(),
      title: args.title,
      bookmarkIds: [],
      bookmarkGroupIds: [],
      level: args.parentId ? 2 : 1
    }

    await store.addBookmarkGroup(group)

    return {
      success: true,
      id: group.id,
      message: `Bookmark group "${group.title}" created`
    }
  }

  // ==================== Quick Command APIs ====================

  // Store.prototype.mcpListQuickCommands = function () {
  //   return deepCopy(window.store.quickCommands)
  // }

  // Store.prototype.mcpAddQuickCommand = function (args) {
  //   const { store } = window
  //   const qm = {
  //     id: uid(),
  //     name: args.name,
  //     commands: args.commands,
  //     inputOnly: args.inputOnly || false,
  //     labels: args.labels || []
  //   }

  //   store.addQuickCommand(qm)

  //   return {
  //     success: true,
  //     id: qm.id,
  //     message: `Quick command "${qm.name}" created`
  //   }
  // }

  // Store.prototype.mcpRunQuickCommand = function (args) {
  //   const { store } = window
  //   const qm = store.quickCommands.find(q => q.id === args.id)
  //   if (!qm) {
  //     throw new Error(`Quick command not found: ${args.id}`)
  //   }

  //   store.runQuickCommandItem(args.id)

  //   return {
  //     success: true,
  //     message: `Executed quick command "${qm.name}"`
  //   }
  // }

  // Store.prototype.mcpDeleteQuickCommand = function (args) {
  //   const { store } = window
  //   const qm = store.quickCommands.find(q => q.id === args.id)
  //   if (!qm) {
  //     throw new Error(`Quick command not found: ${args.id}`)
  //   }

  //   store.delQuickCommand({ id: args.id })

  //   return {
  //     success: true,
  //     message: `Deleted quick command "${qm.name}"`
  //   }
  // }

  // ==================== Tab APIs ====================

  Store.prototype.mcpListTabs = function () {
    const { store } = window
    return store.tabs.map(t => {
      return {
        id: t.id,
        title: t.title,
        host: t.host,
        type: t.type || 'local',
        status: t.status,
        isTransporting: t.isTransporting,
        onData: refsTabs.get('tab-' + t.id)?.state.terminalOnData,
        batch: t.batch
      }
    })
  }

  Store.prototype.mcpGetActiveTab = function () {
    const { store } = window
    const tab = store.currentTab
    if (!tab) {
      return { activeTabId: null, tab: null }
    }
    return {
      activeTabId: store.activeTabId,
      tab: {
        id: tab.id,
        title: tab.title,
        host: tab.host,
        type: tab.type || 'local',
        status: tab.status
      }
    }
  }

  Store.prototype.mcpSwitchTab = function (args) {
    const { store } = window
    const tab = store.changeActiveTabId(args.tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${args.tabId}`)
    }

    return {
      success: true,
      message: `Switched to tab "${tab.title}"`
    }
  }

  Store.prototype.mcpCloseTab = function (args) {
    const { store } = window
    const tab = store.tabs.find(t => t.id === args.tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${args.tabId}`)
    }

    store.delTab(args.tabId)

    return {
      success: true,
      message: `Closed tab "${tab.title}"`
    }
  }

  Store.prototype.mcpReloadTab = function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    const tab = store.tabs.find(t => t.id === tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${tabId}`)
    }

    store.reloadTab(tabId)

    return {
      success: true,
      message: `Reloaded tab "${tab.title}"`
    }
  }

  Store.prototype.mcpDuplicateTab = function (args) {
    const { store } = window
    const tab = store.tabs.find(t => t.id === args.tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${args.tabId}`)
    }

    store.duplicateTab(args.tabId)

    return {
      success: true,
      message: `Duplicated tab "${tab.title}"`
    }
  }

  Store.prototype.mcpOpenLocalTerminal = function () {
    const { store } = window
    store.addTab()
    const newTabId = store.activeTabId

    return {
      success: true,
      tabId: newTabId,
      message: 'Opened new local terminal'
    }
  }

  Store.prototype.mcpOpenTab = function (args) {
    const { store } = window
    const data = fixBookmarkData({ ...args })

    const { valid, errors } = validateBookmarkData(data)
    if (!valid) {
      throw new Error(errors.join(', '))
    }

    const tab = {
      ...data,
      from: 'mcp',
      ...newTerm(true, true)
    }

    store.addTab(tab)
    const newTabId = store.activeTabId

    return {
      success: true,
      tabId: newTabId,
      type: data.type,
      message: `Opened ${data.type || 'local'} tab`
    }
  }

  // ==================== Terminal APIs ====================

  Store.prototype.mcpSendTerminalCommand = async function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    const command = args.command

    if (!tabId) {
      throw new Error('No active terminal')
    }

    if (command === undefined || command === null) {
      throw new Error('No command provided')
    }

    const safetyResult = await store.runSafetyCommand(command, {
      tabId,
      inputOnly: args.inputOnly === true,
      source: 'agent',
      title: args.title || 'MCP 终端命令'
    })

    return {
      success: safetyResult?.sent === true || safetyResult?.inputOnly === true,
      cancelled: safetyResult?.cancelled === true,
      operationId: safetyResult?.operationId,
      message: safetyResult?.cancelled
        ? '用户取消了安全确认，命令尚未发送。'
        : safetyResult?.inputOnly
          ? '命令已填入终端，尚未执行。'
          : '命令已安全发送到终端。'
    }
  }

  Store.prototype.mcpGetTerminalSelection = function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId

    if (!tabId) {
      throw new Error('No active terminal')
    }

    const term = refs.get('term-' + tabId)
    if (!term || !term.term) {
      throw new Error('Terminal not found')
    }

    const selection = term.term.getSelection()

    return {
      selection: selection || '',
      tabId
    }
  }

  Store.prototype.mcpGetTerminalOutput = function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    const lineCount = args.lines || 50

    if (!tabId) {
      throw new Error('No active terminal')
    }

    const term = refs.get('term-' + tabId)
    if (!term || !term.term) {
      throw new Error('Terminal not found')
    }

    const buffer = term.term.buffer.active
    if (!buffer) {
      throw new Error('Terminal buffer not available')
    }

    const cursorY = buffer.cursorY || 0
    const baseY = buffer.baseY || 0
    const totalLines = buffer.length || 0

    // Calculate the actual content range
    // baseY is the scroll offset, cursorY is cursor position in viewport
    const actualContentEnd = baseY + cursorY + 1
    const startLine = Math.max(0, actualContentEnd - lineCount)
    const endLine = Math.min(totalLines, actualContentEnd)
    const lines = []

    for (let i = startLine; i < endLine; i++) {
      const line = buffer.getLine(i)
      if (line) {
        const text = line.translateToString(true)
        lines.push(text)
      }
    }

    return {
      output: lines.join('\n'),
      lineCount: lines.length,
      cursorY,
      baseY,
      tabId
    }
  }

  Store.prototype.mcpWaitForTerminalIdle = async function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    const timeout = Math.min(args.timeout || 30000, 120000)
    const pollInterval = 500
    const minWait = args.minWait !== undefined ? args.minWait : 1000
    const lineCountToFetch = args.lines || 50
    const signal = args.signal

    if (!tabId) {
      throw new Error('No active terminal')
    }
    assertMcpActive(signal, 'Terminal wait cancelled')

    const start = Date.now()

    // Brief initial wait so the command has time to start producing output
    if (minWait > 0) {
      await abortableDelay(minWait, signal, 'Terminal wait cancelled')
    }

    const collectOutput = () => {
      const term = refs.get('term-' + tabId)
      if (!term || !term.term) return { output: '', lineCount: 0 }
      const buffer = term.term.buffer.active
      if (!buffer) return { output: '', lineCount: 0 }
      const cursorY = buffer.cursorY || 0
      const baseY = buffer.baseY || 0
      const totalLines = buffer.length || 0
      const actualContentEnd = baseY + cursorY + 1
      const startLine = Math.max(0, actualContentEnd - lineCountToFetch)
      const endLine = Math.min(totalLines, actualContentEnd)
      const lines = []
      for (let i = startLine; i < endLine; i++) {
        const line = buffer.getLine(i)
        if (line) lines.push(line.translateToString(true))
      }
      return { output: lines.join('\n'), lineCount: lines.length }
    }

    // Poll until onData becomes false (4s idle debounce in tab.jsx)
    while (Date.now() - start < timeout) {
      assertMcpActive(signal, 'Terminal wait cancelled')
      const tabRef = refsTabs.get('tab-' + tabId)
      const onData = tabRef?.state.terminalOnData
      if (!onData) {
        const { output, lineCount } = collectOutput()
        return {
          tabId,
          elapsed: Date.now() - start,
          timedOut: false,
          output,
          lineCount
        }
      }
      await abortableDelay(pollInterval, signal, 'Terminal wait cancelled')
    }

    // Timeout reached — return whatever is currently in the buffer
    const { output, lineCount } = collectOutput()
    return {
      tabId,
      elapsed: Date.now() - start,
      timedOut: true,
      message: `Terminal still active after ${timeout}ms`,
      output,
      lineCount
    }
  }

  // ==================== Terminal Status & Cancel ====================

  Store.prototype.mcpGetTerminalStatus = function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    if (!tabId) {
      throw new Error('No active terminal')
    }

    const tabRef = refsTabs.get('tab-' + tabId)
    const onData = tabRef?.state.terminalOnData || ''
    const term = refs.get('term-' + tabId)

    let output = ''
    let lineCount = 0
    if (term && term.term) {
      const buffer = term.term.buffer.active
      if (buffer) {
        const lines = []
        const cursorY = buffer.cursorY || 0
        const baseY = buffer.baseY || 0
        const totalLines = buffer.length || 0
        const end = baseY + cursorY + 1
        const start = Math.max(0, end - 20)
        for (let i = start; i < Math.min(totalLines, end); i++) {
          const line = buffer.getLine(i)
          if (line) {
            lines.push(line.translateToString(true))
          }
        }
        output = lines.join('\n')
        lineCount = lines.length
      }
    }

    return {
      tabId,
      isRunning: onData === 'feed',
      hasPasswordPrompt: onData === 'password',
      isIdle: !onData,
      output,
      lineCount
    }
  }

  Store.prototype.mcpCancelTerminalCommand = async function (args) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    if (!tabId) {
      throw new Error('No active terminal')
    }

    const term = refs.get('term-' + tabId)
    if (!term || !term.attachAddon) {
      throw new Error('Terminal not found')
    }

    const transactionCancelled = typeof term.commandSafetyEntrypoint
      ?.cancelForegroundExecutionById === 'function'
      ? await term.commandSafetyEntrypoint.cancelForegroundExecutionById(
        args.operationId,
        () => term.attachAddon._sendData('\x03'),
        'Agent sent Ctrl+C'
      )
      : false
    if (transactionCancelled !== true) {
      return {
        success: false,
        stopConfirmed: false,
        remoteState: 'not-dispatched',
        message: 'The requested safety operation is not the active foreground command',
        tabId,
        operationId: args.operationId
      }
    }
    const idle = await store.mcpWaitForTerminalIdle({
      tabId,
      timeout: 6000,
      minWait: 300,
      lines: 20
    })
    const stopConfirmed = idle.timedOut === false && transactionCancelled === true
    return {
      success: stopConfirmed,
      stopConfirmed,
      remoteState: stopConfirmed ? 'stopped' : 'unknown',
      message: stopConfirmed
        ? 'Sent Ctrl+C and confirmed terminal idle'
        : 'Sent Ctrl+C but terminal stop could not be confirmed',
      tabId,
      operationId: args.operationId
    }
  }

  // ==================== Background Task Management ====================

  async function runMonitorCmd (tabId, cmd) {
    const term = refs.get('term-' + tabId)
    if (!term?.pid) throw new Error('后台任务终端会话已失效。')
    const result = await runCmd(term.pid, cmd, {
      timeoutMs: 5000,
      maxOutputBytes: 4096
    })
    if (typeof result === 'string') return result
    return result?.stdout || result?.output || ''
  }

  function requireBackgroundPath (value) {
    const path = String(value || '')
    if (!/^\/tmp\/shellpilot-bg-[a-zA-Z0-9_-]+\.(?:pid|exit|log)$/.test(path)) {
      throw new Error('后台任务监控路径无效。')
    }
    return `'${path}'`
  }

  const backgroundTasks = createBackgroundTaskRegistry({
    readFile: (tabId, path) => runMonitorCmd(
      tabId,
      `cat -- ${requireBackgroundPath(path)} 2>/dev/null || true`
    ),
    isAlive: async (tabId, pid) => {
      const output = await runMonitorCmd(
        tabId,
        `kill -0 -- ${pid} 2>/dev/null && printf alive || printf dead`
      )
      return output.trim() === 'alive'
    },
    kill: async (tabId, pid) => {
      const output = await runMonitorCmd(
        tabId,
        `if kill -- ${pid} 2>/dev/null; then printf killed; else printf failed; fi`
      )
      return output.trim() === 'killed'
    }
  })

  function assertBackgroundTaskSession (taskId, tabId) {
    const task = backgroundTasks.get(taskId)
    if (task && tabId) assertSessionResourceTabId(task, tabId)
    return task
  }

  Store.prototype.mcpRunBackgroundCommand = async function (args, options = {}) {
    const { store } = window
    const tabId = args.tabId || store.activeTabId
    if (!tabId) {
      throw new Error('No active terminal')
    }
    if (!args.command) {
      throw new Error('No command provided')
    }
    assertMcpActive(options.signal, 'Background command cancelled')

    const submission = await store.runSafetyCommand(args.command, {
      tabId,
      ...(options.signal ? { signal: options.signal } : {}),
      source: 'agent',
      title: '后台命令',
      executionMode: 'background',
      backgroundFinalizationRetry: true,
      ...(options.riskDelegation
        ? { riskDelegation: options.riskDelegation }
        : {})
    })
    if (options.signal?.aborted && submission.sent) {
      let cancelled = false
      try {
        cancelled = await submission.cancelBackground?.(
          'Agent background command cancelled after dispatch'
        ) === true
      } catch {
        cancelled = false
      }
      const error = mcpAbortError('Background command cancelled after dispatch')
      error.mutationDispatched = true
      error.remoteState = cancelled ? 'stopped' : 'unknown'
      error.canAutoRetry = false
      throw error
    }
    assertMcpActive(options.signal, 'Background command cancelled')
    if (!submission.sent) {
      return {
        success: false,
        cancelled: submission.cancelled === true,
        retryable: submission.retryable === true,
        operationId: submission.operationId,
        message: submission.error || '后台命令尚未发送。'
      }
    }

    const {
      taskId,
      logFile,
      pidFile,
      exitFile
    } = submission.execution.metadata

    const task = backgroundTasks.register({
      id: taskId,
      operationId: submission.operationId,
      command: args.command,
      tabId,
      startTime: Date.now(),
      logFile,
      pidFile,
      exitFile,
      finalize: submission.finalizeBackground,
      cancel: submission.cancelBackground,
      completion: submission.completion,
      onTerminal: options.onTerminal
    })

    return {
      pending: true,
      taskId,
      tabId,
      logFile,
      pidFile,
      exitFile,
      operationId: task.operationId,
      message: '后台命令已启动，可查询后台任务状态。'
    }
  }

  Store.prototype.mcpGetBackgroundTaskStatus = async function (args) {
    assertBackgroundTaskSession(args.taskId, args.tabId)
    return backgroundTasks.status(args.taskId)
  }

  Store.prototype.mcpGetBackgroundTaskLog = async function (args) {
    const task = assertBackgroundTaskSession(args.taskId, args.tabId)
    if (!task) {
      return {
        taskId: args.taskId,
        status: 'unknown',
        interrupted: true,
        output: '',
        message: '后台任务上下文已丢失，无法读取日志。'
      }
    }

    const lines = Number(args.lines || 100)
    if (!Number.isInteger(lines) || lines < 1 || lines > 10000) {
      throw new Error('后台日志行数必须是 1 到 10000 的整数。')
    }
    const output = await runMonitorCmd(task.tabId,
      `tail -n ${lines} -- ${requireBackgroundPath(task.logFile)} 2>/dev/null || true`)

    return {
      taskId: task.id,
      output: output.trim(),
      lines
    }
  }

  Store.prototype.mcpCancelBackgroundTask = async function (args) {
    assertBackgroundTaskSession(args.taskId, args.tabId)
    return backgroundTasks.cancel(args.taskId)
  }

  // ==================== Settings APIs ====================

  Store.prototype.mcpGetSettings = function () {
    const { store } = window
    // Return safe settings (no sensitive data)
    const config = store.config
    const excludeKeys = ['apiKeyAI', 'syncSetting']
    const safeConfig = Object.fromEntries(
      Object.entries(config).filter(([key]) => !excludeKeys.includes(key))
    )
    return safeConfig
  }

  // ==================== SFTP APIs ====================

  Store.prototype.mcpGetSshSftpRef = function (tabId) {
    const { store } = window
    const resolvedTabId = tabId || store.activeTabId
    if (!resolvedTabId) {
      throw new Error('No active tab')
    }
    const tab = store.tabs.find(t => t.id === resolvedTabId)
    if (!tab) {
      throw new Error(`Tab not found: ${resolvedTabId}`)
    }
    if (tab.type !== 'ssh' && tab.type !== 'ftp') {
      throw new Error(`Tab "${resolvedTabId}" is not an SSH/SFTP tab (type: ${tab.type || 'local'})`)
    }
    const sftpEntry = refs.get('sftp-' + resolvedTabId)
    if (!sftpEntry || !sftpEntry.sftp) {
      throw new Error(`SFTP not initialized for tab "${resolvedTabId}". Open the SFTP panel first.`)
    }
    return { sftp: sftpEntry.sftp, sftpEntry, tab, tabId: resolvedTabId }
  }

  Store.prototype.mcpSftpList = async function (args) {
    const { sftp, tab, tabId } = window.store.mcpGetSshSftpRef(args.tabId)
    const remotePath = args.remotePath
    if (!remotePath) {
      throw new Error('remotePath is required')
    }
    const list = await sftp.list(remotePath)
    const ordered = [...list].sort((left, right) => (
      String(left?.name || '').localeCompare(String(right?.name || ''))
    ))
    const page = paginateAgentList(ordered, {
      cursor: args.cursor,
      limit: args.limit,
      maxBytes: args.maxBytes
    })
    return {
      tabId,
      host: tab.host,
      path: remotePath,
      list: page.items,
      cursor: String(page.cursor),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total: page.total
    }
  }

  Store.prototype.mcpSftpStat = async function (args) {
    const { sftp, tab, tabId } = window.store.mcpGetSshSftpRef(args.tabId)
    const remotePath = args.remotePath
    if (!remotePath) {
      throw new Error('remotePath is required')
    }
    const stat = await sftp.stat(remotePath)
    return { tabId, host: tab.host, path: remotePath, stat }
  }

  Store.prototype.mcpSftpReadFile = async function (args, options = {}) {
    assertMcpActive(options.signal, 'SFTP file read cancelled')
    const { sftp, tab, tabId } = window.store.mcpGetSshSftpRef(args.tabId)
    const remotePath = args.remotePath
    if (!remotePath) {
      throw new Error('remotePath is required')
    }
    const requestedMaxBytes = Number(args.maxBytes)
    const maxBytes = Number.isSafeInteger(requestedMaxBytes) && requestedMaxBytes > 0
      ? Math.max(4, Math.min(requestedMaxBytes, 32 * 1024))
      : 32 * 1024
    const requestedOffset = Number(args.offset)
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0
    const chunk = await abortableMcpOperation(
      sftp.readFileChunk(remotePath, { offset, maxBytes }),
      options.signal,
      'SFTP file read cancelled'
    )
    assertMcpActive(options.signal, 'SFTP file read cancelled')
    let current
    try {
      current = window.store.mcpGetSshSftpRef(args.tabId)
    } catch (cause) {
      const error = new Error('SFTP session endpoint changed during file read')
      error.code = 'SESSION_ENDPOINT_CHANGED'
      error.cause = cause
      throw error
    }
    if (current.sftp !== sftp || current.tabId !== tabId) {
      const error = new Error('SFTP session endpoint changed during file read')
      error.code = 'SESSION_ENDPOINT_CHANGED'
      throw error
    }
    const binary = globalThis.atob(String(chunk.base64 || ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    const decoded = decodeUtf8Chunk(bytes, {
      offset: chunk.offset,
      totalBytes: chunk.totalBytes,
      hasMore: chunk.hasMore
    })
    return {
      tabId,
      host: tab.host,
      path: remotePath,
      ...decoded
    }
  }

  Store.prototype.mcpSftpDel = async function (args, options = {}) {
    if (options.signal?.aborted) {
      const error = new Error('SFTP delete cancelled')
      error.name = 'AbortError'
      throw error
    }
    const { sftp, sftpEntry, tab, tabId } = window.store.mcpGetSshSftpRef(args.tabId)
    const remotePath = args.remotePath
    if (!remotePath) {
      throw new Error('remotePath is required')
    }
    // Use stat to determine if it's a file or directory
    const stat = await sftp.stat(remotePath)
    if (options.signal?.aborted) {
      const error = new Error('SFTP delete cancelled')
      error.name = 'AbortError'
      throw error
    }
    const isDirectory = typeof stat.isDirectory === 'function'
      ? stat.isDirectory()
      : !!stat.isDirectory
    const file = {
      ...getFolderFromFilePath(remotePath, true),
      type: 'remote',
      isDirectory
    }
    const success = await sftpEntry.delFiles('remote', [file], options)
    const isFtp = sftpEntry.props?.isFtp === true ||
      String(tab.type || '').toLowerCase() === 'ftp'
    const recoverable = Boolean(success && !isFtp)
    return {
      success,
      recoverable,
      tabId,
      host: tab.host,
      path: remotePath,
      type: isDirectory ? 'directory' : 'file',
      message: success
        ? recoverable
          ? '已移入 ShellPilot SFTP 安全回收区，可在安全操作中心恢复。'
          : 'FTP item was permanently deleted; no recovery snapshot exists.'
        : '用户已取消安全删除。'
    }
  }

  // ==================== File Transfer APIs ====================

  Store.prototype.mcpDescribeSftpUploadSource = async function (args, options = {}) {
    const { store } = window
    const { tab, tabId, sftpEntry } = store.mcpGetSshSftpRef(args.tabId)
    if (!args.localPath || !args.remotePath) {
      throw new Error('localPath and remotePath are required')
    }
    assertMcpActive(options.signal, 'SFTP upload source capture cancelled')
    const fromFile = await getLocalFileInfo(args.localPath)
    const transfer = {
      host: tab.host,
      tabType: tab.type || 'ssh',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: args.localPath,
      toPath: args.remotePath,
      fromFile: {
        ...fromFile,
        host: tab.host,
        tabType: tab.type || 'ssh',
        tabId
      },
      id: uid(),
      title: tab.title,
      tabId,
      conflictPolicy: args.conflictPolicy || 'mergeOrOverwriteAll',
      operation: ''
    }
    const sourceDescriptor = await captureLocalTransferSource({
      transfer,
      describeLocal: window.fs.describeTransferEntry
    })
    assertMcpActive(options.signal, 'SFTP upload source capture cancelled')
    if (options.prepareRecovery !== true) return { sourceDescriptor }
    transfer.sourceDescriptor = sourceDescriptor
    const safetyPlan = buildTransferSafetyPlan(transfer)
    const safetyOperation = safetyPlan.required
      ? await sftpEntry.prepareTransferSafetyOperation(safetyPlan)
      : null
    try {
      assertMcpActive(options.signal, 'SFTP upload recovery preparation cancelled')
    } catch (error) {
      if (safetyOperation?.id) {
        await sftpEntry.cancelTransferSafetyOperation(safetyOperation.id)
      }
      throw error
    }
    return {
      sourceDescriptor,
      preparedTransfer: {
        transferId: transfer.id,
        tabId,
        safetyOperationId: safetyOperation?.id || null
      }
    }
  }

  Store.prototype.mcpCancelPreparedSftpUpload = async function (prepared = {}) {
    if (!prepared.safetyOperationId) return false
    const { sftpEntry } = window.store.mcpGetSshSftpRef(prepared.tabId)
    await sftpEntry.cancelTransferSafetyOperation(prepared.safetyOperationId)
    return true
  }

  Store.prototype.mcpSftpUpload = async function (args, options = {}) {
    const { store } = window
    const { tab, tabId, sftpEntry } = store.mcpGetSshSftpRef(args.tabId)
    const localPath = args.localPath
    const remotePath = args.remotePath
    if (!localPath) {
      throw new Error('localPath is required')
    }
    if (!remotePath) {
      throw new Error('remotePath is required')
    }
    assertMcpActive(options.signal, 'SFTP upload cancelled')

    window._transferConflictPolicy = args.conflictPolicy || 'mergeOrOverwriteAll'

    const fromFile = await getLocalFileInfo(localPath)
    const transferItem = {
      host: tab.host,
      tabType: tab.type || 'ssh',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: localPath,
      toPath: remotePath,
      fromFile: {
        ...fromFile,
        host: tab.host,
        tabType: tab.type || 'ssh',
        tabId,
        title: tab.title
      },
      id: args.preparedTransfer?.transferId || uid(),
      title: tab.title,
      tabId,
      conflictPolicy: args.conflictPolicy || 'mergeOrOverwriteAll',
      operation: ''
    }
    transferItem.sourceDescriptor = args.sourceDescriptor ||
      await captureLocalTransferSource({
        transfer: transferItem,
        describeLocal: window.fs.describeTransferEntry
      })
    await verifyLocalTransferSource({
      transfer: transferItem,
      sourceDescriptor: transferItem.sourceDescriptor,
      describeLocal: window.fs.describeTransferEntry
    })
    if (typeof options.onTerminal === 'function') {
      Object.defineProperty(transferItem, '_agentRiskTerminal', {
        configurable: false,
        enumerable: false,
        value: options.onTerminal
      })
    }
    const safetyPlan = buildTransferSafetyPlan(transferItem)
    let safetyOperation
    if (safetyPlan.required) {
      safetyOperation = await sftpEntry.prepareTransferSafetyOperation(safetyPlan)
      if (args.preparedTransfer?.safetyOperationId &&
        safetyOperation.id !== args.preparedTransfer.safetyOperationId) {
        throw new Error('Prepared SFTP recovery operation changed before queueing')
      }
      transferItem.safetyOperationId = safetyOperation.id
    }
    if (options.signal?.aborted) {
      if (safetyOperation) {
        await sftpEntry.cancelTransferSafetyOperation(safetyOperation.id)
      }
      throw mcpAbortError('SFTP upload cancelled before queueing')
    }
    try {
      store.addTransferList([transferItem])
    } catch (error) {
      if (safetyOperation) {
        await sftpEntry.cancelTransferSafetyOperation(safetyOperation.id)
      }
      throw error
    }

    return {
      success: true,
      pending: true,
      recoveryPrepared: safetyOperation != null,
      safetyOperationId: safetyOperation?.id,
      message: `Upload started: ${localPath} → ${tab.host}:${remotePath}`,
      transferId: transferItem.id,
      tabId
    }
  }

  Store.prototype.mcpSftpDownload = async function (args, options = {}) {
    const { store } = window
    const { sftp, tab, tabId } = store.mcpGetSshSftpRef(args.tabId) // sftp used for getRemoteFileInfo
    const remotePath = args.remotePath
    const localPath = args.localPath
    if (!remotePath) {
      throw new Error('remotePath is required')
    }
    if (!localPath) {
      throw new Error('localPath is required')
    }
    assertMcpActive(options.signal, 'SFTP download cancelled')

    window._transferConflictPolicy = args.conflictPolicy || 'mergeOrOverwriteAll'

    const fromFile = await getRemoteFileInfo(sftp, remotePath)
    const transferItem = {
      host: tab.host,
      tabType: tab.type || 'ssh',
      typeFrom: 'remote',
      typeTo: 'local',
      fromPath: remotePath,
      toPath: localPath,
      fromFile: {
        ...fromFile,
        id: uid(),
        isSymbolicLink: false
      },
      id: uid(),
      title: tab.title,
      tabId,
      conflictPolicy: args.conflictPolicy || 'mergeOrOverwriteAll'
    }
    if (typeof options.onTerminal === 'function') {
      Object.defineProperty(transferItem, '_agentRiskTerminal', {
        configurable: false,
        enumerable: false,
        value: options.onTerminal
      })
    }

    assertMcpActive(options.signal, 'SFTP download cancelled before queueing')
    store.addTransferList([transferItem])

    return {
      success: true,
      pending: true,
      message: `Download started: ${tab.host}:${remotePath} → ${localPath}`,
      transferId: transferItem.id,
      tabId
    }
  }

  Store.prototype.mcpSftpCancelTransfer = async function ({
    transferId,
    tabId
  } = {}) {
    const { store } = window
    const id = String(transferId || '')
    const transfer = store.fileTransfers.find(item => item.id === id)
    if (!transfer) {
      return { success: false, transferId: id, message: 'Transfer not found' }
    }
    if (tabId) assertSessionResourceTabId(transfer, tabId)
    const transferRefId = `tr-${transfer.transferBatch || ''}-${id}`
    const activeTransfer = refsTransfers.get(transferRefId)
    const handledByActiveTransfer = typeof activeTransfer?.cancelAndWait === 'function'
    if (handledByActiveTransfer) {
      await activeTransfer.cancelAndWait()
    } else {
      const queue = refsStatic.get('transfer-queue')
      if (queue) {
        await queue.addToQueue('delete', id)
      } else {
        const index = store.fileTransfers.findIndex(item => item.id === id)
        if (index >= 0) store.fileTransfers.splice(index, 1)
      }
    }
    if (store.fileTransfers.some(item => item.id === id)) {
      throw new Error(`Transfer cancellation did not complete: ${id}`)
    }
    if (transfer.safetyOperationId && !handledByActiveTransfer) {
      const { sftpEntry } = store.mcpGetSshSftpRef(transfer.tabId)
      await sftpEntry.cancelTransferSafetyOperation(transfer.safetyOperationId)
    }
    if (!handledByActiveTransfer && typeof transfer._agentRiskTerminal === 'function') {
      await transfer._agentRiskTerminal({
        status: 'cancelled',
        remoteState: 'not-dispatched',
        transferId: id
      })
    }
    return { success: true, transferId: id }
  }

  // ==================== Transfer List/History APIs ====================

  Store.prototype.mcpSftpTransferList = function (args = {}) {
    const items = args.tabId
      ? filterSessionResourcesByTabId(window.store.fileTransfers, args.tabId)
      : window.store.fileTransfers
    return deepCopy(items)
  }

  Store.prototype.mcpSftpTransferHistory = function (args = {}) {
    const items = args.tabId
      ? filterSessionResourcesByTabId(window.store.transferHistory, args.tabId)
      : window.store.transferHistory
    return deepCopy(items)
  }

  // ==================== Zmodem (trzsz/rzsz) APIs ====================

  Store.prototype.mcpZmodemUpload = async function (args) {
    return runZmodemUploadSafety({
      store: window.store,
      args,
      setSelectedFiles: files => { window._apiControlSelectFile = files }
    })
  }

  Store.prototype.mcpZmodemDownload = async function (args) {
    return runZmodemDownloadSafety({
      store: window.store,
      args,
      setSelectedFolder: folder => { window._apiControlSelectFolder = folder }
    })
  }
}
