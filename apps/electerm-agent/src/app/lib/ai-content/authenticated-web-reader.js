const {
  WebAccessError
} = require('./web-access-errors')
const {
  evaluateWebContentQuality
} = require('./web-reader')
const {
  installWebNavigationGuard
} = require('./web-navigation-guard')

const MAX_TEXT_CHARS = 80000
const LOAD_TIMEOUT_MS = 30000
const INTERACTIVE_TIMEOUT_MS = 5 * 60 * 1000
const DOM_SETTLE_MS = 350

const EXTRACT_VISIBLE_PAGE_SCRIPT = [
  '(() => {',
  '  const body = document.body',
  '  return {',
  '    title: String(document.title || ""),',
  '    text: String(body ? body.innerText || "" : "")',
  '  }',
  '})()'
].join('\n')

function createSignal () {
  let signalResolve
  const promise = new Promise(resolve => {
    signalResolve = resolve
  })
  return { promise, resolve: signalResolve }
}

function safeFinalUrl (remote) {
  try {
    return String(remote.getURL() || '')
  } catch {
    return ''
  }
}

async function extractVisiblePage (remote) {
  const extracted = await remote.executeJavaScript(
    EXTRACT_VISIBLE_PAGE_SCRIPT
  )
  const rawText = String(extracted?.text || '')
  const truncated = rawText.length > MAX_TEXT_CHARS
  return {
    kind: 'web',
    source: 'browser',
    url: safeFinalUrl(remote),
    title: String(extracted?.title || '').slice(0, 300),
    text: truncated ? rawText.slice(0, MAX_TEXT_CHARS) : rawText,
    truncated
  }
}

function browserContentQuality (result) {
  let url = result.url
  try {
    const parsed = new URL(result.url)
    parsed.hash = ''
    url = parsed.toString()
  } catch {}
  return evaluateWebContentQuality({
    url,
    html: '',
    text: result.text
  })
}

function createPolicyError (decision, readId) {
  return new WebAccessError(
    decision.code || 'WEB_ACCESS_BLOCKED',
    decision.code === 'WEB_ACCESS_AUTH_REQUIRED'
      ? 'This site requires web access authorization.'
      : 'The page attempted to access a blocked network target.',
    {
      origin: decision.target?.origin,
      addressClass: decision.target?.addressClass,
      authorizationToken: decision.target?.authorizationToken,
      readId
    }
  )
}

function waitForLoad ({
  remote,
  url,
  timeoutMs,
  policySignal
}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => finish(
      reject,
      new WebAccessError(
        'WEB_READ_TIMEOUT',
        'The web page took too long to load.'
      )
    ), timeoutMs)

    function cleanup () {
      clearTimeout(timeout)
      remote.removeListener('did-finish-load', handleFinished)
      remote.removeListener('did-fail-load', handleFailed)
    }

    function finish (complete, value) {
      if (settled) return
      settled = true
      cleanup()
      complete(value)
    }

    function handleFinished () {
      finish(resolve)
    }

    function handleFailed (
      _event,
      errorCode,
      errorDescription,
      _validatedUrl,
      isMainFrame
    ) {
      if (isMainFrame === false) return
      const certificateFailure = /CERT/i.test(
        String(errorDescription || '')
      ) || (errorCode <= -200 && errorCode >= -299)
      finish(
        reject,
        new WebAccessError(
          certificateFailure
            ? 'WEB_CERTIFICATE_ERROR'
            : 'WEB_NETWORK_ERROR',
          certificateFailure
            ? 'The web page certificate could not be verified.'
            : 'The web page could not be loaded.'
        )
      )
    }

    remote.on('did-finish-load', handleFinished)
    remote.on('did-fail-load', handleFailed)
    policySignal.then(error => finish(reject, error))
    Promise.resolve(remote.loadURL(url)).catch(() => {
      finish(
        reject,
        new WebAccessError(
          'WEB_NETWORK_ERROR',
          'The web page could not be loaded.'
        )
      )
    })
  })
}

