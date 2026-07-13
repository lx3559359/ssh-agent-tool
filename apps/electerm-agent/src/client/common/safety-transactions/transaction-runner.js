import { redactAuditText, redactSensitiveData } from './audit-redaction.js'
import { classifyCommand } from './command-classifier.js'
import { assertSameSessionEndpoint, buildEndpointKey } from './endpoint-guard.js'
import { operationStates } from './models.js'
import {
  buildVerifiedRemoteAction,
  parseRemoteActionMarker
} from './remote-recovery.js'

export const maxAuditPreviewBytes = 64 * 1024

const terminalStates = new Set([
  operationStates.rollbackAvailable,
  operationStates.kept,
  operationStates.restored,
  operationStates.failed,
  operationStates.cancelled
])
const cancellableStates = new Set([
  operationStates.preparing,
  operationStates.recoveryReady,
  operationStates.awaitingConfirmation,
  operationStates.executing,
  operationStates.rollingBack
])
const defaultTimeouts = {
  prepare: 30000,
  execute: 60000,
  rollback: 30000,
  verify: 30000
}
const riskRank = {
  readonly: 0,
  change: 1,
  unknown: 2,
  blocked: 3
}
const recoveryBindingSchemaVersion = 1
const recoveryBindingAlgorithm = 'SHA-256'

function requireFunction (value, label) {
  if (typeof value !== 'function') throw new Error(`${label} 必须是函数。`)
  return value
}

function bindStoreMethod (store, genericName, operationName) {
  const method = store?.[genericName] || store?.[operationName]
  if (typeof method !== 'function') {
    throw new Error(`事务存储缺少 ${genericName} 方法。`)
  }
  return method.bind(store)
}

function resolveClock (now) {
  const clock = typeof now === 'function' ? now : () => now ?? new Date()
  return () => {
    const value = clock()
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) throw new Error('事务执行器当前时间无效。')
    return date.toISOString()
  }
}

export function redactAndTruncateAuditText (value, maxBytes = maxAuditPreviewBytes) {
  const redacted = redactAuditText(String(value ?? ''))
  const encoder = new TextEncoder()
  const bytes = encoder.encode(redacted)
  if (bytes.byteLength <= maxBytes) return redacted
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let end = maxBytes; end >= Math.max(0, maxBytes - 3); end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {}
  }
  return ''
}

function utf8CodePointBytes (character) {
  const codePoint = character.codePointAt(0)
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

function boundedUtf8String (value, maxBytes) {
  const text = String(value ?? '')
  let bytes = 0
  let end = 0
  for (const character of text) {
    const size = utf8CodePointBytes(character)
    if (bytes + size > maxBytes) break
    bytes += size
    end += character.length
  }
  return { text: text.slice(0, end), bytes, truncated: end < text.length }
}

function boundedUtf8TailString (value, maxBytes) {
  const text = String(value ?? '')
  let bytes = 0
  let start = text.length
  while (start > 0) {
    let characterStart = start - 1
    const codeUnit = text.charCodeAt(characterStart)
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff && characterStart > 0) {
      const previous = text.charCodeAt(characterStart - 1)
      if (previous >= 0xd800 && previous <= 0xdbff) characterStart -= 1
    }
    const character = text.slice(characterStart, start)
    const size = utf8CodePointBytes(character)
    if (bytes + size > maxBytes) break
    bytes += size
    start = characterStart
  }
  return { text: text.slice(start), bytes }
}

function boundedMonolithicOutput (value, maxBytes) {
  const bounded = boundedUtf8String(value, maxBytes)
  if (!bounded.truncated) {
    return {
      output: bounded.text,
      outputBytes: bounded.bytes,
      markerOutput: bounded.text,
      markerBytes: 0
    }
  }
  const markerBudget = Math.min(4 * 1024, Math.floor(maxBytes / 2))
  const output = boundedUtf8String(value, maxBytes - markerBudget)
  const marker = boundedUtf8TailString(value, markerBudget)
  return {
    output: output.text,
    outputBytes: output.bytes,
    markerOutput: marker.text,
    markerBytes: marker.bytes
  }
}

function byteView (value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
}

async function readBoundedValue (value, maxBytes) {
  if (value === undefined || value === null || maxBytes <= 0) {
    return { text: '', bytes: 0 }
  }
  if (typeof value === 'string' ||
    ['number', 'boolean', 'bigint'].includes(typeof value)) {
    return boundedUtf8String(value, maxBytes)
  }
  const bytes = byteView(value)
  if (bytes) {
    const consumedBytes = Math.min(bytes.byteLength, maxBytes)
    const bounded = boundedUtf8String(
      new TextDecoder().decode(bytes.subarray(0, maxBytes)),
      maxBytes
    )
    return { ...bounded, bytes: consumedBytes }
  }

  let text = ''
  let usedBytes = 0
  const append = chunk => {
    const remaining = maxBytes - usedBytes
    const chunkBytes = byteView(chunk)
    const consumedBytes = chunkBytes
      ? Math.min(chunkBytes.byteLength, remaining)
      : undefined
    const bounded = chunkBytes
      ? boundedUtf8String(
        new TextDecoder().decode(chunkBytes.subarray(0, remaining)),
        remaining
      )
      : boundedUtf8String(chunk, remaining)
    text += bounded.text
    usedBytes += consumedBytes ?? bounded.bytes
  }

  if (typeof value?.getReader === 'function') {
    const reader = value.getReader()
    try {
      while (true) {
        if (usedBytes >= maxBytes) break
        const item = await reader.read()
        if (item.done) break
        append(item.value)
      }
      if (usedBytes >= maxBytes) {
        try {
          await reader.cancel()
        } catch {}
      }
    } finally {
      reader.releaseLock?.()
    }
    return { text, bytes: usedBytes }
  }

  if (typeof value?.[Symbol.asyncIterator] === 'function' ||
    typeof value?.[Symbol.iterator] === 'function') {
    for await (const chunk of value) {
      append(chunk)
      if (usedBytes >= maxBytes) break
    }
    return { text, bytes: usedBytes }
  }
  return boundedUtf8String(value, maxBytes)
}

