const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const specPath = path.join(root, 'test/e2e/030.real-server-regression.spec.js')
const specExists = fs.existsSync(specPath)
const requiredEnvironmentVariables = [
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD',
  'SHELLPILOT_E2E_REMOTE_ROOT'
]

function readSpec () {
  return fs.readFileSync(specPath, 'utf8')
}

test('real-server E2E regression spec exists', () => {
  assert.ok(specExists, 'test/e2e/030.real-server-regression.spec.js must be implemented')
})

test('real-server E2E reads credentials only from the approved environment variables', { skip: !specExists }, () => {
  const source = readSpec()

  for (const variable of requiredEnvironmentVariables) {
    assert.match(source, new RegExp(`['"]${variable}['"]`))
  }
  const directEnvironmentReads = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)]
    .map(match => match[1])
  assert.deepEqual(
    directEnvironmentReads.filter(name => !requiredEnvironmentVariables.includes(name)),
    []
  )
  assert.doesNotMatch(source, /(?:password|username|host|apiKey)\s*[:=]\s*['"][^'"]+['"]/i)
  assert.doesNotMatch(source, /\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{12,}\b/)
  assert.doesNotMatch(source, /console\.(?:log|info|debug|warn|error)\s*\(/)
})

test('real-server E2E skips explicitly when any required environment variable is missing', { skip: !specExists }, () => {
  const source = readSpec()

  assert.match(source, /missingEnvironmentVariables/)
  assert.match(source, /test\.skip\(\s*missingEnvironmentVariables\.length > 0/)
  assert.match(source, /\u7f3a\u5c11\u771f\u5b9e\u670d\u52a1\u5668\u6d4b\u8bd5\u73af\u5883\u53d8\u91cf/)
})

test('real-server E2E limits SSH commands to a declared read-only allowlist', { skip: !specExists }, () => {
  const source = readSpec()

  assert.match(source, /const readOnlyCommands = Object\.freeze\(\[/)
  assert.match(source, /'uname -s'/)
  assert.match(source, /'id -un'/)
  assert.match(source, /'pwd'/)
  assert.doesNotMatch(
    source,
    /\b(?:systemctl|service|firewall-cmd|ufw|iptables|nft|nmcli|useradd|userdel|passwd|reboot|shutdown|poweroff|kill|pkill|apt|yum|dnf|apk|chmod|chown)\b|sed\s+-i|ip\s+(?:address|addr|route)\s+(?:add|del|replace)/i
  )
  assert.doesNotMatch(source, /(?:exec|execFile|spawn|fork)\s*\(/)
})

test('real-server E2E confines SFTP changes to a random directory below REMOTE_ROOT and always cleans it', { skip: !specExists }, () => {
  const source = readSpec()

  assert.match(source, /crypto\.randomBytes/)
  assert.match(source, /path\.posix\.join\(config\.remoteRoot, sandboxName\)/)
  assert.match(source, /assertSafeRemoteRoot/)
  assert.match(source, /assertPathInsideSandbox/)
  assert.match(source, /\.mkdir\(/)
  assert.match(source, /\.writeFile\(/)
  assert.match(source, /\.readFile\(/)
  assert.match(source, /\.rename\(/)
  assert.ok(
    (source.match(/renameRemotePath\(run\.page,/g) || []).length >= 2,
    'rename and restore must both be exercised through the guarded helper'
  )
  assert.match(source, /finally\s*{/)
  assert.match(source, /cleanupRemoteSandbox/)
  assert.match(source, /\.unlink\(/)
  assert.match(source, /\.rmdir\(/)
})
