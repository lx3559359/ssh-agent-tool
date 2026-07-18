const test = require('node:test')
const assert = require('node:assert/strict')

test('AI history initially renders the latest page and expands backward by page', async () => {
  const {
    AI_HISTORY_PAGE_SIZE,
    expandAIHistoryWindow,
    getVisibleAIHistory
  } = await import('../../src/client/components/ai/ai-history-window.js')

  const history = Array.from({ length: 70 }, (_, index) => ({ id: `item-${index + 1}` }))
  assert.equal(AI_HISTORY_PAGE_SIZE, 24)
  assert.deepEqual(
    getVisibleAIHistory(history, AI_HISTORY_PAGE_SIZE).map(item => item.id),
    history.slice(-24).map(item => item.id)
  )
  assert.equal(expandAIHistoryWindow(24, history.length), 48)
  assert.equal(expandAIHistoryWindow(48, history.length), 70)
  assert.equal(expandAIHistoryWindow(70, history.length), 70)
})

test('AI history window handles empty and shortened histories safely', async () => {
  const {
    clampAIHistoryWindow,
    getVisibleAIHistory
  } = await import('../../src/client/components/ai/ai-history-window.js')

  assert.deepEqual(getVisibleAIHistory([], 24), [])
  assert.equal(clampAIHistoryWindow(48, 10), 10)
  assert.equal(clampAIHistoryWindow(-1, 10), 10)
})

test('AI history window grows with new messages until the initial page is full', async () => {
  const {
    syncAIHistoryWindow
  } = await import('../../src/client/components/ai/ai-history-window.js')

  assert.equal(syncAIHistoryWindow(1, 2), 2)
  assert.equal(syncAIHistoryWindow(23, 24), 24)
  assert.equal(syncAIHistoryWindow(24, 25), 24)
  assert.equal(syncAIHistoryWindow(48, 49), 48)
  assert.equal(syncAIHistoryWindow(48, 10), 10)
})
