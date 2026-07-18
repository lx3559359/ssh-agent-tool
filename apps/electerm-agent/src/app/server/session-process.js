const { fork } = require('child_process')
const path = require('path')
const { reconstructRunCmdError } = require('./session-common')

// Active entries have completed initialization; pending entries have not.
const activeTerminals = new Map()
const pendingTerminals = new Map()
const closingTerminals = new Map()
const latestTerminalRequests = new Map()
const childEntries = new WeakMap()

let lastPort = 30975
const MIN_PORT = 30975
const MAX_PORT = 65534
const pendingPorts = new Set()
const CLOSE_TIMEOUT_MS = 1000
const FORCE_KILL_WAIT_MS = 250

function nextPort (port) {
  return port >= MAX_PORT ? MIN_PORT : port + 1
}

function releasePort (port) {
  pendingPorts.delete(port)
}

function getPort (fromPort) {
  return new Promise((resolve, reject) => {
    const probe = candidate => {
      while (pendingPorts.has(candidate)) candidate = nextPort(candidate)
      pendingPorts.add(candidate)
      require('find-free-port')(candidate, '127.0.0.1', function (err, freePort) {
        pendingPorts.delete(candidate)
        if (err) {
          reject(err)
          return
        }
        const port = Number(freePort)
        if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
          reject(new Error('Invalid free port'))
          return
        }
        if (pendingPorts.has(port)) {
          probe(nextPort(port))
          return
        }
        pendingPorts.add(port)
        lastPort = port
        resolve(port)
      })
    }
    let startPort = fromPort === undefined
      ? nextPort(lastPort)
      : Math.max(MIN_PORT, Math.min(MAX_PORT, Number(fromPort) || MIN_PORT))
    while (pendingPorts.has(startPort)) {
      startPort = nextPort(startPort)
    }
    probe(startPort)
  })
}

function rejectEntryPending (entry, error) {
  for (const rejectPending of [...entry.pending]) {
    rejectPending(error || childEndedError('exited'))
  }
  entry.pending.clear()
}

function cleanupEntry (entry) {
  for (const cleanup of entry.cleanup.splice(0)) {
    try {
      cleanup()
    } catch (caught) {}
  }
}

function beginEntryTermination (entry, error) {
  if (entry.ended || entry.terminating) return
  entry.terminating = true
  rejectEntryPending(entry, error)
  cleanupEntry(entry)
  closeEntry(entry).catch(() => {})
}

function supersededError () {
  const error = childEndedError('superseded during initialization')
  error.code = 'SESSION_SUPERSEDED'
  return error
}

function childEndedError (event, detail) {
  const suffix = detail instanceof Error && detail.message
    ? `: ${detail.message}`
    : ''
  const error = new Error(`Session child ${event}${suffix}`)
  error.code = 'SESSION_CHILD_ENDED'
  return error
}

function toError (value) {
  return reconstructRunCmdError(value, 'Session request failed')
}

function hasExited (entry) {
  const { child } = entry
  return entry.ended || (
    child.exitCode !== null && child.exitCode !== undefined
  )
}

function addPendingEntry (entry) {
  let entries = pendingTerminals.get(entry.pid)
  if (!entries) {
    entries = new Set()
    pendingTerminals.set(entry.pid, entries)
  }
  entries.add(entry)
}

function removePendingEntry (entry) {
  const entries = pendingTerminals.get(entry.pid)
  if (!entries) return
  entries.delete(entry)
  if (!entries.size) pendingTerminals.delete(entry.pid)
}

function entriesForPid (pid) {
  const entries = new Set(pendingTerminals.get(pid) || [])
  const active = activeTerminals.get(pid)
  if (active) entries.add(active)
  return [...entries]
}

function addEntryCleanup (entry, cleanup) {
  let active = true
  const dispose = () => {
    if (!active) return
    active = false
    const index = entry.cleanup.indexOf(dispose)
    if (index >= 0) entry.cleanup.splice(index, 1)
    cleanup()
  }
  entry.cleanup.push(dispose)
  return dispose
}

function finalizeEntry (entry, error) {
  if (entry.ended) return
  entry.ended = true
  rejectEntryPending(entry, error)
  cleanupEntry(entry)
  removePendingEntry(entry)
  if (activeTerminals.get(entry.pid) === entry) {
    activeTerminals.delete(entry.pid)
  }
  if (latestTerminalRequests.get(entry.pid) === entry.requestToken) {
    latestTerminalRequests.delete(entry.pid)
  }
}

