async function acquireIsolatedApp (options) {
  let electronApp
  let profileRoot
  let ready = false
  let primaryError
  let cleanupError
  let acquiredApp

  try {
    profileRoot = await options.createProfileRoot()
    options.validateProfileRoot(profileRoot)
    electronApp = await options.launch(profileRoot)
    const userDataPath = await readUserDataPathWithRetry(
      options,
      electronApp,
      profileRoot
    )
    options.validateUserDataPath(profileRoot, userDataPath)
    ready = true
    acquiredApp = { electronApp, profileRoot, userDataPath }
  } catch (error) {
    primaryError = error
  } finally {
    if (!ready && profileRoot) {
      try {
        await options.cleanup(electronApp, profileRoot)
      } catch (error) {
        cleanupError = error
      }
    }
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
  return acquiredApp
}

async function readUserDataPathWithRetry (
  options,
  electronApp,
  profileRoot,
  attempts = 5
) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await options.readUserDataPath(electronApp, profileRoot)
    } catch (error) {
      lastError = error
      if (!/execution context was destroyed/i.test(String(error?.message))) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw lastError
}

async function cleanupPreservingPrimaryError (cleanup, primaryError) {
  try {
    await cleanup()
  } catch (cleanupError) {
    if (primaryError) {
      primaryError.cleanupError = cleanupError
      return
    }
    throw cleanupError
  }
}

module.exports = {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
}
