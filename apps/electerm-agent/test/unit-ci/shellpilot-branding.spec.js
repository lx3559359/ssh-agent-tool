const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('ShellPilot branding is used for the Windows client shell', () => {
  const pkg = JSON.parse(read('package.json'))
  const builder = JSON.parse(read('build/electron-builder.json'))
  const topbar = read('src/client/components/main/aigshell-topbar.jsx')

  assert.equal(pkg.productName, 'ShellPilot')
  assert.equal(builder.appId, 'com.lx3559359.shellpilot')
  assert.equal(builder.win.icon, 'build/assets/shellpilot.ico')
  assert.match(topbar, /alt='ShellPilot'/)
  assert.match(topbar, />ShellPilot</)
})

test('ShellPilot top bar shows the current app version', () => {
  const topbar = read('src/client/components/main/aigshell-topbar.jsx')
  const style = read('src/client/components/main/aigshell-topbar.styl')

  assert.match(topbar, /packInfo/)
  assert.match(topbar, /packInfo\.version/)
  assert.match(topbar, /aigshell-topbar-version/)
  assert.match(style, /\.aigshell-topbar-version/)
})

test('ShellPilot release assets use the public ShellPilot file prefix', () => {
  const builder = JSON.parse(read('build/electron-builder.json'))
  const releaseVerifier = read('build/bin/verify-local-release-assets.js')
  const updateVersion = read('src/client/common/update-version.js')
  const versionTemplate = '$' + '{version}'
  const osTemplate = '$' + '{os}'
  const archTemplate = '$' + '{arch}'
  const extTemplate = '$' + '{ext}'

  assert.equal(builder.artifactName, `ShellPilot-${versionTemplate}-${osTemplate}-${archTemplate}.${extTemplate}`)
  assert.equal(builder.nsis.artifactName, `ShellPilot-${versionTemplate}-${osTemplate}-${archTemplate}-installer.${extTemplate}`)
  assert.match(releaseVerifier, /releaseAssetPrefix = pack\.productName \|\| 'ShellPilot'/)
  assert.match(releaseVerifier, /\$\{releaseAssetPrefix\}-\$\{pack\.version\}-win-/)
  assert.match(updateVersion, /ShellPilot-\$\{version\}-win-\$\{arch\}-installer\.exe/)
  assert.match(updateVersion, /AIGShell-\$\{version\}-win-\$\{arch\}-installer\.exe/)
})

test('ShellPilot icons are used by app chrome, tray, loading screen, and watermark fallbacks', () => {
  const runtimeConstants = read('src/app/common/runtime-constants.js')
  const menuButton = read('src/client/components/sys-menu/menu-btn.jsx')
  const indexView = read('src/client/views/index.pug')
  const cssOverwrite = read('src/client/components/bg/css-overwrite.jsx')

  for (const [name, source] of [
    ['runtime constants', runtimeConstants],
    ['system menu button', menuButton],
    ['loading view', indexView],
    ['terminal watermark fallback', cssOverwrite]
  ]) {
    assert.doesNotMatch(source, /aigshell-(round-128x128|tray|watermark|\.png)/, `${name} should not reference old AIGShell icons`)
    assert.match(source, /shellpilot/, `${name} should reference ShellPilot assets`)
  }
})

test('ShellPilot product name is used for app and window titles', () => {
  const runtimeConstants = read('src/app/common/runtime-constants.js')
  const createWindow = read('src/app/lib/create-window.js')
  const createApp = read('src/app/lib/create-app.js')
  const ipc = read('src/app/lib/ipc.js')
  const initApp = read('src/app/lib/init-app.js')

  assert.match(runtimeConstants, /appDisplayName: packInfo\.productName \|\| packInfo\.name/)
  assert.match(runtimeConstants, /safeStorageAppName:\s*'AIGShell'/)
  assert.match(createWindow, /title: appDisplayName/)
  assert.match(createApp, /app\.setName\(safeStorageAppName\)/)
  assert.match(createApp, /before the ShellPilot rebrand/)
  assert.match(createApp, /app\.setDesktopName\(appDisplayName\)/)
  assert.match(ipc, /\(packInfo\.productName \|\| packInfo\.name\) \+ ' - ' \+ title/)
  assert.match(initApp, /\$\{appDisplayName\} \$\{e\('isRunning'\)\}/)
  assert.doesNotMatch(createWindow, /title: packInfo\.name/)
  assert.doesNotMatch(ipc, /setTitle\(packInfo\.name/)
})

test('safe storage app name is set before encrypted config modules load', () => {
  const createApp = read('src/app/lib/create-app.js')
  const appEntry = read('src/app/app.js')
  const setNameIndex = createApp.indexOf('app.setName(safeStorageAppName)')
  const getConfigRequireIndex = createApp.indexOf("require('./get-config')")
  const entrySetNameIndex = appEntry.indexOf('electronApp.setName(safeStorageAppName)')
  const entrySetPathIndex = appEntry.indexOf("electronApp.setPath('userData'")
  const entryLogRequireIndex = appEntry.indexOf("require('./common/log')")
  const entryCreateAppRequireIndex = appEntry.indexOf("require('./lib/create-app')")

  assert.notEqual(setNameIndex, -1)
  assert.notEqual(getConfigRequireIndex, -1)
  assert.notEqual(entrySetNameIndex, -1)
  assert.notEqual(entrySetPathIndex, -1)
  assert.notEqual(entryLogRequireIndex, -1)
  assert.notEqual(entryCreateAppRequireIndex, -1)
  assert.ok(
    getConfigRequireIndex > setNameIndex,
    'get-config must load after app.setName(safeStorageAppName)'
  )
  assert.ok(
    entrySetPathIndex > entrySetNameIndex,
    'app entry must set legacy userData after the safe storage app name'
  )
  assert.ok(
    entryLogRequireIndex > entrySetPathIndex,
    'app entry must set legacy userData before loading log'
  )
  assert.ok(
    entryCreateAppRequireIndex > entrySetPathIndex,
    'app entry must set legacy userData before loading create-app'
  )
})

test('ShellPilot icon assets are present for app chrome and packaging', () => {
  const files = [
    'build/assets/shellpilot.ico',
    'src/client/assets/images/shellpilot.png',
    'src/client/assets/images/shellpilot-round-128x128.png',
    'src/client/assets/images/shellpilot-watermark.png',
    'src/client/assets/images/shellpilot-tray.png'
  ]

  for (const file of files) {
    const fullPath = path.join(root, file)
    assert.equal(fs.existsSync(fullPath), true, `${file} should exist`)
    assert.ok(fs.statSync(fullPath).size > 512, `${file} should not be empty`)
  }
})

test('update approval accepts the ShellPilot brand while remaining compatible with AIGShell clients', () => {
  const source = read('build/bin/write-update-approval-manifest.js')

  assert.match(source, /product:\s*'ShellPilot'/)
  assert.match(source, /compatibleProducts/)
  assert.match(source, /AIGShell/)
  assert.match(source, /ShellPilot/)
})
