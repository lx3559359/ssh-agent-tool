function finiteOr (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp (value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function computeSftpTransferDockLayout ({
  containerRect,
  viewportWidth,
  viewportHeight,
  horizontalGutter = 10,
  bottomGutter = 8
} = {}) {
  const width = Math.max(0, finiteOr(viewportWidth, 0))
  const height = Math.max(0, finiteOr(viewportHeight, 0))
  const gutterX = Math.max(0, finiteOr(horizontalGutter, 10))
  const gutterBottom = Math.max(0, finiteOr(bottomGutter, 8))
  const visibleLeft = clamp(finiteOr(containerRect?.left, 0), 0, width)
  const visibleRight = clamp(
    finiteOr(containerRect?.right, width),
    visibleLeft,
    width
  )
  const visibleBottom = clamp(
    finiteOr(containerRect?.bottom, height),
    0,
    height
  )
  const left = clamp(visibleLeft + gutterX, 0, width)
  const rightEdge = clamp(visibleRight - gutterX, left, width)
  const right = Math.max(0, width - rightEdge)
  const bottom = Math.max(gutterBottom, height - visibleBottom + gutterBottom)

  return {
    left,
    right,
    bottom,
    maxWidth: Math.max(0, width - left - right)
  }
}
