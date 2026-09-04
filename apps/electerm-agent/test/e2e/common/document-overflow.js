function rectanglesOverlap (first, second, tolerance) {
  if (!first || !second) return false

  return first.left < second.right - tolerance &&
    first.right > second.left + tolerance &&
    first.top < second.bottom - tolerance &&
    first.bottom > second.top + tolerance
}

function classifyDocumentBaseline (snapshot, tolerance = 1) {
  const overflowingNodes = snapshot.nodes
    .filter(node => node.scrollWidth > node.clientWidth)

  if (overflowingNodes.length === 0) {
    return { ok: true, reason: 'contained', overflowingNodes: [], checks: {} }
  }

  const rail = snapshot.topbarActionRail
  const controls = snapshot.windowControls
  const railReady = Boolean(rail && rail.found && rail.visible && rail.rect)
  const checks = {
    offendersOnlyInRail: snapshot.offenderCount > 0 &&
      snapshot.offenderCount === snapshot.topbarOffenderCount,
    railReady,
    railWithinViewport: railReady &&
      rail.rect.left >= -tolerance &&
      rail.rect.right <= snapshot.viewport.width + tolerance,
    railActuallyScrolls: railReady && Boolean(rail &&
      (rail.overflowX === 'auto' || rail.overflowX === 'scroll') &&
      rail.scrollWidth > rail.clientWidth),
    windowControlsClear: railReady &&
      (!controls || !controls.found || !controls.visible || !controls.rect ||
        !rectanglesOverlap(rail.rect, controls.rect, tolerance))
  }

  const controlled = Object.values(checks).every(Boolean)
  return {
    ok: controlled,
    reason: controlled ? 'controlled-topbar-scroll' : 'document-overflow',
    overflowingNodes,
    checks
  }
}

module.exports = { classifyDocumentBaseline }