export async function collectBoundedRemoteOutput (
  result,
  maxBytes = maxAuditPreviewBytes
) {
  if (typeof result === 'string') {
    const bounded = boundedMonolithicOutput(result, maxBytes)
    return {
      output: bounded.output,
      markerOutput: bounded.markerOutput
    }
  }
  if (byteView(result)) {
    const bounded = await readBoundedValue(result, maxBytes)
    return { output: bounded.text, markerOutput: bounded.text }
  }
  if (!result || typeof result !== 'object') {
    return { output: '', markerOutput: '' }
  }

  const monolithicStdout = typeof result.stdout === 'string'
    ? boundedMonolithicOutput(result.stdout, maxBytes)
    : null
  const stdout = monolithicStdout || await readBoundedValue(result.stdout, maxBytes)
  let output = monolithicStdout ? stdout.output : stdout.text
  let usedBytes = monolithicStdout
    ? stdout.outputBytes + stdout.markerBytes
    : stdout.bytes
  const values = [result.output, result.stderr]
  if (!output && values.every(value => value == null || value === '')) {
    values.push(result.message)
  }
  for (const value of values) {
    if (value === undefined || value === null || value === '' || usedBytes >= maxBytes) {
      continue
    }
    const separatorBytes = output ? 1 : 0
    if (usedBytes + separatorBytes >= maxBytes) break
    const bounded = await readBoundedValue(
      value,
      maxBytes - usedBytes - separatorBytes
    )
    if (!bounded.text || bounded.text === output) continue
    if (output) {
      output += '\n'
      usedBytes += 1
    }
    output += bounded.text
    usedBytes += bounded.bytes
  }
  return {
    output,
    markerOutput: monolithicStdout ? stdout.markerOutput : stdout.text
  }
}

function remoteCode (result) {
  if (!result || typeof result !== 'object') return undefined
  const codes = [result.code, result.exitCode, result.rc]
    .filter(value => typeof value === 'number' && Number.isFinite(value))
  return codes.find(value => value !== 0) ?? codes[0]
}

function remoteSignal (result) {
  if (!result || typeof result !== 'object') return ''
  return result.signal == null ? '' : String(result.signal).trim()
}

export function createAuditRecord ({ phase, timestamp, code, output }) {
  return {
    phase,
    timestamp,
    code: code === undefined ? null : code,
    preview: redactAndTruncateAuditText(output)
  }
}

function sanitizeError (error, fallback = '安全事务执行失败。') {
  const message = redactAndTruncateAuditText(error?.message || fallback)
  const safeError = new Error(message || fallback)
  if (error?.code !== undefined) safeError.code = error.code
  return safeError
}

function cancellationError () {
  const error = new Error('安全事务已取消。')
  error.cancelled = true
  return error
}

function phaseError (error, audit, cancelled = false) {
  const safeError = cancelled ? cancellationError() : sanitizeError(error)
  safeError.audit = audit
  return safeError
}

function appendAudit (operation, entries) {
  return [...(operation.audit || []), ...entries.filter(Boolean)]
}

function timeoutFor (operation, phase) {
  const value = operation?.[`${phase}TimeoutMs`] ??
    operation?.plan?.[`${phase}TimeoutMs`] ??
    operation?.timeoutMs ??
    defaultTimeouts[phase]
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : defaultTimeouts[phase]
}

function recoveryBindingError () {
  return new Error('恢复绑定指纹不一致，已拒绝执行。')
}

function stableSerialize (value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item) ?? 'null').join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().flatMap(key => {
      const serialized = stableSerialize(value[key])
      return serialized === undefined
        ? []
        : [`${JSON.stringify(key)}:${serialized}`]
    })
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256 (value) {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) {
    throw new Error('当前环境不支持恢复绑定指纹计算。')
  }
  const digest = await cryptoApi.subtle.digest(
    recoveryBindingAlgorithm,
    new TextEncoder().encode(String(value))
  )
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

async function persistedPlan (plan) {
  if (typeof plan?.prepareCommand !== 'string' || !plan.prepareCommand) {
    throw recoveryBindingError()
  }
  const { prepareCommand, ...immutablePlan } = plan
  return redactSensitiveData({
    ...immutablePlan,
    prepareCommandHash: await sha256(prepareCommand)
  })
}

