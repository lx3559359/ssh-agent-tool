const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const servicesUrl = pathToFileURL(
  path.join(aiRoot, 'agent-runtime-services.js')
).href

test('runtime services preserve exact injected adapters', async () => {
  const { createAgentRuntimeServices } = await import(servicesUrl)
  const adapters = {
    store: { id: 'store' },
    pre: { id: 'pre' },
    refs: { id: 'refs' },
    translate: key => `translated:${key}`,
    now: () => 123,
    reportError: () => 'reported'
  }

  const services = createAgentRuntimeServices(adapters)

  assert.equal(Object.isFrozen(services), true)
  assert.deepEqual(Object.keys(services).sort(), Object.keys(adapters).sort())
  for (const [name, adapter] of Object.entries(adapters)) {
    assert.equal(services[name], adapter)
  }
})

test('runtime services retain browser defaults and local fallbacks', async () => {
  const { createAgentRuntimeServices } = await import(servicesUrl)
  const previousWindow = global.window
  const reported = []
  const browser = {
    store: { onError: error => reported.push(error) },
    pre: { id: 'browser-pre' },
    refs: { id: 'browser-refs' },
    translate: key => `browser:${key}`
  }
  global.window = browser
  try {
    const services = createAgentRuntimeServices()
    assert.equal(services.store, browser.store)
    assert.equal(services.pre, browser.pre)
    assert.equal(services.refs, browser.refs)
    assert.equal(services.translate, browser.translate)
    assert.equal(services.now, Date.now)
    const failure = new Error('local failure')
    services.reportError(failure)
    assert.deepEqual(reported, [failure])
  } finally {
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }

  const local = createAgentRuntimeServices({ store: null })
  assert.equal(local.translate('key'), 'key')
  assert.doesNotThrow(() => local.reportError(new Error('ignored')))
})

test('diagnostic task UI wires observer diagnostics to runtime services', () => {
  const source = fs.readFileSync(
    path.join(aiRoot, 'agent-task-runner.jsx'),
    'utf8'
  )
  assert.match(
    source,
    /createAgentRunObserver\(\{\s*context: taskTraceContextRef\.current,\s*reportError: runtimeServices\.reportError\s*\}\)/
  )
})

test('Agent paths run with injected services while window is absent', async () => {
  const { createServer } = await import('vite')
  const previousWindow = global.window
  delete global.window
  const server = await createServer({
    root: path.resolve(__dirname, '../..'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false }
  })
  try {
    const servicesModule = await server.ssrLoadModule(
      '/src/client/components/ai/agent-runtime-services.js'
    )
    const execution = await server.ssrLoadModule(
      '/src/client/components/ai/agent-tool-execution.js'
    )
    const risk = await server.ssrLoadModule(
      '/src/client/components/ai/agent-tool-risk-lifecycle.js'
    )
    const agent = await server.ssrLoadModule(
      '/src/client/components/ai/agent.js'
    )
    const taskController = await server.ssrLoadModule(
      '/src/client/components/ai/agent-task-controller.js'
    )
    const handoff = await server.ssrLoadModule(
      '/src/client/components/ai/agent-task-handoff.js'
    )

    const actions = []
    const chatEntry = { id: 'injected-agent-loop', prompt: 'inspect locally' }
    const store = {
      aiChatHistory: [chatEntry],
      config: {},
      getLangName: () => 'English',
      mcpListTabs: () => [{ id: 'tab-injected' }],
      onError: error => { throw error }
    }
    const pre = {
      runGlobalAsync: async action => {
        actions.push(action)
        if (action === 'listAgentSkills') return { ok: true, value: [] }
        if (action === 'AIchatWithTools') {
          return { message: { role: 'assistant', content: 'injected result' } }
        }
        if (action === 'AIchat') return { response: '{"steps":[]}' }
        throw new Error(`Unexpected action: ${action}`)
      }
    }
    const refs = {
      get: name => name === 'AIChat'
        ? { setPrompt: value => { refs.prompt = value } }
        : undefined
    }
    const diagnostics = []
    const services = servicesModule.createAgentRuntimeServices({
      store,
      pre,
      refs,
      translate: key => key,
      now: () => 123,
      reportError: error => diagnostics.push(error)
    })

    assert.equal(
      await execution.executeToolCall('list_tabs', {}, { services }),
      '[{"id":"tab-injected"}]'
    )

    const uploadAbort = new AbortController()
    let cancelledOperation
    store.mcpDescribeSftpUploadSource = async () => {
      uploadAbort.abort()
      return {
        sourceDescriptor: { digest: 'sha256:a' },
        preparedTransfer: { safetyOperationId: 'prepared-a' }
      }
    }
    store.mcpCancelPreparedSftpUpload = async prepared => {
      cancelledOperation = prepared.safetyOperationId
    }
    await assert.rejects(
      risk.prepareAgentRiskArgs('sftp_upload', { localPath: 'a' }, {
        signal: uploadAbort.signal,
        services
      }),
      error => error?.name === 'AbortError'
    )
    assert.equal(cancelledOperation, 'prepared-a')

    const streaming = []
    await agent.runAgentLoop(
      chatEntry,
      {},
      { current: false },
      value => streaming.push(value),
      [],
      undefined,
      undefined,
      services
    )
    assert.deepEqual(streaming, [true, false])
    assert.equal(store.aiChatHistory[0].completionStatus, 'completed')
    assert.equal(store.aiChatHistory[0].response, 'injected result')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(
      diagnostics.map(error => error?.code),
      ['AGENT_OBSERVER_WRITE_FAILED']
    )

    const plan = await taskController.requestDiagnosticPlanText({
      prompt: 'plan',
      config: {
        baseURLAI: 'https://local.invalid',
        apiKeyAI: 'secret',
        modelAI: 'local-model'
      },
      services
    })
    assert.equal(plan, '{"steps":[]}')

    handoff.handoffAgentPromptToAi({
      prompt: 'handoff through injected refs',
      getAiChat: () => services.refs.get('AIChat')
    })
    assert.equal(refs.prompt, 'handoff through injected refs')
    assert.deepEqual(actions, [
      'listAgentSkills',
      'AIchatWithTools',
      'AIchat'
    ])
  } finally {
    await server.close()
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
})
