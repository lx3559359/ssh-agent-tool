const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const specPath = path.resolve(
  __dirname,
  '../e2e/034.real-server-external-acceptance.spec.js'
)

test('external acceptance fingerprints protected VPS services before and after the suite', () => {
  const source = fs.readFileSync(specPath, 'utf8')

  assert.match(source, /protectedServiceSnapshotCommand/)
  assert.match(source, /systemctl show x-ui/)
  assert.match(source, /systemctl cat x-ui/)
  assert.match(source, /systemctl list-units --type=service --state=running/)
  assert.match(source, /ss -H -lnt/)
  assert.match(source, /docker ps/)
  assert.match(source, /test\.beforeAll/)
  assert.match(source, /test\.afterAll/)
  assert.match(source, /protectedServiceBaseline/)
  assert.match(source, /Protected remote service fingerprint changed/)
  assert.match(source, /window\.store\.mcpOpenTab/)
  assert.match(source, /enableSftp:\s*true/)
  assert.match(source, /seedKnownHost/)
  assert.match(source, /acceptedHosts\.has/)
  assert.match(source, /launchExternalAcceptanceApp/)
})

test('protected service snapshot command is read-only', () => {
  const source = fs.readFileSync(specPath, 'utf8')
  const match = source.match(
    /const protectedServiceSnapshotCommand = Object\.freeze\(\[([\s\S]*?)\]\)\.join\('\\n'\)/
  )

  assert.ok(match, 'protected service snapshot command must remain a frozen inline allowlist')
  assert.doesNotMatch(
    match[1],
    /\b(?:restart|reload|start|stop|enable|disable|kill|pkill|reboot|shutdown|poweroff|rm|mv|cp|touch|mkdir|chmod|chown|install|update|upgrade)\b|sed\s+-i|(?:^|[^0-9])>\s*(?!&|\/dev\/null)/im
  )
})
