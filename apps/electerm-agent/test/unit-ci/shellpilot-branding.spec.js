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
