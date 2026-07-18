const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const {
  createPerformanceMetrics
} = require('../../src/app/lib/quality/performance-metrics')

function createTempStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-performance-'))
  return {
    dir,
    storagePath: path.join(dir, 'performance-metrics.json'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('derives one-time startup metrics from lifecycle marks', () => {
  const metrics = createPerformanceMetrics({
    persist: false,
    runId: 'run-a',
    now: () => 2000
  })

  assert.equal(metrics.mark('app_start', 1000), true)
  assert.equal(metrics.mark('window_loaded', 1450, { windowRole: 'main' }), true)
  assert.equal(metrics.mark('window_loaded', 1900, { windowRole: 'main' }), false)
  assert.equal(metrics.mark('config_interactive', 1600, { windowRole: 'main' }), true)
  assert.equal(metrics.mark('first_terminal_ready', 1800, { terminalType: 'ssh' }), true)
  assert.equal(metrics.mark('first_terminal_ready', 2200, { terminalType: 'local' }), false)

  const summary = metrics.getSummary()
  assert.equal(summary.metrics.app_start_ms.latest, 450)
  assert.equal(summary.metrics.first_window_interactive_ms.latest, 600)
  assert.equal(summary.metrics.first_terminal_ready_ms.latest, 800)
  assert.deepEqual(summary.metrics.first_terminal_ready_ms.dimensions, {
    terminalType: 'ssh'
  })
})

test('records AI first token once per request at the caller boundary and total outcomes', () => {
  const metrics = createPerformanceMetrics({ persist: false, runId: 'run-a' })

  assert.equal(metrics.recordDuration('ai_first_token_ms', 320, {
    outcome: 'streaming'
  }), true)
  assert.equal(metrics.recordDuration('ai_total_ms', 720, {
    outcome: 'completed'
  }), true)
  assert.equal(metrics.recordDuration('ai_total_ms', 410, {
    outcome: 'cancelled'
  }), true)

  const summary = metrics.getSummary()
  assert.equal(summary.metrics.ai_first_token_ms.latest, 320)
  assert.equal(summary.metrics.ai_first_token_ms.sampleCount, 1)
  assert.equal(summary.metrics.ai_total_ms.latest, 410)
  assert.equal(summary.metrics.ai_total_ms.sampleCount, 2)
})

test('rate limits memory samples to one per sixty seconds', () => {
  let now = 1000
  const metrics = createPerformanceMetrics({
    persist: false,
    runId: 'run-a',
    now: () => now
  })

  assert.equal(metrics.recordMemory({
    mainMb: 100,
    rendererMb: 200,
    totalMb: 320
  }), true)
  now += 59_999
  assert.equal(metrics.recordMemory({
    mainMb: 101,
    rendererMb: 201,
    totalMb: 322
  }), false)
  now += 1
  assert.equal(metrics.recordMemory({
    mainMb: 102,
    rendererMb: 202,
    totalMb: 324
  }), true)

  const summary = metrics.getSummary()
  assert.equal(summary.metrics.memory_main_mb.sampleCount, 2)
  assert.equal(summary.metrics.memory_renderer_mb.latest, 202)
  assert.equal(summary.metrics.memory_total_mb.latest, 324)
})

test('rejects unsupported metrics, invalid numbers and sensitive dimensions', () => {
  const metrics = createPerformanceMetrics({ persist: false, runId: 'run-a' })

  assert.equal(metrics.recordDuration('terminal_bytes', 12), false)
  assert.equal(metrics.recordDuration('ai_total_ms', -1), false)
  assert.equal(metrics.recordDuration('ai_total_ms', Number.NaN), false)
  assert.equal(metrics.recordDuration('ai_total_ms', 10, {
    host: 'server.example.com'
  }), false)
  assert.equal(metrics.recordDuration('ai_total_ms', 10, {
    apiKey: 'secret'
  }), false)
  assert.equal(metrics.recordDuration('ai_total_ms', 10, {
    outcome: 'completed',
    command: 'uname -a'
  }), false)
  assert.equal(metrics.recordDuration('ai_total_ms', 10, {
    outcome: 'completed with spaces'
  }), false)
  assert.equal(metrics.recordDuration('ai_total_ms', 10, {
    outcome: 'completed'
  }), true)

  assert.equal(metrics.getSummary().recordCount, 1)
})

test('prunes records older than thirty days and caps storage at one thousand entries', () => {
  const day = 24 * 60 * 60 * 1000
  let now = 40 * day
  const metrics = createPerformanceMetrics({
    persist: false,
    runId: 'run-current',
    now: () => now,
    initialRecords: [
      {
        name: 'ai_total_ms',
        value: 10,
        at: 9 * day,
        runId: 'run-old',
        dimensions: { outcome: 'completed' }
      }
    ]
  })

  for (let index = 0; index < 1005; index += 1) {
    now += 1
    assert.equal(metrics.recordDuration('ai_total_ms', index + 1, {
      outcome: 'completed'
    }), true)
  }

  const summary = metrics.getSummary()
  assert.equal(summary.recordCount, 1000)
  assert.equal(summary.metrics.ai_total_ms.sampleCount, 1000)
  assert.equal(summary.metrics.ai_total_ms.latest, 1005)
  assert.equal(summary.metrics.ai_total_ms.minimum, 6)
})

test('calculates relative change against prior-run local baseline', () => {
  const metrics = createPerformanceMetrics({
    persist: false,
    runId: 'run-current',
    now: () => 3000,
    initialRecords: [
      { name: 'app_start_ms', value: 100, at: 1000, runId: 'run-a', dimensions: {} },
      { name: 'app_start_ms', value: 120, at: 2000, runId: 'run-b', dimensions: {} }
    ]
  })

  metrics.recordDuration('app_start_ms', 132, { windowRole: 'main' })
  const result = metrics.getSummary().metrics.app_start_ms

  assert.equal(result.latest, 132)
  assert.equal(result.baseline, 110)
  assert.equal(result.relativeChange, 0.2)
})

test('persists bounded records atomically and reloads a recoverable store', async (t) => {
  const store = createTempStore()
  t.after(store.cleanup)
  const metrics = createPerformanceMetrics({
    storagePath: store.storagePath,
    runId: 'run-a'
  })
  metrics.recordDuration('ai_total_ms', 640, { outcome: 'completed' })

  assert.equal(await metrics.flush(), true)
  assert.equal(fs.existsSync(store.storagePath), true)
  assert.equal(fs.existsSync(`${store.storagePath}.tmp`), false)

  const reloaded = createPerformanceMetrics({
    storagePath: store.storagePath,
    runId: 'run-b'
  })
  assert.equal(reloaded.getSummary().metrics.ai_total_ms.latest, 640)
})

test('storage failure disables persistence without blocking metric collection', async () => {
  const warnings = []
  const metrics = createPerformanceMetrics({
    storagePath: 'unused.json',
    runId: 'run-a',
    logger: { warn: (...args) => warnings.push(args) },
    fileSystem: {
      readFileSync: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
      mkdir: async () => {},
      writeFile: async () => { throw new Error('disk unavailable') },
      rename: async () => {}
    }
  })

  assert.equal(metrics.recordDuration('ai_total_ms', 15, {
    outcome: 'completed'
  }), true)
  assert.equal(await metrics.flush(), false)
  assert.equal(metrics.recordDuration('ai_total_ms', 20, {
    outcome: 'failed'
  }), true)
  assert.equal(await metrics.flush(), false)
  assert.equal(metrics.getSummary().recordCount, 2)
  assert.equal(warnings.length, 1)
})

test('a record arriving during an atomic flush is persisted by an automatic follow-up flush', async () => {
  let releaseFirstWrite
  let writeCount = 0
  const written = []
  const fileSystem = {
    readFileSync: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    mkdir: async () => {},
    writeFile: async (file, content) => {
      written.push(content)
      writeCount += 1
      if (writeCount === 1) {
        await new Promise(resolve => { releaseFirstWrite = resolve })
      }
    },
    rename: async () => {}
  }
  const metrics = createPerformanceMetrics({
    storagePath: 'performance.json',
    runId: 'run-a',
    fileSystem,
    flushDelayMs: 0
  })
  metrics.recordDuration('ai_total_ms', 10, { outcome: 'completed' })
  const firstFlush = metrics.flush()
  await new Promise(resolve => setImmediate(resolve))
  metrics.recordDuration('ai_total_ms', 20, { outcome: 'failed' })
  releaseFirstWrite()
  assert.equal(await firstFlush, true)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(written.length, 2)
  assert.equal(JSON.parse(written[1]).records.length, 2)
})

test('corrupt persisted data is ignored without interrupting startup', (t) => {
  const store = createTempStore()
  t.after(store.cleanup)
  fs.writeFileSync(store.storagePath, '{broken-json', 'utf8')

  const metrics = createPerformanceMetrics({
    storagePath: store.storagePath,
    runId: 'run-a'
  })

  assert.equal(metrics.getSummary().recordCount, 0)
  assert.equal(metrics.recordDuration('ai_total_ms', 50, {
    outcome: 'completed'
  }), true)
})

test('renderer metric helpers validate requests and fail silently across IPC', async (t) => {
  const calls = []
  const previousWindow = globalThis.window
  globalThis.window = {
    pre: {
      runGlobalAsync: (...args) => {
        calls.push(args)
        return Promise.resolve(true)
      }
    }
  }
  t.after(() => { globalThis.window = previousWindow })
  const qualityEventsUrl = pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/quality/quality-events.js'
  ))
  qualityEventsUrl.search = `test=${Date.now()}`
  const {
    recordPerformanceDuration,
    recordPerformanceMark
  } = await import(qualityEventsUrl)

  assert.equal(await recordPerformanceMark(
    'config_interactive',
    1500,
    { windowRole: 'main' }
  ), true)
  assert.equal(await recordPerformanceDuration(
    'ai_total_ms',
    300,
    { outcome: 'completed' }
  ), true)
  assert.equal(await recordPerformanceDuration(
    'unknown_metric',
    300,
    { outcome: 'completed' }
  ), false)
  assert.deepEqual(calls, [
    ['recordPerformanceMetric', {
      kind: 'mark',
      name: 'config_interactive',
      at: 1500,
      dimensions: { windowRole: 'main' }
    }],
    ['recordPerformanceMetric', {
      kind: 'duration',
      name: 'ai_total_ms',
      value: 300,
      dimensions: { outcome: 'completed' }
    }]
  ])
})

