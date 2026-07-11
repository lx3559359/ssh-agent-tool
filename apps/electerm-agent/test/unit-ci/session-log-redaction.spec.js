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

test('ssh session log recursively creates nested log directories', async () => {
  const SessionLog = require(path.resolve(__dirname, '../../src/app/server/session-log'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-session-log-nested-'))
  const logDir = path.join(root, 'year', 'month', 'day')
  const logger = new SessionLog({ logDir, fileName: 'session.log' })

  logger.write('normal terminal output')
  await new Promise(resolve => logger.stream.end(resolve))

  assert.equal(fs.readFileSync(path.join(logDir, 'session.log'), 'utf8'), 'normal terminal output')
})

test('ssh session log propagates file open errors synchronously', () => {
  const SessionLog = require(path.resolve(__dirname, '../../src/app/server/session-log'))
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-session-log-open-'))
  fs.mkdirSync(path.join(logDir, 'blocked.log'))

  assert.throws(
    () => new SessionLog({ logDir, fileName: 'blocked.log' }),
    /EISDIR|EPERM|EACCES/
  )
})

test('ssh session log controls stream errors instead of emitting them unhandled', () => {
  const SessionLog = require(path.resolve(__dirname, '../../src/app/server/session-log'))
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-session-log-stream-'))
  const logger = new SessionLog({ logDir, fileName: 'session.log' })
  const expectedError = new Error('stream failed')

  assert.doesNotThrow(() => logger.stream.emit('error', expectedError))
  assert.throws(() => logger.write('more output'), expectedError)
  logger.destroy()
})
