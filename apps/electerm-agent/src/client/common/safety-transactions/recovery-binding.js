import { redactSensitiveData } from './audit-redaction.js'
import { classifyCommand } from './command-classifier.js'
import { buildEndpointKey } from './endpoint-guard.js'
import {
  recoveryBindingAlgorithm,
  recoveryBindingSchemaVersion,
  sideEffectRecoveryBindingSchemaVersion
} from './models.js'
import { buildSideEffectKey } from './side-effect-model.js'

const recoveryIntegrityFailureMessage = '恢复记录完整性校验失败'

function recoveryBindingError () {
  return new Error('恢复绑定指纹不一致，已拒绝执行。')
}

export function stableSerialize (value) {
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

export async function createPersistedRecoveryPlan (plan) {
  if (typeof plan?.prepareCommand !== 'string' || !plan.prepareCommand) {
    throw recoveryBindingError()
  }
  const { prepareCommand, ...immutablePlan } = plan
  return redactSensitiveData({
    ...immutablePlan,
    prepareCommandHash: await sha256(prepareCommand)
  })
}

export function recoveryBindingPayload (operation, plan, artifacts) {
  if (operation.operationKind === 'side-effect') {
    if (operation.risk !== 'change' || operation.reversible !== true ||
      operation.recoveryProvider !== operation.effect?.adapter ||
      operation.effect?.adapter !== 'sftp' ||
      operation.effectKey !== buildSideEffectKey(operation.effect) ||
      plan?.adapter !== operation.effect.adapter ||
      typeof plan?.operationDir !== 'string' || !plan.operationDir ||
      !artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts) ||
      !Object.keys(artifacts).length) {
      throw recoveryBindingError()
    }
    return {
      schemaVersion: operation.schemaVersion,
      operationKind: operation.operationKind,
      id: operation.id,
      endpoint: operation.endpoint,
      endpointKey: buildEndpointKey(operation.endpoint),
      effect: operation.effect,
      effectKey: operation.effectKey,
      plan,
      artifacts
    }
  }
  const classification = classifyCommand(operation.command)
  const provider = classification.provider
  const operationDir = typeof plan?.operationDir === 'string'
    ? plan.operationDir
    : ''
  if (classification.risk !== 'change' || classification.reversible !== true ||
    operation.risk !== classification.risk ||
    operation.reversible !== classification.reversible ||
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

export async function recoveryBindingFingerprint (operation, plan, artifacts) {
  const payload = recoveryBindingPayload(operation, plan, artifacts)
  return sha256(stableSerialize(payload))
}

export async function createRecoveryBinding (operation, plan, artifacts) {
  return {
    schemaVersion: operation.operationKind === 'side-effect'
      ? sideEffectRecoveryBindingSchemaVersion
      : recoveryBindingSchemaVersion,
    algorithm: recoveryBindingAlgorithm,
    fingerprint: await recoveryBindingFingerprint(operation, plan, artifacts)
  }
}

export async function assertRecoveryBinding (operation) {
  const binding = operation.recoveryBinding
  const expectedVersion = operation.operationKind === 'side-effect'
    ? sideEffectRecoveryBindingSchemaVersion
    : recoveryBindingSchemaVersion
  if (binding?.schemaVersion !== expectedVersion ||
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

export async function verifyRecoveryBinding (operation) {
  try {
    await assertRecoveryBinding(operation)
    return { valid: true, error: '' }
  } catch {
    return { valid: false, error: recoveryIntegrityFailureMessage }
  }
}
