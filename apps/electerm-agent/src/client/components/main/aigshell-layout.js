export const aigshellTopBarHeight = 44
export const minRightPanelWidth = 360

export function normalizeRightPanelWidth (value) {
  const width = Number.parseInt(value, 10)
  if (!Number.isFinite(width) || width < minRightPanelWidth) {
    return minRightPanelWidth
  }
  return width
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
    ? normalizeRightPanelWidth(rightPanelWidth)
    : 0
  const quickBarHeight = inActiveTerminal && pinnedQuickCommandBar ? quickCommandBoxHeight : 0

  return {
    top: aigshellTopBarHeight,
    left,
    width: width - left - right,
    height: height - aigshellTopBarHeight - footerHeight - quickBarHeight + resizeTrigger
  }
}
