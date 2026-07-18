const test = require('node:test')
const assert = require('node:assert/strict')

const sessionPath = require.resolve('../../src/app/server/session')
const sessionApiPath = require.resolve('../../src/app/server/session-api')

test('create terminal exposes only the session public identity metadata', async () => {
  const previousSession = require.cache[sessionPath]
  const previousSessionApi = require.cache[sessionApiPath]
  require.cache[sessionPath] = {
    id: sessionPath,
    filename: sessionPath,
    loaded: true,
    exports: {
      startSession: async () => ({
        pid: 'tab-public',
        getPublicSessionMetadata: () => ({
          hostKeyFingerprint: 'SHA256:verified-host-key',
          password: 'must-not-cross-process-boundary',
          privateKey: 'must-not-cross-process-boundary'
        }),
        initOptions: {
          password: 'must-not-cross-process-boundary',
          privateKey: 'must-not-cross-process-boundary'
        }
      })
    }
  }
  delete require.cache[sessionApiPath]

  try {
    const { createTerm } = require('../../src/app/server/session-api')
    const result = await createTerm({ uid: 'tab-public' })

    assert.deepEqual(result, {
      pid: 'tab-public',
      hostKeyFingerprint: 'SHA256:verified-host-key'
    })
  } finally {
    if (previousSession) require.cache[sessionPath] = previousSession
    else delete require.cache[sessionPath]
    if (previousSessionApi) require.cache[sessionApiPath] = previousSessionApi
    else delete require.cache[sessionApiPath]
  }
})
