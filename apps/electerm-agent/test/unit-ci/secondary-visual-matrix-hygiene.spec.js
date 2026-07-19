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
  assert.doesNotMatch(selector[0], /index\s*\*\s*32|evaluate\(option => option\.click\(\)\)/)
  assert.match(selector[0], /await languageCombobox\.focus\(\)/)
  assert.match(selector[0], /await languageCombobox\.press\('ArrowDown'\)/)
  assert.match(selector[0], /dropdown\.waitFor\(\{ state: 'visible'/)
  assert.match(selector[0], /\.ant-select-dropdown:visible/)
  assert.match(selector[0], /getByRole\('listbox'\)/)
  assert.match(selector[0], /\.rc-virtual-list-holder/)
  assert.match(selector[0], /await holder\.boundingBox\(\)/)
  assert.match(selector[0], /const viewport = await page\.evaluate\(\(\) => \(\{/)
  assert.match(selector[0], /width: window\.innerWidth/)
  assert.match(selector[0], /height: window\.innerHeight/)
  assert.match(selector[0], /Math\.max\(holderBox\.y, 0\)/)
  assert.match(selector[0], /Math\.min\(holderBox\.y \+ holderBox\.height, viewport\.height\)/)
  assert.match(selector[0], /document\.elementFromPoint/)
  assert.match(selector[0], /await page\.mouse\.wheel\(0, wheelDelta\)/)
  assert.match(selector[0], /\.ant-select-item-option/)
  assert.match(selector[0], /toHaveCount\(1\)/)
  assert.match(selector[0], /toHaveText\(targetText\)/)
  assert.match(selector[0], /toBeVisible\(\)/)
  assert.match(selector[0], /toBeEnabled\(\)/)
  assert.match(selector[0], /const stableBox = await targetOption\.boundingBox\(\)/)
  assert.match(selector[0], /click\(\{ trial: true \}\)/)
  assert.match(selector[0], /await targetOption\.click\(\)/)
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
