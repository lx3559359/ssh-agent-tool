const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const appParserPath = path.resolve(
  __dirname,
  '../../src/app/common/parse-quick-connect'
)
const clientParserPath = path.resolve(
  __dirname,
  '../../src/client/common/parse-quick-connect.js'
)

const {
  parseQuickConnect
} = require(appParserPath)

async function loadClientParser () {
  return import(pathToFileURL(clientParserPath))
}

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

test('app quick connect parses bracketed IPv6 SSH URLs with username and default port', () => {
  const result = parseQuickConnect('ssh://deploy@[2001:db8::6]')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::6')
  assert.equal(result.port, 22)
})

test('app quick connect parses bracketed IPv6 SSH shortcuts with username and default port', () => {
  const result = parseQuickConnect('deploy@[2001:db8::7]')

  assert.equal(result.username, 'deploy')
  assert.equal(result.host, '2001:db8::7')
  assert.equal(result.port, 22)
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

test('renderer quick connect adapter matches the canonical parser contract', async () => {
  const { parseQuickConnect: parseClientQuickConnect } = await loadClientParser()
  const cases = [
    'ssh://deploy%2Bops:p%40ss%3Aword@10.0.1.23:22',
    'ssh://deploy:p@ssword@10.0.1.23:22',
    'ssh://deploy@[2001:db8::1]:2222',
    'deploy@[2001:db8::3]:2201',
    'deploy@2001:db8::5',
    'https://status.example.test:8443/health?theme=dark',
    'spice://viewer:secret@10.0.0.9:5901',
    'serial://COM5?baudRate=115200',
    'aigshell://ops@example.test?type=telnet&title=Router',
    'unsupported://example.test',
    '',
    null
  ]

  for (const input of cases) {
    assert.deepEqual(
      parseClientQuickConnect(input),
      parseQuickConnect(input),
      `renderer parser diverged for ${JSON.stringify(input)}`
    )
  }
})

test('renderer quick connect entry is a thin adapter to the canonical parser', () => {
  const source = fs.readFileSync(clientParserPath, 'utf8')
  const appSource = fs.readFileSync(`${appParserPath}.js`, 'utf8')
  const lines = source.split(/\r?\n/).filter(line => line.trim())

  assert.match(source, /\.\.\/\.\.\/app\/common\/parse-quick-connect\.js/)
  assert.doesNotMatch(
    source,
    /^import\s+\w+\s+from\s+['"]\.\.\/\.\.\/app\/common\/parse-quick-connect\.js['"]/m,
    'Vite serves application source as native ESM, so the renderer adapter must not request a CommonJS default export'
  )
  assert.match(
    appSource,
    /globalThis\.__shellpilotQuickConnect/,
    'the canonical CommonJS parser must expose the browser-safe bridge consumed by the renderer adapter'
  )
  assert.equal(lines.length <= 30, true, `expected a thin adapter, found ${lines.length} non-empty lines`)
})
