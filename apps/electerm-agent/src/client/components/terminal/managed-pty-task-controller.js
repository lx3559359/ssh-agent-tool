import {
  buildPtyTaskCommand,
  createPtyTaskOutputParser
} from '../operations-toolkit/runtime/pty-task-protocol.js'

const defaultCommandTimeoutMs = 60 * 1000
const defaultRecoveryTimeoutMs = 5 * 1000
const managedPtyFrameByteLimit = 3840
const managedPtyPlanFrameLimit = 128
const managedPtyPlanByteLimit = 512 * 1024
const managedPtyFrameAckByteLimit = 512
const managedPtyFrameAckPrefix = '\u001b]698;SHELLPILOT_FILE_FRAME;'

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

function cleanupTimeoutError () {
  return createNamedError('TimeoutError', '受控 PTY 执行计划清理超时')
}

function cancellationUnknownError (cause) {
  return createNamedError(
    'CancellationUnknownError',
    '取消结果未知；终端尚未恢复到可确认的提示符',
    cause
  )
}

function cancellationCleanupUnknownError (cancelError, cleanupError) {
  const cleanupFailure = cleanupError || new Error('受控 PTY 执行计划清理失败')
  return cancellationUnknownError(new AggregateError(
    [cancelError, cleanupFailure].filter(Boolean),
    '受控 PTY 执行计划取消后的清理失败'
  ))
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

function managedPtyByteLength (value) {
  return new TextEncoder().encode(value).byteLength
}

function parseManagedFrameAcknowledgement (value) {
  if (typeof value !== 'string' ||
    managedPtyByteLength(value) > managedPtyFrameAckByteLimit ||
    !value.startsWith(managedPtyFrameAckPrefix) ||
    !value.endsWith('\u0007')) {
    throw new Error('受控 PTY 命令帧确认合同无效')
  }
  const fields = value
    .slice(managedPtyFrameAckPrefix.length, -1)
    .split(';')
  if (fields.length !== 5) {
    throw new Error('受控 PTY 命令帧确认合同无效')
  }
  const [token, rawSequence, rawTotal, digest, status] = fields
  if (!/^(?:0|[1-9]\d*)$/.test(rawSequence) ||
    !/^[1-9]\d*$/.test(rawTotal) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !['ok', 'error'].includes(status)) {
    throw new Error('受控 PTY 命令帧确认合同无效')
  }
  const sequence = Number(rawSequence)
  const total = Number(rawTotal)
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(total)) {
    throw new Error('受控 PTY 命令帧确认合同无效')
  }
  return { token, sequence, total, digest, status }
}

function requireManagedFrame (
  value,
  token,
  sequence,
  total,
  digest,
  allowNoAck = false
) {
  const command = requireManagedCommand(value?.command)
  if (value?.sequence !== sequence ||
    managedPtyByteLength(command) > managedPtyFrameByteLimit) {
    throw new Error('受控 PTY 命令帧超过安全上限或顺序无效')
  }
  const acknowledgement = value?.acknowledgement
  if (acknowledgement === null && allowNoAck) {
    return Object.freeze({
      sequence,
      command,
      acknowledgement: null,
      executesOperation: true
    })
  }
  const parsed = parseManagedFrameAcknowledgement(acknowledgement)
  if (parsed.token !== token || parsed.sequence !== sequence ||
    parsed.total !== total || parsed.digest !== digest ||
    parsed.status !== 'ok') {
    throw new Error('受控 PTY 命令帧确认合同无效')
  }
  return Object.freeze({
    sequence,
    command,
    acknowledgement,
    executesOperation: value.executesOperation === true
  })
}

