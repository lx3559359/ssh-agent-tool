const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { PassThrough } = require('node:stream')

process.env.NODE_ENV = 'development'

const aiPath = path.resolve(__dirname, '../../src/app/lib/ai')
const aiResolvedPath = require.resolve(aiPath)

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

test('AI backend omits the system message when ordinary chat has no custom role', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  let requestBody

  axios.create = () => ({
    post: async (endpoint, body) => {
      requestBody = body
      return {
        data: {
          choices: [{ message: { content: 'general answer' } }]
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    await AIchat(
      '介绍一下你自己',
      'test-model',
      '',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization: Bearer'
    )

    assert.deepEqual(requestBody.messages, [
      { role: 'user', content: '介绍一下你自己' }
    ])
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('AI backend records started and completed with the renderer trace without changing its response', async () => {
  const axios = require('axios')
  const log = require('../../src/app/common/log')
  const originalCreate = axios.create
  const originalRecordQualityEvent = log.recordQualityEvent
  const events = []

  axios.create = () => ({
    post: async () => ({
      data: { choices: [{ message: { content: 'observable answer' } }] }
    })
  })
  log.recordQualityEvent = (context, event) => {
    events.push({ context, event })
    return true
  }
  delete require.cache[aiResolvedPath]
  const { AIchat } = require(aiPath)
  const traceContext = {
    traceId: 'sp-1784304000000-12345678',
    requestId: 'renderer-request-id'
  }

  try {
    const result = await AIchat(
      'private chat body',
      'test-model',
      '',
      'https://relay.example.com/v1',
      '',
      'private-api-key',
      '',
      false,
      'Authorization: Bearer',
      'backend-request-id',
      traceContext
    )

    assert.deepEqual(result, {
      response: 'observable answer',
      isStream: false
    })
    assert.deepEqual(events.map(entry => ({
      traceId: entry.context.traceId,
      requestId: entry.context.requestId,
      phase: entry.event.phase,
      result: entry.event.result
    })), [
      {
        traceId: traceContext.traceId,
        requestId: 'backend-request-id',
        phase: 'started',
        result: undefined
      },
      {
        traceId: traceContext.traceId,
        requestId: 'backend-request-id',
        phase: 'completed',
        result: 'completed'
      }
    ])
    assert.doesNotMatch(JSON.stringify(events), /private chat body|private-api-key|relay\.example\.com/)
  } finally {
    axios.create = originalCreate
    log.recordQualityEvent = originalRecordQualityEvent
    delete require.cache[aiResolvedPath]
  }
})

test('AI backend retries one transient pre-response failure and applies a request timeout', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const originalRetryDelay = process.env.SHELLPILOT_AI_REQUEST_RETRY_DELAY_MS
  const clientConfigs = []
  let attempts = 0
  process.env.SHELLPILOT_AI_REQUEST_RETRY_DELAY_MS = '1'

  axios.create = config => {
    clientConfigs.push(config)
    return {
      post: async () => {
        attempts += 1
        if (attempts === 1) {
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        }
        return {
          data: {
            choices: [{ message: { content: 'recovered' } }]
          }
        }
      }
    }
  }

  delete require.cache[aiResolvedPath]
  const { AIchat, AI_REQUEST_LIMITS } = require(aiPath)

  try {
    const result = await AIchat(
      'retry please',
      'test-model',
      '',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false
    )
    assert.equal(attempts, 2)
    assert.equal(result.response, 'recovered')
    assert.equal(AI_REQUEST_LIMITS.maxRetries, 1)
    assert.equal(clientConfigs.length, 1)
    assert.equal(clientConfigs[0].timeout, AI_REQUEST_LIMITS.timeoutMs)
  } finally {
    axios.create = originalCreate
    if (originalRetryDelay === undefined) delete process.env.SHELLPILOT_AI_REQUEST_RETRY_DELAY_MS
    else process.env.SHELLPILOT_AI_REQUEST_RETRY_DELAY_MS = originalRetryDelay
    delete require.cache[aiResolvedPath]
  }
})

test('AI backend does not retry authentication failures and returns actionable disconnect guidance', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  let authAttempts = 0
  let networkAttempts = 0

  axios.create = () => ({
    post: async () => {
      authAttempts += 1
      const error = new Error('unauthorized')
      error.response = { status: 401, data: { error: { message: 'invalid key' } } }
      throw error
    }
  })
  delete require.cache[aiResolvedPath]

  try {
    let ai = require(aiPath)
    const auth = await ai.AIchat('hello', 'model', '', 'https://relay.example.com/v1', '', 'key', '', false)
    assert.equal(authAttempts, 1)
    assert.match(auth.error, /invalid key|认证|密钥/)

    axios.create = () => ({
      post: async () => {
        networkAttempts += 1
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
      }
    })
    delete require.cache[aiResolvedPath]
    ai = require(aiPath)
    const disconnected = await ai.AIchat('hello', 'model', '', 'https://relay.example.com/v1', '', 'key', '', false)
    assert.equal(networkAttempts, 2)
    assert.match(disconnected.error, /连接中断|网络|重试/)
    assert.doesNotMatch(disconnected.error, /socket hang up/i)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiResolvedPath]
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

test('AI backend immediately fails stream traces closed or aborted without end or error', async () => {
  const axios = require('axios')
  const log = require('../../src/app/common/log')
  const originalCreate = axios.create
  const originalRecordQualityEvent = log.recordQualityEvent
  const streams = []
  const events = []

  axios.create = () => ({
    post: async () => {
      const stream = new PassThrough()
      streams.push(stream)
      return { data: stream }
    }
  })
  log.recordQualityEvent = (context, event) => {
    events.push({ context, event })
    return true
  }

  delete require.cache[aiResolvedPath]
  const { AIchat, getStreamContent } = require(aiPath)
  const parentTrace = {
    traceId: 'sp-1784304000000-12345678',
    operationId: 'upstream-operation',
    taskId: 'upstream-task'
  }

  try {
    for (const streamEvent of ['close', 'aborted']) {
      const result = await AIchat(
        `private ${streamEvent} prompt`,
        'test-model',
        '',
        'https://relay.example.com/v1',
        '',
        'private-key',
        '',
        true,
        'Authorization: Bearer',
        `request-${streamEvent}`,
        parentTrace
      )
      streams.at(-1).emit(streamEvent)
      await new Promise(resolve => setImmediate(resolve))

      const state = getStreamContent(result.sessionId, 0)
      assert.equal(state.hasMore, false)
      assert.equal(typeof state.error, 'string')
      assert.ok(state.error.length > 0)
    }

    assert.deepEqual(events.map(entry => ({
      requestId: entry.context.requestId,
      operationId: entry.context.operationId,
      taskId: entry.context.taskId,
      phase: entry.event.phase,
      result: entry.event.result
    })), [
      {
        requestId: 'request-close',
        operationId: undefined,
        taskId: undefined,
        phase: 'started',
        result: undefined
      },
      {
        requestId: 'request-close',
        operationId: undefined,
        taskId: undefined,
        phase: 'failed',
        result: 'failed'
      },
      {
        requestId: 'request-aborted',
        operationId: undefined,
        taskId: undefined,
        phase: 'started',
        result: undefined
      },
      {
        requestId: 'request-aborted',
        operationId: undefined,
        taskId: undefined,
        phase: 'failed',
        result: 'failed'
      }
    ])
    assert.doesNotMatch(JSON.stringify(events), /private (?:close|aborted) prompt|private-key/)
  } finally {
    streams.forEach(stream => stream.destroy())
    axios.create = originalCreate
    log.recordQualityEvent = originalRecordQualityEvent
    delete require.cache[aiResolvedPath]
  }
})

test('AI backend records one terminal after normal end or explicit stop followed by close', async () => {
  const axios = require('axios')
  const log = require('../../src/app/common/log')
  const originalCreate = axios.create
  const originalRecordQualityEvent = log.recordQualityEvent
  const streams = []
  const events = []

  axios.create = () => ({
    post: async () => {
      const stream = new PassThrough()
      streams.push(stream)
      return { data: stream }
    }
  })
  log.recordQualityEvent = (context, event) => {
    events.push({ context, event })
    return true
  }

  delete require.cache[aiResolvedPath]
  const { AIchat, stopStream } = require(aiPath)

  try {
    const ended = await AIchat(
      'normal end',
      'test-model',
      '',
      'https://relay.example.com/v1',
      '',
      'key',
      '',
      true,
      'Authorization: Bearer',
      'request-end'
    )
    streams[0].end('data: [DONE]\n\n')
    await new Promise(resolve => setImmediate(resolve))
    streams[0].emit('close')

    const stopped = await AIchat(
      'explicit stop',
      'test-model',
      '',
      'https://relay.example.com/v1',
      '',
      'key',
      '',
      true,
      'Authorization: Bearer',
      'request-stop'
    )
    assert.deepEqual(stopStream(stopped.sessionId), { stopped: true })
    streams[1].emit('close')
    streams[1].emit('aborted')
    await new Promise(resolve => setImmediate(resolve))

    assert.ok(ended.sessionId)
    assert.deepEqual(events
      .filter(entry => entry.event.phase !== 'started')
      .map(entry => [entry.context.requestId, entry.event.phase]), [
      ['request-end', 'completed'],
      ['request-stop', 'cancelled']
    ])
  } finally {
    streams.forEach(stream => stream.destroy())
    axios.create = originalCreate
    log.recordQualityEvent = originalRecordQualityEvent
    delete require.cache[aiResolvedPath]
  }
})

test('AI backend caps concurrent streaming sessions', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const originalLimit = process.env.SHELLPILOT_AI_STREAM_MAX_ACTIVE
  const streams = []
  process.env.SHELLPILOT_AI_STREAM_MAX_ACTIVE = '1'

  axios.create = () => ({
    post: async () => {
      const stream = new PassThrough()
      streams.push(stream)
      return { data: stream }
    }
  })

  delete require.cache[aiResolvedPath]
  const { AIchat, stopStream, AI_STREAM_LIMITS } = require(aiPath)

  try {
    assert.equal(AI_STREAM_LIMITS.maxActive, 1)
    const first = await AIchat('first', 'test-model', '', 'https://relay.example.com/v1', '', 'key', '', true)
    const second = await AIchat('second', 'test-model', '', 'https://relay.example.com/v1', '', 'key', '', true)

    assert.ok(first.sessionId)
    assert.match(second.error, /并发|流式会话|稍后/)
    assert.equal(streams.length, 1)
    stopStream(first.sessionId)
  } finally {
    streams.forEach(stream => stream.destroy())
    axios.create = originalCreate
    if (originalLimit === undefined) delete process.env.SHELLPILOT_AI_STREAM_MAX_ACTIVE
    else process.env.SHELLPILOT_AI_STREAM_MAX_ACTIVE = originalLimit
    delete require.cache[aiResolvedPath]
  }
})

test('AI backend stops a streaming session after its byte limit', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const originalLimit = process.env.SHELLPILOT_AI_STREAM_MAX_BYTES
  const stream = new PassThrough()
  process.env.SHELLPILOT_AI_STREAM_MAX_BYTES = '64'

  axios.create = () => ({
    post: async () => ({ data: stream })
  })

  delete require.cache[aiResolvedPath]
  const { AIchat, getStreamContent } = require(aiPath)

  try {
    const result = await AIchat('hello', 'test-model', '', 'https://relay.example.com/v1', '', 'key', '', true)
    stream.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(80) } }] })}\n\n`)
    await new Promise(resolve => setTimeout(resolve, 20))
    const state = getStreamContent(result.sessionId, 0)

    assert.equal(state.hasMore, false)
    assert.match(state.error, /过大|上限|限制/)
  } finally {
    stream.destroy()
    axios.create = originalCreate
    if (originalLimit === undefined) delete process.env.SHELLPILOT_AI_STREAM_MAX_BYTES
    else process.env.SHELLPILOT_AI_STREAM_MAX_BYTES = originalLimit
    delete require.cache[aiResolvedPath]
  }
})

test('AI backend times out stalled streaming sessions', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const originalTimeout = process.env.SHELLPILOT_AI_STREAM_MAX_DURATION_MS
  const stream = new PassThrough()
  process.env.SHELLPILOT_AI_STREAM_MAX_DURATION_MS = '20'

  axios.create = () => ({
    post: async () => ({ data: stream })
  })

  delete require.cache[aiResolvedPath]
  const { AIchat, getStreamContent } = require(aiPath)

  try {
    const result = await AIchat('hello', 'test-model', '', 'https://relay.example.com/v1', '', 'key', '', true)
    await new Promise(resolve => setTimeout(resolve, 50))
    const state = getStreamContent(result.sessionId, 0)

    assert.equal(state.hasMore, false)
    assert.match(state.error, /超时|时间上限/)
  } finally {
    stream.destroy()
    axios.create = originalCreate
    if (originalTimeout === undefined) delete process.env.SHELLPILOT_AI_STREAM_MAX_DURATION_MS
    else process.env.SHELLPILOT_AI_STREAM_MAX_DURATION_MS = originalTimeout
    delete require.cache[aiResolvedPath]
  }
})
