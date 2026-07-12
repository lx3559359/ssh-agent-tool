const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src', relativePath), 'utf8')
}

test('update center shows the complete user-facing update state', () => {
  const source = readSource('client/components/main/update-center-modal.jsx')

  assert.match(source, /当前版本/)
  assert.match(source, /最新版本/)
  assert.match(source, /更新状态/)
  assert.match(source, /下载进度/)
  assert.match(source, /更新日志/)
  assert.match(source, /重启并安装/)
  assert.match(source, /refsStatic\.get\('upgrade'\)/)
  assert.match(source, /更新源/)
  assert.match(source, /updateSource/)
  assert.match(source, /ModelScope 国内源/)
  assert.match(source, /GitHub/)
  assert.match(source, /setConfig/)
})

test('top bar opens the update center before checking for updates', () => {
  const source = readSource('client/components/main/aigshell-topbar.jsx')

  assert.match(source, /setShowUpdateCenter\(true\)/)
  assert.match(source, /<UpdateCenterModal/)
  assert.match(source, /onCheckUpdate\(true\)/)
})

test('upgrade flow only offers restart after the native updater confirms download completion', () => {
  const source = readSource('client/components/main/upgrade.jsx')

  assert.match(source, /if \(!finalState\?\.downloaded\)/)
  assert.match(source, /upgradeReady:\s*Boolean\(finalState\?\.downloaded\)/)
  assert.doesNotMatch(source, /upgradeReady:\s*true/)
  assert.match(source, /shouldUpgrade:\s*false/)
  assert.match(source, /canAutoUpgrade:\s*false/)
})

test('legacy websocket updater is disabled so every desktop update uses approval checks', () => {
  const source = readSource('app/server/dispatch-center.js')

  assert.doesNotMatch(source, /\/upgrade\/:id/)
  assert.doesNotMatch(source, /require\('\.\/download-upgrade'\)/)
  assert.doesNotMatch(source, /upgrade-new/)
})
