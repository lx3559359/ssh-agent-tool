const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

test('ssh session log redacts secrets before writing terminal output to disk', async () => {
  const SessionLog = require(path.resolve(__dirname, '../../src/app/server/session-log'))
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-session-log-redaction-'))
  const fileName = 'prod-web-01.log'
  const logger = new SessionLog({ logDir, fileName })

  logger.write([
    'root@prod# echo password=root-password',
    'Authorization: Bearer sk-live-secret',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'private-key-body',
    '-----END OPENSSH PRIVATE KEY-----',
    'normal terminal output'
  ].join('\n'))

  await new Promise(resolve => logger.stream.end(resolve))
  const written = fs.readFileSync(path.join(logDir, fileName), 'utf8')

  assert.equal(written.includes('root-password'), false)
  assert.equal(written.includes('sk-live-secret'), false)
  assert.equal(written.includes('private-key-body'), false)
  assert.equal(written.includes('BEGIN OPENSSH PRIVATE KEY'), false)
  assert.match(written, /normal terminal output/)
})
