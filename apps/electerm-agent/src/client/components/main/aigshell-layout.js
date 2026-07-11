export const aigshellTopBarHeight = 44
export const minRightPanelWidth = 320
export const maxRightPanelWidth = 1000

export function normalizeRightPanelWidth (value) {
  const width = Number.parseInt(value, 10)
  if (!Number.isFinite(width) || width < minRightPanelWidth) {
    return minRightPanelWidth
  }
  return Math.min(width, maxRightPanelWidth)
}

export function getMaxRightPanelWidth (windowWidth, reservedWidth = 420) {
  const width = Number(windowWidth)
  if (!Number.isFinite(width)) {
    return maxRightPanelWidth
  }
  return Math.max(
    minRightPanelWidth,
    Math.min(maxRightPanelWidth, width - reservedWidth)
  )
}

export function getAIGShellContentFrame ({
  width,
  height,
  footerHeight,
  sidebarWidth,
  leftSidebarWidth,
  rightPanelWidth,
  pinned,
  rightPanelVisible,
  rightPanelPinned,
  pinnedQuickCommandBar,
  inActiveTerminal,
  quickCommandBoxHeight,
  resizeTrigger = 0
}) {
  const left = pinned ? sidebarWidth + leftSidebarWidth : sidebarWidth
  const right = rightPanelVisible && rightPanelPinned
    ? Math.min(
      normalizeRightPanelWidth(rightPanelWidth),
      getMaxRightPanelWidth(width, left + 320)
    )
    : 0
  const quickBarHeight = inActiveTerminal && pinnedQuickCommandBar ? quickCommandBoxHeight : 0

  return {
    top: aigshellTopBarHeight,
    left,
    width: Math.max(0, width - left - right),
    height: Math.max(0, height - aigshellTopBarHeight - footerHeight - quickBarHeight + resizeTrigger)
  }
}
