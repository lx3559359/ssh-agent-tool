const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('native updater waits for downloaded state before offering install', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.doesNotMatch(
    upgradeSource,
    /upgradePercent\s*>=\s*100[\s\S]{0,160}(?:this\.update\s*&&\s*)?this\.update\.destroy\(\)/,
    '100% progress alone is not the same as native updater downloaded state'
  )
  assert.match(upgradeSource, /nativeUpdateDownload/)
  assert.match(upgradeSource, /nativeUpdateState/)
  assert.match(upgradeSource, /if \(!finalState\?\.downloaded\)/)
  assert.match(upgradeSource, /upgradeReady:\s*Boolean\(finalState\?\.downloaded\)/)
  assert.match(upgradeSource, /nativeUpdateInstall/)
})

test('native updater polls progress until downloaded or failed', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(upgradeSource, /nativeUpdatePollTimer/)
  assert.match(upgradeSource, /clearNativeUpdatePoll/)
  assert.match(upgradeSource, /trackNativeUpdateProgress/)
  assert.match(upgradeSource, /setInterval\(async\s*\(\)\s*=>\s*{[\s\S]{0,180}nativeUpdateState/)
  assert.match(upgradeSource, /state\?\.downloaded\s*\|\|\s*state\?\.error/)
  assert.match(upgradeSource, /upgradePercent:\s*Math\.min\(state\?\.percent/)
})
