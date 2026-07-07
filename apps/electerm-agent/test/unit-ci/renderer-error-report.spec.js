const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const rendererErrorReportPath = path.resolve(
  __dirname,
  '../../src/app/lib/renderer-error-report'
)

test('normalizes renderer errors before writing them to logs', () => {
  const {
    normalizeRendererErrorReport,
    reportRendererError
  } = require(rendererErrorReportPath)
  const logs = []

  const report = normalizeRendererErrorReport({
    message: 'Authorization: Bearer sk-live-secret',
    stack: 'Error: boom\n    at C:\\Users\\alice\\app\\index.js:1:1',
    componentStack: 'at ErrorBoundary',
    location: 'file:///C:/Users/alice/AppData/Local/Temp/_MEI123/index.html',
    userAgent: 'Chrome',
    extra: 'ignored'
  }, {
    now: '2026-07-08T00:00:00.000Z',
    homeDir: 'C:\\Users\\alice',
    userName: 'alice'
  })

  assert.equal(report.createdAt, '2026-07-08T00:00:00.000Z')
  assert.equal(report.source, 'renderer')
  assert.equal(report.userAgent, 'Chrome')
  assert.equal(report.message.includes('sk-live-secret'), false)
  assert.equal(report.stack.includes('C:\\Users\\alice'), false)
  assert.equal(report.location.includes('alice'), false)
  assert.equal(Object.hasOwn(report, 'extra'), false)

  const result = reportRendererError({
    message: 'render failed',
    stack: 'stack'
  }, {
    error: (...args) => logs.push(args)
  }, {
    now: '2026-07-08T00:00:00.000Z'
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(logs.length, 1)
  assert.match(logs[0][0], /renderer-process error/)
  assert.equal(logs[0][1].message, 'render failed')
})

test('main process exposes renderer error reporting through async IPC globals', () => {
  const ipcSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(ipcSource, /reportRendererError/)
})

test('error boundary reports renderer crashes to the main process log', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/error-wrapper.jsx'),
    'utf8'
  )

  assert.match(source, /componentDidCatch\s*\(\s*error\s*,\s*errorInfo\s*\)/)
  assert.match(source, /runGlobalAsync\?\.\('reportRendererError'/)
  assert.match(source, /componentStack/)
})