function requireManagedExecutionPlan (protocol, token, request) {
  if (typeof protocol.buildExecutionPlan !== 'function') {
    const command = requireManagedCommand(
      protocol.buildCommand({ token, request })
    )
    if (managedPtyByteLength(command) > managedPtyFrameByteLimit) {
      throw new Error('受控 PTY 命令帧超过安全上限')
    }
    return Object.freeze({
      kind: 'managed-pty-command-plan',
      version: 1,
      token,
      digest: '',
      frames: Object.freeze([Object.freeze({
        sequence: 0,
        command,
        acknowledgement: null,
        executesOperation: true
      })]),
      cleanup: null
    })
  }
  const source = protocol.buildExecutionPlan({ token, request })
  if (source?.kind !== 'managed-pty-command-plan' || source.version !== 1 ||
    source.token !== token || !Array.isArray(source.frames) ||
    source.frames.length < 1 ||
    source.frames.length > managedPtyPlanFrameLimit) {
    throw new Error('受控 PTY 命令计划无效')
  }
  const digest = String(source.digest || '')
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error('受控 PTY 命令计划摘要无效')
  }
  const singleFrame = source.frames.length === 1
  const frames = source.frames.map((frame, sequence) =>
    requireManagedFrame(
      frame, token, sequence, source.frames.length, digest, singleFrame))
  if (frames.filter(frame => frame.executesOperation).length !== 1 ||
    frames.at(-1).executesOperation !== true) {
    throw new Error('受控 PTY 命令计划执行边界无效')
  }
  const totalBytes = frames.reduce(
    (total, frame) => total + managedPtyByteLength(frame.command),
    0
  )
  if (totalBytes > managedPtyPlanByteLimit) {
    throw new Error('受控 PTY 命令计划超过安全上限')
  }
  const cleanup = singleFrame || source.cleanup === null
    ? null
    : requireManagedFrame(
      source.cleanup, token, frames.length, frames.length, digest)
  return Object.freeze({
    kind: source.kind,
    version: source.version,
    token,
    digest,
    frames: Object.freeze(frames),
    cleanup
  })
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

  function failExecution (execution, error, options = {}) {
    if (!execution.settled && !execution.cancelRequested &&
      !execution.planCleanupStarted && execution.planStateMayExist &&
      execution.plan.cleanup) {
      execution.cancelRequested = true
      execution.cancelError = error
      execution.cancelRequestedPromptSequence = promptSequence
      execution.cancellationRecoveryArmed = true
      clearTimer(execution.timeoutHandle)
      clearTimer(execution.recoveryHandle)
      execution.timeoutHandle = null
      safeCancelSubmission(execution.submissionToken)
      beginPlanCleanup(execution)
      return
    }
    rejectExecution(execution, error, options)
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
      failExecution(execution, error, { cancelExpected: true })
    }
  }

  function settleIfCompleteUnsafe (execution) {
    if (execution.settled) return
    if (execution.cancelRequested) {
      if (!execution.promptReturned) return
      if (execution.planCleanupStarted) {
        clearTimer(execution.recoveryHandle)
        if (execution.frameError || !execution.frameAcknowledged ||
          execution.commandExitCode !== 0) {
          recoveryLocked = true
          rejectExecution(
            execution,
            cancellationCleanupUnknownError(
              execution.cancelError,
              execution.frameError
            ),
            { preserveSubmissionOutput: true }
          )
          return
        }
        rejectExecution(execution, execution.cancelError)
        return
      }
      if (execution.plan.cleanup && execution.planStateMayExist) {
        if (!execution.commandInputReady) return
        beginPlanCleanup(execution)
        return
      }
      rejectExecution(execution, execution.cancelError)
      return
    }
    if (!execution.commandFinished || !execution.promptReturned) return
    if (execution.frameError) {
      failExecution(execution, execution.frameError)
      return
    }
    if (execution.frame?.acknowledgement && !execution.frameAcknowledged) {
      failExecution(execution, new Error('受控 PTY 命令帧确认缺失'))
      return
    }
    if (execution.frameIndex < execution.plan.frames.length - 1) {
      if (!execution.commandInputReady) return
      if (execution.commandExitCode !== 0) {
        failExecution(execution, new Error('受控 PTY 命令帧执行失败'))
        return
      }
      submitExecutionFrame(
        execution,
        execution.plan.frames[execution.frameIndex + 1]
      )
      return
    }
    if (!execution.parser.started()) {
      failExecution(execution, new Error('PTY 运维任务开始边界缺失'))
      return
    }
    if (!execution.parser.ended()) {
      failExecution(execution, new Error('PTY 运维任务结束边界缺失'))
      return
    }
    const markerExitCode = execution.parser.exitCode()
    if (markerExitCode !== execution.commandExitCode) {
      failExecution(
        execution,
        new Error('PTY 运维任务退出码与 Shell Integration 不一致')
      )
      return
    }
    const identity = execution.parser.identity()
    if (!identity) {
      failExecution(execution, new Error('PTY 运维任务缺少有效身份'))
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
      const error = execution.planCleanupStarted
        ? cancellationCleanupUnknownError(
          execution.cancelError, cleanupTimeoutError())
        : cancellationUnknownError(execution.cancelError)
      rejectExecution(
        execution,
        error,
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

  function pushParserOutput (execution, chunk) {
    if (!chunk) return
    const parsed = execution.parser.push(chunk)
    if (!validateIdentity(execution)) return
    for (const output of parsed?.output || []) execution.onChunk?.(output)
  }

  function consumeExecutionOutput (execution, chunk) {
    if (execution.planCleanupStarted) {
      consumeFrameAcknowledgement(execution, chunk)
      return
    }
    if (!execution.frame?.acknowledgement || execution.frameAcknowledged) {
      if (execution.frame?.executesOperation) {
        pushParserOutput(execution, chunk)
      }
      return
    }
    consumeFrameAcknowledgement(execution, chunk)
  }

  function consumeFrameAcknowledgement (execution, chunk) {
    if (execution.frameError) return
    execution.frameAckBuffer += String(chunk || '')
    const start = execution.frameAckBuffer.indexOf(managedPtyFrameAckPrefix)
    if (start === -1) {
      execution.frameAckBuffer = execution.frameAckBuffer.slice(
        -(managedPtyFrameAckPrefix.length - 1)
      )
      return
    }
    const end = execution.frameAckBuffer.indexOf('\u0007', start)
    if (end === -1) {
      if (managedPtyByteLength(
        execution.frameAckBuffer.slice(start)
      ) > managedPtyFrameAckByteLimit) {
        execution.frameError = new Error('受控 PTY 命令帧确认超过安全上限')
        execution.frameAckBuffer = ''
      }
      return
    }
    const acknowledgement = execution.frameAckBuffer.slice(start, end + 1)
    let parsed
    try {
      parsed = parseManagedFrameAcknowledgement(acknowledgement)
    } catch (error) {
      execution.frameError = error
      execution.frameAckBuffer = ''
      return
    }
    if (parsed.token !== execution.plan.token ||
      parsed.sequence !== execution.frame.sequence ||
      parsed.total !== execution.plan.frames.length ||
      parsed.digest !== execution.plan.digest || parsed.status !== 'ok' ||
      acknowledgement !== execution.frame.acknowledgement) {
      execution.frameError = new Error('受控 PTY 命令帧确认顺序或认证无效')
      execution.frameAckBuffer = ''
      return
    }
    execution.frameAcknowledged = true
    const remainder = execution.frameAckBuffer.slice(end + 1)
    execution.frameAckBuffer = ''
    if (execution.frame.executesOperation && remainder) {
      pushParserOutput(execution, remainder)
    }
  }

  function submitExecutionFrame (execution, frame, options = {}) {
    const submissionToken = expectSubmission(frame.command)
    if (!submissionToken) {
      throw new Error('无法建立 PTY 运维命令追踪，命令尚未发送')
    }
    execution.frameGeneration += 1
    const frameGeneration = execution.frameGeneration
    execution.frame = frame
    execution.frameIndex = options.cleanup === true
      ? execution.plan.frames.length
      : frame.sequence
    execution.command = frame.command
    execution.submissionToken = submissionToken
    execution.transport = null
    execution.transportAccepted = false
    execution.submitted = false
    execution.commandFinished = false
    execution.commandExitCode = null
    execution.commandFinishedPromptSequence = 0
    execution.promptReturned = false
    execution.commandInputReady = false
    execution.frameAcknowledged = frame.acknowledgement === null
    execution.frameAckBuffer = ''
    execution.frameError = null
    execution.preAcceptInterruptSent = false
    execution.recoveryInterruptSent = false
    execution.cancellationRecoveryArmed = options.cleanup === true
    if (armSubmission(submissionToken) !== true) {
      throw new Error('无法锁定 PTY 运维命令追踪，命令尚未发送')
    }
    if (execution.settled || active !== execution) return
    const transport = submitCommand(frame.command, {
      holdSuppression: execution.plan.frames.length > 1 &&
        frame.executesOperation !== true && options.cleanup !== true,
      cleanup: options.cleanup === true
    })
    if (!transport || typeof transport.accepted?.then !== 'function' ||
      typeof transport.written?.then !== 'function') {
      throw new Error('PTY 运维命令未能发送')
    }
    execution.transport = transport
    Promise.resolve(transport.accepted).then(() => {
      if (execution.frameGeneration !== frameGeneration) return
      if (execution.settled && execution.cancelRequested && recoveryLocked &&
        lateRecovery?.owner === execution.owner) {
        execution.transportAccepted = true
        armAcceptedCancellationRecovery(execution)
        return
      }
      if (active !== execution || execution.settled) return
      execution.submitted = true
      execution.transportAccepted = true
      if (execution.plan.frames.length > 1 &&
        options.cleanup !== true && frame.executesOperation !== true) {
        execution.planStateMayExist = true
      }
      if (execution.cancelRequested && !execution.planCleanupStarted) {
        armAcceptedCancellationRecovery(execution)
        if (!execution.settled) settleIfComplete(execution)
        return
      }
      if (!execution.timeoutHandle && !execution.planCleanupStarted) {
        execution.timeoutHandle = setTimer(
          () => requestCancellation(execution, 'timeout'),
          execution.timeoutMs
        )
      }
    }).catch(error => {
      if (execution.frameGeneration !== frameGeneration) return
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
      if (execution.planCleanupStarted) {
        execution.frameError = error
        recoveryLocked = true
        rejectExecution(
          execution,
          cancellationCleanupUnknownError(execution.cancelError, error),
          { cancelExpected: true, preserveSubmissionOutput: true }
        )
        return
      }
      if (execution.cancelRequested) {
        if (isDefinitivePreAcceptRejection(error)) {
          if (execution.plan.cleanup && execution.planStateMayExist) {
            safeCancelSubmission(execution.submissionToken)
            beginPlanCleanup(execution)
            return
          }
          rejectExecution(execution, execution.cancelError, {
            cancelExpected: true
          })
        }
        return
      }
      failExecution(execution, error, { cancelExpected: true })
    })
    Promise.resolve(transport.written).catch(error => {
      if (execution.frameGeneration !== frameGeneration) return
      if (!execution.settled && execution.planCleanupStarted) {
        recoveryLocked = true
        rejectExecution(
          execution,
          cancellationCleanupUnknownError(execution.cancelError, error),
          { cancelExpected: true, preserveSubmissionOutput: true }
        )
        return
      }
      if (!execution.settled && !execution.cancelRequested) {
        requestCancellation(execution, error)
      }
    })
  }

  function beginPlanCleanup (execution) {
    clearTimer(execution.recoveryHandle)
    clearTimer(execution.timeoutHandle)
    execution.timeoutHandle = null
    execution.planCleanupStarted = true
    execution.cancelRequestedPromptSequence = promptSequence
    try {
      submitExecutionFrame(execution, execution.plan.cleanup, { cleanup: true })
      beginRecoveryDeadline(execution)
    } catch (error) {
      recoveryLocked = true
      rejectExecution(
        execution,
        cancellationCleanupUnknownError(execution.cancelError, error),
        { cancelExpected: true, preserveSubmissionOutput: true }
      )
    }
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
    const plan = requireManagedExecutionPlan(protocol, token, request)
    const parser = requireManagedParser(
      protocol.createParser({ token, request })
    )

    return new Promise((resolve, reject) => {
      const execution = {
        owner,
        command: '',
        protocol,
        request,
        parser,
        plan,
        frame: null,
        frameIndex: -1,
        frameGeneration: 0,
        frameAcknowledged: false,
        frameAckBuffer: '',
        frameError: null,
        planCleanupStarted: false,
        planStateMayExist: false,
        submissionToken: '',
        timeoutMs,
        onChunk: options.onChunk,
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
        commandInputReady: false,
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
            consumeExecutionOutput(execution, chunk)
            settleIfComplete(execution)
          } catch (error) {
            requestCancellation(execution, error)
          }
        })
        submitExecutionFrame(execution, plan.frames[0])
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

  function handleCommandInputStarted () {
    const execution = active
    if (!execution || !execution.promptReturned) return false
    execution.commandInputReady = true
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
    handleCommandInputStarted,
    handleUserInput,
    invalidate,
    isBusy: () => Boolean(leaseOwner || pendingAcquireOwner),
    owner: () => leaseOwner || pendingAcquireOwner
  })
}
