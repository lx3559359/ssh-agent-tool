const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.NODE_ENV = 'development'

const aiPath = path.resolve(__dirname, '../../src/app/lib/ai')
const logPath = path.resolve(__dirname, '../../src/app/common/log')

function createHttpError (status, data, code) {
  const error = new Error(`Request failed with status code ${status}`)
  error.code = code
  if (status) {
    error.response = {
      status,
      data
    }
  }
  return error
}

async function withAIHealthMock ({ get, post, onClient, keepLogs = false }, run) {
  const axios = require('axios')
  const log = require(logPath)
  const originalCreate = axios.create
  const originalLogError = log.error
  axios.create = (config) => {
    onClient && onClient(config)
    return {
      get: get || (async () => ({ data: { data: [] } })),
      post: post || (async () => ({ data: { choices: [{ message: { content: 'ok' } }] } }))
    }
  }
  if (!keepLogs) {
    log.error = () => {}
  }
  delete require.cache[aiPath]

  try {
    const ai = require(aiPath)
    assert.equal(typeof ai.AIHealthCheck, 'function')
    await run(ai.AIHealthCheck, ai)
  } finally {
    axios.create = originalCreate
    log.error = originalLogError
    delete require.cache[aiPath]
  }
}

function assertSafeResultShape (result) {
  const allowedStatuses = new Set([
    'reachable',
    'available',
    'auth-error',
    'model-error',
    'quota-error',
    'network-error'
  ])
  assert.deepEqual(
    Object.keys(result).sort(),
    ['apiStatus', 'checkedAt', 'latencyMs', 'message', 'modelStatus', 'models', 'status'].sort()
  )
  assert.equal(allowedStatuses.has(result.status), true)
  assert.equal(Array.isArray(result.models), true)
  assert.equal(typeof result.message, 'string')
  assert.equal(Number.isNaN(Date.parse(result.checkedAt)), false)
  assert.equal(Number.isFinite(result.latencyMs), true)
  assert.equal(result.latencyMs >= 0, true)
}

test('checks models before a minimal non-streaming model request', async () => {
  const calls = []
  const clientConfigs = []

  await withAIHealthMock({
    onClient: config => clientConfigs.push(config),
    get: async (urlPath, config) => {
      calls.push({ method: 'GET', path: urlPath, config })
      return {
        data: {
          data: [
            { id: 'grok-4-fast-reasoning' },
            { id: 'deepseek-chat' }
          ]
        }
      }
    },
    post: async (urlPath, body, config) => {
      calls.push({ method: 'POST', path: urlPath, body, config })
      return {
        data: {
          choices: [{ message: { content: 'ok' } }]
        }
      }
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'grok-4-fast-reasoning',
      'https://relay.example.com',
      '',
      'sk-health-secret',
      '',
      'Authorization: Bearer'
    )

    assertSafeResultShape(result)
    assert.equal(result.status, 'available')
    assert.equal(result.apiStatus, 'reachable')
    assert.equal(result.modelStatus, 'available')
    assert.deepEqual(result.models, ['grok-4-fast-reasoning', 'deepseek-chat'])
    assert.match(result.message, /可用/)

    assert.equal(clientConfigs.length, 2)
    for (const config of clientConfigs) {
      assert.equal(config.baseURL, 'https://relay.example.com/v1')
      assert.equal(config.headers.Authorization, 'Bearer sk-health-secret')
      assert.equal(Number.isFinite(config.timeout), true)
      assert.equal(config.timeout > 0, true)
    }
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].path, '/models')
    assert.equal(calls[1].method, 'POST')
    assert.equal(calls[1].path, '/chat/completions')
    assert.equal(calls[1].body.model, 'grok-4-fast-reasoning')
    assert.equal(calls[1].body.stream, false)
    assert.equal(calls[1].body.max_tokens <= 2, true)
    assert.equal(calls[1].body.messages.length, 1)
    assert.equal(calls[1].body.messages[0].role, 'user')
    assert.equal(calls[1].body.messages[0].content.length <= 12, true)
    assert.equal(Boolean(calls[0].config.signal), true)
    assert.equal(Boolean(calls[1].config.signal), true)
  })
})

