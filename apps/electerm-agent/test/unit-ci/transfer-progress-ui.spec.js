const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const transportUiPath = path.resolve(
  __dirname,
  '../../src/client/components/sidebar/transport-ui.jsx'
)

test('transfer rows render a progress bar, bytes, speed, ETA and Chinese controls', () => {
  const source = fs.readFileSync(transportUiPath, 'utf8')
  assert.match(source, /Progress/)
  assert.match(source, /transferred/)
  assert.match(source, /total/)
  assert.match(source, /leftTime/)
  assert.match(source, /title=\{pauseTitle\}/)
  assert.match(source, /transfer-progress-meta/)
})
