const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const toolbarSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-toolbar.jsx'),
  'utf8'
)

test('bookmark toolbar uses encrypted backup for its primary export action', () => {
  assert.match(
    toolbarSource,
    /onClick=\{handleDownloadEncrypted\}[\s\S]*?className='download-bookmark-icon'/
  )
  assert.match(
    toolbarSource,
    /label:\s*e\('shellpilotEncryptedBackupRecommended'\)[\s\S]*?onClick:\s*handleDownloadEncrypted/
  )
})

test('plaintext credential export is explicitly warned and confirmed', () => {
  assert.match(toolbarSource, /const handleDownloadPlaintext = \(\) =>/)
  assert.match(toolbarSource, /window\.confirm\(e\('shellpilotPlaintextBackupWarning'\)\)/)
  assert.match(toolbarSource, /label:\s*e\('shellpilotPlaintextBackupNotRecommended'\)/)
  assert.match(toolbarSource, /onClick:\s*handleDownloadPlaintext/)
})

test('encrypted backup requires matching passphrase confirmation', () => {
  assert.match(toolbarSource, /const confirmation = window\.prompt\(e\('shellpilotBackupPasswordConfirm'\)\)/)
  assert.match(toolbarSource, /if \(confirmation !== passphrase\)/)
  assert.match(toolbarSource, /message\.error\(e\('shellpilotBackupPasswordMismatch'\)\)/)
})

test('bookmark toolbar provides an in-app cross-device migration guide', () => {
  assert.match(toolbarSource, /shellpilotMigrationGuideTitle/)
  assert.match(toolbarSource, /shellpilotMigrationStepOne/)
  assert.match(toolbarSource, /shellpilotMigrationStepThree/)
  assert.match(toolbarSource, /shellpilotMigrationExcludes/)
  assert.match(toolbarSource, /Modal\.info/)
})
