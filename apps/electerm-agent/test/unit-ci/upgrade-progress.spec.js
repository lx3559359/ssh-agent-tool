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

test('upgrade download keeps the stall timeout active until completion or cancellation', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(
    upgradeSource,
    /resetDownloadTimer\s*=\s*\(\)\s*=>\s*{[\s\S]{0,180}clearTimeout\(this\.downloadTimer\)[\s\S]{0,180}this\.downloadTimer\s*=\s*setTimeout\(this\.timeout,\s*downloadUpgradeTimeout\)/,
    'progress should refresh the timeout so a stalled download can still be cancelled'
  )
  assert.match(upgradeSource, /onData\s*=\s*\(upgradePercent\)\s*=>\s*{[\s\S]{0,120}this\.resetDownloadTimer\(\)/)
  assert.match(upgradeSource, /doUpgrade\s*=\s*debounce\(async\s*\(\)\s*=>\s*{[\s\S]{0,900}this\.resetDownloadTimer\(\)/)
  assert.match(
    upgradeSource,
    /clearDownloadTimer\s*=\s*\(\)\s*=>\s*{[\s\S]{0,120}clearTimeout\(this\.downloadTimer\)[\s\S]{0,120}this\.downloadTimer\s*=\s*null/
  )
  assert.match(upgradeSource, /cancel\s*=\s*\(\)\s*=>\s*{[\s\S]{0,120}this\.clearDownloadTimer\(\)/)
  assert.match(upgradeSource, /onError\s*=\s*\([^)]*\)\s*=>\s*{[\s\S]{0,120}this\.clearDownloadTimer\(\)/)
  assert.match(upgradeSource, /onEnd\s*=\s*\(\)\s*=>\s*{[\s\S]{0,120}this\.clearDownloadTimer\(\)/)
})