function attachLifecycle (entry) {
  const { child } = entry
  const onExit = (code, signal) => {
    finalizeEntry(entry, childEndedError('exited', new Error(
      `code ${code ?? 'unknown'}, signal ${signal || 'none'}`
    )))
  }
  const onError = error => {
    beginEntryTermination(entry, childEndedError('errored', error))
  }
  const onDisconnect = () => {
    beginEntryTermination(entry, childEndedError('disconnected'))
  }
  child.on('exit', onExit)
  child.on('error', onError)
  child.on('disconnect', onDisconnect)
  entry.cleanup.push(() => {
    child.removeListener('exit', onExit)
    child.removeListener('error', onError)
    child.removeListener('disconnect', onDisconnect)
  })
}

function runSessionServer (type, port) {
  const cleanEnv = Object.assign({}, process.env)
  delete cleanEnv.ELECTRON_RUN_AS_NODE
  const child = fork(path.resolve(__dirname, './session-server.js'), {
    env: Object.assign(
      {
        wsPort: port,
        type
      },
      cleanEnv
    ),
    cwd: process.cwd()
  })
  const ready = new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      child.removeListener('message', onMessage)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      child.removeListener('disconnect', onDisconnect)
    }
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onMessage = message => {
      if (message?.serverInited) settle(resolve, child)
    }
    const onExit = () => settle(reject, childEndedError('exited before initialization'))
    const onError = error => settle(reject, childEndedError('errored before initialization', error))
    const onDisconnect = () => settle(reject, childEndedError('disconnected before initialization'))
    child.on('message', onMessage)
    child.on('exit', onExit)
    child.on('error', onError)
    child.on('disconnect', onDisconnect)
  })
  return { child, ready }
}

async function sendMsgToChildProcess (pid, msg) {
  const entry = typeof pid === 'object'
    ? childEntries.get(pid)
    : activeTerminals.get(pid)
  const child = typeof pid === 'object' ? pid : entry?.child
  if (!child || entry?.ended || entry?.terminating || child.connected === false) {
    throw new Error(`Terminal with PID ${typeof pid === 'object' ? 'unknown' : pid} not found`)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      child.removeListener('message', onMessage)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      child.removeListener('disconnect', onDisconnect)
      entry?.pending.delete(fail)
    }
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const fail = error => settle(reject, toError(error))
    const onMessage = response => {
      if (response?.id !== msg.id) return
      if (response.error) fail(response.error)
      else settle(resolve, response.data)
    }
    const onExit = () => fail(childEndedError('exited'))
    const onError = error => fail(childEndedError('errored', error))
    const onDisconnect = () => fail(childEndedError('disconnected'))
    child.on('message', onMessage)
    child.on('exit', onExit)
    child.on('error', onError)
    child.on('disconnect', onDisconnect)
    entry?.pending.add(fail)
    try {
      child.send({
        type: 'common',
        data: msg
      }, error => {
        if (error) fail(error)
      })
    } catch (error) {
      fail(error)
    }
  })
}

function attachSshBridge (entry) {
  const { child, ws } = entry
  if (!ws || entry.sshBridgeAttached) return
  entry.sshBridgeAttached = true
  const responseDisposers = new Map()
  const removeWsListener = listener => {
    if (typeof ws.removeEventListener === 'function') {
      ws.removeEventListener('message', listener)
    } else if (typeof ws.removeListener === 'function') {
      ws.removeListener('message', listener)
    }
  }
  const addWsListener = listener => {
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', listener)
      return true
    }
    if (typeof ws.on === 'function') {
      ws.on('message', listener)
      return true
    }
    return false
  }
  const parseResponse = event => {
    const value = event && Object.prototype.hasOwnProperty.call(event, 'data')
      ? event.data
      : event
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value
    try {
      return JSON.parse(String(value))
    } catch (error) {
      return null
    }
  }
  const onMessage = message => {
    const { type, data } = message || {}
    if (type !== 'common') return
    const responseId = data?.id
    responseDisposers.get(responseId)?.()
    let dispose
    const onResponse = event => {
      const response = parseResponse(event)
      if (!response || response.id !== responseId) return
      dispose()
      if (entry.ended || child.connected === false) return
      try {
        child.send(response)
      } catch (error) {}
    }
    if (addWsListener(onResponse)) {
      dispose = addEntryCleanup(entry, () => {
        removeWsListener(onResponse)
        if (responseDisposers.get(responseId) === dispose) {
          responseDisposers.delete(responseId)
        }
      })
      responseDisposers.set(responseId, dispose)
    }
    ws.s(data)
  }
  child.on('message', onMessage)
  addEntryCleanup(entry, () => child.removeListener('message', onMessage))
}