function recoveryBindingPayload (operation, plan, artifacts) {
  const classification = classifyCommand(operation.command)
  const provider = classification.provider
  const operationDir = typeof plan?.operationDir === 'string'
    ? plan.operationDir
    : ''
  if (classification.risk !== 'change' || classification.reversible !== true ||
    !provider || operation.recoveryProvider !== provider ||
    plan?.provider !== provider || !operationDir ||
    plan?.executeCommand !== operation.command ||
    typeof plan?.prepareCommandHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(plan.prepareCommandHash) ||
    typeof plan?.rollbackCommand !== 'string' || !plan.rollbackCommand ||
    typeof plan?.verifyCommand !== 'string' || !plan.verifyCommand ||
    typeof plan?.allowUnsafeExecute !== 'boolean' ||
    stableSerialize(plan?.artifacts) !== stableSerialize(artifacts)) {
    throw recoveryBindingError()
  }
  return {
    schemaVersion: operation.schemaVersion,
    id: operation.id,
    command: operation.command,
    endpoint: operation.endpoint,
    endpointKey: buildEndpointKey(operation.endpoint),
    provider,
    operationDir,
    plan,
    artifacts
  }
}

async function recoveryBindingFingerprint (operation, plan, artifacts) {
  const payload = recoveryBindingPayload(operation, plan, artifacts)
  return sha256(stableSerialize(payload))
}

async function createRecoveryBinding (operation, plan, artifacts) {
  return {
    schemaVersion: recoveryBindingSchemaVersion,
    algorithm: recoveryBindingAlgorithm,
    fingerprint: await recoveryBindingFingerprint(operation, plan, artifacts)
  }
}

async function assertRecoveryBinding (operation) {
  const binding = operation.recoveryBinding
  if (binding?.schemaVersion !== recoveryBindingSchemaVersion ||
    binding?.algorithm !== recoveryBindingAlgorithm ||
    typeof binding?.fingerprint !== 'string') {
    throw recoveryBindingError()
  }
  let fingerprint
  try {
    fingerprint = await recoveryBindingFingerprint(
      operation,
      operation.plan,
      operation.artifacts
    )
  } catch (error) {
    if (error.message.includes('当前环境')) throw error
    throw recoveryBindingError()
  }
  if (binding.fingerprint !== fingerprint) throw recoveryBindingError()
}

function recoveryIntegrityError () {
  const error = new Error('恢复绑定完整性校验失败，远程结果未提交；已恢复原始可回滚信息。')
  error.integrityFailure = true
  return error
}

function clonePersistedValue (value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value))
}

function boundRecoverySnapshot (operation) {
  return clonePersistedValue({
    identity: {
      schemaVersion: operation.schemaVersion,
      id: operation.id,
      command: operation.command,
      endpoint: operation.endpoint,
      endpointKey: operation.endpointKey,
      computedEndpointKey: buildEndpointKey(operation.endpoint)
    },
    classification: {
      risk: operation.risk,
      reversible: operation.reversible,
      recoveryProvider: operation.recoveryProvider,
      requiresConfirmation: operation.requiresConfirmation,
      reason: operation.reason
    },
    plan: operation.plan,
    artifacts: operation.artifacts,
    recoveryBinding: operation.recoveryBinding,
    recoveryReadyAt: operation.recoveryReadyAt
  })
}

function stricterClassification (operation) {
  const classified = classifyCommand(operation.command)
  const hasClaimedRisk = operation.risk !== undefined
  const validClaimedRisk = Object.hasOwn(riskRank, operation.risk)
  const claimedRisk = validClaimedRisk
    ? operation.risk
    : hasClaimedRisk ? 'blocked' : classified.risk
  const risk = riskRank[claimedRisk] >= riskRank[classified.risk]
    ? claimedRisk
    : classified.risk
  const claimsReversible = operation.reversible === true
  const classifierRequiresRecovery = classified.risk === 'change' &&
    classified.reversible === true && classified.provider != null
  const reversible = classifierRequiresRecovery
  const forged = (hasClaimedRisk && !validClaimedRisk) ||
    riskRank[claimedRisk] < riskRank[classified.risk] ||
    (classifierRequiresRecovery && claimedRisk === 'unknown') ||
    (claimsReversible && !classified.reversible) ||
    (operation.recoveryProvider != null && operation.recoveryProvider !== classified.provider)
  return {
    classified,
    forged,
    risk,
    reversible,
    recoveryProvider: reversible ? classified.provider : null,
    requiresConfirmation: risk !== 'readonly',
    reason: classified.reason
  }
}

function classificationPatch (operation, safety) {
  const patch = {
    risk: safety.risk,
    reversible: safety.reversible,
    recoveryProvider: safety.recoveryProvider,
    requiresConfirmation: safety.requiresConfirmation,
    reason: safety.reason
  }
  return Object.entries(patch).some(([key, value]) => operation[key] !== value)
    ? patch
    : null
}

