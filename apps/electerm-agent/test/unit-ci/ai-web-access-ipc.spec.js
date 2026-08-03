const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  WebAccessError,
  serializeWebAccessError
} = require('../../src/app/lib/ai-content/web-access-errors')

const ipcPath = path.resolve(
  __dirname,
  '../../src/app/lib/ipc.js'
)

test('serializes only allowlisted web error details', () => {
  const error = new WebAccessError(
    'WEB_ACCESS_AUTH_REQUIRED',
    'Authorization required.',
    {
      origin: 'http://kb.internal',
      addressClass: 'private',
      authorizationToken: 'token-1',
      readId: 'read-1',
      addresses: ['10.0.0.10'],
      url: 'http://kb.internal/private?secret=x',
      cookie: 'session=secret',
      body: 'sensitive page text'
    }
  )
  assert.deepEqual(serializeWebAccessError(error), {
    code: 'WEB_ACCESS_AUTH_REQUIRED',
    message: 'Authorization required.',
    details: {
      origin: 'http://kb.internal',
      addressClass: 'private',
      authorizationToken: 'token-1',
      readId: 'read-1'
    }
  })
})

test('IPC routes web operations through sender-aware globals', () => {
  const source = fs.readFileSync(ipcPath, 'utf8')

  assert.match(source, /const contextualAsyncGlobals =/)
  assert.match(
    source,
    /ingestAIContent:\s*\(event,\s*payload\)[\s\S]*?event\.sender\.id/
  )
  assert.match(
    source,
    /authorizeAIWebTarget:\s*\(event,\s*payload\)[\s\S]*?event\.sender\.id/
  )
  assert.match(source, /listAIWebGrants/)
  assert.match(source, /revokeAIWebGrant/)
  assert.match(source, /clearAIWebGrants/)
  assert.match(source, /clearAIWebSessionData/)
  assert.match(source, /cancelAIWebRead/)
  assert.match(
    source,
    /contextualAsyncGlobals\[name\][\s\S]*?\(event,\s*\.\.\.args\)/
  )
  assert.match(
    source,
    /Object\.hasOwn\(contextualAsyncGlobals,\s*name\)/
  )
  assert.doesNotMatch(
    source,
    /senderId:\s*payload\.senderId/
  )
})

test('IPC preserves sanitized WEB errors and flattens ordinary failures', () => {
  const source = fs.readFileSync(ipcPath, 'utf8')

  assert.match(source, /isWebAccessError\(error\)/)
  assert.match(source, /serializeWebAccessError\(error\)/)
  assert.match(source, /AI_CONTENT_READ_FAILED/)
  assert.match(
    source,
    /payload\?\.kind === 'url'[\s\S]*?getWebAccessService\(\)\.read/
  )
})
