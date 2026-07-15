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
    const userDataPath = await options.readUserDataPath(electronApp)
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