export function createTransactionRunner (options = {}) {
  const runRemote = requireFunction(options.runRemote, 'runRemote')
  const cancelRemote = requireFunction(options.cancelRemote, 'cancelRemote')
  const getCurrentEndpoint = requireFunction(options.getCurrentEndpoint, 'getCurrentEndpoint')
  const buildRecoveryPlan = requireFunction(options.buildRecoveryPlan, 'buildRecoveryPlan')
  const store = options.store || options
  const save = bindStoreMethod(store, 'save', 'saveOperation')
  const get = bindStoreMethod(store, 'get', 'getOperation')
  const patch = bindStoreMethod(store, 'patch', 'patchOperation')
  const guardedPatch = bindStoreMethod(
    store,
    'guardedPatch',
    'guardedPatchOperation'
  )
  const timestamp = resolveClock(options.now)
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const queues = new Map()
  const endpointQueues = new Map()
  const activeExecutions = new Map()
  const cancellationRequests = new Set()
  const boundRecoveries = new Map()
  let executionSequence = 0

  function emit (operationId, status, phase) {
    if (!onEvent) return
    try {
      onEvent({ operationId, status, phase })
    } catch {}
  }

  function serialize (id, work) {
    const previous = queues.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    queues.set(id, current)
    return current.finally(() => {
      if (queues.get(id) === current) queues.delete(id)
    })
  }

  function serializeEndpoint (operation, work) {
    const endpointKey = buildEndpointKey(operation.endpoint)
    const previous = endpointQueues.get(endpointKey) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    endpointQueues.set(endpointKey, current)
    return current.finally(() => {
      if (endpointQueues.get(endpointKey) === current) endpointQueues.delete(endpointKey)
    })
  }

  async function transition (operation, state, extra = {}, phase = state) {
    const current = await get(operation.id) || operation
    if (state !== operationStates.cancelled &&
      (cancellationRequests.has(operation.id) || current.state === operationStates.cancelled)) {
      throw cancellationError()
    }
    if (state === operationStates.cancelled && current.state === operationStates.cancelled) {
      return current
    }
    const next = await patch(operation.id, {
      ...extra,
      state,
      updatedAt: timestamp()
    })
    emit(operation.id, state, phase)
    return next
  }

  async function assertCurrentEndpoint (operation) {
    const current = await getCurrentEndpoint(operation)
    assertSameSessionEndpoint(operation.endpoint, current)
  }

  async function enforceClassification (operation) {
    const safety = stricterClassification(operation)
    const effectivePatch = classificationPatch(operation, safety)
    const current = effectivePatch
      ? await patch(operation.id, { ...effectivePatch, updatedAt: timestamp() })
      : operation
    return { operation: current, safety }
  }

  function rememberBoundRecovery (operation) {
    const bound = boundRecoverySnapshot(operation)
    boundRecoveries.set(operation.id, bound)
    return bound
  }

  async function assertBoundRecovery (operation, bound) {
    await assertRecoveryBinding(operation)
    if (stableSerialize(boundRecoverySnapshot(operation)) !== stableSerialize(bound)) {
      throw recoveryIntegrityError()
    }
    return operation
  }

  async function failIntegrity (operation, bound, entries = []) {
    const error = recoveryIntegrityError()
    const current = await get(operation.id) || operation
    await transition(current, operationStates.failed, {
      command: bound.identity.command,
      endpoint: clonePersistedValue(bound.identity.endpoint),
      endpointKey: bound.identity.endpointKey,
      risk: bound.classification.risk,
      reversible: bound.classification.reversible,
      recoveryProvider: bound.classification.recoveryProvider,
      requiresConfirmation: bound.classification.requiresConfirmation,
      reason: bound.classification.reason,
      plan: clonePersistedValue(bound.plan),
      artifacts: clonePersistedValue(bound.artifacts),
      recoveryBinding: clonePersistedValue(bound.recoveryBinding),
      recoveryReadyAt: bound.recoveryReadyAt,
      audit: appendAudit(current, entries),
      error: error.message,
      integrityError: error.message,
      failedAt: timestamp(),
      executionId: undefined
    }, 'failed')
    error.integrityFailureHandled = true
    throw error
  }

  async function requireBoundRecovery (operation) {
    const bound = boundRecoveries.get(operation.id)
    if (!bound) {
      await assertRecoveryBinding(operation)
      return rememberBoundRecovery(operation)
    }
    try {
      await assertBoundRecovery(operation, bound)
      return bound
    } catch {
      return failIntegrity(operation, bound)
    }
  }

  async function postCheckBoundRecovery (operation, bound, entries = []) {
    const current = await get(operation.id) || operation
    try {
      return await assertBoundRecovery(current, bound)
    } catch {
      return failIntegrity(current, bound, entries)
    }
  }

  async function guardedRecoveryTransition (
    operation,
    bound,
    state,
    extra = {},
    phase = state,
    entries = [],
    shouldEmit = true
  ) {
    try {
      const next = await guardedPatch(
        operation.id,
        async current => {
          try {
            await assertBoundRecovery(current, bound)
            return true
          } catch {
            return false
          }
        },
        async current => {
          if (cancellationRequests.has(operation.id) ||
            current.state === operationStates.cancelled) {
            throw cancellationError()
          }
          const resolvedExtra = typeof extra === 'function'
            ? await extra(current)
            : extra
          return {
            ...resolvedExtra,
            state,
            updatedAt: timestamp()
          }
        }
      )
      if (shouldEmit) emit(operation.id, state, phase)
      return next
    } catch (error) {
      if (error.cancelled) throw error
      if (error.integrityFailure ||
        error.code === 'SAFETY_OPERATION_INTEGRITY' ||
        /完整性|原子更新/.test(error.message)) {
        return failIntegrity(operation, bound, entries)
      }
      throw error
    }
  }

  async function runMarkedPhase (operation, command, phase, runOptions = {}) {
    const current = await get(operation.id) || operation
    if (cancellationRequests.has(operation.id) ||
      current.state === operationStates.cancelled) throw cancellationError()
    const executionId = `${operation.id}-${phase}-${++executionSequence}`
    let rejectCancellation
    const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject })
    const active = {
      executionId,
      cancelRequested: false,
      release () {
        rejectCancellation(cancellationError())
      }
    }
    activeExecutions.set(operation.id, active)
    const remoteCommand = runOptions.alreadyMarked
      ? command
      : buildVerifiedRemoteAction(command, phase, operation.id)
    try {
      let result
      try {
        const remote = Promise.resolve().then(() => runRemote(remoteCommand, {
          timeoutMs: timeoutFor(operation, phase),
          maxOutputBytes: maxAuditPreviewBytes,
          signal: runOptions.signal,
          executionId,
          phase
        }))
        result = await Promise.race([remote, cancellation])
      } catch (error) {
        const cancelled = active.cancelRequested || cancellationRequests.has(operation.id)
        const remoteOutput = await collectBoundedRemoteOutput(error)
        const output = remoteOutput.output ||
          boundedUtf8String(error?.message || '', maxAuditPreviewBytes).text
        const audit = createAuditRecord({
          phase,
          timestamp: timestamp(),
          code: remoteCode(error),
          output
        })
        throw phaseError(error, audit, cancelled)
      }

      const remoteOutput = await collectBoundedRemoteOutput(result)
      const output = remoteOutput.output
      const markerOutput = remoteOutput.markerOutput
      let code = remoteCode(result)
      if (code !== undefined && code !== 0) {
        const error = new Error(`远程${phase}传输执行失败，退出码 ${code}。`)
        error.code = code
        throw phaseError(error, createAuditRecord({
          phase,
          timestamp: timestamp(),
          code,
          output
        }))
      }
      const signal = remoteSignal(result)
      if (signal) {
        const error = new Error(`远程${phase}传输被信号 ${signal} 中断。`)
        throw phaseError(error, createAuditRecord({
          phase,
          timestamp: timestamp(),
          code,
          output
        }))
      }
      try {
        code = parseRemoteActionMarker(markerOutput, phase, operation.id)
      } catch (error) {
        if (error.code !== undefined) code = Number(error.code)
        const audit = createAuditRecord({
          phase,
          timestamp: timestamp(),
          code,
          output
        })
        throw phaseError(error, audit)
      }
      return {
        executionId,
        cancelRequested: active.cancelRequested,
        audit: createAuditRecord({
          phase,
          timestamp: timestamp(),
          code,
          output
        })
      }
    } finally {
      if (activeExecutions.get(operation.id) === active) {
        activeExecutions.delete(operation.id)
      }
    }
  }

  async function fail (operation, error, entries = []) {
    const current = await get(operation.id) || operation
    if (current.state === operationStates.cancelled ||
      cancellationRequests.has(operation.id)) {
      throw cancellationError()
    }
    await transition(current, operationStates.failed, {
      audit: appendAudit(current, entries),
      error: sanitizeError(error).message,
      failedAt: timestamp(),
      executionId: undefined
    }, 'failed')
    throw sanitizeError(error)
  }

  async function cancelState (operation, entries = [], failure) {
    const current = await get(operation.id) || operation
    const preservesRecovery = [
      operationStates.executing,
      operationStates.rollingBack
    ].includes(current.state) && Boolean(
      current.recoveryBinding &&
      current.recoveryReadyAt &&
      current.plan?.rollbackCommand &&
      current.plan?.verifyCommand
    )
    const state = failure || preservesRecovery
      ? operationStates.failed
      : operationStates.cancelled
    const next = await patch(current.id, {
      audit: appendAudit(current, entries),
      error: failure?.message || cancellationError().message,
      ...(state === operationStates.failed
        ? { failedAt: timestamp() }
        : { completedAt: timestamp() }),
      state,
      updatedAt: timestamp(),
      executionId: undefined
    })
    emit(current.id, state, 'cancel')
    return next
  }

  function prepare (request = {}) {
    const id = String(request.id || '')
    if (!id) return Promise.reject(new Error('安全事务标识不能为空。'))
    return serialize(id, async () => {
      let operation
      try {
        boundRecoveries.delete(id)
        const { signal, ...persistedRequest } = request
        operation = await save({
          ...persistedRequest,
          state: operationStates.preparing,
          updatedAt: timestamp()
        })
        emit(id, operationStates.preparing, 'prepare')
        let enforced = await enforceClassification(operation)
        operation = enforced.operation
        if (enforced.safety.forged) {
          throw new Error('命令安全分类与事务记录不一致，已拒绝伪造的低风险声明。')
        }
        if (enforced.safety.risk === 'blocked') {
          throw new Error('该命令重新分类为 blocked，属于明确禁止操作。')
        }

        // Lock order is always operation id first, then endpoint key. cancel takes neither.
        return await serializeEndpoint(operation, async () => {
          operation = await get(operation.id) || operation
          enforced = await enforceClassification(operation)
          operation = enforced.operation
          if (enforced.safety.forged) {
            throw new Error('命令安全分类与事务记录不一致，已拒绝伪造的低风险声明。')
          }
          if (enforced.safety.risk === 'blocked') {
            throw new Error('该命令重新分类为 blocked，属于明确禁止操作。')
          }
          await assertCurrentEndpoint(operation)
          if (cancellationRequests.has(operation.id) ||
            operation.state === operationStates.cancelled) throw cancellationError()
          if (!enforced.safety.reversible) {
            return transition(
              operation,
              operationStates.awaitingConfirmation,
              {},
              'prepare'
            )
          }

          const plan = await buildRecoveryPlan(operation)
          const savedPlan = await persistedPlan(plan)
          const artifacts = savedPlan.artifacts || {}
          const recoveryBinding = await createRecoveryBinding(
            operation,
            savedPlan,
            artifacts
          )
          if (cancellationRequests.has(operation.id)) throw cancellationError()
          const phase = await runMarkedPhase(
            operation,
            plan.prepareCommand,
            'prepare',
            { signal }
          )
          const recoveryReady = await transition(operation, operationStates.recoveryReady, {
            plan: savedPlan,
            recoveryBinding,
            artifacts,
            audit: appendAudit(operation, [phase.audit]),
            recoveryReadyAt: timestamp(),
            executionId: undefined
          }, 'prepare')
          rememberBoundRecovery(recoveryReady)
          return transition(
            recoveryReady,
            operationStates.awaitingConfirmation,
            {},
            'prepare'
          )
        })
      } catch (error) {
        if (!operation) throw sanitizeError(error)
        const current = await get(operation.id) || operation
        if (error.cancelled || cancellationRequests.has(operation.id) ||
          current.state === operationStates.cancelled) throw cancellationError()
        return fail(operation, error, [error.audit])
      }
    })
  }

  function execute (id, executeOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (operation.state !== operationStates.awaitingConfirmation) {
        throw new Error('安全事务必须处于 awaiting-confirmation 状态才能执行。')
      }
      if (executeOptions.confirmed !== true) {
        throw new Error('必须明确确认后才能执行安全事务。')
      }
      let safety
      let boundRecovery
      try {
        return await serializeEndpoint(operation, async () => {
          operation = await get(operation.id) || operation
          if (operation.state === operationStates.cancelled) throw cancellationError()
          if (operation.state !== operationStates.awaitingConfirmation) {
            throw new Error('安全事务必须处于 awaiting-confirmation 状态才能执行。')
          }
          const enforced = await enforceClassification(operation)
          operation = enforced.operation
          safety = enforced.safety
          if (safety.forged) {
            throw new Error('命令安全分类与事务记录不一致，已拒绝伪造的低风险声明。')
          }
          await assertCurrentEndpoint(operation)
          if (safety.risk === 'blocked') {
            throw new Error('该命令重新分类为 blocked，属于明确禁止操作。')
          }
          if (safety.reversible) {
            if (!operation.plan || !operation.artifacts || !operation.recoveryReadyAt) {
              throw new Error('可逆事务尚未完成 recovery-ready，已拒绝执行。')
            }
            boundRecovery = await requireBoundRecovery(operation)
          } else {
            if (safety.classified.provider === 'network') {
              throw new Error('网络修改禁止 unsafe 执行，必须使用已验证恢复点。')
            }
            if (executeOptions.allowUnsafe !== true) {
              throw new Error('非可逆或未知操作必须显式允许 unsafe 执行。')
            }
          }

          operation = await transition(operation, operationStates.executing, {}, 'execute')
          operation = await get(operation.id) || operation
          if (safety.reversible) {
            operation = await postCheckBoundRecovery(operation, boundRecovery)
          }
          const executeCommand = operation.command
          const phase = await runMarkedPhase(
            operation,
            executeCommand,
            'execute',
            { signal: executeOptions.signal }
          )
          if (phase.cancelRequested) throw cancellationError()
          if (safety.reversible) {
            const verified = await guardedRecoveryTransition(
              operation,
              boundRecovery,
              operationStates.verificationPassed,
              current => ({
                audit: appendAudit(current, [phase.audit]),
                executionId: undefined
              }),
              'execute',
              [phase.audit]
            )
            return guardedRecoveryTransition(
              verified,
              boundRecovery,
              operationStates.rollbackAvailable,
              { completedAt: timestamp() },
              'execute'
            )
          }
          return transition(operation, operationStates.kept, {
            audit: appendAudit(operation, [phase.audit]),
            completedAt: timestamp(),
            executionId: undefined
          }, 'execute')
        })
      } catch (error) {
        if (error.integrityFailureHandled) throw sanitizeError(error)
        const current = await get(operation.id) || operation
        if (error.cancelled || cancellationRequests.has(operation.id) ||
          current.state === operationStates.cancelled) throw cancellationError()
        if (safety?.forged || safety?.risk === 'blocked' ||
          /网络修改禁止|recovery-ready/.test(error.message)) {
          return fail(operation, error, [error.audit])
        }
        if (current.state === operationStates.awaitingConfirmation &&
          /unsafe/.test(error.message)) {
          throw sanitizeError(error)
        }
        return fail(operation, error, [error.audit])
      }
    })
  }

  function beginExternalExecution (id, executeOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (operation.state !== operationStates.awaitingConfirmation) {
        throw new Error('安全事务必须处于 awaiting-confirmation 状态才能开始外部执行。')
      }
      if (executeOptions.confirmed !== true) {
        throw new Error('必须明确确认后才能开始外部执行。')
      }
      let safety
      let boundRecovery
      try {
        return await serializeEndpoint(operation, async () => {
          operation = await get(operation.id) || operation
          if (operation.state === operationStates.cancelled) throw cancellationError()
          if (operation.state !== operationStates.awaitingConfirmation) {
            throw new Error('安全事务必须处于 awaiting-confirmation 状态才能开始外部执行。')
          }
          const enforced = await enforceClassification(operation)
          operation = enforced.operation
          safety = enforced.safety
          if (safety.forged) {
            throw new Error('命令安全分类与事务记录不一致，已拒绝伪造的低风险声明。')
          }
          await assertCurrentEndpoint(operation)
          if (safety.risk === 'blocked') {
            throw new Error('该命令重新分类为 blocked，属于明确禁止操作。')
          }
          if (safety.reversible) {
            if (!operation.plan || !operation.artifacts || !operation.recoveryReadyAt) {
              throw new Error('可逆事务尚未完成 recovery-ready，已拒绝外部执行。')
            }
            boundRecovery = await requireBoundRecovery(operation)
          } else {
            if (safety.classified.provider === 'network') {
              throw new Error('网络修改禁止 unsafe 执行，必须使用已验证恢复点。')
            }
            if (executeOptions.allowUnsafe !== true) {
              throw new Error('非可逆或未知操作必须显式允许 unsafe 外部执行。')
            }
          }

          const executionId = `${operation.id}-external-${++executionSequence}`
          operation = await transition(operation, operationStates.executing, {
            executionId
          }, 'execute')
          operation = await get(operation.id) || operation
          if (safety.reversible) {
            operation = await postCheckBoundRecovery(operation, boundRecovery)
          }
          return operation
        })
      } catch (error) {
        if (error.integrityFailureHandled) throw sanitizeError(error)
        const current = await get(operation.id) || operation
        if (error.cancelled || cancellationRequests.has(operation.id) ||
          current.state === operationStates.cancelled) throw cancellationError()
        if (safety?.forged || safety?.risk === 'blocked' ||
          /网络修改禁止|recovery-ready/.test(error.message)) {
          return fail(operation, error, [error.audit])
        }
        if (current.state === operationStates.awaitingConfirmation &&
          /unsafe/.test(error.message)) {
          throw sanitizeError(error)
        }
        return fail(operation, error, [error.audit])
      }
    })
  }

  function completeExternalExecution (id, completion = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (operation.state !== operationStates.executing) {
        throw new Error('安全事务必须处于 executing 状态才能完成外部执行。')
      }
      if (!completion.executionId || completion.executionId !== operation.executionId) {
        throw new Error('外部执行标识不匹配，已忽略无关或迟到事件。')
      }
      if (completion.command !== operation.command) {
        throw new Error('外部执行命令不匹配，已忽略无关命令事件。')
      }
      if (completion.exitCode !== null && !Number.isInteger(completion.exitCode)) {
        throw new Error('外部执行退出码无效。')
      }

      return serializeEndpoint(operation, async () => {
        operation = await get(operation.id) || operation
        if (operation.state !== operationStates.executing) {
          throw new Error('安全事务必须处于 executing 状态才能完成外部执行。')
        }
        if (completion.executionId !== operation.executionId) {
          throw new Error('外部执行标识不匹配，已忽略无关或迟到事件。')
        }
        if (completion.command !== operation.command) {
          throw new Error('外部执行命令不匹配，已忽略无关命令事件。')
        }

        const enforced = await enforceClassification(operation)
        operation = enforced.operation
        const safety = enforced.safety
        if (safety.forged || safety.risk === 'blocked') {
          throw new Error('外部执行完成时安全分类校验失败。')
        }
        await assertCurrentEndpoint(operation)
        const audit = createAuditRecord({
          phase: 'execute',
          timestamp: timestamp(),
          code: completion.exitCode === null ? undefined : completion.exitCode,
          output: completion.exitCode === null
            ? '外部 PTY 命令未返回可验证退出码。'
            : ''
        })
        const failed = completion.exitCode !== 0

        if (safety.reversible) {
          const boundRecovery = await requireBoundRecovery(operation)
          if (failed) {
            const error = completion.exitCode === null
              ? '外部 PTY 命令执行中断，恢复点仍可用于回滚。'
              : `外部 PTY 命令执行失败，退出码 ${completion.exitCode}；恢复点仍可用于回滚。`
            return guardedRecoveryTransition(
              operation,
              boundRecovery,
              operationStates.failed,
              current => ({
                audit: appendAudit(current, [audit]),
                error,
                failedAt: timestamp(),
                executionId: undefined
              }),
              'execute',
              [audit]
            )
          }
          const verified = await guardedRecoveryTransition(
            operation,
            boundRecovery,
            operationStates.verificationPassed,
            current => ({
              audit: appendAudit(current, [audit]),
              executionId: undefined
            }),
            'execute',
            [audit]
          )
          return guardedRecoveryTransition(
            verified,
            boundRecovery,
            operationStates.rollbackAvailable,
            { completedAt: timestamp() },
            'execute'
          )
        }

        if (failed) {
          const error = completion.exitCode === null
            ? '外部 PTY 命令执行中断。'
            : `外部 PTY 命令执行失败，退出码 ${completion.exitCode}。`
          return transition(operation, operationStates.failed, {
            audit: appendAudit(operation, [audit]),
            error,
            failedAt: timestamp(),
            executionId: undefined
          }, 'execute')
        }
        return transition(operation, operationStates.kept, {
          audit: appendAudit(operation, [audit]),
          completedAt: timestamp(),
          executionId: undefined
        }, 'execute')
      })
    })
  }

  function rollback (id, rollbackOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (![operationStates.rollbackAvailable, operationStates.failed].includes(operation.state)) {
        throw new Error('当前安全事务状态不允许回滚。')
      }
      if (!operation.plan?.rollbackCommand || !operation.plan?.verifyCommand) {
        throw new Error('安全事务没有可用恢复计划，无法回滚。')
      }
      const audits = []
      let boundRecovery
      try {
        return await serializeEndpoint(operation, async () => {
          operation = await get(operation.id) || operation
          if (operation.state === operationStates.cancelled) throw cancellationError()
          if (![operationStates.rollbackAvailable, operationStates.failed].includes(operation.state)) {
            throw new Error('当前安全事务状态不允许回滚。')
          }
          if (!operation.plan?.rollbackCommand || !operation.plan?.verifyCommand) {
            throw new Error('安全事务没有可用恢复计划，无法回滚。')
          }
          await assertCurrentEndpoint(operation)
          boundRecovery = await requireBoundRecovery(operation)
          operation = await transition(operation, operationStates.rollingBack, {}, 'rollback')
          operation = await get(operation.id) || operation
          operation = await postCheckBoundRecovery(operation, boundRecovery)
          const rollbackCommand = operation.plan.rollbackCommand
          const rollbackPhase = await runMarkedPhase(
            operation,
            rollbackCommand,
            'rollback',
            { alreadyMarked: true, signal: rollbackOptions.signal }
          )
          audits.push(rollbackPhase.audit)
          if (rollbackPhase.cancelRequested) throw cancellationError()
          operation = await guardedRecoveryTransition(
            operation,
            boundRecovery,
            operationStates.rollingBack,
            current => ({
              audit: appendAudit(current, audits),
              executionId: undefined
            }),
            'rollback',
            audits,
            false
          )
          audits.length = 0
          const verifyCommand = operation.plan.verifyCommand
          const verifyPhase = await runMarkedPhase(
            operation,
            verifyCommand,
            'verify',
            { alreadyMarked: true, signal: rollbackOptions.signal }
          )
          audits.push(verifyPhase.audit)
          if (verifyPhase.cancelRequested) throw cancellationError()
          const restored = await guardedRecoveryTransition(
            operation,
            boundRecovery,
            operationStates.restored,
            current => ({
              audit: appendAudit(current, audits),
              completedAt: timestamp(),
              executionId: undefined
            }),
            'verify',
            audits
          )
          boundRecoveries.delete(operation.id)
          return restored
        })
      } catch (error) {
        if (error.integrityFailureHandled) throw sanitizeError(error)
        if (error.audit) audits.push(error.audit)
        const current = await get(operation.id) || operation
        if (error.cancelled || cancellationRequests.has(operation.id) ||
          current.state === operationStates.cancelled) throw cancellationError()
        return fail(operation, error, audits)
      }
    })
  }

  function keep (id) {
    return serialize(String(id), async () => {
      const operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (operation.state !== operationStates.rollbackAvailable) {
        throw new Error('只有 rollback-available 状态可以确认保留。')
      }
      const kept = await transition(operation, operationStates.kept, {
        completedAt: timestamp()
      }, 'keep')
      boundRecoveries.delete(operation.id)
      return kept
    })
  }

  async function cancel (id) {
    const operationId = String(id)
    cancellationRequests.add(operationId)
    const active = activeExecutions.get(operationId)
    let cancellationFailure
    if (active) {
      active.cancelRequested = true
      try {
        await cancelRemote(active.executionId, {
          maxOutputBytes: maxAuditPreviewBytes,
          phase: 'cancel'
        })
      } catch (error) {
        cancellationFailure = sanitizeError(error)
      } finally {
        active.release()
      }
    }

    if (cancellationFailure) {
      try {
        const current = await get(operationId)
        if (current && !terminalStates.has(current.state) &&
          cancellableStates.has(current.state)) {
          await cancelState(current, [], cancellationFailure)
        }
      } finally {
        cancellationRequests.delete(operationId)
      }
      throw cancellationFailure
    }

    let current
    try {
      current = await get(operationId)
      if (current && !terminalStates.has(current.state) &&
        cancellableStates.has(current.state)) {
        current = await cancelState(current)
        if (current.state === operationStates.cancelled) {
          boundRecoveries.delete(operationId)
        }
      }
    } finally {
      cancellationRequests.delete(operationId)
    }
    return current
  }

  return {
    prepare,
    execute,
    beginExternalExecution,
    completeExternalExecution,
    rollback,
    keep,
    cancel
  }
}
