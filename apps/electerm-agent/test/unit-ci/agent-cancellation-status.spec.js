const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const statusUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-cancellation-status.js'
)).href

test('confirmed cancellation is represented as cancelled', async () => {
  const { buildAgentCancellationUpdate } = await import(statusUrl)
  assert.deepEqual(buildAgentCancellationUpdate({
    response: 'working',
    stoppedText: 'stopped'
  }), {
    response: 'working\n\n*(stopped)*',
    completionStatus: 'cancelled'
  })
})

test('unconfirmed remote cancellation is represented as partially completed', async () => {
  const { buildAgentCancellationUpdate } = await import(statusUrl)
  const update = buildAgentCancellationUpdate({
    response: 'working',
    error: new Error('transport stop failed')
  })
  assert.equal(update.completionStatus, 'partially-completed')
  assert.match(update.response, /transport stop failed/)
  assert.match(update.response, /may still be running/i)
})

test('final cancellation status waits for the active remote cancellation result', async () => {
  const { settleAgentCancellation } = await import(statusUrl)
  let rejectCancellation
  const activeCancellation = new Promise((resolve, reject) => {
    rejectCancellation = reject
  })
  let settled = false
  const pending = settleAgentCancellation(activeCancellation)
    .then(error => {
      settled = true
      return error
    })
  await Promise.resolve()
  assert.equal(settled, false)
  rejectCancellation(new Error('remote stop unconfirmed'))
  const error = await pending
  assert.match(error.message, /remote stop unconfirmed/)
})
