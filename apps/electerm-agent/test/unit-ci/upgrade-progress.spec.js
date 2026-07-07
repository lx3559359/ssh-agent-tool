const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('upgrade download waits for the server completion event at 100 percent', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.doesNotMatch(
    upgradeSource,
    /upgradePercent\s*>=\s*100[\s\S]{0,160}(?:this\.update\s*&&\s*)?this\.update\.destroy\(\)/,
    '100% progress is not the same as upgrade:end; destroying early can prevent the installer from opening'
  )
  assert.match(upgradeSource, /onEnd\s*=\s*\(\)\s*=>\s*{[\s\S]{0,120}this\.handleClose\(\)/)
})
