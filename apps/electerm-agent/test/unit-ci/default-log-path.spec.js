const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('default terminal logs are stored under the AIGShell app folder', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/common/default-log-path.js'),
    'utf8'
  )

  assert.match(source, /window\.et\.sessionLogPath\s*\|\|/)
  assert.match(source, /osResolve\(window\.store\.appPath,\s*'AIGShell',\s*'session_logs'\)/)
  assert.doesNotMatch(source, /osResolve\(window\.store\.appPath,\s*'electerm',\s*'session_logs'\)/)
})
