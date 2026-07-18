const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  installProcessErrorLogging,
  isGpuRelatedError
} = require(path.resolve(__dirname, '../../src/app/lib/process-error-logging'))

function createEmitterRecorder () {
  const handlers = {}
  return {
    handlers,
    on: (event, handler) => {
      handlers[event] = handler
    }
  }
}

test('logs uncaught exceptions and unhandled promise rejections from the main process', () => {
  const processRef = createEmitterRecorder()
  const app = createEmitterRecorder()
  const logs = []

  installProcessErrorLogging({
    app,
    processRef,
    log: {
      error: (...args) => logs.push(args)
    },
    consoleRef: {
      error: () => {}
    },
    gpuSuggestion: 'GPU suggestion'
  })

  processRef.handlers.uncaughtException(new Error('main crash'))
  processRef.handlers.unhandledRejection(new Error('promise crash'))

  assert.equal(logs.length, 2)
  assert.match(logs[0].join(' '), /uncaughtException/)
  assert.match(logs[0].join(' '), /main crash/)
  assert.match(logs[1].join(' '), /unhandledRejection/)
  assert.match(logs[1].join(' '), /promise crash/)
})

test('logs renderer, gpu, and child process failures from Electron app events', () => {
  const processRef = createEmitterRecorder()
  const app = createEmitterRecorder()
  const logs = []
  const consoleErrors = []

  installProcessErrorLogging({
    app,
    processRef,
    log: {
      error: (...args) => logs.push(args)
    },
    consoleRef: {
      error: (...args) => consoleErrors.push(args.join(' '))
    },
    gpuSuggestion: 'GPU suggestion'
  })

  app.handlers['render-process-gone']({}, {}, { reason: 'crashed', exitCode: 9 })
  app.handlers['gpu-process-crashed']({}, true)
  app.handlers['child-process-gone']({}, { type: 'GPU', reason: 'abnormal-exit' })

  const text = logs.map(args => args.join(' ')).join('\n')
  assert.match(text, /render-process-gone/)
  assert.match(text, /gpu-process-crashed/)
  assert.match(text, /child-process-gone/)
  assert.equal(consoleErrors.some(item => item.includes('GPU suggestion')), true)
})

test('marks only application-threatening failures as abnormal recovery exits', () => {
  const processRef = createEmitterRecorder()
  const app = createEmitterRecorder()
  const abnormal = []
  installProcessErrorLogging({
    app,
    processRef,
    log: { error: () => {} },
    consoleRef: { error: () => {} },
    onAbnormalExit: reason => abnormal.push(reason)
  })

  processRef.handlers.uncaughtException(new Error('main crash'))
  processRef.handlers.unhandledRejection(new Error('promise crash'))
  app.handlers['render-process-gone']({}, {}, { reason: 'oom', exitCode: 9 })
  app.handlers['render-process-gone']({}, {}, { reason: 'clean-exit', exitCode: 0 })
  app.handlers['gpu-process-crashed']({}, true)

  assert.deepEqual(abnormal, [
    'main-uncaught-exception',
    'main-unhandled-rejection',
    'renderer-oom'
  ])
})

test('detects GPU related errors for actionable startup guidance', () => {
  assert.equal(isGpuRelatedError(new Error('DXGI device removed')), true)
  assert.equal(isGpuRelatedError(new Error('ordinary failure')), false)
})