function createEntry (pid, child, port, ws, requestToken) {
  const entry = {
    pid,
    child,
    port,
    ws,
    pending: new Set(),
    cleanup: [],
    closePromise: null,
    ended: false,
    terminating: false,
    requestToken,
    sshBridgeAttached: false
  }
  childEntries.set(child, entry)
  attachLifecycle(entry)
  return entry
}

exports.terminal = async function (initOptions, ws, uid) {
  const terminalOptions = { ...initOptions }
  const abortSignal = terminalOptions.abortSignal
  delete terminalOptions.abortSignal
  const type = terminalOptions.termType || terminalOptions.type || 'terminal'
  const pid = terminalOptions.uid || uid
  const requestToken = {}
  latestTerminalRequests.set(pid, requestToken)
  terminalOptions.uid = pid
  let entry
  let port
  let portReserved = false
  try {
    if (abortSignal?.aborted) throw childEndedError('aborted before initialization')
    port = await getPort()
    portReserved = true
    if (latestTerminalRequests.get(pid) !== requestToken) throw supersededError()
    if (abortSignal?.aborted) throw childEndedError('aborted before initialization')
    const closing = closingTerminals.get(pid)
    if (closing) await closing
    if (latestTerminalRequests.get(pid) !== requestToken) throw supersededError()
    if (abortSignal?.aborted) throw childEndedError('aborted before initialization')
    const { child, ready } = runSessionServer(type, port)
    entry = createEntry(pid, child, port, ws, requestToken)
    addPendingEntry(entry)
    const onAbort = () => {
      closeEntry(entry).catch(() => {})
    }
    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true })
      entry.cleanup.push(() => abortSignal.removeEventListener('abort', onAbort))
    }
    await ready
    releasePort(port)
    portReserved = false
    const isSsh = ![
      'telnet',
      'serial',
      'local',
      'rdp',
      'vnc',
      'spice',
      'ftp'
    ].includes(type)
    if (isSsh) attachSshBridge(entry)
    let sessionMetadata = {}
    if (type !== 'ftp') {
      const createdSession = await sendMsgToChildProcess(child, {
        id: uid,
        action: 'create-terminal',
        body: terminalOptions
      })
      const hostKeyFingerprint = typeof createdSession?.hostKeyFingerprint === 'string'
        ? createdSession.hostKeyFingerprint.trim()
        : ''
      if (hostKeyFingerprint) {
        sessionMetadata = { hostKeyFingerprint }
      }
    }
    if (abortSignal?.aborted) throw childEndedError('aborted during initialization')
    if (latestTerminalRequests.get(pid) !== requestToken) throw supersededError()
    removePendingEntry(entry)
    const previous = activeTerminals.get(pid)
    activeTerminals.set(pid, entry)
    if (previous && previous !== entry) await closeEntry(previous)
    return { pid, port, ...sessionMetadata }
  } catch (error) {
    if (entry) await closeEntry(entry)
    if (latestTerminalRequests.get(pid) === requestToken) {
      latestTerminalRequests.delete(pid)
    }
    throw error
  } finally {
    if (portReserved) releasePort(port)
  }
}

exports.testConnection = async function (initOptions, ws, uid) {
  const type = initOptions.termType || initOptions.type || 'terminal'
  const port = await getPort()
  let portReserved = true
  const pid = `test-${uid}`
  let entry
  try {
    const { child, ready } = runSessionServer(type, port)
    entry = createEntry(pid, child, port, ws)
    await ready
    releasePort(port)
    portReserved = false
    const isSsh = ![
      'telnet',
      'serial',
      'local',
      'rdp',
      'vnc',
      'spice',
      'ftp'
    ].includes(type)
    if (isSsh) attachSshBridge(entry)
    return await sendMsgToChildProcess(entry.child, {
      id: uid,
      action: 'test-terminal',
      body: initOptions
    })
  } finally {
    if (portReserved) releasePort(port)
    if (entry && !entry.ended) {
      try {
        entry.child.kill()
      } catch (error) {}
      finalizeEntry(entry, childEndedError('closed'))
    }
  }
}

