const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const clientUrl = pathToFileURL(path.join(
  root,
  'src/client/components/ai/ai-web-access-client.js'
)).href

function authorizationResult ({
  token,
  origin = 'http://kb.internal',
  addressClass = 'private',
  readId = 'read-1'
}) {
  return {
    ok: false,
    error: {
      code: 'WEB_ACCESS_AUTH_REQUIRED',
      message: 'Authorization required.',
      details: {
        origin,
        addressClass,
        authorizationToken: token,
        readId
      }
    }
  }
}

test('authorizes and retries with one stable logical read ID', async () => {
  const {
    readAIWebContent
  } = await import(clientUrl)
  const calls = []
  const result = await readAIWebContent({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    invoke: async (name, payload) => {
      calls.push([name, payload])
      if (name === 'ingestAIContent' && calls.length === 1) {
        return authorizationResult({ token: 'token-1' })
      }
      if (name === 'authorizeAIWebTarget') {
        return { ok: true, value: {} }
      }
      return {
        ok: true,
        value: {
          kind: 'web',
          source: 'browser',
          text: 'visible content'
        }
      }
    },
    requestAuthorization: async challenge => {
      assert.deepEqual(challenge, {
        origin: 'http://kb.internal',
        addressClass: 'private',
        readId: 'read-1'
      })
      return 'once'
    }
  })

  assert.equal(result.text, 'visible content')
  assert.equal(calls[0][1].readId, 'read-1')
  assert.equal(calls[1][0], 'authorizeAIWebTarget')
  assert.deepEqual(calls[1][1], {
    authorizationToken: 'token-1',
    scope: 'once'
  })
  assert.equal(calls[2][1].readId, 'read-1')
})

test('supports always scope without exposing the token to the modal', async () => {
  const {
    readAIWebContent
  } = await import(clientUrl)
  let challenge
  const invocations = []
  await readAIWebContent({
    url: 'http://localhost:3000/app',
    readId: 'read-local',
    invoke: async (name, payload) => {
      invocations.push([name, payload])
      if (name === 'ingestAIContent' && invocations.length === 1) {
        return authorizationResult({
          token: 'secret-token',
          origin: 'http://localhost:3000',
          addressClass: 'loopback',
          readId: 'read-local'
        })
      }
      if (name === 'authorizeAIWebTarget') {
        return { ok: true, value: {} }
      }
      return {
        ok: true,
        value: { kind: 'web', text: 'local content' }
      }
    },
    requestAuthorization: async value => {
      challenge = value
      return 'always'
    }
  })

  assert.equal(Object.hasOwn(challenge, 'authorizationToken'), false)
  assert.equal(invocations[1][1].scope, 'always')
  assert.equal(
    invocations[1][1].authorizationToken,
    'secret-token'
  )
})

test('cancels the logical read without returning a system failure', async () => {
  const {
    readAIWebContent
  } = await import(clientUrl)
  const calls = []
  await assert.rejects(readAIWebContent({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    invoke: async (name, payload) => {
      calls.push([name, payload])
      if (name === 'ingestAIContent') {
        return authorizationResult({ token: 'token-1' })
      }
      return { ok: true, value: { cancelled: true } }
    },
    requestAuthorization: async () => null
  }), { code: 'WEB_ACCESS_CANCELLED' })

  assert.deepEqual(calls.at(-1), [
    'cancelAIWebRead',
    { readId: 'read-1' }
  ])
})

test('fails closed for malformed challenges and does not retry other errors', async () => {
  const {
    readAIWebContent
  } = await import(clientUrl)
  let prompts = 0
  await assert.rejects(readAIWebContent({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    invoke: async () => ({
      ok: false,
      error: {
        code: 'WEB_ACCESS_AUTH_REQUIRED',
        message: 'Authorization required.',
        details: {
          origin: 'http://kb.internal',
          addressClass: 'private',
          readId: 'different-read'
        }
      }
    }),
    requestAuthorization: async () => {
      prompts += 1
      return 'once'
    }
  }), { code: 'WEB_ACCESS_BLOCKED' })
  assert.equal(prompts, 0)

  let reads = 0
  await assert.rejects(readAIWebContent({
    url: 'https://missing.example',
    readId: 'read-network',
    invoke: async () => {
      reads += 1
      return {
        ok: false,
        error: {
          code: 'WEB_NETWORK_ERROR',
          message: 'Network failed.'
        }
      }
    },
    requestAuthorization: async () => 'once'
  }), { code: 'WEB_NETWORK_ERROR' })
  assert.equal(reads, 1)
})

test('bounds consecutive cross-origin authorization retries', async () => {
  const {
    readAIWebContent
  } = await import(clientUrl)
  let reads = 0
  await assert.rejects(readAIWebContent({
    url: 'http://first.internal/app',
    readId: 'read-loop',
    invoke: async name => {
      if (name === 'authorizeAIWebTarget') {
        return { ok: true, value: {} }
      }
      reads += 1
      return authorizationResult({
        token: 'token-' + reads,
        origin: 'http://origin-' + reads + '.internal',
        readId: 'read-loop'
      })
    },
    requestAuthorization: async () => 'once',
    maxChallenges: 4
  }), { code: 'WEB_REDIRECT_LIMIT' })
  assert.equal(reads, 5)
})

test('AI chat wires the controlled authorization modal and stable attachment read IDs', async () => {
  const chatSource = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-chat.jsx'
  ), 'utf8')
  const modalSource = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-web-access-modal.jsx'
  ), 'utf8')
  const attachmentSource = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-attachments.js'
  ), 'utf8')

  assert.match(chatSource, /webAccessChallenge/)
  assert.match(chatSource, /webAccessResolverRef/)
  assert.match(chatSource, /requestWebAccessAuthorization/)
  assert.match(chatSource, /<AIWebAccessModal/)
  assert.match(chatSource, /onDecision=/)
  assert.match(chatSource, /onCancel=/)
  assert.match(modalSource, /ai-web-allow-once/)
  assert.match(modalSource, /ai-web-allow-always/)
  assert.match(modalSource, /ai-web-cancel/)
  assert.match(modalSource, /addressClass === 'loopback'/)
  assert.match(attachmentSource, /readId/)
  assert.match(attachmentSource, /readAIWebContent/)
})
