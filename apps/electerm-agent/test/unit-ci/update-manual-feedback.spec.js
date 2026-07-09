const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('top bar exposes a clear check update action label for Chinese users', () => {
  const topbarSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/aigshell-topbar.jsx'),
    'utf8'
  )

  assert.match(topbarSource, /key:\s*'update'[\s\S]{0,120}label:\s*'检查更新'/)
  assert.doesNotMatch(topbarSource, /key:\s*'update'[\s\S]{0,120}label:\s*'更新'/)
})

test('manual update checks show visible toast feedback from the top bar', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(upgradeSource, /message\.info\('正在检查更新/)
  assert.match(upgradeSource, /message\.success\(text/)
  assert.match(upgradeSource, /message\.warning\(text/)
  assert.match(upgradeSource, /message\.error\(text/)
  assert.match(upgradeSource, /releaseStatus\.status\s*===\s*'current'[\s\S]{0,220}this\.showNoUpdateInfo\(releaseStatus\.message/)
})
