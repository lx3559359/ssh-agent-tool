import { normalizeOperation } from './models.js'
import { assertTrustedOperationId } from './operation-id.js'

export const sideEffectOperationKind = 'side-effect'

export const sftpSideEffectActions = Object.freeze([
  'editor-save',
  'delete',
  'rename',
  'chmod'
])

const actionSet = new Set(sftpSideEffectActions)
const resourceTypes = new Set(['file', 'directory'])
const actionPolicies = Object.freeze({
  'editor-save': Object.freeze({
    reason: 'SFTP editor save changes remote file content.'
  }),
  delete: Object.freeze({
    reason: 'SFTP delete removes a remote resource.'
  }),
  rename: Object.freeze({
    reason: 'SFTP rename changes remote resource paths.'
  }),
  chmod: Object.freeze({
    reason: 'SFTP chmod changes remote permissions.'
  })
})

const actionPathFields = Object.freeze({
  'editor-save': ['target'],
  delete: ['source'],
  rename: ['source', 'target'],
  chmod: ['source']
})

function stableSerialize (value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item) ?? 'null').join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().flatMap(key => {
      const serialized = stableSerialize(value[key])
      return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`]
    })
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function shortStableHash (value) {
  let hash = 0xcbf29ce484222325n
  const bytes = new TextEncoder().encode(value)
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function normalizeRemotePath (value) {
  const path = String(value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (!path.startsWith('/')) {
    throw new Error('SFTP side-effect requires an absolute path.')
  }
  const parts = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('SFTP side-effect requires an absolute path.')
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const normalized = `/${parts.join('/')}`
  if (parts.includes('.shellpilot-transactions')) {
    throw new Error('SFTP side-effect cannot target transaction storage.')
  }
  return normalized
}

function normalizeType (value) {
  const type = String(value || '')
  if (!resourceTypes.has(type)) {
    throw new Error('SFTP side-effect resource type is not supported.')
  }
  return type
}

function normalizeMode (value, required) {
  if (value === undefined && !required) return undefined
  if (!Number.isInteger(value) || value < 0 || value > 0o7777) {
    throw new Error('SFTP side-effect mode is invalid.')
  }
  return value
}

function normalizeExpected (value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SFTP side-effect expected state is invalid.')
  }
  const expected = {}
  if (value.size !== undefined) {
    if (!Number.isSafeInteger(value.size) || value.size < 0) {
      throw new Error('SFTP side-effect expected size is invalid.')
    }
    expected.size = value.size
  }
  if (value.digest !== undefined) {
    const digest = String(value.digest).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('SFTP side-effect expected digest is invalid.')
    }
    expected.digest = digest
    expected.digestAlgorithm = String(value.digestAlgorithm || 'SHA-256')
  }
  if (value.absent !== undefined) expected.absent = value.absent === true
  if (value.mode !== undefined) expected.mode = normalizeMode(value.mode, true)
  if (value.type !== undefined) expected.type = normalizeType(value.type)
  return expected
}

export function buildSideEffectKey (effect) {
  return `${effect.adapter}:${effect.action}:${shortStableHash(stableSerialize(effect))}`
}

function normalizeEffect (effect = {}) {
  if (effect.adapter !== 'sftp' || !actionSet.has(effect.action)) {
    throw new Error('SFTP side-effect action is not supported.')
  }
  const paths = Object.fromEntries(actionPathFields[effect.action].map(field => [
    field,
    normalizeRemotePath(effect.paths?.[field])
  ]))
  if (paths.source && paths.target && paths.source === paths.target) {
    throw new Error('SFTP side-effect source and target must differ.')
  }
  if (!Array.isArray(effect.resources) || !effect.resources.length ||
    effect.resources.length > 64) {
    throw new Error('SFTP side-effect resources are invalid.')
  }
  const resources = effect.resources.map(resource => ({
    path: normalizeRemotePath(resource?.path),
    type: normalizeType(resource?.type)
  }))
  const requiredPaths = new Set(Object.values(paths))
  if ([...requiredPaths].some(path => !resources.some(resource => resource.path === path))) {
    throw new Error('SFTP side-effect resources do not cover every path.')
  }
  const expected = normalizeExpected(effect.expected)
  if (effect.action === 'editor-save' &&
    (expected.size === undefined || !expected.digest || !expected.digestAlgorithm)) {
    throw new Error('SFTP editor-save expected size and digest are required.')
  }
  const normalized = {
    adapter: 'sftp',
    action: effect.action,
    resources,
    paths,
    type: normalizeType(effect.type),
    expected
  }
  const requestedMode = normalizeMode(
    effect.requestedMode,
    effect.action === 'chmod'
  )
  if (requestedMode !== undefined) normalized.requestedMode = requestedMode
  return normalized
}

export function buildSideEffectSafetyRequest (request = {}, options = {}) {
  if (request.source !== 'sftp') {
    throw new Error('SFTP side-effect source is invalid.')
  }
  const id = assertTrustedOperationId(request.id)
  const effect = normalizeEffect(request.effect)
  const policy = actionPolicies[effect.action]
  return normalizeOperation({
    id,
    source: 'sftp',
    title: request.title,
    endpoint: request.endpoint,
    metadata: request.metadata,
    state: request.state,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    operationKind: sideEffectOperationKind,
    effect,
    effectKey: buildSideEffectKey(effect),
    risk: 'change',
    provider: 'sftp',
    reversible: true,
    recoveryProvider: 'sftp',
    requiresConfirmation: true,
    reason: policy.reason
  }, options)
}
