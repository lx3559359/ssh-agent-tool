const DEFAULT_MAX_CHALLENGES = 4

export function createAIWebClientError (error = {}) {
  const value = new Error(error.message || 'Web content could not be read.')
  value.code = error.code || 'WEB_ACCESS_BLOCKED'
  value.details = error.details || {}
  return value
}

function unwrapAIWebResult (result) {
  if (!result?.ok) {
    throw createAIWebClientError(result?.error)
  }
  return result.value
}

function getAuthorizationChallenge (error, readId) {
  const details = error?.details
  const validAddressClass = ['private', 'loopback'].includes(
    details?.addressClass
  )
  if (
    !details ||
    typeof details.origin !== 'string' ||
    !details.origin ||
    !validAddressClass ||
    typeof details.authorizationToken !== 'string' ||
    !details.authorizationToken ||
    details.readId !== readId
  ) {
    throw createAIWebClientError({
      code: 'WEB_ACCESS_BLOCKED',
      message: 'The web access authorization challenge was invalid.'
    })
  }
  return details
}

async function cancelLogicalRead (invoke, readId) {
  try {
    await invoke('cancelAIWebRead', { readId })
  } catch {
    // Cancellation is best effort. The original user decision still wins.
  }
}

export async function readAIWebContent ({
  url,
  readId,
  invoke = (name, payload) => window.pre.runGlobalAsync(name, payload),
  requestAuthorization,
  maxChallenges = DEFAULT_MAX_CHALLENGES
} = {}) {
  if (typeof readId !== 'string' || !readId) {
    throw createAIWebClientError({
      code: 'WEB_ACCESS_BLOCKED',
      message: 'A logical web read ID is required.'
    })
  }

  let challengeCount = 0
  while (true) {
    const result = await invoke('ingestAIContent', {
      kind: 'url',
      url,
      readId
    })
    if (result?.ok) {
      return result.value
    }

    const error = createAIWebClientError(result?.error)
    if (error.code !== 'WEB_ACCESS_AUTH_REQUIRED') {
      throw error
    }

    const challenge = getAuthorizationChallenge(error, readId)
    challengeCount += 1
    if (challengeCount > maxChallenges) {
      throw createAIWebClientError({
        code: 'WEB_REDIRECT_LIMIT',
        message: 'The web page crossed too many protected origins.'
      })
    }

    const scope = typeof requestAuthorization === 'function'
      ? await requestAuthorization({
        origin: challenge.origin,
        addressClass: challenge.addressClass,
        readId: challenge.readId
      })
      : null

    if (!['once', 'always'].includes(scope)) {
      await cancelLogicalRead(invoke, readId)
      throw createAIWebClientError({
        code: 'WEB_ACCESS_CANCELLED',
        message: 'Web access was cancelled.'
      })
    }

    unwrapAIWebResult(await invoke('authorizeAIWebTarget', {
      authorizationToken: challenge.authorizationToken,
      scope
    }))
  }
}
