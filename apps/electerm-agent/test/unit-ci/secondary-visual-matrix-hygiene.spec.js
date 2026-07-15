const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const helperPath = path.resolve(__dirname, '../e2e/common/isolated-electron-app.js')
const matrixPath = path.resolve(__dirname, '../e2e/022.secondary-ui-visual-matrix.spec.js')

test('language selection uses rendered option semantics instead of virtual-row math', () => {
  const source = fs.readFileSync(matrixPath, 'utf8')

  assert.doesNotMatch(source, /index\s*\*\s*32|targetIndex/)
  assert.match(source, /getByRole\('option'/)
  assert.match(source, /scrollIntoViewIfNeeded\(\)/)
})

test('isolated app acquisition cleans launch and validation failures without masking them', async () => {
  assert.ok(fs.existsSync(helperPath), 'isolated Electron acquisition helper must exist')
  const { acquireIsolatedApp } = require(helperPath)

  for (const failureStage of ['launch', 'validation']) {
    const primaryError = new Error(`${failureStage} failed`)
    const cleanupError = new Error('cleanup failed')
    const cleanupCalls = []
    const app = { id: 'test-app' }

    await assert.rejects(
      acquireIsolatedApp({
        createProfileRoot: async () => 'safe-profile',
        validateProfileRoot: () => {},
        launch: async () => {
          if (failureStage === 'launch') throw primaryError
          return app
        },
        readUserDataPath: async () => 'unexpected-user-data',
        validateUserDataPath: () => {
          if (failureStage === 'validation') throw primaryError
        },
        cleanup: async (actualApp, profileRoot) => {
          cleanupCalls.push({ app: actualApp, profileRoot })
          throw cleanupError
        }
      }),
      error => {
        assert.equal(error, primaryError)
        assert.equal(error.cleanupError, cleanupError)
        return true
      }
    )

    assert.deepEqual(cleanupCalls, [{
      app: failureStage === 'launch' ? undefined : app,
      profileRoot: 'safe-profile'
    }])
  }
})
