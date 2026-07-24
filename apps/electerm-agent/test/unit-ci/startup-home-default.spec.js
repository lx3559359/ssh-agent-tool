const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../', relativePath),
    'utf8'
  )
}

test('desktop defaults to the disconnected home without creating a local terminal', () => {
  const clientDefaults = readSource('src/client/common/default-setting.js')
  const appDefaults = readSource('src/app/common/default-setting.js')

  assert.match(clientDefaults, /initDefaultTabOnStart:\s*false/)
  assert.match(appDefaults, /initDefaultTabOnStart:\s*false/)
})

test('explicit startup sessions remain supported when the default local tab is disabled', () => {
  const source = readSource('src/client/store/load-data.js')

  assert.match(source, /typeof onStartSessions === 'string'/)
  assert.match(source, /store\.loadWorkspace\(onStartSessions\)/)
  assert.match(source, /for \(const s of arr\)/)
  assert.match(source, /store\.onSelectBookmark\(s\)/)
  assert.match(source, /store\.config\.initDefaultTabOnStart/)
  assert.match(source, /store\.initFirstTab\(\)/)
})

test('existing installations receive the disconnected-home default once', () => {
  const source = readSource('src/app/lib/get-config.js')

  assert.match(source, /shellpilotStartupHomeDefaultV1/)
  assert.match(source, /initDefaultTabOnStart\s*=\s*false/)
  assert.match(source, /dbAction\('data', 'update'/)
})
