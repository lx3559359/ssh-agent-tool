const test = require('node:test')
const assert = require('node:assert/strict')

const { classifyDocumentBaseline } = require('../e2e/common/document-overflow')

function makeControlledSnapshot () {
  return {
    viewport: { width: 337, height: 228 },
    nodes: {
      documentElement: { scrollWidth: 430, clientWidth: 337 },
      body: { scrollWidth: 430, clientWidth: 337 },
      root: { scrollWidth: 430, clientWidth: 337 }
    },
    offenderCount: 3,
    topbarOffenderCount: 3,
    offenders: [{ insideTopbarActionRail: true }],
    topbarActionRail: {
      found: true,
      visible: true,
      rect: { left: 30, top: 5, right: 193, bottom: 41 },
      overflowX: 'auto',
      clientWidth: 163,
      scrollWidth: 427
    },
    windowControls: {
      found: true,
      visible: true,
      rect: { left: 199, top: 0, right: 337, bottom: 36 }
    }
  }
}

test('contained documents return the exact contained result', () => {
  const snapshot = makeControlledSnapshot()
  for (const node of Object.values(snapshot.nodes)) node.scrollWidth = node.clientWidth

  assert.deepEqual(classifyDocumentBaseline(snapshot), {
    ok: true,
    reason: 'contained',
    overflowingNodes: [],
    checks: {}
  })
})

test('controlled topbar overflow passes all safety checks', () => {
  const result = classifyDocumentBaseline(makeControlledSnapshot())

  assert.equal(result.ok, true)
  assert.equal(result.reason, 'controlled-topbar-scroll')
  assert.deepEqual(result.overflowingNodes, ['documentElement', 'body', 'root'])
  assert.deepEqual(result.checks, {
    offendersOnlyInRail: true,
    railReady: true,
    railWithinViewport: true,
    railActuallyScrolls: true,
    windowControlsClear: true
  })
})

test('rejects overflow with an off-rail offender', () => {
  const snapshot = makeControlledSnapshot()
  snapshot.topbarOffenderCount = 2
  assert.equal(classifyDocumentBaseline(snapshot).reason, 'document-overflow')
  assert.equal(classifyDocumentBaseline(snapshot).ok, false)
})

test('rejects a rail extending beyond the viewport', () => {
  const snapshot = makeControlledSnapshot()
  snapshot.topbarActionRail.rect.right = 350
  assert.equal(classifyDocumentBaseline(snapshot).reason, 'document-overflow')
  assert.equal(classifyDocumentBaseline(snapshot).ok, false)
})

test('rejects a non-scrollable rail', () => {
  const snapshot = makeControlledSnapshot()
  snapshot.topbarActionRail.overflowX = 'hidden'
  assert.equal(classifyDocumentBaseline(snapshot).reason, 'document-overflow')
  assert.equal(classifyDocumentBaseline(snapshot).ok, false)
})

test('rejects a rail without actual scrollable content', () => {
  const snapshot = makeControlledSnapshot()
  snapshot.topbarActionRail.scrollWidth = 163
  assert.equal(classifyDocumentBaseline(snapshot).reason, 'document-overflow')
  assert.equal(classifyDocumentBaseline(snapshot).ok, false)
})

test('rejects rail overlapping window controls', () => {
  const snapshot = makeControlledSnapshot()
  snapshot.windowControls.rect.left = 190
  assert.equal(classifyDocumentBaseline(snapshot).reason, 'document-overflow')
  assert.equal(classifyDocumentBaseline(snapshot).ok, false)
})
