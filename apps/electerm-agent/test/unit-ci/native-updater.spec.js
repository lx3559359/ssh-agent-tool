const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

test('package includes electron-updater for in-client differential updates', () => {
  const pack = require(path.join(root, 'package.json'))
  assert.ok(
    pack.dependencies['electron-updater'],
    'electron-updater must be a runtime dependency, not a manual installer helper'
  )
})

test('main updater service uses native autoUpdater behind release approval', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/app/lib/native-updater.js'),
    'utf8'
  )

  assert.match(source, /require\('electron-updater'\)/)
  assert.match(source, /autoDownload\s*=\s*false/)
  assert.match(source, /aigshell-update\.json/)
  assert.match(source, /publishApproved/)
  assert.match(source, /checkForUpdates/)
  assert.match(source, /downloadUpdate/)
  assert.match(source, /quitAndInstall\(true,\s*true\)/)
})

test('windows nsis installer lets first-time users choose an installation directory', () => {
  const config = require(path.join(root, 'build/electron-builder.json'))

  assert.equal(config.nsis.oneClick, false)
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true)
})

test('windows nsis build refreshes the effective electron-builder config before packaging', () => {
  const source = fs.readFileSync(
    path.join(root, 'build/bin/build-win-nsis.js'),
    'utf8'
  )

  assert.match(source, /prepareElectronBuilderConfig/)
  assert.match(source, /prepareElectronBuilderConfig\(\)/)
})

test('renderer upgrade panel defaults to native updater instead of installer mirror download', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(source, /nativeUpdateCheck/)
  assert.match(source, /nativeUpdateDownload/)
  assert.match(source, /nativeUpdateInstall/)
  assert.doesNotMatch(source, /renderMirrorSelector\(\)/)
  assert.doesNotMatch(source, /<Space\.Compact>/)
})

test('ipc exposes native update operations to the renderer', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(source, /nativeUpdateCheck/)
  assert.match(source, /nativeUpdateDownload/)
  assert.match(source, /nativeUpdateInstall/)
})
