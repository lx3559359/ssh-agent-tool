import { normalizeOperation } from './models.js'
import { assertTrustedOperationId } from './operation-id.js'

export const sideEffectOperationKind = 'side-effect'

export const sftpSideEffectActions = Object.freeze([
  'editor-save',
  'delete',
  'rename',
  'chmod',
  'upload',
  'copy',
  'move'
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
  }),
  upload: Object.freeze({
    reason: 'SFTP upload writes a remote target.'
  }),
  copy: Object.freeze({
    reason: 'SFTP copy writes a remote target.'
  }),
  move: Object.freeze({
    reason: 'SFTP move changes remote source and target paths.'
  })
})

const actionPathFields = Object.freeze({
  'editor-save': ['target'],
  delete: ['source'],
  rename: ['source', 'target'],
  chmod: ['source'],
  upload: ['target'],
  copy: ['source', 'target'],
  move: ['source', 'target']
})

const transferActions = new Set(['upload', 'copy', 'move'])
const transferDirections = new Set([
  'local-to-remote',
  'same-endpoint',
  'cross-host-target'
])

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

function normalizeSourceDescriptor (value, budget = { nodes: 10000 }, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    depth > 128 || budget.nodes <= 0) {
    throw new Error('SFTP upload source descriptor is invalid or exceeds its bounds.')
  }
  budget.nodes -= 1
  const type = normalizeType(value.type)
  const descriptor = {
    type,
    mode: normalizeMode(value.mode, true)
  }
  for (const field of ['uid', 'gid']) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`SFTP upload source descriptor ${field} is invalid.`)
    }
    descriptor[field] = value[field]
  }
  if (type === 'file') {
    if (!Number.isSafeInteger(value.size) || value.size < 0 ||
      !/^[a-f0-9]{64}$/.test(String(value.digest || '').toLowerCase()) ||
      value.digestAlgorithm !== 'SHELLPILOT-SHA-256-CHAIN-V1') {
      throw new Error('SFTP upload source file descriptor is invalid.')
    }
    return {
      ...descriptor,
      size: value.size,
      digest: String(value.digest).toLowerCase(),
      digestAlgorithm: value.digestAlgorithm
    }
  }
  if (!Array.isArray(value.entries)) {
    throw new Error('SFTP upload source directory descriptor is invalid.')
  }
  let previousName = ''
  descriptor.entries = value.entries.map(item => {
    const name = String(item?.name || '')
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name) ||
      name.localeCompare(previousName) <= 0) {
      throw new Error('SFTP upload source directory entries are invalid.')
    }
    previousName = name
    return {
      name,
      entry: normalizeSourceDescriptor(item.entry, budget, depth + 1)
    }
  })
  return descriptor
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
  if (value.sourceDescriptor !== undefined) {
    expected.sourceDescriptor = normalizeSourceDescriptor(value.sourceDescriptor)
    if (new TextEncoder().encode(JSON.stringify(expected.sourceDescriptor)).byteLength > 256 * 1024) {
      throw new Error('SFTP upload source descriptor exceeds the manifest limit.')
    }
  }
  return expected
}

function normalizeTransferIdentity (value, label, required = true) {
  if (value === undefined && !required) return undefined
  const normalized = String(value || '').trim()
  const hasControlCharacter = [...normalized].some(character => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
  if (!normalized || normalized !== normalized.normalize('NFKC') ||
    normalized.length > 256 || hasControlCharacter) {
    throw new Error(`SFTP transfer ${label} is invalid.`)
  }
  return normalized
}

function normalizeTransfer (value = {}, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SFTP transfer identity is invalid.')
  }
  const direction = String(value.direction || '')
  if (!transferDirections.has(direction)) {
    throw new Error('SFTP transfer direction is invalid.')
  }
  const normalized = {
    identity: normalizeTransferIdentity(value.identity, 'identity'),
    direction
  }
  const sourceIdentity = normalizeTransferIdentity(
    value.sourceIdentity,
    'source identity',
    action === 'upload'
  )
  if (sourceIdentity !== undefined) normalized.sourceIdentity = sourceIdentity
  const batchId = normalizeTransferIdentity(value.batchId, 'batch id', false)
  if (batchId !== undefined) normalized.batchId = batchId
  const sourceEndpointKey = normalizeTransferIdentity(
    value.sourceEndpointKey,
    'source endpoint',
    false
  )
  if (sourceEndpointKey !== undefined) {
    normalized.sourceEndpointKey = sourceEndpointKey
  }
  const sourceContentIdentity = normalizeTransferIdentity(
    value.sourceContentIdentity,
    'source content identity',
    false
  )
  if (sourceContentIdentity !== undefined) {
    normalized.sourceContentIdentity = sourceContentIdentity
  }
  return normalized
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
  if (transferActions.has(effect.action)) {
    normalized.transfer = normalizeTransfer(effect.transfer, effect.action)
  } else if (effect.transfer !== undefined) {
    throw new Error('SFTP transfer identity is not valid for this action.')
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
