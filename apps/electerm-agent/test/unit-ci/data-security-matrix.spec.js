const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readUnitTest (name) {
  return fs.readFileSync(path.resolve(__dirname, name), 'utf8')
}

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src', relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing data security evidence: ${label}`)
}

test('P0 data security matrix covers encrypted credentials backups and redacted logs', () => {
  const safeStorage = readUnitTest('safe-storage.spec.js')
  const bookmarkBackup = readUnitTest('bookmark-backup.spec.js')
  const logRedaction = readUnitTest('log-redaction.spec.js')
  const diagnosticPack = readUnitTest('diagnostic-pack.spec.js')
  const sessionLogRedaction = readUnitTest('session-log-redaction.spec.js')
  const sqliteSource = readSource('app/lib/sqlite.js')
  const sessionLogSource = readSource('app/server/session-log.js')

  assertEvidence(safeStorage, /sqlite bookmark storage encrypts all server connection secrets at rest/, 'server credential encryption at rest')
  assertEvidence(safeStorage, /sqlite userConfig storage encrypts model api credentials at rest/, 'model api credential encryption at rest')
  assertEvidence(sqliteSource, /ENC_TABLES = new Set\(\[[\s\S]*'bookmarks'[\s\S]*'data'[\s\S]*'aiChatHistory'[\s\S]*\]\)/, 'sqlite encrypted table allow-list')
  assertEvidence(sqliteSource, /DATA_ENC_ID = 'userConfig'/, 'model api config row encryption gate')
  assertEvidence(sqliteSource, /enc && shouldEncForRow\(dbName,\s*_id\) \? encryptData\(jsonStr\) : jsonStr/, 'sqlite row encryption before writing')
  assertEvidence(bookmarkBackup, /creates an AIGShell bookmark backup package with metadata and credentials intact/, 'backup can include credentials')
  assertEvidence(bookmarkBackup, /creates a bookmark backup without credentials when requested/, 'backup can omit credentials')
  assertEvidence(bookmarkBackup, /creates an encrypted bookmark backup that hides server details and decrypts with the passphrase/, 'encrypted backup export')
  assertEvidence(bookmarkBackup, /rejects encrypted bookmark backups without the correct passphrase/, 'encrypted backup import password validation')
  assertEvidence(logRedaction, /redacts sensitive strings before writing app logs/, 'app log redaction')
  assertEvidence(logRedaction, /redacts sensitive fields inside structured app log payloads/, 'structured log redaction')
  assertEvidence(diagnosticPack, /redacts secrets and local user paths from diagnostic text/, 'diagnostic text redaction')
  assertEvidence(diagnosticPack, /builds a diagnostic report with redacted session and update logs/, 'diagnostic log redaction')
  assertEvidence(sessionLogRedaction, /ssh session log redacts secrets before writing terminal output to disk/, 'ssh session log redaction test')
  assertEvidence(sessionLogSource, /redactLogValue/, 'ssh session log redaction implementation')
})
