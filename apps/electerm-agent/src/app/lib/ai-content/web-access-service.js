const {
  randomUUID: defaultRandomUUID
} = require('node:crypto')
const {
  WebAccessError
} = require('./web-access-errors')
const {
  inspectWebTarget
} = require('./web-access-policy')
const {
  readPublicWebPage
} = require('./web-reader')

const TOKEN_TTL_MS = 5 * 60 * 1000
const MAX_AUTHORIZATION_CHALLENGES = 4

function createWebAccessService ({
  inspectTarget = inspectWebTarget,
  readStatic = readPublicWebPage,
  browserReader,
  clearSessionData = async () => {},
  grants,
  now = () => Date.now(),
  randomUUID = defaultRandomUUID,
  tokenTtlMs = TOKEN_TTL_MS,
  maxAuthorizationChallenges = MAX_AUTHORIZATION_CHALLENGES
} = {}) {
  if (!browserReader?.read || !grants) {
    throw new Error(
      'Web access service requires a browser reader and grants.'
    )
  }

  const authorizationTokens = new Map()
  const challengeCounts = new Map()
  const readOwners = new Map()
  let loadPromise

  function ensureLoaded () {
    if (!loadPromise) {
      loadPromise = Promise.resolve(grants.load()).catch(error => {
        loadPromise = null
        throw error
      })
    }
    return loadPromise
  }

  function currentTime () {
    const value = now()
    const timestamp = value instanceof Date
      ? value.getTime()
      : Number(value)
    if (!Number.isFinite(timestamp)) {
      throw new Error('Web access service clock is invalid.')
    }
    return timestamp
  }

  function senderKey (senderId) {
    const value = String(senderId ?? '').trim()
    if (!value) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'The web read sender is invalid.'
      )
    }
    return value
  }

  function readKey (readId) {
    const value = String(readId || '').trim()
    if (!value) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'A logical web read ID is required.'
      )
    }
    return value
  }

  function registerRead (readId, senderId) {
    const owner = senderKey(senderId)
    const key = readKey(readId)
    const existing = readOwners.get(key)
    if (existing && existing !== owner) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'This logical web read belongs to another window.'
      )
    }
    readOwners.set(key, owner)
    return { owner, key }
  }

  function removeReadTokens (readId, senderId) {
    for (const [token, record] of authorizationTokens) {
      if (
        record.readId === readId &&
        record.senderId === senderId
      ) {
        authorizationTokens.delete(token)
      }
    }
  }

  function finishRead (readId, senderId) {
    grants.finishRead(readId)
    removeReadTokens(readId, senderId)
    challengeCounts.delete(readId)
    if (readOwners.get(readId) === senderId) {
      readOwners.delete(readId)
    }
  }

  function createAuthorizationChallenge ({
    target,
    readId,
    senderId
  }) {
    if (!['private', 'loopback'].includes(target?.addressClass)) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'This target class cannot be authorized.',
        {
          origin: target?.origin,
          addressClass: target?.addressClass,
          readId
        }
      )
    }
    const count = (challengeCounts.get(readId) || 0) + 1
    challengeCounts.set(readId, count)
    if (count > maxAuthorizationChallenges) {
      throw new WebAccessError(
        'WEB_REDIRECT_LIMIT',
        'The page requested too many private site authorizations.',
        { readId }
      )
    }

    let token = String(randomUUID())
    while (authorizationTokens.has(token)) {
      token = String(randomUUID())
    }
    authorizationTokens.set(token, {
      token,
      senderId,
      readId,
      origin: target.origin,
      addressClass: target.addressClass,
      expiresAt: currentTime() + tokenTtlMs
    })
    return {
      authorizationToken: token,
      origin: target.origin,
      addressClass: target.addressClass,
      readId
    }
  }

  function authorizationRequired ({
    target,
    readId,
    senderId
  }) {
    const challenge = createAuthorizationChallenge({
      target,
      readId,
      senderId
    })
    return new WebAccessError(
      'WEB_ACCESS_AUTH_REQUIRED',
      'This private site requires your authorization.',
      challenge
    )
  }

  async function authorize ({
    authorizationToken,
    scope,
    senderId
  } = {}) {
    await ensureLoaded()
    const token = String(authorizationToken || '')
    const record = authorizationTokens.get(token)
    if (!record) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'The web access authorization request is invalid or expired.'
      )
    }
    if (record.expiresAt < currentTime()) {
      authorizationTokens.delete(token)
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'The web access authorization request has expired.',
        {
          origin: record.origin,
          addressClass: record.addressClass,
          readId: record.readId
        }
      )
    }
    if (record.senderId !== senderKey(senderId)) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'The web access authorization belongs to another window.'
      )
    }
    if (readOwners.get(record.readId) !== record.senderId) {
      authorizationTokens.delete(token)
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'The logical web read is no longer active.'
      )
    }

    const inspection = await inspectTarget(record.origin, {
      isOriginGranted: async () => false
    })
    if (
      inspection.decision === 'blocked' ||
      inspection.target.origin !== record.origin ||
      inspection.target.addressClass !== record.addressClass
    ) {
      authorizationTokens.delete(token)
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'The site network classification changed before authorization.',
        {
          origin: inspection.target.origin,
          addressClass: inspection.target.addressClass,
          readId: record.readId
        }
      )
    }

    await grants.authorize({
      origin: record.origin,
      addressClass: record.addressClass,
      scope,
      readId: record.readId
    })
    authorizationTokens.delete(token)
    return {
      origin: record.origin,
      scope,
      readId: record.readId
    }
  }

  async function read ({
    url,
    readId,
    senderId
  } = {}) {
    await ensureLoaded()
    const identity = registerRead(readId, senderId)
    const inspection = await inspectTarget(url, {
      isOriginGranted: origin => grants.isGranted({
        origin,
        readId: identity.key
      })
    })

    if (inspection.decision === 'blocked') {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'This network target is permanently blocked.',
        {
          origin: inspection.target.origin,
          addressClass: inspection.target.addressClass,
          readId: identity.key
        }
      )
    }
    if (inspection.decision === 'authorization-required') {
      throw authorizationRequired({
        target: inspection.target,
        readId: identity.key,
        senderId: identity.owner
      })
    }

    if (inspection.decision === 'allow-public') {
      const staticResult = await readStatic(url)
      if (!staticResult.requiresBrowser) {
        finishRead(identity.key, identity.owner)
        return staticResult
      }
    }

    try {
      const result = await browserReader.read({
        url,
        readId: identity.key,
        isOriginGranted: value => {
          const origin = typeof value === 'string'
            ? value
            : value?.origin
          return grants.isGranted({
            origin,
            readId: identity.key
          })
        },
        onAuthorizationRequired: target => {
          return createAuthorizationChallenge({
            target,
            readId: identity.key,
            senderId: identity.owner
          })
        }
      })
      finishRead(identity.key, identity.owner)
      return result
    } catch (error) {
      if (error?.code === 'WEB_ACCESS_CANCELLED') {
        finishRead(identity.key, identity.owner)
      }
      throw error
    }
  }

  async function cancelRead ({ readId, senderId } = {}) {
    await ensureLoaded()
    const key = readKey(readId)
    const owner = senderKey(senderId)
    const existing = readOwners.get(key)
    if (existing && existing !== owner) {
      throw new WebAccessError(
        'WEB_ACCESS_BLOCKED',
        'This logical web read belongs to another window.'
      )
    }
    finishRead(key, owner)
    return { cancelled: true }
  }

  async function listGrants () {
    await ensureLoaded()
    return grants.list()
  }

  async function revokeGrant ({ origin } = {}) {
    await ensureLoaded()
    return grants.revoke(origin)
  }

  async function clearGrants () {
    await ensureLoaded()
    await grants.clear()
    return { cleared: true }
  }

  async function clearIsolatedSessionData () {
    await clearSessionData()
    return { cleared: true }
  }

  return {
    authorize,
    cancelRead,
    clearGrants,
    clearSessionData: clearIsolatedSessionData,
    listGrants,
    read,
    revokeGrant
  }
}

module.exports = {
  MAX_AUTHORIZATION_CHALLENGES,
  TOKEN_TTL_MS,
  createWebAccessService
}
