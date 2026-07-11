function getWorkArea (display) {
  return display.workArea || {
    x: 0,
    y: 0,
    width: display.workAreaSize.width,
    height: display.workAreaSize.height
  }
}

function getVisibleFrame (rect, area) {
  const left = Math.max(rect.x, area.x)
  const top = Math.max(rect.y, area.y)
  const right = Math.min(rect.x + rect.width, area.x + area.width)
  const bottom = Math.min(rect.y + rect.height, area.y + area.height)
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }
}

exports.normalizeWindowBounds = function normalizeWindowBounds (rect, displays, limits) {
  const areas = displays.map(getWorkArea)
  const minWidth = limits.minWidth
  const minHeight = limits.minHeight
  if (areas.length === 0) {
    return {
      ...rect,
      width: Math.max(rect.width, minWidth),
      height: Math.max(rect.height, minHeight)
    }
  }
  const width = Math.max(Math.min(rect.width, areas[0].width), minWidth)
  const height = Math.max(Math.min(rect.height, areas[0].height), minHeight)
  const next = {
    ...rect,
    width,
    height
  }
  const visibleEnough = areas.some(area => {
    const frame = getVisibleFrame(next, area)
    return frame.width >= Math.min(width, 320) &&
      frame.height >= Math.min(height, 220)
  })
  if (visibleEnough) {
    return next
  }
  return {
    ...next,
    x: areas[0].x,
    y: areas[0].y
  }
}
