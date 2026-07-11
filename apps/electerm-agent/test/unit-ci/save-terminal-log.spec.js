const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/terminal/save-terminal-log.js')
).href

test('terminal buffer content gets exactly one trailing newline before live appends', async () => {
  const { normalizeTerminalLogContent } = await import(moduleUrl)

  assert.equal(normalizeTerminalLogContent('first line'), 'first line\n')
  assert.equal(normalizeTerminalLogContent('first line\n'), 'first line\n')
  assert.equal(normalizeTerminalLogContent('first line\r\n\r\n'), 'first line\n')
  assert.equal(normalizeTerminalLogContent(''), '')
})

test('saving a terminal log completes both writes before reporting success', async () => {
  const { saveTerminalLog } = await import(moduleUrl)
  const calls = []

  const result = await saveTerminalLog({
    filePath: 'C:\\logs\\session.log',
    content: 'terminal output',
    pid: 'terminal-1',
    addTimeStampToTermLog: true,
    writeFile: async (_filePath, content) => {
      calls.push('writeFile')
      assert.equal(content, 'terminal output\n')
      return true
    },
    startTerminalLogFile: async () => {
      calls.push('startTerminalLogFile')
      return true
    },
    onError: () => calls.push('onError'),
    onSuccess: () => calls.push('onSuccess')
  })

  assert.equal(result, true)
  assert.deepEqual(calls, [
    'writeFile',
    'startTerminalLogFile',
    'onSuccess'
  ])
})

test('recording lifecycle only reports success after backend confirmation', async () => {
  const { startTerminalRecording, stopTerminalRecording } = await import(moduleUrl)
  const calls = []
  let resolveStart
  const startPending = new Promise(resolve => { resolveStart = resolve })
  const startResult = startTerminalRecording({
    pid: 'terminal-1',
    filePath: 'C:\\logs\\session.log',
    addTimeStampToTermLog: true,
    startTerminalLogFile: async () => {
      calls.push('start')
      return startPending
    },
    onError: () => calls.push('startError'),
    onSuccess: () => calls.push('startSuccess')
  })

  await Promise.resolve()
  assert.deepEqual(calls, ['start'])
  resolveStart(true)
  assert.equal(await startResult, true)
  assert.deepEqual(calls, ['start', 'startSuccess'])

  let resolveStop
  const stopPending = new Promise(resolve => { resolveStop = resolve })
  const stopResult = stopTerminalRecording({
    pid: 'terminal-1',
    toggleTerminalLog: async () => {
      calls.push('stop')
      return stopPending
    },
    onError: () => calls.push('stopError'),
    onSuccess: () => calls.push('stopSuccess')
  })

  await Promise.resolve()
  assert.deepEqual(calls, ['start', 'startSuccess', 'stop'])
  resolveStop(true)
  assert.equal(await stopResult, true)
  assert.deepEqual(calls, ['start', 'startSuccess', 'stop', 'stopSuccess'])
})

test('recording lifecycle reports rejected and false results without succeeding', async () => {
  const { startTerminalRecording, stopTerminalRecording } = await import(moduleUrl)

  for (const failure of [new Error('backend failed'), false]) {
    for (const operation of [
      options => startTerminalRecording({
        ...options,
        filePath: 'C:\\logs\\session.log',
        addTimeStampToTermLog: false,
        startTerminalLogFile: options.backend
      }),
      options => stopTerminalRecording({
        ...options,
        toggleTerminalLog: options.backend
      })
    ]) {
      const errors = []
      let successCalls = 0
      const result = await operation({
        pid: 'terminal-1',
        backend: async () => {
          if (failure instanceof Error) throw failure
          return failure
        },
        onError: error => errors.push(error),
        onSuccess: () => { successCalls += 1 }
      })

      assert.equal(result, false)
      assert.equal(errors.length, 1)
      assert.equal(successCalls, 0)
    }
  }
})

test('a rejected terminal log write reports the error without starting or succeeding', async () => {
  const { saveTerminalLog } = await import(moduleUrl)
  const expectedError = new Error('disk write failed')
  const errors = []
  let startCalls = 0
  let successCalls = 0

  const result = await saveTerminalLog({
    filePath: 'C:\\logs\\session.log',
    content: 'terminal output',
    pid: 'terminal-1',
    addTimeStampToTermLog: false,
    writeFile: async () => { throw expectedError },
    startTerminalLogFile: async () => { startCalls += 1 },
    onError: error => errors.push(error),
    onSuccess: () => { successCalls += 1 }
  })

  assert.equal(result, false)
  assert.deepEqual(errors, [expectedError])
  assert.equal(startCalls, 0)
  assert.equal(successCalls, 0)
})

test('a false terminal log write result reports an error without starting or succeeding', async () => {
  const { saveTerminalLog } = await import(moduleUrl)
  const errors = []
  let startCalls = 0
  let successCalls = 0

  const result = await saveTerminalLog({
    filePath: 'C:\\logs\\session.log',
    content: 'terminal output',
    pid: 'terminal-1',
    addTimeStampToTermLog: false,
    writeFile: async () => false,
    startTerminalLogFile: async () => { startCalls += 1 },
    onError: error => errors.push(error),
    onSuccess: () => { successCalls += 1 }
  })

  assert.equal(result, false)
  assert.match(errors[0].message, /写入终端日志文件失败/)
  assert.equal(startCalls, 0)
  assert.equal(successCalls, 0)
})

test('a rejected terminal log start reports the error without succeeding', async () => {
  const { saveTerminalLog } = await import(moduleUrl)
  const expectedError = new Error('logger start failed')
  const errors = []
  let successCalls = 0

  const result = await saveTerminalLog({
    filePath: 'C:\\logs\\session.log',
    content: 'terminal output',
    pid: 'terminal-1',
    addTimeStampToTermLog: true,
    writeFile: async () => true,
    startTerminalLogFile: async () => { throw expectedError },
    onError: error => errors.push(error),
    onSuccess: () => { successCalls += 1 }
  })

  assert.equal(result, false)
  assert.deepEqual(errors, [expectedError])
  assert.equal(successCalls, 0)
})

test('a false terminal log start result reports an error without succeeding', async () => {
  const { saveTerminalLog } = await import(moduleUrl)
  const errors = []
  let successCalls = 0

  const result = await saveTerminalLog({
    filePath: 'C:\\logs\\session.log',
    content: 'terminal output',
    pid: 'terminal-1',
    addTimeStampToTermLog: true,
    writeFile: async () => true,
    startTerminalLogFile: async () => false,
    onError: error => errors.push(error),
    onSuccess: () => { successCalls += 1 }
  })

  assert.equal(result, false)
  assert.match(errors[0].message, /启动终端日志文件失败/)
  assert.equal(successCalls, 0)
})

test('terminal save integration uses the coordinator and Chinese log filter label', () => {
  const fs = require('node:fs')
  const terminalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )

  assert.match(terminalSource, /saveTerminalLog,\r?\n\s+startTerminalRecording,\r?\n\s+stopTerminalRecording/)
  assert.match(terminalSource, /await saveTerminalLog\(\{/)
  assert.match(terminalSource, /name: '日志文件'/)
})
