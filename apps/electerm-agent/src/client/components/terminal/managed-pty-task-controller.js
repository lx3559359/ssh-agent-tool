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

function abortError (
  message = 'PTY 运维任务已取消',
  cancellationOrigin = 'signal'
) {
  const error = createNamedError('AbortError', message)
  error.code = 'PTY_TASK_CANCELLED'
  error.cancelled = true
  error.cancellationOrigin = cancellationOrigin
  return error
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

function isDefinitivePreAcceptRejection (error) {
  if (error?.name === 'AbortError') return true
  return error?.name === 'ManagedInputTransportError' &&
    error?.message === '受控输入请求被拒绝'
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
  prepareSubmissionOutputRecovery = () => true,
  cancelSubmissionOutput = () => true,
  submitCommand,
  interrupt,
  onIdle = () => {},
  subscribeOutput,
  createToken,
  recoveryTimeoutMs = defaultRecoveryTimeoutMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let leaseOwner = ''
  let pendingAcquireOwner = ''
  let userInputGeneration = 0
  let active = null
  let generation = 0
  let promptSequence = 0
  let firstIdentity = null
  let recoveryLocked = false
  let lateRecovery = null
  const defaultProtocol = createDefaultProtocol({ createToken })

  function safeCancelSubmission (token) {
    if (!token) return
    try {
      cancelSubmission(token)
    } catch {
      // Session cleanup is best effort after a failed or interrupted submission.
    }
  }

  function safePrepareSubmissionOutputRecovery () {
    try {
      prepareSubmissionOutputRecovery()
    } catch {
      // Prompt recovery remains authoritative even if echo retargeting fails.
    }
  }

  function safeCancelSubmissionOutput () {
    try {
      cancelSubmissionOutput()
    } catch {
      // Echo cleanup is best effort; controller recovery remains authoritative.
    }
  }

  function safeNotifyIdle () {
    try {
      const result = onIdle()
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch {
      // Releasing the PTY lease must not fail because queued input replay did.
    }
  }

  function cleanupExecution (execution, options = {}) {
    clearTimer(execution.timeoutHandle)
    clearTimer(execution.recoveryHandle)
    execution.signal?.removeEventListener('abort', execution.abortHandler)
    try {
      execution.outputSubscription?.dispose?.()
    } catch {
      // A broken output listener must not keep the terminal lease unsettled.
    }
    execution.outputSubscription = null
    if (options.cancelExpected === true) {
      safeCancelSubmission(execution.submissionToken)
    }
    if (options.preserveSubmissionOutput !== true) {
      safeCancelSubmissionOutput()
    }
    if (active === execution) active = null
  }

  function rejectExecution (execution, error, options = {}) {
    if (execution.settled) return
    execution.settled = true
    cleanupExecution(execution, options)
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
      if (execution.promptReturned) {
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
      lateRecovery = {
        owner: execution.owner,
        promptAfterSequence: execution.cancelRequestedPromptSequence,
        recoveryArmed: execution.cancellationRecoveryArmed
      }
      rejectExecution(
        execution,
        cancellationUnknownError(execution.cancelError),
        {
          cancelExpected: true,
          preserveSubmissionOutput: true
        }
      )
    }, Number(recoveryTimeoutMs))
  }

  function sendCancellationInterrupt (execution, phase) {
    const sentField = phase === 'accepted'
      ? 'recoveryInterruptSent'
      : 'preAcceptInterruptSent'
    if (execution[sentField]) return
    execution[sentField] = true
    if (!execution.outputRecoveryPrepared) {
      execution.outputRecoveryPrepared = true
      safePrepareSubmissionOutputRecovery()
    }
    try {
      interrupt()
    } catch {
      // Missing prompt recovery below keeps the terminal locked safely.
    }
  }

  function armAcceptedCancellationRecovery (execution) {
    if (execution.cancellationRecoveryArmed) return
    execution.cancellationRecoveryArmed = true
    execution.cancelRequestedPromptSequence = promptSequence
    if (execution.settled && lateRecovery?.owner === execution.owner) {
      lateRecovery.promptAfterSequence = promptSequence
      lateRecovery.recoveryArmed = true
    }
    sendCancellationInterrupt(execution, 'accepted')
    if (!execution.settled) beginRecoveryDeadline(execution)
  }

  function requestCancellation (execution, reason = 'signal') {
    if (!execution || active !== execution || execution.settled ||
      execution.cancelRequested) return false
    execution.cancelRequested = true
    execution.cancelError = reason instanceof Error
      ? reason
      : reason === 'timeout'
        ? timeoutError()
        : abortError(
          reason === 'user'
            ? '用户已取消 PTY 运维任务'
            : 'PTY 运维任务已取消',
          reason === 'user' ? 'user' : 'signal'
        )
    execution.cancelRequestedPromptSequence = promptSequence
    clearTimer(execution.timeoutHandle)
    if (!execution.transport) {
      rejectExecution(execution, execution.cancelError, {
        cancelExpected: true
      })
      return true
    }
    if (!execution.transportAccepted) {
      sendCancellationInterrupt(execution, 'pending')
      beginRecoveryDeadline(execution)
      return true
    }
    armAcceptedCancellationRecovery(execution)
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
        transport: null,
        transportAccepted: false,
        timeoutHandle: null,
        recoveryHandle: null,
        submitted: false,
        outputRecoveryPrepared: false,
        preAcceptInterruptSent: false,
        recoveryInterruptSent: false,
        cancellationRecoveryArmed: false,
        cancelRequested: false,
        cancelError: null,
        cancelRequestedPromptSequence: 0,
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
        const transport = submitCommand(command)
        if (!transport || typeof transport.accepted?.then !== 'function' ||
          typeof transport.written?.then !== 'function') {
          throw new Error('PTY 运维命令未能发送')
        }
        execution.transport = transport
        Promise.resolve(transport.accepted).then(() => {
          execution.submitted = true
          execution.transportAccepted = true
          if (execution.cancelRequested) {
            armAcceptedCancellationRecovery(execution)
            if (!execution.settled) settleIfComplete(execution)
            return
          }
          if (execution.settled) return
          execution.timeoutHandle = setTimer(
            () => requestCancellation(execution, 'timeout'),
            timeoutMs
          )
        }).catch(error => {
          if (execution.settled) {
            if (execution.cancelRequested &&
              isDefinitivePreAcceptRejection(error) &&
              recoveryLocked && lateRecovery?.owner === execution.owner) {
              const recoveryOwner = lateRecovery.owner
              lateRecovery = null
              recoveryLocked = false
              if (leaseOwner === recoveryOwner) {
                leaseOwner = ''
                safeNotifyIdle()
              }
              firstIdentity = null
              safeCancelSubmissionOutput()
            }
            return
          }
          if (execution.cancelRequested) {
            if (isDefinitivePreAcceptRejection(error)) {
              rejectExecution(execution, execution.cancelError, {
                cancelExpected: true
              })
            }
            return
          }
          rejectExecution(execution, error, { cancelExpected: true })
        })
        Promise.resolve(transport.written).catch(error => {
          if (!execution.settled && !execution.cancelRequested) {
            requestCancellation(execution, error)
          }
        })
      } catch (error) {
        rejectExecution(execution, error, { cancelExpected: true })
      }
    })
  }

  async function acquire (ownerId) {
    const owner = String(ownerId || '')
    if (!owner) throw new Error('PTY 运维任务缺少租约标识')
    if (leaseOwner || pendingAcquireOwner) {
      throw new Error('当前终端已有运维任务正在执行')
    }
    const acquireGeneration = generation
    const acquireInputGeneration = userInputGeneration
    pendingAcquireOwner = owner
    try {
      await ensureReady()
      if (generation !== acquireGeneration || pendingAcquireOwner !== owner) {
        throw disconnectedError('终端连接已断开，PTY 运维任务尚未开始')
      }
      if (userInputGeneration !== acquireInputGeneration) {
        throw new Error('用户已开始终端输入，后台运维任务已让行')
      }
      assertRunnableTerminalState(getTerminalState())
      pendingAcquireOwner = ''
      leaseOwner = owner
      firstIdentity = null
      recoveryLocked = false
      lateRecovery = null
    } catch (error) {
      if (pendingAcquireOwner === owner) pendingAcquireOwner = ''
      if (leaseOwner === owner) leaseOwner = ''
      if (generation === acquireGeneration) {
        safeNotifyIdle()
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
        safeNotifyIdle()
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
    if (!execution) {
      if (!recoveryLocked || !lateRecovery ||
        lateRecovery.recoveryArmed !== true ||
        promptSequence <= lateRecovery.promptAfterSequence) return false
      const recoveryOwner = lateRecovery.owner
      lateRecovery = null
      recoveryLocked = false
      if (leaseOwner === recoveryOwner) {
        leaseOwner = ''
        safeNotifyIdle()
      }
      firstIdentity = null
      safeCancelSubmissionOutput()
      return true
    }
    if (execution.cancelRequested) {
      if (!execution.cancellationRecoveryArmed) return false
      if (promptSequence <= execution.cancelRequestedPromptSequence) return false
    } else if (!execution.commandFinished ||
      promptSequence <= execution.commandFinishedPromptSequence) {
      return false
    }
    execution.promptReturned = true
    settleIfComplete(execution)
    return true
  }

  function handleUserInput (data) {
    if (pendingAcquireOwner && !leaseOwner) {
      userInputGeneration += 1
      return { handled: false, send: false }
    }
    if (!leaseOwner) return { handled: false, send: false }
    const isInterrupt = data === '\x03'
    const preemptReadOnlyFileTask = !isInterrupt &&
      /^root-file:list(?::|$)/.test(leaseOwner) &&
      ['probe', 'list', 'list-bound'].includes(active?.request?.operation)
    if (isInterrupt || preemptReadOnlyFileTask) {
      requestCancellation(active, 'user')
    }
    return { handled: true, send: false, queue: !isInterrupt }
  }

  async function invalidate (reason = '终端连接已断开') {
    generation += 1
    const execution = active
    const needsOutputCleanup = recoveryLocked || Boolean(lateRecovery)
    pendingAcquireOwner = ''
    leaseOwner = ''
    firstIdentity = null
    recoveryLocked = false
    lateRecovery = null
    if (execution) {
      rejectExecution(execution, disconnectedError(reason), {
        cancelExpected: true
      })
    } else if (needsOutputCleanup) {
      safeCancelSubmissionOutput()
    }
  }

  return Object.freeze({
    acquire,
    handleCommandFinished,
    handlePromptStarted,
    handleUserInput,
    invalidate,
    isBusy: () => Boolean(leaseOwner || pendingAcquireOwner),
    owner: () => leaseOwner || pendingAcquireOwner
  })
}
