import { redactAuditText } from './audit-redaction.js'
import { classifyCommand } from './command-classifier.js'
import { assertSameSessionEndpoint, buildEndpointKey } from './endpoint-guard.js'
import { operationStates } from './models.js'
import {
  buildSideEffectKey,
  sftpSideEffectActions
} from './side-effect-model.js'
import {
  assertRecoveryBinding,
  createPersistedRecoveryPlan,
  createRecoveryBinding,
  stableSerialize
} from './recovery-binding.js'
import {
  buildVerifiedRemoteAction,
  parseRemoteActionMarker
} from './remote-recovery.js'
import {
  assertAuthorizedMaintenanceRecovery,
  assertPersistedMaintenanceRecoveryOperation,
  consumeInternalMaintenanceRecoveryAuthorization,
  maintenanceRecoveryProvider
} from './maintenance-recovery-delegation.js'

export const maxAuditPreviewBytes = 64 * 1024

const terminalStates = new Set([
  operationStates.verificationPassed,
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
const rollbackStates = new Set([
  operationStates.verificationPassed,
  operationStates.rollbackAvailable,
  operationStates.failed
])

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
  const identity = operation.operationKind === 'side-effect'
    ? {
        schemaVersion: operation.schemaVersion,
        id: operation.id,
        operationKind: operation.operationKind,
        effect: operation.effect,
        effectKey: operation.effectKey,
        endpoint: operation.endpoint,
        endpointKey: operation.endpointKey,
        computedEndpointKey: buildEndpointKey(operation.endpoint)
      }
    : {
        schemaVersion: operation.schemaVersion,
        id: operation.id,
        command: operation.command,
        endpoint: operation.endpoint,
        endpointKey: operation.endpointKey,
        computedEndpointKey: buildEndpointKey(operation.endpoint)
      }
  return clonePersistedValue({
    identity,
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

function stricterClassification (operation, maintenanceAuthorization) {
  if (operation.operationKind === 'side-effect') {
    const supportedAction = operation.effect?.adapter === 'sftp' &&
      sftpSideEffectActions.includes(operation.effect?.action)
    let validEffectKey = false
    try {
      validEffectKey = supportedAction &&
        operation.effectKey === buildSideEffectKey(operation.effect)
    } catch {}
    const forged = !validEffectKey || operation.risk !== 'change' ||
      operation.reversible !== true || operation.recoveryProvider !== 'sftp' ||
      operation.requiresConfirmation !== true
    return {
      classified: {
        risk: 'change',
        reversible: true,
        provider: 'sftp'
      },
      forged,
      risk: 'change',
      reversible: true,
      recoveryProvider: 'sftp',
      requiresConfirmation: true,
      reason: 'SFTP side-effect requires a verified recovery point.'
    }
  }
  if (maintenanceAuthorization ||
    operation.recoveryProvider === maintenanceRecoveryProvider) {
    let authorized = false
    try {
      if (maintenanceAuthorization) {
        assertAuthorizedMaintenanceRecovery(maintenanceAuthorization, operation)
      } else {
        if (!operation.recoveryBinding) throw new Error('维护恢复记录尚未绑定。')
        assertPersistedMaintenanceRecoveryOperation(operation)
      }
      authorized = true
    } catch {}
    const forged = !authorized || operation.risk !== 'change' ||
      operation.provider !== maintenanceRecoveryProvider ||
      operation.reversible !== true ||
      operation.recoveryProvider !== maintenanceRecoveryProvider ||
      operation.requiresConfirmation !== true
    return {
      classified: {
        risk: 'change',
        reversible: true,
        provider: maintenanceRecoveryProvider
      },
      forged,
      risk: 'change',
      reversible: true,
      recoveryProvider: maintenanceRecoveryProvider,
      requiresConfirmation: true,
      reason: 'Authenticated quick command provides a fixed rollback script.'
    }
  }
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
  const sideEffectAdapter = options.sideEffectAdapter
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
  const authorizedMaintenanceRecoveries = new Map()
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

  async function requireSideEffectAdapter (operation) {
    if (!sideEffectAdapter || typeof sideEffectAdapter !== 'object') {
      throw new Error('当前 SFTP 安全事务缺少 sideEffectAdapter。')
    }
    for (const method of [
      'supports',
      'prepare',
      'beforeExecute',
      'verifyExecute',
      'rollback',
      'verifyRollback'
    ]) {
      requireFunction(sideEffectAdapter[method], `sideEffectAdapter.${method}`)
    }
    if (await sideEffectAdapter.supports(operation) !== true) {
      throw new Error('当前 sideEffectAdapter 不支持该 SFTP 操作。')
    }
    return sideEffectAdapter
  }

  function sideEffectAudit (phase, result, code = 0) {
    const output = result?.summary || result?.message || `${phase} completed`
    return createAuditRecord({ phase, timestamp: timestamp(), code, output })
  }

  async function runSideEffectHook (adapter, method, operation, context = {}) {
    if (cancellationRequests.has(operation.id)) throw cancellationError()
    const executionId = `${operation.id}-${context.phase || method}-${++executionSequence}`
    const controller = new AbortController()
    const externalSignal = context.signal
    const abortFromExternalSignal = () => controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) {
      abortFromExternalSignal()
    } else if (typeof externalSignal?.addEventListener === 'function') {
      externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true })
    }
    let resolveSettled
    const active = {
      kind: 'side-effect',
      executionId,
      cancelRequested: false,
      settled: new Promise(resolve => { resolveSettled = resolve }),
      abort () {
        controller.abort()
      }
    }
    const persistMutationMarker = async (mutationOptions) => {
      const bound = await requireBoundRecovery(operation)
      const markerAt = timestamp()
      let guardFailure
      try {
        return await guardedPatch(
          operation.id,
          async current => {
            if (controller.signal.aborted ||
              cancellationRequests.has(operation.id) ||
              current.state === operationStates.cancelled) {
              guardFailure = cancellationError()
              return false
            }
            try {
              await assertCurrentEndpoint(current)
            } catch (error) {
              guardFailure = error
              return false
            }
            try {
              await assertBoundRecovery(current, bound)
            } catch {
              guardFailure = recoveryIntegrityError()
              return false
            }
            if (current.state !== operation.state) {
              guardFailure = new Error(
                'SFTP 安全事务阶段状态已变化，已停止后续修改。'
              )
              return false
            }
            return true
          },
          current => ({
            mutationStarted: true,
            mutationStartedAt: current.mutationStartedAt || markerAt,
            ...(mutationOptions.commitPoint !== false
              ? {
                  commitPoint: true,
                  commitPointAt: current.commitPointAt || markerAt
                }
              : {}),
            updatedAt: markerAt
          })
        )
      } catch (error) {
        if (guardFailure?.cancelled) throw guardFailure
        if (guardFailure?.integrityFailure) {
          return failIntegrity(operation, bound)
        }
        if (guardFailure) throw guardFailure
        if (error.integrityFailure ||
          error.code === 'SAFETY_OPERATION_INTEGRITY' ||
          /完整性|原子更新/.test(error.message)) {
          return failIntegrity(operation, bound)
        }
        throw error
      }
    }
    const runMutation = async (work, mutationOptions = {}) => {
      if (typeof work !== 'function') {
        throw new Error('SFTP mutation lifecycle 缺少远程修改函数。')
      }
      if (controller.signal.aborted || cancellationRequests.has(operation.id)) {
        throw cancellationError()
      }
      await persistMutationMarker(mutationOptions)
      if (controller.signal.aborted || cancellationRequests.has(operation.id)) {
        throw cancellationError()
      }
      let effectPromise
      try {
        effectPromise = Promise.resolve(work())
      } catch (error) {
        effectPromise = Promise.reject(error)
      }
      return effectPromise
    }
    activeExecutions.set(operation.id, active)
    try {
      const result = await adapter[method](operation, {
        ...context,
        executionId,
        signal: controller.signal,
        runMutation
      })
      if (controller.signal.aborted) {
        throw cancellationError()
      }
      if (result === false || result?.verified === false) {
        throw new Error(`SFTP 安全事务 ${method} 验证失败。`)
      }
      return { result, audit: sideEffectAudit(context.phase || method, result) }
    } catch (error) {
      if (controller.signal.aborted || active.cancelRequested ||
        cancellationRequests.has(operation.id)) {
        throw cancellationError()
      }
      if (!error.audit) {
        error.audit = sideEffectAudit(
          context.phase || method,
          { summary: error?.message || String(error) },
          null
        )
      }
      throw error
    } finally {
      if (typeof externalSignal?.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', abortFromExternalSignal)
      }
      if (activeExecutions.get(operation.id) === active) {
        activeExecutions.delete(operation.id)
      }
      resolveSettled()
    }
  }

  async function enforceClassification (operation) {
    const safety = stricterClassification(
      operation,
      authorizedMaintenanceRecoveries.get(operation.id)
    )
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
      ...(bound.identity.operationKind === 'side-effect'
        ? {
            operationKind: bound.identity.operationKind,
            effect: clonePersistedValue(bound.identity.effect),
            effectKey: bound.identity.effectKey
          }
        : { command: bound.identity.command }),
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
    if (operation.recoveryRevokedAt) {
      throw new Error('��ǰά���ָ���¼�ѳ����������ٴ�ִ�лع���')
    }
    const bound = boundRecoveries.get(operation.id)
    if (!bound) {
      if (operation.recoveryProvider === maintenanceRecoveryProvider &&
        !authorizedMaintenanceRecoveries.has(operation.id)) {
        throw new Error('��ǰά���ָ���¼ȱ�ٱ��λỰ��Ȩ������ִ�лع���')
      }
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

  async function assertSideEffectPhase (
    operation,
    bound,
    allowedStates,
    entries = []
  ) {
    const current = await get(operation.id) || operation
    await assertCurrentEndpoint(current)
    const checked = await postCheckBoundRecovery(current, bound, entries)
    if (cancellationRequests.has(operation.id) ||
      checked.state === operationStates.cancelled) {
      throw cancellationError()
    }
    if (allowedStates && !allowedStates.includes(checked.state)) {
      throw new Error('SFTP 安全事务阶段状态已变化，已停止后续修改。')
    }
    return checked
  }

  async function bindPostMutationArtifacts (operation, bound, verifyResult) {
    if (!verifyResult?.postMutation) return null
    const artifacts = {
      ...clonePersistedValue(bound.artifacts),
      postMutation: clonePersistedValue(verifyResult.postMutation)
    }
    return {
      artifacts,
      recoveryBinding: await createRecoveryBinding(
        operation,
        bound.plan,
        artifacts
      )
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
    const hasRecovery = Boolean(
      current.recoveryBinding &&
      current.recoveryReadyAt &&
      (current.operationKind === 'side-effect'
        ? current.plan?.adapter === current.effect?.adapter
        : current.plan?.rollbackCommand && current.plan?.verifyCommand)
    )
    const preservesRecovery = hasRecovery && (
      current.operationKind === 'side-effect'
        ? current.mutationStarted === true || current.commitPoint === true
        : [
            operationStates.executing,
            operationStates.rollingBack
          ].includes(current.state)
    )
    const rollbackCancelled = !failure && preservesRecovery &&
      current.state === operationStates.rollingBack
    const state = rollbackCancelled
      ? operationStates.rollbackAvailable
      : failure || preservesRecovery
        ? operationStates.failed
        : operationStates.cancelled
    const next = await patch(current.id, {
      audit: appendAudit(current, entries),
      error: failure?.message || cancellationError().message,
      ...(state === operationStates.failed
        ? { failedAt: timestamp() }
        : state === operationStates.cancelled
          ? { completedAt: timestamp() }
          : {}),
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
    const hasMaintenanceAuthorization =
      request.maintenanceRecoveryAuthorization !== undefined
    const maintenanceAuthorization = hasMaintenanceAuthorization
      ? consumeInternalMaintenanceRecoveryAuthorization(
        request.maintenanceRecoveryAuthorization
      )
      : undefined
    if (hasMaintenanceAuthorization && (!maintenanceAuthorization ||
      maintenanceAuthorization.operationId !== id ||
      maintenanceAuthorization.command !== request.command)) {
      return Promise.reject(new Error('维护操作恢复授权无效。'))
    }
    return serialize(id, async () => {
      let operation
      try {
        boundRecoveries.delete(id)
        if (maintenanceAuthorization) {
          authorizedMaintenanceRecoveries.set(id, maintenanceAuthorization)
        } else {
          authorizedMaintenanceRecoveries.delete(id)
        }
        const { signal, maintenanceRecoveryAuthorization, ...persistedRequest } = request
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
          if (operation.operationKind === 'side-effect') {
            const adapter = await requireSideEffectAdapter(operation)
            const preparedPhase = await runSideEffectHook(
              adapter,
              'prepare',
              operation,
              { phase: 'prepare', signal }
            )
            await assertCurrentEndpoint(operation)
            operation = await get(operation.id) || operation
            enforced = await enforceClassification(operation)
            operation = enforced.operation
            if (enforced.safety.forged) {
              throw new Error('SFTP side-effect 结构或权威安全分类已被修改。')
            }
            const prepared = preparedPhase.result
            if (prepared?.manifestComplete !== true ||
              !prepared.plan || typeof prepared.plan !== 'object' ||
              !prepared.artifacts || typeof prepared.artifacts !== 'object' ||
              !Object.keys(prepared.artifacts).length) {
              throw new Error('SFTP 快照清单尚未完整，不能进入 recovery-ready。')
            }
            const savedPlan = clonePersistedValue(prepared.plan)
            const artifacts = clonePersistedValue(prepared.artifacts)
            const recoveryBinding = await createRecoveryBinding(
              operation,
              savedPlan,
              artifacts
            )
            if (cancellationRequests.has(operation.id)) throw cancellationError()
            const recoveryReady = await transition(
              operation,
              operationStates.recoveryReady,
              {
                plan: savedPlan,
                recoveryBinding,
                artifacts,
                audit: appendAudit(operation, [preparedPhase.audit]),
                recoveryReadyAt: timestamp(),
                executionId: undefined
              },
              'prepare'
            )
            await assertCurrentEndpoint(recoveryReady)
            await assertRecoveryBinding(recoveryReady)
            rememberBoundRecovery(recoveryReady)
            return transition(
              recoveryReady,
              operationStates.awaitingConfirmation,
              {},
              'prepare'
            )
          }
          if (!enforced.safety.reversible) {
            return transition(
              operation,
              operationStates.awaitingConfirmation,
              {},
              'prepare'
            )
          }

          const plan = await buildRecoveryPlan(operation)
          const savedPlan = await createPersistedRecoveryPlan(plan)
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
        authorizedMaintenanceRecoveries.delete(id)
        if (!operation) throw sanitizeError(error)
        const current = await get(operation.id) || operation
        if (error.cancelled || cancellationRequests.has(operation.id) ||
          current.state === operationStates.cancelled) throw cancellationError()
        return fail(operation, error, [error.audit])
      }
    })
  }

  async function executeSideEffectWork (operation, executeOptions) {
    if (executeOptions.confirmed !== true) {
      throw new Error('必须明确确认后才能执行 SFTP 安全事务。')
    }
    if (![operationStates.awaitingConfirmation,
      operationStates.verificationPassed,
      operationStates.rollbackAvailable].includes(operation.state)) {
      throw new Error('SFTP 安全事务必须处于 awaiting-confirmation 状态才能执行。')
    }
    const audits = []
    let boundRecovery
    try {
      return await serializeEndpoint(operation, async () => {
        operation = await get(operation.id) || operation
        const adapter = await requireSideEffectAdapter(operation)
        if ([operationStates.verificationPassed,
          operationStates.rollbackAvailable].includes(operation.state)) {
          boundRecovery = await requireBoundRecovery(operation)
          operation = await assertSideEffectPhase(
            operation,
            boundRecovery,
            [operation.state]
          )
          const verifiedPhase = await runSideEffectHook(
            adapter,
            'verifyExecute',
            operation,
            {
              phase: 'verify',
              signal: executeOptions.signal,
              input: executeOptions.sideEffectInput
            }
          )
          operation = await assertSideEffectPhase(
            operation,
            boundRecovery,
            [operation.state],
            [verifiedPhase.audit]
          )
          if (operation.state === operationStates.verificationPassed) {
            return guardedRecoveryTransition(
              operation,
              boundRecovery,
              operationStates.rollbackAvailable,
              { completedAt: timestamp() },
              'execute'
            )
          }
          return operation
        }
        if (operation.state !== operationStates.awaitingConfirmation) {
          throw new Error('SFTP 安全事务状态已变化，请刷新后重试。')
        }
        const enforced = await enforceClassification(operation)
        operation = enforced.operation
        if (enforced.safety.forged) {
          throw new Error('SFTP side-effect 结构或权威安全分类已被修改。')
        }
        await assertCurrentEndpoint(operation)
        if (!operation.plan || !operation.artifacts || !operation.recoveryReadyAt) {
          throw new Error('SFTP 安全事务尚未完成 recovery-ready。')
        }
        boundRecovery = await requireBoundRecovery(operation)
        operation = await transition(
          operation,
          operationStates.executing,
          {},
          'execute'
        )

        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.executing]
        )
        const executePhase = await runSideEffectHook(
          adapter,
          'beforeExecute',
          operation,
          {
            phase: 'execute',
            signal: executeOptions.signal,
            input: executeOptions.sideEffectInput
          }
        )
        audits.push(executePhase.audit)
        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.executing],
          audits
        )

        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.executing],
          audits
        )
        const verifyPhase = await runSideEffectHook(
          adapter,
          'verifyExecute',
          operation,
          {
            phase: 'verify',
            signal: executeOptions.signal,
            input: executeOptions.sideEffectInput,
            executeResult: executePhase.result
          }
        )
        audits.push(verifyPhase.audit)
        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.executing],
          audits
        )
        const verifiedRecovery = await bindPostMutationArtifacts(
          operation,
          boundRecovery,
          verifyPhase.result
        )
        const verified = await guardedRecoveryTransition(
          operation,
          boundRecovery,
          operationStates.verificationPassed,
          current => ({
            audit: appendAudit(current, audits),
            executionId: undefined,
            ...(verifiedRecovery || {})
          }),
          'verify',
          audits
        )
        const verifiedBoundRecovery = verifiedRecovery
          ? rememberBoundRecovery(verified)
          : boundRecovery
        return guardedRecoveryTransition(
          verified,
          verifiedBoundRecovery,
          operationStates.rollbackAvailable,
          { completedAt: timestamp() },
          'execute'
        )
      })
    } catch (error) {
      if (error.integrityFailureHandled) throw sanitizeError(error)
      if (error.audit && !audits.includes(error.audit)) audits.push(error.audit)
      const current = await get(operation.id) || operation
      if (error.cancelled) {
        if (!cancellationRequests.has(operation.id) &&
          current.state !== operationStates.cancelled &&
          cancellableStates.has(current.state)) {
          await cancelState(current, audits)
        }
        throw cancellationError()
      }
      if (cancellationRequests.has(operation.id) ||
        current.state === operationStates.cancelled) throw cancellationError()
      return fail(operation, error, audits)
    }
  }

  function validateExternalSideEffectIdentity (operation, value = {}) {
    const identity = String(value.transferIdentity || '')
    if (!identity || identity !== operation.effect?.transfer?.identity) {
      throw new Error('外部 SFTP 传输标识不匹配，已拒绝继续执行。')
    }
    if (value.effectKey !== undefined && value.effectKey !== operation.effectKey) {
      throw new Error('外部 SFTP 传输 effectKey 不匹配，已拒绝继续执行。')
    }
    return identity
  }

  async function beginExternalSideEffectWork (operation, executeOptions) {
    if (executeOptions.confirmed !== true) {
      throw new Error('必须明确确认后才能开始外部 SFTP 传输。')
    }
    if (operation.state !== operationStates.awaitingConfirmation) {
      throw new Error('SFTP 传输事务必须处于 awaiting-confirmation 状态。')
    }
    if (typeof executeOptions.cancelExternal !== 'function') {
      throw new Error('外部 SFTP 传输缺少可取消的 transport 回调。')
    }
    const transferIdentity = validateExternalSideEffectIdentity(
      operation,
      executeOptions
    )
    let active
    try {
      return await serializeEndpoint(operation, async () => {
        operation = await get(operation.id) || operation
        if (operation.state !== operationStates.awaitingConfirmation) {
          throw new Error('SFTP 传输事务状态已变化，请刷新后重试。')
        }
        const enforced = await enforceClassification(operation)
        operation = enforced.operation
        if (enforced.safety.forged || enforced.safety.risk === 'blocked') {
          throw new Error('SFTP 传输事务安全分类校验失败。')
        }
        await assertCurrentEndpoint(operation)
        const adapter = await requireSideEffectAdapter(operation)
        if (typeof adapter.beforeExternalExecute !== 'function') {
          throw new Error('当前 SFTP 适配器不支持外部传输事务。')
        }
        const bound = await requireBoundRecovery(operation)
        operation = await assertSideEffectPhase(
          operation,
          bound,
          [operationStates.awaitingConfirmation]
        )
        const checked = await runSideEffectHook(
          adapter,
          'beforeExternalExecute',
          operation,
          { phase: 'execute-check', signal: executeOptions.signal }
        )
        operation = await assertSideEffectPhase(
          operation,
          bound,
          [operationStates.awaitingConfirmation],
          [checked.audit]
        )
        const executionId = `${operation.id}-external-side-effect-${++executionSequence}`
        const startedAt = timestamp()
        operation = await guardedRecoveryTransition(
          operation,
          bound,
          operationStates.executing,
          current => ({
            audit: appendAudit(current, [checked.audit]),
            executionId,
            mutationStarted: true,
            mutationStartedAt: current.mutationStartedAt || startedAt,
            commitPoint: true,
            commitPointAt: current.commitPointAt || startedAt,
            metadata: {
              ...current.metadata,
              externalExecution: {
                schemaVersion: 1,
                executionId,
                effectKey: current.effectKey,
                transferIdentity,
                batchId: current.effect?.transfer?.batchId || ''
              }
            }
          }),
          'execute',
          [checked.audit]
        )
        active = {
          kind: 'external-side-effect',
          executionId,
          cancelRequested: false,
          cancelExternal: executeOptions.cancelExternal
        }
        activeExecutions.set(operation.id, active)
        return operation
      })
    } catch (error) {
      if (activeExecutions.get(operation.id) === active) {
        activeExecutions.delete(operation.id)
      }
      if (error.integrityFailureHandled) throw sanitizeError(error)
      const current = await get(operation.id) || operation
      if (error.cancelled || cancellationRequests.has(operation.id) ||
        current.state === operationStates.cancelled) throw cancellationError()
      return fail(operation, error, [error.audit])
    }
  }

  function execute (id, executeOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (operation?.operationKind === 'side-effect') {
        return executeSideEffectWork(operation, executeOptions)
      }
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
          } else if (safety.risk !== 'readonly') {
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
      if (operation.operationKind === 'side-effect') {
        return beginExternalSideEffectWork(operation, executeOptions)
      }
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
          } else if (safety.risk !== 'readonly') {
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

  function validateExternalCompletion (operation, completion) {
    if (!completion.executionId) {
      throw new Error('外部执行标识不匹配，已忽略无关或迟到事件。')
    }
    if (operation.operationKind === 'side-effect') {
      validateExternalSideEffectIdentity(operation, completion)
      if (completion.effectKey !== operation.effectKey) {
        throw new Error('外部 SFTP 传输 effectKey 不匹配。')
      }
      if (completion.exitCode !== null && !Number.isInteger(completion.exitCode)) {
        throw new Error('外部 SFTP 传输退出状态无效。')
      }
      return
    }
    if (completion.command !== operation.command) {
      throw new Error('外部执行命令不匹配，已忽略无关命令事件。')
    }
    if (completion.exitCode !== null && !Number.isInteger(completion.exitCode)) {
      throw new Error('外部执行退出码无效。')
    }
  }

  function externalCompletionMetadata (operation, completion) {
    if (operation.operationKind === 'side-effect') {
      return {
        ...operation.metadata,
        externalCompletion: {
          schemaVersion: 1,
          executionId: completion.executionId,
          effectKey: completion.effectKey,
          transferIdentity: completion.transferIdentity,
          exitCode: completion.exitCode,
          cancelled: completion.cancelled === true
        }
      }
    }
    return {
      ...operation.metadata,
      externalCompletion: {
        schemaVersion: 1,
        executionId: completion.executionId,
        command: completion.command,
        exitCode: completion.exitCode
      }
    }
  }

  function matchesExternalCompletion (operation, completion) {
    const receipt = operation.metadata?.externalCompletion
    if (operation.operationKind === 'side-effect') {
      return receipt?.schemaVersion === 1 &&
        receipt.executionId === completion.executionId &&
        receipt.effectKey === completion.effectKey &&
        receipt.transferIdentity === completion.transferIdentity &&
        receipt.exitCode === completion.exitCode &&
        receipt.cancelled === (completion.cancelled === true)
    }
    return receipt?.schemaVersion === 1 &&
      receipt.executionId === completion.executionId &&
      receipt.command === completion.command &&
      receipt.exitCode === completion.exitCode
  }

  async function resumeExternalCompletion (operation, completion) {
    if (!matchesExternalCompletion(operation, completion)) {
      throw new Error('安全事务已有不同的外部执行完成记录，已拒绝重复收口。')
    }
    const successful = completion.exitCode === 0
    if ((operation.state === operationStates.rollbackAvailable &&
      successful && operation.reversible) ||
      (operation.state === operationStates.kept &&
        successful && !operation.reversible) ||
      (operation.state === operationStates.failed && !successful)) {
      return operation
    }
    if (operation.state !== operationStates.verificationPassed ||
      !successful || !operation.reversible) {
      throw new Error('安全事务必须处于 executing 状态才能完成外部执行。')
    }
    await assertCurrentEndpoint(operation)
    const boundRecovery = await requireBoundRecovery(operation)
    operation = await postCheckBoundRecovery(operation, boundRecovery)
    return guardedRecoveryTransition(
      operation,
      boundRecovery,
      operationStates.rollbackAvailable,
      { completedAt: timestamp() },
      'execute'
    )
  }

  async function completeExternalSideEffectWork (operation, completion) {
    if (operation.state !== operationStates.executing) {
      if (matchesExternalCompletion(operation, completion) &&
        [operationStates.rollbackAvailable, operationStates.failed].includes(operation.state)) {
        return operation
      }
      throw new Error('SFTP 传输事务不处于 executing 状态。')
    }
    if (completion.executionId !== operation.executionId) {
      throw new Error('外部 SFTP 传输执行标识不匹配。')
    }
    try {
      return await serializeEndpoint(operation, async () => {
        operation = await get(operation.id) || operation
        if (operation.state !== operationStates.executing) {
          if (matchesExternalCompletion(operation, completion)) return operation
          throw new Error('SFTP 传输事务状态已变化。')
        }
        if (completion.executionId !== operation.executionId) {
          throw new Error('外部 SFTP 传输执行标识不匹配。')
        }
        const active = activeExecutions.get(operation.id)
        if (active?.executionId === completion.executionId) {
          activeExecutions.delete(operation.id)
        }
        const bound = await requireBoundRecovery(operation)
        await assertCurrentEndpoint(operation)
        operation = await postCheckBoundRecovery(operation, bound)
        const failed = completion.cancelled === true || completion.exitCode !== 0
        const audit = createAuditRecord({
          phase: 'execute',
          timestamp: timestamp(),
          code: completion.exitCode === null ? undefined : completion.exitCode,
          output: failed ? 'SFTP 传输未完整完成，恢复点仍可用于回滚。' : ''
        })
        if (failed) {
          return guardedRecoveryTransition(
            operation,
            bound,
            operationStates.failed,
            current => ({
              audit: appendAudit(current, [audit]),
              error: completion.cancelled === true
                ? 'SFTP 传输已取消，远程目标可能已部分写入，可执行回滚。'
                : 'SFTP 传输失败，远程目标可能已部分写入，可执行回滚。',
              failedAt: timestamp(),
              executionId: undefined,
              metadata: externalCompletionMetadata(current, completion)
            }),
            'execute',
            [audit]
          )
        }
        const adapter = await requireSideEffectAdapter(operation)
        const verifiedPhase = await runSideEffectHook(
          adapter,
          'verifyExecute',
          operation,
          { phase: 'verify' }
        )
        operation = await assertSideEffectPhase(
          operation,
          bound,
          [operationStates.executing],
          [audit, verifiedPhase.audit]
        )
        const verifiedRecovery = await bindPostMutationArtifacts(
          operation,
          bound,
          verifiedPhase.result
        )
        const verified = await guardedRecoveryTransition(
          operation,
          bound,
          operationStates.verificationPassed,
          current => ({
            audit: appendAudit(current, [audit, verifiedPhase.audit]),
            executionId: undefined,
            metadata: externalCompletionMetadata(current, completion),
            ...(verifiedRecovery || {})
          }),
          'verify',
          [audit, verifiedPhase.audit]
        )
        const verifiedBound = verifiedRecovery
          ? rememberBoundRecovery(verified)
          : bound
        return guardedRecoveryTransition(
          verified,
          verifiedBound,
          operationStates.rollbackAvailable,
          { completedAt: timestamp() },
          'execute'
        )
      })
    } catch (error) {
      if (error.integrityFailureHandled) throw sanitizeError(error)
      const current = await get(operation.id) || operation
      const active = activeExecutions.get(operation.id)
      if (active?.executionId === completion.executionId) {
        activeExecutions.delete(operation.id)
      }
      if (current.state !== operationStates.executing) {
        throw sanitizeError(error)
      }
      const bound = await requireBoundRecovery(current)
      const audit = createAuditRecord({
        phase: 'verify',
        timestamp: timestamp(),
        code: completion.exitCode === null ? undefined : completion.exitCode,
        output: 'SFTP 传输结果校验失败，恢复点仍可用于回滚。'
      })
      return guardedRecoveryTransition(
        current,
        bound,
        operationStates.failed,
        value => ({
          audit: appendAudit(value, [audit]),
          error: sanitizeError(error).message,
          failedAt: timestamp(),
          executionId: undefined,
          metadata: externalCompletionMetadata(value, completion)
        }),
        'verify',
        [audit]
      )
    }
  }

  function completeExternalExecution (id, completion = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      validateExternalCompletion(operation, completion)
      if (operation.operationKind === 'side-effect') {
        return completeExternalSideEffectWork(operation, completion)
      }
      if (operation.state !== operationStates.executing) {
        return serializeEndpoint(operation, async () => {
          operation = await get(operation.id) || operation
          return resumeExternalCompletion(operation, completion)
        })
      }
      if (completion.executionId !== operation.executionId) {
        throw new Error('外部执行标识不匹配，已忽略无关或迟到事件。')
      }

      return serializeEndpoint(operation, async () => {
        operation = await get(operation.id) || operation
        if (operation.state !== operationStates.executing) {
          return resumeExternalCompletion(operation, completion)
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
                executionId: undefined,
                metadata: externalCompletionMetadata(current, completion)
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
              executionId: undefined,
              metadata: externalCompletionMetadata(current, completion)
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
            executionId: undefined,
            metadata: externalCompletionMetadata(operation, completion)
          }, 'execute')
        }
        return transition(operation, operationStates.kept, {
          audit: appendAudit(operation, [audit]),
          completedAt: timestamp(),
          executionId: undefined,
          metadata: externalCompletionMetadata(operation, completion)
        }, 'execute')
      })
    })
  }

  async function rollbackSideEffectWork (operation, rollbackOptions) {
    if (operation.state === operationStates.restored) return operation
    if (!rollbackStates.has(operation.state)) {
      throw new Error('当前 SFTP 安全事务状态不允许回滚。')
    }
    const audits = []
    let boundRecovery
    try {
      return await serializeEndpoint(operation, async () => {
        operation = await get(operation.id) || operation
        if (operation.state === operationStates.restored) return operation
        if (!rollbackStates.has(operation.state)) {
          throw new Error('当前 SFTP 安全事务状态不允许回滚。')
        }
        const adapter = await requireSideEffectAdapter(operation)
        await assertCurrentEndpoint(operation)
        boundRecovery = await requireBoundRecovery(operation)
        operation = await transition(
          operation,
          operationStates.rollingBack,
          {},
          'rollback'
        )

        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.rollingBack]
        )
        const rollbackPhase = await runSideEffectHook(
          adapter,
          'rollback',
          operation,
          { phase: 'rollback', signal: rollbackOptions.signal }
        )
        audits.push(rollbackPhase.audit)
        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.rollingBack],
          audits
        )

        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.rollingBack],
          audits
        )
        const verifyPhase = await runSideEffectHook(
          adapter,
          'verifyRollback',
          operation,
          {
            phase: 'verify',
            signal: rollbackOptions.signal,
            rollbackResult: rollbackPhase.result
          }
        )
        audits.push(verifyPhase.audit)
        operation = await assertSideEffectPhase(
          operation,
          boundRecovery,
          [operationStates.rollingBack],
          audits
        )
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
      if (error.audit && !audits.includes(error.audit)) audits.push(error.audit)
      const current = await get(operation.id) || operation
      if (error.cancelled || cancellationRequests.has(operation.id) ||
        current.state === operationStates.cancelled) throw cancellationError()
      return fail(operation, error, audits)
    }
  }

  function rollback (id, rollbackOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (operation?.operationKind === 'side-effect') {
        return rollbackSideEffectWork(operation, rollbackOptions)
      }
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (!rollbackStates.has(operation.state)) {
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
          if (!rollbackStates.has(operation.state)) {
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
          authorizedMaintenanceRecoveries.delete(operation.id)
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
      authorizedMaintenanceRecoveries.delete(operation.id)
      return kept
    })
  }

  function revokeRecovery (id, reason = 'ά���ָ���Ȩ�ѳ�����') {
    return serialize(String(id), async () => {
      const operation = await get(id)
      if (!operation) throw new Error(`δ�ҵ���ȫ����${id}`)
      if (operation.recoveryProvider !== maintenanceRecoveryProvider) {
        throw new Error('ֻ��ά���������ָ���¼������ʽ������')
      }
      if (![operationStates.failed, operationStates.cancelled].includes(operation.state)) {
        throw new Error('ֻ���ύʧ�ܻ���ȡ����ά��������Գ����ָ���Ȩ��')
      }
      const revoked = await patch(operation.id, {
        recoveryRevokedAt: timestamp(),
        recoveryRevocationReason: redactAndTruncateAuditText(reason),
        updatedAt: timestamp()
      })
      boundRecoveries.delete(operation.id)
      authorizedMaintenanceRecoveries.delete(operation.id)
      emit(operation.id, revoked.state, 'revoke-recovery')
      return revoked
    })
  }

  async function cancel (id) {
    const operationId = String(id)
    cancellationRequests.add(operationId)
    const active = activeExecutions.get(operationId)
    let cancellationFailure
    if (active) {
      active.cancelRequested = true
      if (active.kind === 'side-effect') {
        active.abort()
        await active.settled
      } else if (active.kind === 'external-side-effect') {
        try {
          await active.cancelExternal()
        } catch (error) {
          cancellationFailure = sanitizeError(error)
        } finally {
          if (activeExecutions.get(operationId) === active) {
            activeExecutions.delete(operationId)
          }
        }
      } else {
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
    revokeRecovery,
    cancel
  }
}
