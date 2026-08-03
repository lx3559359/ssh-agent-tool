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

test('connection wizard binds labels, help text, and local persistence copy', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-wizard.jsx'),
    'utf8'
  )

  const fieldIds = [
    'protocol',
    'host',
    'port',
    'username',
    'auth-type',
    'password',
    'private-key',
    'passphrase',
    'profile',
    'title',
    'save',
    'group'
  ]
  for (const field of fieldIds) {
    assert.match(source, new RegExp(`htmlFor='shellpilot-connect-${field}'`))
    assert.match(source, new RegExp(`id='shellpilot-connect-${field}'`))
  }
  assert.match(source, /id='shellpilot-connect-host-help'/)
  assert.match(source, /aria-describedby='shellpilot-connect-host-help'/)
  assert.match(source, /id='shellpilot-connect-auth-help'/)
  assert.match(source, /aria-describedby='shellpilot-connect-auth-help'/)
  assert.match(source, /id='shellpilot-connect-persistence-help'/)
  assert.match(source, /aria-describedby='shellpilot-connect-persistence-help'/)
  assert.match(source, /shellpilotRequired/)
  assert.match(source, /shellpilotOptional/)
  assert.match(source, /shellpilotRecommended/)
  assert.match(source, /shellpilotQuickConnectLocalPersistence/)

  for (const field of ['protocol', 'host', 'port', 'auth-type', 'private-key', 'profile']) {
    assert.match(
      source,
      new RegExp(`id='shellpilot-connect-${field}'[\\s\\S]{0,160}aria-required='true'`)
    )
  }

  assert.match(source, /saveAsBookmark:\s*true/)
  assert.match(source, /await testConnection\(options\)/)
  assert.match(source, /onClick=\{handleConnect\}/)
  assert.match(source, /ref=\{hostInputRef\}/)
  assert.match(source, /afterOpenChange=\{handleAfterOpenChange\}/)
  assert.match(source, /hostInputRef\.current\?\.focus/)
  assert.doesNotMatch(source, /disabled=\{!testResult|disabled=\{testResult/)
})
