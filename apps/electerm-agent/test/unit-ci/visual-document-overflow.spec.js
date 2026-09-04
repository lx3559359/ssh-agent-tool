const test = require('node:test')
const assert = require('node:assert/strict')

const { classifyDocumentBaseline } = require('../e2e/common/document-overflow')

function makeControlledSnapshot () {
  return {
    viewport: { width: 337, height: 228 },
    nodes: [
      { name: 'documentElement', found: true, scrollWidth: 430, clientWidth: 337 },
      { name: 'body', found: true, scrollWidth: 430, clientWidth: 337 },
      { name: 'root', found: true, scrollWidth: 430, clientWidth: 337 }
    ],
    offenderCount: 3,
    topbarOffenderCount: 3,
    visibleTopbarActionRailCount: 1,
    offenders: [{
      tag: 'SPAN',
      className: 'aigshell-topbar-action-label',
      right: 396,
      insideTopbarActionRail: true
    }, {
      tag: 'SPAN',
      className: 'aigshell-topbar-action-label',
      right: 374,
      insideTopbarActionRail: true
    }, {
      tag: 'SPAN',
      className: 'aigshell-topbar-action-label',
      right: 352,
      insideTopbarActionRail: true
    }],
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
  for (const node of snapshot.nodes) node.scrollWidth = node.clientWidth

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
  assert.deepEqual(result.overflowingNodes.map(node => node.name), ['documentElement', 'body', 'root'])
  assert.deepEqual(result.checks, {
    offendersOnlyInRail: true,
    singleVisibleRail: true,
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

test('rejects overflow when more than one topbar action rail is visible', () => {
  const snapshot = makeControlledSnapshot()
  snapshot.visibleTopbarActionRailCount = 2

  const result = classifyDocumentBaseline(snapshot)

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'document-overflow')
  assert.equal(result.checks.singleVisibleRail, false)
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

  const invisibleRail = makeControlledSnapshot()
  invisibleRail.topbarActionRail.visible = false
  const invisibleResult = classifyDocumentBaseline(invisibleRail)
  assert.equal(invisibleResult.checks.railActuallyScrolls, false)
  assert.deepEqual(
    { ok: invisibleResult.ok, reason: invisibleResult.reason },
    { ok: false, reason: 'document-overflow' }
  )

  const absentRail = makeControlledSnapshot()
  delete absentRail.topbarActionRail
  const absentResult = classifyDocumentBaseline(absentRail)
  assert.equal(absentResult.checks.railActuallyScrolls, false)
  assert.deepEqual(
    { ok: absentResult.ok, reason: absentResult.reason },
    { ok: false, reason: 'document-overflow' }
  )
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

  const verticallySeparated = makeControlledSnapshot()
  verticallySeparated.windowControls.rect = { left: 190, top: 50, right: 337, bottom: 80 }
  assert.equal(classifyDocumentBaseline(verticallySeparated).reason, 'controlled-topbar-scroll')

  const exactBoundary = makeControlledSnapshot()
  exactBoundary.windowControls.rect.left = 192
  assert.equal(classifyDocumentBaseline(exactBoundary).reason, 'controlled-topbar-scroll')

  const fractionalCrossing = makeControlledSnapshot()
  fractionalCrossing.windowControls.rect.left = 191.5
  assert.equal(classifyDocumentBaseline(fractionalCrossing).reason, 'document-overflow')
})
