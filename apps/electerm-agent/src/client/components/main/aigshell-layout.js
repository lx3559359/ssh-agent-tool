export const aigshellTopBarHeight = 44

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
  const right = rightPanelVisible && rightPanelPinned ? rightPanelWidth : 0
  const quickBarHeight = inActiveTerminal && pinnedQuickCommandBar ? quickCommandBoxHeight : 0

  return {
    top: aigshellTopBarHeight,
    left,
    width: width - left - right,
    height: height - aigshellTopBarHeight - footerHeight - quickBarHeight + resizeTrigger
  }
}
