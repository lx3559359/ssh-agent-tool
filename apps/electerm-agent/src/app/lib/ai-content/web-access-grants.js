const path = require('node:path')
const defaultFs = require('node:fs/promises')
const {
  WebAccessError
} = require('./web-access-errors')
const {
  normalizeWebOrigin
} = require('./web-access-policy')

const GRANT_FILE_VERSION = 1
const ALLOWED_ADDRESS_CLASSES = new Set(['private', 'loopback'])
const ALLOWED_SCOPES = new Set(['once', 'always'])

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function createWebAccessGrantRepository ({
  filePath,
  fs = defaultFs
} = {}) {
  if (!filePath) {
    throw new Error('Web access grant repository requires a file path.')
  }
  const temporaryPath = filePath + '.tmp'

  return {
    async load () {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const parsed = JSON.parse(content)
        return parsed && typeof parsed === 'object'
          ? parsed
          : { version: GRANT_FILE_VERSION, grants: [] }
      } catch {
        return { version: GRANT_FILE_VERSION, grants: [] }
      }
    },

    async save (value) {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      try {
        await fs.writeFile(
          temporaryPath,
          JSON.stringify(value, null, 2) + '\n',
          'utf8'
        )
        await fs.rename(temporaryPath, filePath)
      } finally {
        await fs.unlink(temporaryPath).catch(() => {})
      }
    }
  }
}

function normalizeTimestamp (value, fallback) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? fallback
    : parsed.toISOString()
}

function normalizePersistedGrant (value, fallbackTimestamp) {
  if (
    !value ||
    !ALLOWED_ADDRESS_CLASSES.has(value.addressClass)
  ) {
    return null
  }
  let origin
  try {
    origin = normalizeWebOrigin(value.origin)
  } catch {
    return null
  }
  return {
    origin,
    addressClass: value.addressClass,
    createdAt: normalizeTimestamp(value.createdAt, fallbackTimestamp),
    lastUsedAt: normalizeTimestamp(value.lastUsedAt, fallbackTimestamp)
  }
}

function createWebAccessGrants ({
  repository,
  now = () => new Date()
} = {}) {
  if (!repository) {
    throw new Error('Web access grants require a repository.')
  }

  const permanent = new Map()
  const onceByRead = new Map()
  let writeQueue = Promise.resolve()

  function nowIso () {
    const value = now()
    const parsed = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Web access grant clock returned an invalid date.')
    }
    return parsed.toISOString()
  }

  function snapshot () {
    return {
      version: GRANT_FILE_VERSION,
      grants: Array.from(permanent.values())
        .sort((left, right) => left.origin.localeCompare(right.origin))
        .map(clone)
    }
  }

  function persist () {
    const value = snapshot()
    const operation = writeQueue
      .catch(() => {})
      .then(() => repository.save(value))
    writeQueue = operation
    return operation
  }

  async function load () {
    const stored = await repository.load()
    permanent.clear()
    if (
      stored?.version !== GRANT_FILE_VERSION ||
      !Array.isArray(stored.grants)
    ) {
      return
    }
    const fallbackTimestamp = stored.grants.length ? nowIso() : ''
    for (const value of stored.grants) {
      const grant = normalizePersistedGrant(value, fallbackTimestamp)
      if (!grant) continue
      const existing = permanent.get(grant.origin)
      if (!existing) {
        permanent.set(grant.origin, grant)
        continue
      }
      permanent.set(grant.origin, {
        ...grant,
        createdAt: existing.createdAt < grant.createdAt
          ? existing.createdAt
          : grant.createdAt,
        lastUsedAt: existing.lastUsedAt > grant.lastUsedAt
          ? existing.lastUsedAt
          : grant.lastUsedAt
      })
    }
  }

  async function authorize ({
    origin,
    addressClass,
    scope,
    readId
  } = {}) {
    if (!ALLOWED_SCOPES.has(scope)) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'Web access authorization scope is invalid.'
      )
    }
    if (!ALLOWED_ADDRESS_CLASSES.has(addressClass)) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'This target class cannot be authorized.'
      )
    }
    const normalizedOrigin = normalizeWebOrigin(origin)
    const timestamp = nowIso()

    if (scope === 'once') {
      const normalizedReadId = String(readId || '').trim()
      if (!normalizedReadId) {
        throw new WebAccessError(
          'WEB_ACCESS_BLOCKED',
          'A logical read ID is required for one-time authorization.'
        )
      }
      const grants = onceByRead.get(normalizedReadId) || new Map()
      grants.set(normalizedOrigin, {
        origin: normalizedOrigin,
        addressClass,
        createdAt: timestamp,
        lastUsedAt: timestamp
      })
      onceByRead.set(normalizedReadId, grants)
      return
    }

    const existing = permanent.get(normalizedOrigin)
    permanent.set(normalizedOrigin, {
      origin: normalizedOrigin,
      addressClass,
      createdAt: existing?.createdAt || timestamp,
      lastUsedAt: timestamp
    })
    await persist()
  }

  async function isGranted ({ origin, readId } = {}) {
    let normalizedOrigin
    try {
      normalizedOrigin = normalizeWebOrigin(origin)
    } catch {
      return false
    }
    const normalizedReadId = String(readId || '').trim()
    const once = onceByRead
      .get(normalizedReadId)
      ?.get(normalizedOrigin)
    if (once) {
      once.lastUsedAt = nowIso()
      return true
    }

    const saved = permanent.get(normalizedOrigin)
    if (!saved) return false
    saved.lastUsedAt = nowIso()
    await persist()
    return true
  }

  function finishRead (readId) {
    onceByRead.delete(String(readId || '').trim())
  }

  async function list () {
    return snapshot().grants
  }

  async function revoke (origin) {
    let normalizedOrigin
    try {
      normalizedOrigin = normalizeWebOrigin(origin)
    } catch {
      return false
    }
    const removed = permanent.delete(normalizedOrigin)
    if (removed) await persist()
    return removed
  }

  async function clear () {
    permanent.clear()
    await persist()
  }

  return {
    authorize,
    clear,
    finishRead,
    isGranted,
    list,
    load,
    revoke
  }
}

module.exports = {
  GRANT_FILE_VERSION,
  createWebAccessGrantRepository,
  createWebAccessGrants
}
