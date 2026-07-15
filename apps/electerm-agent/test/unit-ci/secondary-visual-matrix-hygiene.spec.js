const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const helperPath = path.resolve(__dirname, '../e2e/common/isolated-electron-app.js')
const matrixPath = path.resolve(__dirname, '../e2e/022.secondary-ui-visual-matrix.spec.js')

test('language selection uses rendered option semantics instead of virtual-row math', () => {
  const source = fs.readFileSync(matrixPath, 'utf8')
  const selector = source.match(/const chooseTargetOption = async \(\) => {[\s\S]*?\r?\n {2}}\r?\n {2}await chooseTargetOption/)

  assert.ok(selector)
  assert.doesNotMatch(selector[0], /index\s*\*\s*32|targetIndex/)
  assert.match(selector[0], /getAttribute\('aria-expanded'\) !== 'true'\) {\s*await languageCombobox\.press\('ArrowDown'\)/)
  assert.match(selector[0], /aria-activedescendant/)
  assert.match(selector[0], /languageCombobox\.press\('Home'\)/)
  assert.match(selector[0], /step < initial\.locales/)
  assert.match(selector[0], /\[role="option"\]/)
  assert.match(selector[0], /activeOption\.textContent\(\)/)
  assert.doesNotMatch(selector[0], /scrollIntoViewIfNeeded\(\)/)
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

test('isolated app body cleanup preserves the primary failure', async () => {
  const { cleanupPreservingPrimaryError } = require(helperPath)
  const primaryError = new Error('body failed')
  const cleanupError = new Error('cleanup failed')

  await cleanupPreservingPrimaryError(async () => {
    throw cleanupError
  }, primaryError)
  assert.equal(primaryError.cleanupError, cleanupError)

  await assert.rejects(
    cleanupPreservingPrimaryError(async () => {
      throw cleanupError
    }),
    error => error === cleanupError
  )

  const matrix = fs.readFileSync(matrixPath, 'utf8')
  assert.match(matrix, /runWithIsolatedApp/)
  assert.doesNotMatch(matrix, /finally\s*{\s*await closeIsolatedApp/)
})
