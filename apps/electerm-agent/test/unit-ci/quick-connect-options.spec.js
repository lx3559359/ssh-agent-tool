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

test('builds SSH quick connect options for private key auth', async () => {
  const {
    buildQuickConnectOptions
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-options.js')))

  const opts = buildQuickConnectOptions({
    protocol: 'ssh',
    host: '10.0.1.25',
    port: '22',
    username: 'deploy',
    authType: 'privateKey',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
    passphrase: 'key-pass'
  })

  assert.equal(opts.type, 'ssh')
  assert.equal(opts.authType, 'privateKey')
  assert.equal(opts.privateKey.includes('OPENSSH PRIVATE KEY'), true)
  assert.equal(opts.passphrase, 'key-pass')
  assert.equal(opts.password, undefined)
})

test('builds SSH quick connect options for SSH agent auth', async () => {
  const {
    buildQuickConnectOptions
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-options.js')))

  const opts = buildQuickConnectOptions({
    protocol: 'ssh',
    host: '10.0.1.27',
    port: '22',
    username: 'deploy',
    authType: 'sshAgent',
    sshAgent: '\\\\.\\pipe\\openssh-ssh-agent',
    password: 'should-not-be-used',
    privateKey: 'should-not-be-used'
  })

  assert.equal(opts.type, 'ssh')
  assert.equal(opts.useSshAgent, true)
  assert.equal(opts.sshAgent, '\\\\.\\pipe\\openssh-ssh-agent')
  assert.equal(opts.password, undefined)
  assert.equal(opts.privateKey, undefined)
  assert.equal(opts.authType, undefined)
})

test('builds bookmark payload when quick connect is saved as a connection', async () => {
  const {
    buildQuickConnectBookmark,
    buildQuickConnectOptions
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tabs/quick-connect-options.js')))

  const opts = buildQuickConnectOptions({
    protocol: 'ssh',
    host: '10.0.1.26',
    port: '2222',
    username: 'root',
    password: 'secret',
    saveAsBookmark: true,
    title: '生产 web'
  })
  const bookmark = buildQuickConnectBookmark(opts, { id: 'quick-1' })

  assert.equal(bookmark.id, 'quick-1')
  assert.equal(bookmark.title, '生产 web')
  assert.equal(bookmark.host, '10.0.1.26')
  assert.equal(bookmark.port, 2222)
  assert.equal(bookmark.username, 'root')
  assert.equal(bookmark.password, 'secret')
  assert.equal(bookmark.authType, 'password')
  assert.equal(bookmark.from, undefined)
  assert.equal(bookmark.batch, undefined)
})
