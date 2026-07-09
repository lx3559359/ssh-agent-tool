const { app } = require('electron')
const path = require('path')

const USER_DATA_NAME = process.env.SHELLPILOT_USER_DATA_NAME || 'AIGShell'

app.setName(USER_DATA_NAME)
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_NAME))

function requireEnv (name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}

function maskUrl (value = '') {
  try {
    const url = new URL(String(value))
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch (_) {
    return String(value || '')
  }
}

async function main () {
  await app.whenReady()

  const { getConfig } = require('../../src/app/lib/get-config')
  const { saveUserConfig } = require('../../src/app/lib/user-config-controller')

  const { config } = await getConfig(false)
  const update = {
    baseURLAI: requireEnv('SHELLPILOT_AI_BASE_URL'),
    modelAI: requireEnv('SHELLPILOT_AI_MODEL'),
    apiKeyAI: requireEnv('SHELLPILOT_AI_KEY'),
    apiPathAI: process.env.SHELLPILOT_AI_PATH || '',
    authHeaderNameAI: process.env.SHELLPILOT_AI_AUTH_HEADER || 'Authorization: Bearer',
    proxyAI: process.env.SHELLPILOT_AI_PROXY || ''
  }

  await saveUserConfig({
    ...config,
    ...update
  })

  console.log(JSON.stringify({
    ok: true,
    saved: {
      baseURLAI: maskUrl(update.baseURLAI),
      apiPathAI: update.apiPathAI,
      modelAI: update.modelAI,
      hasApiKeyAI: Boolean(update.apiKeyAI),
      apiKeyLength: update.apiKeyAI.length,
      authHeaderNameAI: update.authHeaderNameAI,
      hasProxyAI: Boolean(update.proxyAI)
    }
  }, null, 2))
  app.exit(0)
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2))
  app.exit(1)
})
