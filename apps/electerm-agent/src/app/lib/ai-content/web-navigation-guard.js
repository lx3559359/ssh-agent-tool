const {
  inspectWebTarget
} = require('./web-access-policy')

const SESSION_REGISTRIES = new WeakMap()
const MAIN_FRAME_RESOURCE = 'mainFrame'

function safeTarget (target = {}) {
  return {
    origin: String(target.origin || ''),
    addressClass: String(target.addressClass || '')
  }
}

function unsupportedProtocol (value) {
  try {
    return !['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return true
  }
}

function createWebRequestDecision ({
  inspectTarget = inspectWebTarget,
  isOriginGranted = async () => false
} = {}) {
  return async function decide ({
    url,
    resourceType,
    readId
  } = {}) {
    if (unsupportedProtocol(url)) {
      return {
        action: 'block',
        code: 'WEB_ACCESS_BLOCKED',
        reason: 'unsupported-protocol'
      }
    }

    let inspection
    try {
      inspection = await inspectTarget(url, {
        isOriginGranted: (origin, target) => isOriginGranted({
          origin,
          addressClass: target.addressClass,
          readId,
          target
        })
      })
    } catch (error) {
      return {
        action: 'block',
        code: /^WEB_[A-Z0-9_]+$/.test(String(error?.code || ''))
          ? error.code
          : 'WEB_NETWORK_ERROR',
        reason: 'inspection-failed'
      }
    }

    if (
      inspection.decision === 'allow-public' ||
      inspection.decision === 'allow-granted'
    ) {
      return { action: 'allow' }
    }
    if (inspection.decision === 'blocked') {
      return {
        action: 'block',
        code: 'WEB_ACCESS_BLOCKED',
        reason: inspection.reason || 'dangerous-target',
        target: safeTarget(inspection.target)
      }
    }
    if (
      inspection.decision === 'authorization-required' &&
      resourceType === MAIN_FRAME_RESOURCE
    ) {
      return {
        action: 'authorization-required',
        code: 'WEB_ACCESS_AUTH_REQUIRED',
        target: safeTarget(inspection.target)
      }
    }
    return {
      action: 'block',
      code: 'WEB_ACCESS_BLOCKED',
      reason: 'ungranted-private-subresource',
      target: safeTarget(inspection.target)
    }
  }
}

function notifyDecision (context, decision) {
  if (context.disposed) return
  try {
    if (decision.action === 'authorization-required') {
      context.onAuthorizationRequired?.(decision.target)
      return
    }
    if (decision.action === 'block') {
      context.onBlocked?.(decision)
    }
  } catch {}
}

function installSessionHandlers (session, registry) {
  session.webRequest.onBeforeRequest((details, respond) => {
    const context = registry.contexts.get(details.webContentsId)
    if (!context || context.disposed) {
      respond({})
      return
    }
    Promise.resolve(context.decide({
      url: details.url,
      resourceType: details.resourceType,
      readId: context.readId
    })).then(decision => {
      if (context.disposed) {
        respond({ cancel: true })
        return
      }
      if (decision.action === 'allow') {
        respond({})
        return
      }
      notifyDecision(context, decision)
      respond({ cancel: true })
    }).catch(() => {
      notifyDecision(context, {
        action: 'block',
        code: 'WEB_NETWORK_ERROR',
        reason: 'inspection-failed'
      })
      respond({ cancel: true })
    })
  })

  session.setPermissionRequestHandler((
    _webContents,
    _permission,
    respond
  ) => respond(false))
  session.setPermissionCheckHandler(() => false)
  session.on('will-download', event => event.preventDefault())
}

function getSessionRegistry (session) {
  let registry = SESSION_REGISTRIES.get(session)
  if (registry) return registry
  registry = {
    contexts: new Map()
  }
  installSessionHandlers(session, registry)
  SESSION_REGISTRIES.set(session, registry)
  return registry
}

function installWebNavigationGuard ({
  session,
  webContents,
  readId,
  inspectTarget = inspectWebTarget,
  isOriginGranted = async () => false,
  onAuthorizationRequired,
  onBlocked
} = {}) {
  if (!session || !webContents) {
    throw new Error('Navigation guard requires a session and webContents.')
  }
  const registry = getSessionRegistry(session)
  const context = {
    decide: createWebRequestDecision({
      inspectTarget,
      isOriginGranted
    }),
    disposed: false,
    onAuthorizationRequired,
    onBlocked,
    readId: String(readId || '')
  }
  registry.contexts.set(webContents.id, context)

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  function handleWillNavigate (event, url) {
    if (unsupportedProtocol(url)) {
      event.preventDefault()
      notifyDecision(context, {
        action: 'block',
        code: 'WEB_ACCESS_BLOCKED',
        reason: 'unsupported-protocol'
      })
    }
  }

  webContents.on('will-navigate', handleWillNavigate)

  return function dispose () {
    if (context.disposed) return
    context.disposed = true
    if (registry.contexts.get(webContents.id) === context) {
      registry.contexts.delete(webContents.id)
    }
    webContents.removeListener('will-navigate', handleWillNavigate)
  }
}

module.exports = {
  createWebRequestDecision,
  installWebNavigationGuard
}
