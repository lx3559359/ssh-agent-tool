const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('redacts sensitive strings before writing app logs', () => {
  const {
    redactLogValue
  } = require(path.resolve(__dirname, '../../src/app/lib/log-redaction'))

  const text = [
    'Authorization: Bearer sk-live-secret',
    'apiKeyAI=relay-secret',
    'ssh://root:server-password@10.0.1.23:22',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'private-key-body',
    '-----END OPENSSH PRIVATE KEY-----'
  ].join('\n')

  const redacted = redactLogValue(text)

  assert.equal(redacted.includes('sk-live-secret'), false)
  assert.equal(redacted.includes('relay-secret'), false)
  assert.equal(redacted.includes('server-password'), false)
  assert.equal(redacted.includes('private-key-body'), false)
  assert.match(redacted, /\[已脱敏\]/)
})

test('redacts sensitive fields inside structured app log payloads', () => {
  const {
    redactLogValue
  } = require(path.resolve(__dirname, '../../src/app/lib/log-redaction'))

  const redacted = redactLogValue({
    host: '10.0.1.23',
    username: 'root',
    password: 'root-password',
    privateKey: 'OPENSSH PRIVATE KEY',
    headers: {
      Authorization: 'Bearer sk-live-secret',
      'x-api-key': 'relay-secret'
    },
    nested: [
      {
        tokenElecterm: 'ws-token',
        url: 'socks5://proxy:proxy-password@127.0.0.1:1080'
      }
    ]
  })

  const serialized = JSON.stringify(redacted)
  assert.equal(serialized.includes('root-password'), false)
  assert.equal(serialized.includes('OPENSSH PRIVATE KEY'), false)
  assert.equal(serialized.includes('sk-live-secret'), false)
  assert.equal(serialized.includes('relay-secret'), false)
  assert.equal(serialized.includes('ws-token'), false)
  assert.equal(serialized.includes('proxy-password'), false)
  assert.equal(redacted.host, '10.0.1.23')
  assert.equal(redacted.username, 'root')
})

test('redacts common camelCase and snake_case secret fields in app logs', () => {
  const {
    redactLogValue
  } = require(path.resolve(__dirname, '../../src/app/lib/log-redaction'))

  const redacted = redactLogValue({
    accessToken: 'access-token-secret',
    refresh_token: 'refresh-token-secret',
    private_key: 'private-key-secret',
    clientSecret: 'client-secret',
    normal: 'visible'
  })

  const serialized = JSON.stringify(redacted)
  assert.equal(serialized.includes('access-token-secret'), false)
  assert.equal(serialized.includes('refresh-token-secret'), false)
  assert.equal(serialized.includes('private-key-secret'), false)
  assert.equal(serialized.includes('client-secret'), false)
  assert.equal(redacted.normal, 'visible')
})

test('redacts sensitive Error stacks and leaves circular payloads printable', () => {
  const {
    redactLogValue
  } = require(path.resolve(__dirname, '../../src/app/lib/log-redaction'))

  const err = new Error('Authorization: Bearer sk-live-secret')
  err.stack = 'Error: password=root-password\n    at C:\\Users\\alice\\app.js:1:1'
  const payload = { err }
  payload.self = payload

  const redacted = redactLogValue(payload)
  const serialized = JSON.stringify(redacted)

  assert.equal(serialized.includes('root-password'), false)
  assert.equal(serialized.includes('sk-live-secret'), false)
  assert.match(serialized, /\[已脱敏\]/)
  assert.match(serialized, /\[Circular\]/)
})

test('app log entry installs a redaction hook on electron-log', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/common/log.js'),
    'utf8'
  )

  assert.match(source, /installLogRedaction/)
})
