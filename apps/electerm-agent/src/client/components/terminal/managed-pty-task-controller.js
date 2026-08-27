import {
  buildPtyTaskCommand,
  createPtyTaskOutputParser
} from '../operations-toolkit/runtime/pty-task-protocol.js'

const defaultCommandTimeoutMs = 60 * 1000
const defaultRecoveryTimeoutMs = 5 * 1000

function createNamedError (name, message, cause) {
  const error = new Error(message)
  error.name = name
  if (cause) error.cause = cause
  return error
}

function abortError (message = 'PTY 运维任务已取消') {
  return createNamedError('AbortError', message)
}

function timeoutError () {
  return createNamedError('TimeoutError', 'PTY 运维任务执行超时')
}

function cancellationUnknownError (cause) {
  return createNamedError(
    'CancellationUnknownError',
    '取消结果未知；终端尚未恢复到可确认的提示符',
    cause
  )
}

function disconnectedError (reason) {
  return createNamedError(
    'DisconnectedError',
    String(reason || '终端连接已断开')
  )
}

function assertRunnableTerminalState (state = {}) {
  if (state.alternateBuffer) {
    throw new Error('当前交互程序无法执行受控 PTY 运维任务')
  }
  if (state.passwordPrompt) {
    throw new Error('当前终端正在等待密码，运维命令尚未发送')
  }
  if (state.shellIntegrationActive !== true ||
    state.commandInputActive !== true || state.currentInput !== '') {
    throw new Error('当前终端未处于可追踪的空提示符，运维命令尚未发送')
  }
}

function normalizeTimeout (value) {
  const timeout = value === undefined
    ? defaultCommandTimeoutMs
    : Number(value)
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('PTY 运维任务超时时间无效')
  }
  return timeout
}

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

function requireManagedCommand (value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('受控 PTY 命令无效')
  }
  return value
}

function requireManagedParser (value) {
  for (const field of [
    'push',
    'identity',
    'exitCode',
    'started',
    'ended'
  ]) {
    if (typeof value?.[field] !== 'function') {
      throw new Error(`受控 PTY parser 缺少 ${field}`)
    }
  }
  return value
}