function getTerminal (pid) {
  const entry = activeTerminals.get(pid)
  if (!entry || entry.ended || entry.terminating || entry.closePromise) return null

  return {
    runCmd: async (cmd, id, options = {}) => {
      const normalizedOptions = typeof options === 'number'
        ? { timeoutMs: options }
        : options
      return sendMsgToChildProcess(entry.child, {
        id,
        action: 'run-cmd',
        body: {
          cmd,
          pid,
          timeoutMs: normalizedOptions.timeoutMs,
          maxOutputBytes: normalizedOptions.maxOutputBytes,
          executionId: normalizedOptions.executionId
        }
      })
    },
    cancelRunCmd: async (executionId, id) => {
      return sendMsgToChildProcess(entry.child, {
        id,
        action: 'cancel-run-cmd',
        body: { pid, executionId }
      })
    },
    resize: (cols, rows, id) => {
      sendMsgToChildProcess(entry.child, {
        id,
        action: 'resize-terminal',
        body: { cols, rows, pid }
      }).catch(() => {})
    },
    toggleTerminalLog: id => {
      return sendMsgToChildProcess(entry.child, {
        id,
        action: 'toggle-terminal-log',
        body: { pid }
      })
    },
    toggleTerminalLogTimestamp: id => {
      return sendMsgToChildProcess(entry.child, {
        id,
        action: 'toggle-terminal-log-timestamp',
        body: { pid }
      })
    },
    setTerminalLogPath: (id, logPath) => {
      return sendMsgToChildProcess(entry.child, {
        id,
        action: 'set-terminal-log-path',
        body: { pid, logPath }
      })
    },
    startTerminalLogFile: (id, logFilePath, addTimeStampToTermLog) => {
      return sendMsgToChildProcess(entry.child, {
        id,
        action: 'start-terminal-log-file',
        body: { pid, logFilePath, addTimeStampToTermLog }
      })
    }
  }
}

exports.terminals = getTerminal
exports.getTerminal = getTerminal

function waitForExitAndKill (entry, timeoutMs) {
  const { child } = entry
  if (hasExited(entry)) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    let forceTimer
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(forceTimer)
      child.removeListener('exit', finish)
      resolve(true)
    }
    child.on('exit', finish)
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch (error) {}
      forceTimer = setTimeout(finish, FORCE_KILL_WAIT_MS)
    }, timeoutMs)
    try {
      child.kill()
    } catch (error) {
      finish()
    }
  })
}

function closeEntry (entry, options = {}) {
  if (entry.closePromise) return entry.closePromise

  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Number(options.timeoutMs))
    : CLOSE_TIMEOUT_MS
  entry.closePromise = waitForExitAndKill(entry, timeoutMs)
    .then(() => {
      finalizeEntry(entry, childEndedError('closed'))
      return true
    })
  return entry.closePromise
}

exports.closeTerminal = function (pid, options = {}) {
  const closing = closingTerminals.get(pid)
  if (closing) return closing
  const entries = entriesForPid(pid)
  if (!entries.length) return Promise.resolve(false)

  const closePromise = Promise.all(entries.map(entry => closeEntry(entry, options)))
    .then(() => true)
  closingTerminals.set(pid, closePromise)
  closePromise.then(
    () => {
      if (closingTerminals.get(pid) === closePromise) closingTerminals.delete(pid)
    },
    () => {
      if (closingTerminals.get(pid) === closePromise) closingTerminals.delete(pid)
    }
  )
  return closePromise
}

exports.cleanupTerminals = function () {
  const entries = new Set(activeTerminals.values())
  for (const pending of pendingTerminals.values()) {
    for (const entry of pending) entries.add(entry)
  }
  return Promise.allSettled([...entries].map(entry => closeEntry(entry)))
}

const signalHandlersKey = Symbol.for('electerm.session-process.signal-handlers')
const previousSignalHandlers = process[signalHandlersKey]
if (previousSignalHandlers) {
  process.removeListener('SIGINT', previousSignalHandlers.sigint)
  process.removeListener('SIGTERM', previousSignalHandlers.sigterm)
}
const sigint = async () => {
  await exports.cleanupTerminals()
  process.exit()
}
const sigterm = async () => {
  await exports.cleanupTerminals()
  process.exit()
}
process.on('SIGINT', sigint)
process.on('SIGTERM', sigterm)
process[signalHandlersKey] = { sigint, sigterm }
