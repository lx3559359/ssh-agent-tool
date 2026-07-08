const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const {
  parseQuickConnect
} = require(path.resolve(__dirname, '../../src/app/common/parse-quick-connect'))

test('app quick connect decodes URL-encoded SSH username and password', () => {
  const result = parseQuickConnect('ssh://deploy%2Bops:p%40ss%3Aword@10.0.1.23:22')

  assert.equal(result.username, 'deploy+ops')
  assert.equal(result.password, 'p@ss:word')
  assert.equal(result.host, '10.0.1.23')
  assert.equal(result.port, 22)
})

test('app quick connect keeps raw @ characters inside SSH passwords', () => {
  const result = parseQuickConnect('ssh://deploy:p@ssword@10.0.1.23:22')

  assert.equal(result.username, 'deploy')
  assert.equal(result.password, 'p@ssword')
  assert.equal(result.host, '10.0.1.23')
  assert.equal(result.port, 22)
})

test('app quick connect parses bracketed IPv6 SSH hosts', () => {
  const result = parseQuickConnect('ssh://deploy@[2001:db8::1]:2222')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::1')
  assert.equal(result.port, 2222)
})

test('app quick connect parses bracketed IPv6 SSH shortcuts', () => {
  const result = parseQuickConnect('[2001:db8::2]:2200')

  assert.equal(result.host, '2001:db8::2')
  assert.equal(result.port, 2200)
})

test('app quick connect parses bracketed IPv6 SSH shortcuts with username', () => {
  const result = parseQuickConnect('deploy@[2001:db8::3]:2201')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::3')
  assert.equal(result.port, 2201)
})

test('app quick connect keeps unbracketed IPv6 SSH shortcuts as hosts', () => {
  const result = parseQuickConnect('2001:db8::4')

  assert.equal(result.host, '2001:db8::4')
  assert.equal(result.port, 22)
})

test('app quick connect keeps unbracketed IPv6 SSH shortcuts with username as hosts', () => {
  const result = parseQuickConnect('deploy@2001:db8::5')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::5')
  assert.equal(result.port, 22)
})

test('client quick connect decodes URL-encoded SSH username and password', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('ssh://deploy%2Bops:p%40ss%3Aword@10.0.1.23:22')

  assert.equal(result.username, 'deploy+ops')
  assert.equal(result.password, 'p@ss:word')
  assert.equal(result.host, '10.0.1.23')
  assert.equal(result.port, 22)
})

test('client quick connect parses bracketed IPv6 SSH hosts', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('ssh://deploy@[2001:db8::1]:2222')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::1')
  assert.equal(result.port, 2222)
})

test('client quick connect parses bracketed IPv6 SSH shortcuts', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('[2001:db8::2]:2200')

  assert.equal(result.host, '2001:db8::2')
  assert.equal(result.port, 2200)
})

test('client quick connect parses bracketed IPv6 SSH shortcuts with username', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('deploy@[2001:db8::3]:2201')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::3')
  assert.equal(result.port, 2201)
})

test('client quick connect keeps unbracketed IPv6 SSH shortcuts as hosts', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('2001:db8::4')

  assert.equal(result.host, '2001:db8::4')
  assert.equal(result.port, 22)
})

test('client quick connect keeps unbracketed IPv6 SSH shortcuts with username as hosts', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('deploy@2001:db8::5')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::5')
  assert.equal(result.port, 22)
})

test('client quick connect keeps raw @ characters inside SSH passwords', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('ssh://deploy:p@ssword@10.0.1.23:22')

  assert.equal(result.username, 'deploy')
  assert.equal(result.password, 'p@ssword')
  assert.equal(result.host, '10.0.1.23')
  assert.equal(result.port, 22)
})