test('AI request tracker emits only the first non-empty content and one terminal duration', async () => {
  const qualityEventsUrl = pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/quality/quality-events.js'
  ))
  qualityEventsUrl.search = `tracker=${Date.now()}`
  const { createAIRequestPerformanceTracker } = await import(qualityEventsUrl)
  let now = 1000
  const calls = []
  const tracker = createAIRequestPerformanceTracker({
    now: () => now,
    recordDuration: (name, value, dimensions) => {
      calls.push({ name, value, dimensions })
      return Promise.resolve(true)
    },
    requestType: 'chat'
  })

  assert.equal(tracker.markContent('  '), false)
  now = 1320
  assert.equal(tracker.markContent('first answer'), true)
  now = 1400
  assert.equal(tracker.markContent('second chunk'), false)
  now = 1720
  assert.equal(tracker.finish('completed'), true)
  assert.equal(tracker.finish('completed'), false)
  assert.deepEqual(calls, [
    {
      name: 'ai_first_token_ms',
      value: 320,
      dimensions: { requestType: 'chat' }
    },
    {
      name: 'ai_total_ms',
      value: 720,
      dimensions: { requestType: 'chat', outcome: 'completed' }
    }
  ])
})

test('application lifecycle hooks collect only low-frequency performance events', () => {
  const createApp = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/lib/create-app.js'
  ), 'utf8')
  const createWindow = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/lib/create-window.js'
  ), 'utf8')
  const ipc = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/lib/ipc.js'
  ), 'utf8')
  const loadData = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/store/load-data.js'
  ), 'utf8')
  const terminal = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/terminal/terminal.jsx'
  ), 'utf8')
  const ai = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-history-item.jsx'
  ), 'utf8')

  assert.match(createApp, /createPerformanceMetrics/)
  assert.match(createApp, /mark\('app_start'/)
  assert.match(createApp, /60 \* 1000/)
  assert.match(createApp, /clearInterval/)
  assert.match(createApp, /flush\(\)/)
  assert.match(createWindow, /did-finish-load/)
  assert.match(createWindow, /mark\(\s*'window_loaded'/)
  assert.match(ipc, /recordPerformanceMetric/)
  assert.match(ipc, /getPerformanceSummary/)
  assert.match(loadData, /recordPerformanceMark\('config_interactive'/)
  assert.match(terminal, /recordPerformanceMark\('first_terminal_ready'/)
  const socketReadyBlock = terminal.slice(
    terminal.indexOf('socket.onopen = async () =>'),
    terminal.indexOf('// term.onRrefresh', terminal.indexOf('socket.onopen = async () =>'))
  )
  assert.match(socketReadyBlock, /recordPerformanceMark\('first_terminal_ready'/)
  assert.match(ai, /createAIRequestPerformanceTracker/)
  assert.match(ai, /markAIResponseContent/)
  const stopBlock = ai.slice(
    ai.indexOf('async function handleStop'),
    ai.indexOf('function renderStopButton')
  )
  assert.match(
    stopBlock,
    /finishAIQuality\(qualityStateRef\.current,\s*'cancelled',\s*'cancelled'\)/
  )
  assert.doesNotMatch(terminal, /onData[\s\S]{0,500}recordPerformance/)
  assert.doesNotMatch(ai, /recordPerformanceDuration[\s\S]{0,200}streamResponse\.content/)
})