test('reports only reachable when no model was selected', async () => {
  let postCalls = 0
  await withAIHealthMock({
    get: async () => ({ data: { data: [{ id: 'model-a' }] } }),
    post: async () => {
      postCalls += 1
      return { data: {} }
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck('', 'https://relay.example.com/v1', '', 'key', '', '')
    assertSafeResultShape(result)
    assert.equal(result.status, 'reachable')
    assert.equal(result.apiStatus, 'reachable')
    assert.equal(result.modelStatus, 'unknown')
    assert.equal(postCalls, 0)
  })
})

test('does not treat a successful model list as proof that the selected model works', async () => {
  await withAIHealthMock({
    get: async () => ({ data: { data: [{ id: 'listed-model' }] } }),
    post: async () => {
      throw createHttpError(400, {
        error: {
          code: 'model_not_found',
          message: 'The requested model does not exist'
        }
      })
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck('missing-model', 'https://relay.example.com/v1', '', 'key', '', '')
    assertSafeResultShape(result)
    assert.equal(result.status, 'model-error')
    assert.equal(result.apiStatus, 'reachable')
    assert.equal(result.modelStatus, 'model-error')
    assert.deepEqual(result.models, ['listed-model'])
  })
})

test('continues to the model request when models endpoint is unsupported', async () => {
  const calls = []
  await withAIHealthMock({
    get: async urlPath => {
      calls.push(['GET', urlPath])
      throw createHttpError(404, {
        error: { message: 'models endpoint not found' }
      })
    },
    post: async urlPath => {
      calls.push(['POST', urlPath])
      throw createHttpError(401, {
        error: { message: 'invalid api key sk-must-not-leak' }
      })
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'deepseek-chat',
      'https://user:password@api.deepseek.com',
      '',
      'sk-must-not-leak',
      '',
      ''
    )
    assertSafeResultShape(result)
    assert.equal(result.status, 'auth-error')
    assert.equal(result.apiStatus, 'auth-error')
    assert.equal(result.modelStatus, 'unknown')
    assert.deepEqual(result.models, ['deepseek-chat', 'deepseek-reasoner'])
    assert.deepEqual(calls, [
      ['GET', '/models'],
      ['POST', '/chat/completions']
    ])
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes('sk-must-not-leak'), false)
    assert.equal(serialized.includes('password'), false)
  })
})

test('still checks the selected model when an empty list uses built-in models', async () => {
  let postCalls = 0
  await withAIHealthMock({
    get: async () => ({ data: { data: [] } }),
    post: async () => {
      postCalls += 1
      throw createHttpError(400, {
        error: {
          code: 'model_not_found',
          message: 'model does not exist'
        }
      })
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'missing-deepseek-model',
      'https://api.deepseek.com',
      '',
      'key',
      '',
      ''
    )
    assert.equal(postCalls, 1)
    assert.equal(result.status, 'model-error')
    assert.deepEqual(result.models, ['deepseek-chat', 'deepseek-reasoner'])
  })
})
test('classifies authentication, quota and network failures safely', async t => {
  const cases = [
    {
      name: 'authentication',
      error: createHttpError(403, { error: { message: 'secret rejected' } }),
      status: 'auth-error',
      message: /认证/
    },
    {
      name: 'quota by status',
      error: createHttpError(429, { error: { message: 'too many requests' } }),
      status: 'quota-error',
      message: /额度|限流/
    },
    {
      name: 'quota by provider code',
      error: createHttpError(400, { error: { code: 'rate_limit_exceeded', message: 'daily quota exceeded' } }),
      status: 'quota-error',
      message: /额度|限流/
    },
    {
      name: 'quota hint takes precedence over generic 403',
      error: createHttpError(403, { error: { code: 'insufficient_user_quota', message: 'insufficient quota' } }),
      status: 'quota-error',
      message: /额度|限流/
    },
    {
      name: 'quota provider code works without an explanatory message',
      error: createHttpError(403, { error: { code: 'insufficient_user_quota' } }),
      status: 'quota-error',
      message: /额度|限流/
    },
    {
      name: 'network without response',
      error: Object.assign(new Error('getaddrinfo ENOTFOUND secret-host'), { code: 'ENOTFOUND' }),
      status: 'network-error',
      message: /网络/
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      await withAIHealthMock({
        get: async () => {
          throw item.error
        }
      }, async AIHealthCheck => {
        const result = await AIHealthCheck('model-a', 'https://relay.example.com/v1', '', 'key', '', '')
        assertSafeResultShape(result)
        assert.equal(result.status, item.status)
        assert.match(result.message, item.message)
        assert.equal(JSON.stringify(result).includes('secret-host'), false)
      })
    })
  }
})

