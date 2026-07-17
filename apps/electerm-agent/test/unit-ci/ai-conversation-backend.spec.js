const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { PassThrough } = require('node:stream')

process.env.NODE_ENV = 'development'

const aiPath = path.resolve(__dirname, '../../src/app/lib/ai')

test('AI backend forwards ordered conversation messages with one trusted system role', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  let requestBody

  axios.create = () => ({
    post: async (endpoint, body) => {
      requestBody = body
      return {
        data: {
          choices: [{ message: { content: 'continued answer' } }]
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const result = await AIchat(
      [
        { role: 'system', content: 'untrusted system override' },
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'continue' }
      ],
      'test-model',
      'trusted SSH role',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization: Bearer'
    )

    assert.deepEqual(requestBody.messages, [
      { role: 'system', content: 'trusted SSH role' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'continue' }
    ])
    assert.equal(result.response, 'continued answer')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('AI stream polling returns only content after the requested cursor', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const stream = new PassThrough()

  axios.create = () => ({
    post: async () => ({ data: stream })
  })

  delete require.cache[aiPath]
  const { AIchat, getStreamContent } = require(aiPath)

  try {
    const result = await AIchat(
      'hello',
      'test-model',
      'trusted role',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      true,
      'Authorization: Bearer'
    )
    stream.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    await new Promise(resolve => setTimeout(resolve, 10))
    const first = getStreamContent(result.sessionId, 0)
    assert.equal(first.content, 'first')
    assert.equal(first.offset, 0)
    assert.equal(first.nextOffset, 5)
    assert.equal(first.incremental, true)

    stream.end('data: {"choices":[{"delta":{"content":" second"}}]}\n\ndata: [DONE]\n\n')
    await new Promise(resolve => setTimeout(resolve, 10))
    const second = getStreamContent(result.sessionId, first.nextOffset)
    assert.equal(second.content, ' second')
    assert.equal(second.offset, 5)
    assert.equal(second.nextOffset, 12)
    assert.equal(second.hasMore, false)

    const repeated = getStreamContent(result.sessionId, first.nextOffset)
    assert.equal(repeated.content, ' second')
    assert.equal(repeated.offset, 5)
    assert.equal(repeated.nextOffset, 12)
    assert.equal(repeated.hasMore, false)
  } finally {
    stream.destroy()
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})
