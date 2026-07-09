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