test('redacts the configured API key from returned models and safe log fields', async () => {
  const log = require(logPath)
  const originalError = log.error
  const logs = []
  log.error = (...args) => logs.push(args)

  try {
    await withAIHealthMock({
      keepLogs: true,
      get: async () => ({
        data: {
          data: [
            { id: 'safe-model' },
            { id: 'k3y' },
            { id: 'prefix-k3y-suffix' }
          ]
        }
      }),
      post: async () => {
        throw createHttpError(401, {
          error: { message: 'invalid api key' }
        })
      }
    }, async AIHealthCheck => {
      const result = await AIHealthCheck(
        'model-k3y',
        'https://relay.example.com/v1',
        '',
        'k3y',
        '',
        ''
      )
      assert.deepEqual(result.models, ['safe-model'])
    })

    assert.equal(JSON.stringify(logs).includes('k3y'), false)
  } finally {
    log.error = originalError
    delete require.cache[aiPath]
  }
})
test('returns safe health logs without credentials, response bodies or URL userinfo', async () => {
  const log = require(logPath)
  const originalError = log.error
  const logs = []
  log.error = (...args) => logs.push(args)

  try {
    await withAIHealthMock({
      keepLogs: true,
      get: async () => ({ data: { data: [{ id: 'model-a' }] } }),
      post: async () => {
        const error = createHttpError(400, {
          error: {
            code: 'invalid_model',
            message: 'invalid model; key=sk-health-leak'
          }
        }, 'ERR_BAD_REQUEST')
        error.stack = 'STACK_WITH_sk-health-leak'
        error.config = {
          headers: { Authorization: 'Bearer sk-health-leak' },
          baseURL: 'https://user:password@relay.example.com/v1'
        }
        throw error
      }
    }, async AIHealthCheck => {
      const result = await AIHealthCheck(
        'model-a',
        'https://user:password@relay.example.com/v1',
        '/chat/completions?api_key=secret-query',
        'sk-health-leak',
        '',
        'Authorization: Bearer'
      )
      assert.equal(result.status, 'model-error')
    })

    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], 'AI health check failed')
    assert.deepEqual(Object.keys(logs[0][1]).sort(), [
      'classification',
      'code',
      'kind',
      'model',
      'origin',
      'path',
      'status'
    ])
    assert.equal(logs[0][1].origin, 'https://relay.example.com')
    assert.equal(logs[0][1].path, '/chat/completions')
    assert.equal(logs[0][1].classification, 'model-error')

    const serialized = JSON.stringify(logs)
    for (const secret of ['sk-health-leak', 'password', 'secret-query', 'STACK_WITH']) {
      assert.equal(serialized.includes(secret), false, secret)
    }
  } finally {
    log.error = originalError
    delete require.cache[aiPath]
  }
})

