const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const helperPath = path.resolve(__dirname, '../e2e/common/isolated-electron-app.js')
const matrixPath = path.resolve(__dirname, '../e2e/022.secondary-ui-visual-matrix.spec.js')
const appOptionsPath = path.resolve(__dirname, '../e2e/common/app-options.js')

test('compiled Electron E2E launch does not inherit Vite development mode', () => {
  const originalNodeEnv = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'development'
    delete require.cache[appOptionsPath]
    const options = require(appOptionsPath)
    assert.equal(options.env.NODE_ENV, 'test')
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    delete require.cache[appOptionsPath]
  }
})

test('language selection uses native rendered option semantics', () => {
  const source = fs.readFileSync(matrixPath, 'utf8')
  const selector = source.match(/const chooseTargetOption = async \(\) => {[\s\S]*?\r?\n {2}}\r?\n {2}await chooseTargetOption/)

  assert.ok(selector)
  assert.match(selector[0], /await languageCombobox\.selectOption\(targetLanguage\)/)
  assert.match(selector[0], /toHaveValue\(targetLanguage\)/)
  assert.match(selector[0], /option\[value=/)
  assert.match(selector[0], /toHaveText\(targetText\)/)
  assert.doesNotMatch(selector[0], /ant-select|rc-virtual|mouse\.wheel/)
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

test('isolated Electron readiness uses a staged condition and reports startup diagnostics', () => {
  const matrix = fs.readFileSync(matrixPath, 'utf8')

  assert.match(matrix, /async function waitForSecondaryAppReady \(electronApp, page, label\)/)
  assert.match(matrix, /page\.waitForFunction\([\s\S]*?null,\s*\{[\s\S]*?timeout:/)
  assert.match(matrix, /readyState/)
  assert.match(matrix, /configLoaded/)
  assert.match(matrix, /processId/)
  assert.match(matrix, /startupMs/)
  assert.doesNotMatch(
    matrix,
    /waitForFunction\(\(\) => window\.store\?\.configLoaded === true, \{ timeout:/
  )
  const isolatedRuns = (
    matrix.match(/await runWithIsolatedApp\(/g) || []
  ).length
  const inPlaceReloads = (
    matrix.match(/await page\.reload\(\)/g) || []
  ).length
  const readinessChecks = (
    matrix.match(/await waitForSecondaryAppReady\(electronApp, page,/g) || []
  ).length

  assert.ok(isolatedRuns > 0)
  assert.equal(
    readinessChecks,
    isolatedRuns + inPlaceReloads,
    'every isolated launch and in-place reload must use the staged readiness helper'
  )
})

test('surface focus coverage enters each surface from an internal keyboard sentinel', () => {
  const matrix = fs.readFileSync(matrixPath, 'utf8')
  const focusInspection = matrix.match(
    /async function inspectKeyboardFocus \(page, surface\) \{[\s\S]*?\r?\n}\r?\n\r?\nfunction assertFocusSnapshot/
  )

  assert.ok(focusInspection)
  assert.match(focusInspection[0], /data-secondary-focus-sentinel/)
  assert.match(focusInspection[0], /root\.insertBefore\(sentinel, root\.firstChild\)/)
  assert.match(focusInspection[0], /sentinel\.focus\(\)/)
  assert.match(focusInspection[0], /await page\.keyboard\.press\('Tab'\)/)
  assert.doesNotMatch(focusInspection[0], /enabledCount \* 3/)
})

test('the complete visual matrix runs in a fresh Playwright worker pool', () => {
  const matrix = fs.readFileSync(matrixPath, 'utf8')

  assert.match(matrix, /const matrixTest = test\.extend\(/)
  assert.match(
    matrix,
    /matrixTest\('real app covers the secondary UI visual acceptance matrix'/
  )
  assert.doesNotMatch(
    matrix,
    /test\('real app covers the secondary UI visual acceptance matrix'/
  )
})
