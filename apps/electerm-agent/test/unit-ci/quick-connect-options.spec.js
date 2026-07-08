const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('builds beginner-friendly SSH quick connect options from form fields', async () => {
  const {
    buildQuickConnectOptions
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-options.js')))

  const opts = buildQuickConnectOptions({
    protocol: 'ssh',
    host: '10.0.1.23',
    port: '22',
    username: 'root',
    password: 'secret'
  })

  assert.equal(opts.type, 'ssh')
  assert.equal(opts.host, '10.0.1.23')
  assert.equal(opts.port, 22)
  assert.equal(opts.username, 'root')
  assert.equal(opts.password, 'secret')
  assert.equal(opts.authType, 'password')
  assert.equal(opts.enableSftp, true)
  assert.equal(opts.title, 'root@10.0.1.23')
})

test('omits empty optional quick connect fields', async () => {
  const {
    buildQuickConnectOptions
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-options.js')))

  const opts = buildQuickConnectOptions({
    protocol: 'rdp',
    host: '10.0.1.24',
    port: ''
  })

  assert.equal(opts.type, 'rdp')
  assert.equal(opts.host, '10.0.1.24')
  assert.equal(opts.port, 3389)
  assert.equal(opts.username, undefined)
  assert.equal(opts.password, undefined)
})

test('rejects invalid quick connect ports before opening an SSH tab', async () => {
  const {
    buildQuickConnectOptions
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-options.js')))

  assert.equal(buildQuickConnectOptions({
    protocol: 'ssh',
    host: '10.0.1.23',
    port: 'abc',
    username: 'root'
  }), null)

  assert.equal(buildQuickConnectOptions({
    protocol: 'ssh',
    host: '10.0.1.23',
    port: '70000',
    username: 'root'
  }), null)
})
