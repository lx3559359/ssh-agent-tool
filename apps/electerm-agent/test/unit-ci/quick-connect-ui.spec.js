const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('quick connect form uses beginner friendly localized SSH labels', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tabs/quick-connect.jsx'),
    'utf8'
  )

  assert.match(source, /shellpilotQuickConnectServer/)
  assert.match(source, /shellpilotQuickConnectHostPlaceholder/)
  assert.match(source, /shellpilotOptionalUsername/)
  assert.match(source, /shellpilotOptionalPassword/)
  assert.match(source, /shellpilotQuickConnectHostRequired/)
  assert.doesNotMatch(source, /Format error, please check the input/)
  assert.doesNotMatch(source, /ssh\|rdp\|vnc\|spice/)
})

test('add menu uses the beginner quick connect form instead of the command-line input', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tabs/add-btn-menu.jsx'),
    'utf8'
  )

  assert.match(source, /<QuickConnect batch=\{batch\} formOnly \/>/)
  assert.doesNotMatch(source, /<QuickConnect batch=\{batch\} inputOnly \/>/)
})

test('quick connect form exposes SSH auth method and save controls', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tabs/quick-connect.jsx'),
    'utf8'
  )

  assert.match(source, /shellpilotAuthenticationMethod/)
  assert.match(source, /shellpilotPrivateKey/)
  assert.match(source, /SSH Agent/)
  assert.match(source, /shellpilotSaveAsConnection/)
})
