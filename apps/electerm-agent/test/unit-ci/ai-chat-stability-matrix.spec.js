const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const asyncResultPath = path.resolve(
  __dirname,
  '../../src/client/common/async-result.js'
)

function readTest (name) {
  return fs.readFileSync(path.resolve(__dirname, name), 'utf8')
}

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai', relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing AI chat stability evidence: ${label}`)
}

test('P1 AI chat stability matrix covers submit stream stop retry copy and clear', () => {
  const submitTest = readTest('ai-chat-submit.spec.js')
  const configTest = readTest('ai-config-required.spec.js')
  const actionsTest = readTest('ai-chat-actions.spec.js')
  const copyTest = readTest('ai-agent-copy.spec.js')
  const aiChat = readSource('ai-chat.jsx')
  const historyItem = readSource('ai-chat-history-item.jsx')

  assertEvidence(submitTest, /AI chat submit only opens config when a non-empty prompt is missing required config/, 'empty prompt no-op and valid config submit')
  assertEvidence(configTest, /does not require optional model role endpoint path or auth header before sending/, 'optional model role API path and auth header do not block chat')
  assertEvidence(aiChat, /const\s+submitAction\s*=\s*getAIChatSubmitAction/, 'chat submit goes through submit policy')
  assertEvidence(aiChat, /appendAIChatHistory\(window\.store,\s*chatEntry,\s*MAX_HISTORY\)/, 'new chat entry append')
  assertEvidence(aiChat, /onPressEnter=\{handleKeyPress\}/, 'enter sends from textarea')
  assertEvidence(aiChat, /nativeEvent\?\.isComposing|isComposing/, 'Chinese IME composition does not submit the message')
  assertEvidence(aiChat, /keyCode\s*===\s*229|which\s*===\s*229/, 'legacy IME composition is guarded')
  assertEvidence(historyItem, /'AIchat'[\s\S]*?true,[\s\S]*?authHeaderNameAI/, 'streaming AI request and auth header forwarding')
  assertEvidence(historyItem, /getStreamContent/, 'stream polling')
  assertEvidence(historyItem, /stopStream/, 'stop generation')
  assertEvidence(historyItem, /updateAIChatHistoryEntry\(window\.store/, 'sanitized history refresh after AI response')
  assertEvidence(actionsTest, /copy the answer first and fall back to prompt/, 'copy answer fallback')
  assertEvidence(actionsTest, /create a clean retry entry without stale stream state/, 'retry clears stale stream state')
  assertEvidence(actionsTest, /clear conversation context from the store/, 'clear context')
  assertEvidence(copyTest, /copyAnswerTitle/, 'copy action visible')
  assertEvidence(copyTest, /retryTitle/, 'retry action visible')
  assertEvidence(copyTest, /stopTitle/, 'stop action visible')
})

test('AI chat publishes history after non-stream responses are written', () => {
  const historyItem = readSource('ai-chat-history-item.jsx')
  const branchStart = historyItem.indexOf("} else if (aiResponse && Object.prototype.hasOwnProperty.call(aiResponse, 'response')) {")
  const catchStart = historyItem.indexOf('} catch (error) {', branchStart)
  const branch = historyItem.slice(branchStart, catchStart)

  assert.notEqual(branchStart, -1)
  assert.notEqual(catchStart, -1)
  assertEvidence(branch, /updateAIChatHistoryEntry\(window\.store, item\.id, \{[\s\S]*response: aiResponse\.response/, 'sanitized non-stream response write')
})

test('async results normalize null undefined success and error responses', async () => {
  assert.ok(fs.existsSync(asyncResultPath), 'async result helper must exist')
  const asyncResult = await import(pathToFileURL(asyncResultPath))
  const { normalizeAsyncResult } = asyncResult

  assert.equal(asyncResult.createAsyncResultGuard, undefined)
  const empty = { ok: false, data: null, error: 'empty-response' }
  assert.deepEqual(normalizeAsyncResult(null), empty)
  assert.deepEqual(normalizeAsyncResult(undefined), empty)
  assert.deepEqual(
    normalizeAsyncResult({ data: { status: 'available' } }),
    { ok: true, data: { status: 'available' }, error: '' }
  )
  assert.deepEqual(
    normalizeAsyncResult({ data: false }),
    { ok: true, data: false, error: '' }
  )
  assert.deepEqual(
    normalizeAsyncResult({ data: undefined, error: 'network-error' }),
    { ok: false, data: null, error: 'network-error' }
  )
})
