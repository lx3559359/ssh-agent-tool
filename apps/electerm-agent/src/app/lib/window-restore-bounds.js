const DEFAULT_WIDTH = 1180
const DEFAULT_HEIGHT = 760
const WORKAREA_MARGIN = 48
const PREFERRED_MIN_WIDTH = 1100
const PREFERRED_MIN_HEIGHT = 720

function positiveNumber (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function clamp (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function positionInRange (value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : fallback
}

function getRestoreBounds (bounds, workArea = {}, limits = {}) {
  const platformMinWidth = positiveNumber(limits.minWidth, 590)
  const platformMinHeight = positiveNumber(limits.minHeight, 400)
  const areaWidth = positiveNumber(workArea.width, DEFAULT_WIDTH + WORKAREA_MARGIN)
  const areaHeight = positiveNumber(workArea.height, DEFAULT_HEIGHT + WORKAREA_MARGIN)
  // Prefer a usable desktop workspace, while never exceeding the current display.
  const minWidth = Math.min(
    Math.max(platformMinWidth, PREFERRED_MIN_WIDTH),
    Math.max(platformMinWidth, areaWidth - WORKAREA_MARGIN)
  )
  const minHeight = Math.min(
    Math.max(platformMinHeight, PREFERRED_MIN_HEIGHT),
    Math.max(platformMinHeight, areaHeight - WORKAREA_MARGIN)
  )
  const areaX = Number.isFinite(Number(workArea.x)) ? Number(workArea.x) : 0
  const areaY = Number.isFinite(Number(workArea.y)) ? Number(workArea.y) : 0
  const maxWidth = Math.max(minWidth, areaWidth - WORKAREA_MARGIN)
  const maxHeight = Math.max(minHeight, areaHeight - WORKAREA_MARGIN)
  const width = clamp(positiveNumber(bounds?.width, DEFAULT_WIDTH), minWidth, maxWidth)
  const height = clamp(positiveNumber(bounds?.height, DEFAULT_HEIGHT), minHeight, maxHeight)
  const defaultX = areaX + Math.max(24, Math.floor((areaWidth - width) / 2))
  const defaultY = areaY + Math.max(24, Math.floor((areaHeight - height) / 2))
  const maxX = areaX + Math.max(0, areaWidth - width)
  const maxY = areaY + Math.max(0, areaHeight - height)

  return {
    x: positionInRange(bounds?.x, areaX, maxX, defaultX),
    y: positionInRange(bounds?.y, areaY, maxY, defaultY),
    width,
    height
  }
}

module.exports = {
  getRestoreBounds
}