function waitForToolbarAction ({
  shell,
  timeoutMs,
  policySignal
}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let removeAction = () => {}
    const timeout = setTimeout(() => finish(
      reject,
      new WebAccessError(
        'WEB_READ_TIMEOUT',
        'Timed out while waiting for the page to be read.'
      )
    ), timeoutMs)

    function cleanup () {
      clearTimeout(timeout)
      removeAction()
    }

    function finish (complete, value) {
      if (settled) return
      settled = true
      cleanup()
      complete(value)
    }

    removeAction = shell.onAction(action => {
      if (action === 'complete') {
        finish(resolve, action)
        return
      }
      if (action === 'cancel') {
        finish(
          reject,
          new WebAccessError(
            'WEB_ACCESS_CANCELLED',
            'Web page reading was cancelled.'
          )
        )
      }
    })
    policySignal.then(error => finish(reject, error))
  })
}

function createAuthenticatedWebReader ({
  adapter,
  installGuard = installWebNavigationGuard,
  evaluateQuality = browserContentQuality,
  delay = milliseconds => new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  }),
  loadTimeoutMs = LOAD_TIMEOUT_MS,
  interactiveTimeoutMs = INTERACTIVE_TIMEOUT_MS,
  settleMs = DOM_SETTLE_MS
} = {}) {
  if (!adapter?.createShell) {
    throw new Error('Authenticated web reader requires an adapter.')
  }

  async function read ({
    url,
    readId,
    isOriginGranted,
    onAuthorizationRequired
  } = {}) {
    const origin = new URL(url).origin
    const shell = adapter.createShell({ origin })
    const policy = createSignal()
    let disposeGuard = () => {}

    try {
      try {
        await shell.ready
      } catch {
        throw new WebAccessError(
          'WEB_NETWORK_ERROR',
          'The secure web reader window could not be loaded.'
        )
      }
      disposeGuard = installGuard({
        session: shell.session,
        webContents: shell.remote,
        readId,
        isOriginGranted,
        onAuthorizationRequired: target => {
          Promise.resolve()
            .then(() => onAuthorizationRequired?.(target))
            .then(challenge => {
              policy.resolve(createPolicyError({
                code: 'WEB_ACCESS_AUTH_REQUIRED',
                target: {
                  ...target,
                  ...(challenge || {})
                }
              }, readId))
            })
            .catch(() => {
              policy.resolve(new WebAccessError(
                'WEB_NETWORK_ERROR',
                'The authorization request could not be created.',
                {
                  origin: target.origin,
                  addressClass: target.addressClass,
                  readId
                }
              ))
            })
        },
        onBlocked: decision => {
          if (
            decision.reason === 'ungranted-private-subresource'
          ) {
            return
          }
          policy.resolve(createPolicyError(decision, readId))
        }
      })

      shell.updateStatus('Loading page…')
      await waitForLoad({
        remote: shell.remote,
        url,
        timeoutMs: loadTimeoutMs,
        policySignal: policy.promise
      })
      await Promise.race([
        delay(settleMs),
        policy.promise.then(error => {
          throw error
        })
      ])

      let result = await extractVisiblePage(shell.remote)
      let quality = evaluateQuality(result)
      if (!quality.requiresBrowser) return result

      shell.updateStatus('Log in or navigate, then read the current page.')
      shell.show()
      shell.focus()
      await waitForToolbarAction({
        shell,
        timeoutMs: interactiveTimeoutMs,
        policySignal: policy.promise
      })

      result = await extractVisiblePage(shell.remote)
      quality = evaluateQuality(result)
      if (!String(result.text || '').trim()) {
        throw new WebAccessError(
          'WEB_READ_EMPTY',
          'The current page has no visible text to read.'
        )
      }
      if (
        quality.requiresBrowser &&
        quality.browserReason === 'login-required'
      ) {
        throw new WebAccessError(
          'WEB_LOGIN_REQUIRED',
          'Sign in before reading the current page.'
        )
      }
      return result
    } finally {
      disposeGuard()
      shell.close()
    }
  }

  return { read }
}

module.exports = {
  EXTRACT_VISIBLE_PAGE_SCRIPT,
  MAX_TEXT_CHARS,
  createAuthenticatedWebReader,
  extractVisiblePage
}