export function createManagedPtyTaskController ({
  ensureReady,
  getTerminalState,
  expectSubmission,
  armSubmission,
  cancelSubmission,
  submitCommand,
  interrupt,
  subscribeOutput,
  createToken,
  recoveryTimeoutMs = defaultRecoveryTimeoutMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let leaseOwner = ''
  let active = null
  let generation = 0
  let promptSequence = 0
  let firstIdentity = null
  let recoveryLocked = false
  const defaultProtocol = createDefaultProtocol({ createToken })

  function safeCancelSubmission (token) {
    if (!token) return
    try {
      cancelSubmission(token)
    } catch {
      // Session cleanup is best effort after a failed or interrupted submission.
    }
  }

  function cleanupExecution (execution, cancelExpected = false) {
    clearTimer(execution.timeoutHandle)
    clearTimer(execution.recoveryHandle)
    execution.signal?.removeEventListener('abort', execution.abortHandler)
    try {
      execution.outputSubscription?.dispose?.()
    } catch {
      // A broken output listener must not keep the terminal lease unsettled.
    }
    execution.outputSubscription = null
    if (cancelExpected) safeCancelSubmission(execution.submissionToken)
    if (active === execution) active = null
  }

  function rejectExecution (execution, error, options = {}) {
    if (execution.settled) return
    execution.settled = true
    cleanupExecution(execution, options.cancelExpected === true)
    execution.reject(error)
  }

  function resolveExecution (execution, result) {
    if (execution.settled) return
    execution.settled = true
    cleanupExecution(execution)
    execution.resolve(result)
  }

  function sameIdentity (left, right) {
    return left?.uid === right?.uid && left?.username === right?.username
  }

  function validateIdentity (execution) {
    const identity = execution.parser.identity()
    if (!identity || execution.identityValidated) return true
    execution.identityValidated = true
    if (!firstIdentity) {
      firstIdentity = identity
      return true
    }
    if (!sameIdentity(firstIdentity, identity)) {
      const error = new Error('当前 Shell 有效身份在任务执行期间发生变化')
      requestCancellation(execution, error)
      return false
    }
    return true
  }

  function settleIfComplete (execution) {
    if (execution.settled) return
    try {
      settleIfCompleteUnsafe(execution)
    } catch (error) {
      rejectExecution(execution, error, { cancelExpected: true })
    }
  }

  function settleIfCompleteUnsafe (execution) {
    if (execution.settled) return
    if (execution.cancelRequested) {
      if (execution.commandFinished && execution.promptReturned) {
        rejectExecution(execution, execution.cancelError)
      }
      return
    }
    if (!execution.commandFinished || !execution.promptReturned) return
    if (!execution.parser.started()) {
      rejectExecution(execution, new Error('PTY 运维任务开始边界缺失'))
      return
    }
    if (!execution.parser.ended()) {
      rejectExecution(execution, new Error('PTY 运维任务结束边界缺失'))
      return
    }
    const markerExitCode = execution.parser.exitCode()
    if (markerExitCode !== execution.commandExitCode) {
      rejectExecution(
        execution,
        new Error('PTY 运维任务退出码与 Shell Integration 不一致')
      )
      return
    }
    const identity = execution.parser.identity()
    if (!identity) {
      rejectExecution(execution, new Error('PTY 运维任务缺少有效身份'))
      return
    }
    const protocolResult = {
      ...(execution.protocol.readResult(execution.parser) || {})
    }
    delete protocolResult.exitCode
    delete protocolResult.identity
    resolveExecution(execution, {
      exitCode: markerExitCode,
      identity,
      ...protocolResult
    })
  }

  function beginRecoveryDeadline (execution) {
    clearTimer(execution.recoveryHandle)
    execution.recoveryHandle = setTimer(() => {
      if (active !== execution || execution.settled) return
      recoveryLocked = true
      rejectExecution(
        execution,
        cancellationUnknownError(execution.cancelError),
        { cancelExpected: true }
      )
    }, Number(recoveryTimeoutMs))
  }

  function requestCancellation (execution, reason = 'signal') {
    if (!execution || active !== execution || execution.settled ||
      execution.cancelRequested) return false
    execution.cancelRequested = true
    execution.cancelError = reason instanceof Error
      ? reason
      : reason === 'timeout'
        ? timeoutError()
        : abortError(reason === 'user'
          ? '用户已取消 PTY 运维任务'
          : 'PTY 运维任务已取消')
    clearTimer(execution.timeoutHandle)
    if (!execution.submitted) {
      rejectExecution(execution, execution.cancelError, {
        cancelExpected: true
      })
      return true
    }
    if (!execution.interruptSent) {
      execution.interruptSent = true
      try {
        interrupt()
      } catch {
        // Missing prompt recovery below keeps the terminal locked safely.
      }
    }
    beginRecoveryDeadline(execution)
    settleIfComplete(execution)
    return true
  }

  async function execute (owner, options = {}) {
    if (!leaseOwner || leaseOwner !== owner) {
      throw new Error('PTY 运维任务租约已经失效')
    }
    if (active) throw new Error('当前终端已有 PTY 命令正在执行')
    if (recoveryLocked) throw new Error('当前终端取消结果未知，需要重连恢复')
    assertRunnableTerminalState(getTerminalState())
    if (options.signal?.aborted) throw abortError()
    const timeoutMs = normalizeTimeout(options.timeoutMs)
    const protocol = requireManagedProtocol(options.protocol, defaultProtocol)
    const token = protocol.createToken()
    const request = options.request || { script: options.script }
    const command = requireManagedCommand(
      protocol.buildCommand({ token, request })
    )
    const parser = requireManagedParser(
      protocol.createParser({ token, request })
    )
    const submissionToken = expectSubmission(command)
    if (!submissionToken) {
      throw new Error('无法建立 PTY 运维命令追踪，命令尚未发送')
    }

    return new Promise((resolve, reject) => {
      const execution = {
        owner,
        command,
        protocol,
        request,
        parser,
        submissionToken,
        signal: options.signal,
        abortHandler: null,
        outputSubscription: null,
        timeoutHandle: null,
        recoveryHandle: null,
        submitted: false,
        interruptSent: false,
        cancelRequested: false,
        cancelError: null,
        identityValidated: false,
        commandFinished: false,
        commandExitCode: null,
        commandFinishedPromptSequence: 0,
        promptReturned: false,
        settled: false,
        resolve,
        reject
      }
      active = execution
      execution.abortHandler = () => requestCancellation(execution, 'signal')
      try {
        execution.signal?.addEventListener(
          'abort',
          execution.abortHandler,
          { once: true }
        )
        execution.outputSubscription = subscribeOutput(chunk => {
          if (active !== execution || execution.settled) return
          try {
            const parsed = parser.push(chunk)
            if (!validateIdentity(execution)) return
            for (const output of parsed?.output || []) options.onChunk?.(output)
            settleIfComplete(execution)
          } catch (error) {
            requestCancellation(execution, error)
          }
        })
        if (armSubmission(submissionToken) !== true) {
          throw new Error('无法锁定 PTY 运维命令追踪，命令尚未发送')
        }
        if (execution.settled) return
        execution.submitted = true
        if (submitCommand(command) !== true) {
          execution.submitted = false
          throw new Error('PTY 运维命令未能发送')
        }
        if (execution.settled) return
        execution.timeoutHandle = setTimer(
          () => requestCancellation(execution, 'timeout'),
          timeoutMs
        )
      } catch (error) {
        rejectExecution(execution, error, { cancelExpected: true })
      }
    })
  }

  async function acquire (ownerId) {
    const owner = String(ownerId || '')
    if (!owner) throw new Error('PTY 运维任务缺少租约标识')
    if (leaseOwner) throw new Error('当前终端已有运维任务正在执行')
    const acquireGeneration = generation
    leaseOwner = owner
    firstIdentity = null
    recoveryLocked = false
    try {
      await ensureReady()
      if (generation !== acquireGeneration || leaseOwner !== owner) {
        throw disconnectedError('终端连接已断开，PTY 运维任务尚未开始')
      }
      assertRunnableTerminalState(getTerminalState())
    } catch (error) {
      if (generation === acquireGeneration && leaseOwner === owner) {
        leaseOwner = ''
      }
      throw error
    }
    return Object.freeze({
      execute: options => execute(owner, options),
      release: async () => {
        if (!leaseOwner) return true
        if (leaseOwner !== owner) {
          throw new Error('PTY 运维任务租约已经失效')
        }
        if (recoveryLocked) return false
        if (active) throw new Error('PTY 运维命令仍在执行，无法释放终端')
        leaseOwner = ''
        firstIdentity = null
        return true
      }
    })
  }

  function handleCommandFinished (event = {}) {
    const execution = active
    if (!execution || event.token !== execution.submissionToken ||
      event.command !== execution.command || execution.commandFinished) {
      return false
    }
    execution.commandFinished = true
    execution.commandExitCode = event.exitCode
    execution.commandFinishedPromptSequence = promptSequence
    settleIfComplete(execution)
    return true
  }

  function handlePromptStarted () {
    promptSequence += 1
    const execution = active
    if (!execution || !execution.commandFinished ||
      promptSequence <= execution.commandFinishedPromptSequence) return false
    execution.promptReturned = true
    settleIfComplete(execution)
    return true
  }

  function handleUserInput (data) {
    if (!leaseOwner) return { handled: false, send: false }
    if (data === '\x03') requestCancellation(active, 'user')
    return { handled: true, send: false }
  }

  async function invalidate (reason = '终端连接已断开') {
    generation += 1
    const execution = active
    leaseOwner = ''
    firstIdentity = null
    recoveryLocked = false
    if (execution) {
      rejectExecution(execution, disconnectedError(reason), {
        cancelExpected: true
      })
    }
  }

  return Object.freeze({
    acquire,
    handleCommandFinished,
    handlePromptStarted,
    handleUserInput,
    invalidate,
    isBusy: () => Boolean(leaseOwner),
    owner: () => leaseOwner
  })
}