test('keeps custom auth headers and explicit chat paths for health checks', async () => {
  const clientConfigs = []
  let postPath
  await withAIHealthMock({
    onClient: config => clientConfigs.push(config),
    get: async () => ({ data: { data: [] } }),
    post: async urlPath => {
      postPath = urlPath
      return { data: { choices: [{ message: { content: 'ok' } }] } }
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'deployment-a',
      'https://example.openai.azure.com/openai/deployments/deployment-a',
      '/chat/completions?api-version=2026-01-01',
      'azure-secret',
      '',
      'api-key'
    )
    assert.equal(result.status, 'available')
    assert.equal(postPath, '/chat/completions?api-version=2026-01-01')
    assert.equal(clientConfigs[0].headers['api-key'], 'azure-secret')
    assert.equal(clientConfigs[1].headers['api-key'], 'azure-secret')
  })
})

test('registers AI health and chat cancellation in the async IPC whitelist', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )
  assert.match(source, /AIHealthCheck[\s\S]*AIHealthCheckCancel[\s\S]*require\('\.\/ai'\)/)
  assert.match(source, /AIchat,\s*AIChatCancel,\s*AIchatWithTools,\s*AIAgentCancel,\s*AIHealthCheck,\s*AIHealthCheckCancel,\s*AIModels/)
})

test('does not mark malformed HTTP 200 chat responses as model available', async () => {
  await withAIHealthMock({
    get: async () => ({ data: { data: [{ id: 'model-a' }] } }),
    post: async () => ({ data: '<html>login required</html>' })
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'model-a',
      'https://relay.example.com/v1',
      '',
      'sk-private',
      '',
      ''
    )
    assert.equal(result.status, 'reachable')
    assert.equal(result.apiStatus, 'reachable')
    assert.equal(result.modelStatus, 'unknown')
  })
})

test('classifies unknown client request errors as reachable instead of model unavailable', async () => {
  await withAIHealthMock({
    get: async () => ({ data: { data: [{ id: 'model-a' }] } }),
    post: async () => {
      throw createHttpError(400, { error: { message: 'invalid request body' } })
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'model-a',
      'https://relay.example.com/v1',
      '/wrong-endpoint',
      'sk-private',
      '',
      ''
    )
    assert.equal(result.status, 'reachable')
    assert.equal(result.apiStatus, 'reachable')
    assert.equal(result.modelStatus, 'unknown')
  })
})

test('model list errors redact echoed credentials and never return stacks', async () => {
  const logs = []
  const log = require(logPath)
  const originalError = log.error
  log.error = (...args) => logs.push(args)
  try {
    await withAIHealthMock({
      keepLogs: true,
      get: async () => {
        const error = createHttpError(401, {
          error: { message: 'api_key=sk-model-leak at https://user:pass@relay.example.com/v1?code=query-secret' }
        })
        error.stack = 'STACK_WITH_sk-model-leak'
        throw error
      }
    }, async (AIHealthCheck, ai) => {
      const result = await ai.AIModels(
        'https://user:pass@relay.example.com/v1?code=query-secret',
        'sk-model-leak',
        'http://proxy-user:proxy-pass@127.0.0.1:7890',
        'Authorization: Bearer'
      )
      const serialized = JSON.stringify({ result, logs })
      assert.equal('stack' in result, false)
      for (const secret of ['sk-model-leak', 'user:pass', 'query-secret', 'proxy-pass', 'STACK_WITH']) {
        assert.equal(serialized.includes(secret), false, secret)
      }
    })
  } finally {
    log.error = originalError
  }
})
test('unsupported models endpoint still proves API reachable when chat rejects the model', async () => {
  await withAIHealthMock({
    get: async () => {
      throw createHttpError(404, {
        error: { message: 'models endpoint not found' }
      })
    },
    post: async () => {
      throw createHttpError(404, {
        error: {
          code: 'model_not_found',
          message: 'The requested model does not exist'
        }
      })
    }
  }, async AIHealthCheck => {
    const result = await AIHealthCheck(
      'missing-model',
      'https://relay.example.com/v1',
      '',
      'key',
      '',
      ''
    )
    assert.equal(result.status, 'model-error')
    assert.equal(result.apiStatus, 'reachable')
    assert.equal(result.modelStatus, 'model-error')
  })
})
