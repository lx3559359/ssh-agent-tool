export const aigshellTopBarHeight = 44
export const minRightPanelWidth = 320
export const maxRightPanelWidth = 1000
export const minTerminalVertical = 64
export const rightPanelAutoCollapseWidth = 1120
const minPinnedTerminalWidth = 320
const preferredTerminalWidth = 640

function toNonNegativeNumber (value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

export function normalizeRightPanelWidth (value) {
  const width = Number(value)
  if (!Number.isFinite(width) || width < minRightPanelWidth) {
    return minRightPanelWidth
  }
  return Math.min(width, maxRightPanelWidth)
}

export function getAIGShellGeometry ({
  width,
  height,
  footerHeight,
  sidebarWidth,
  leftSidebarWidth,
  openedSideBar,
  pinned,
  rightPanelWidth,
  rightPanelVisible,
  rightPanelPinned,
  rightPanelTab,
  rightPanelAutoExpanded = false,
  pinnedQuickCommandBar,
  inActiveTerminal,
  quickCommandBoxHeight,
  resizeTrigger = 0
}) {
  const viewportWidth = toNonNegativeNumber(width)
  const viewportHeight = toNonNegativeNumber(height)
  const effectiveSidebarWidth = Math.min(
    toNonNegativeNumber(sidebarWidth),
    viewportWidth
  )
  const leftPanelVisible = Boolean(openedSideBar)
  const leftPanelMaxWidth = Math.max(0, viewportWidth - effectiveSidebarWidth)
  const leftPanelWidth = leftPanelVisible
    ? Math.min(toNonNegativeNumber(leftSidebarWidth), leftPanelMaxWidth)
    : 0
  const leftPanelCanReserve = leftPanelVisible && Boolean(pinned) &&
    viewportWidth - effectiveSidebarWidth - leftPanelWidth >= minPinnedTerminalWidth
  const leftPanelReservation = leftPanelCanReserve ? leftPanelWidth : 0
  const terminalLeft = effectiveSidebarWidth + leftPanelReservation

  const rightPanelIsVisible = Boolean(rightPanelVisible)
  const requestedRightPanelWidth = normalizeRightPanelWidth(rightPanelWidth)
  const rightPanelNeedsSpace = viewportWidth < rightPanelAutoCollapseWidth ||
    viewportWidth - terminalLeft < preferredTerminalWidth + minRightPanelWidth
  const rightPanelShouldAutoCollapse = rightPanelIsVisible &&
    rightPanelTab === 'ai' && !rightPanelAutoExpanded && rightPanelNeedsSpace
  const renderedRightPanelVisible = rightPanelIsVisible && !rightPanelShouldAutoCollapse
  const pinnedRightPanelMaxWidth = Math.max(
    0,
    viewportWidth - terminalLeft - minPinnedTerminalWidth
  )
  const rightPanelCanReserve = renderedRightPanelVisible && Boolean(rightPanelPinned) &&
    pinnedRightPanelMaxWidth >= minRightPanelWidth
  const rightPanelMaxWidth = rightPanelCanReserve
    ? Math.min(maxRightPanelWidth, pinnedRightPanelMaxWidth)
    : Math.min(maxRightPanelWidth, viewportWidth)
  const rightPanelWidthValue = renderedRightPanelVisible
    ? Math.min(requestedRightPanelWidth, rightPanelMaxWidth)
    : 0
  const rightPanelReservation = rightPanelCanReserve ? rightPanelWidthValue : 0

  const effectiveFooterHeight = toNonNegativeNumber(footerHeight)
  const effectiveQuickCommandBoxHeight = toNonNegativeNumber(quickCommandBoxHeight)
  const effectiveResizeTrigger = toNonNegativeNumber(resizeTrigger)
  const terminalAvailableHeight = Math.max(
    0,
    viewportHeight - aigshellTopBarHeight - effectiveFooterHeight + effectiveResizeTrigger
  )
  const terminalHeightFloor = Math.min(minTerminalVertical, terminalAvailableHeight)
  const quickBarHeight = Boolean(inActiveTerminal) && Boolean(pinnedQuickCommandBar)
    ? Math.min(
      effectiveQuickCommandBoxHeight,
      Math.max(0, terminalAvailableHeight - terminalHeightFloor)
    )
    : 0
  const terminalFrame = {
    top: aigshellTopBarHeight,
    left: terminalLeft,
    width: Math.max(0, viewportWidth - terminalLeft - rightPanelReservation),
    height: Math.max(0, terminalAvailableHeight - quickBarHeight)
  }

  return {
    viewport: {
      width: viewportWidth,
      height: viewportHeight
    },
    leftPanel: {
      visible: leftPanelVisible,
      width: leftPanelWidth,
      reservation: leftPanelReservation,
      overlay: leftPanelVisible && leftPanelWidth > 0 && !leftPanelCanReserve,
      maxWidth: leftPanelMaxWidth
    },
    rightPanel: {
      visible: renderedRightPanelVisible,
      requestedVisible: rightPanelIsVisible,
      autoCollapsed: rightPanelShouldAutoCollapse,
      width: rightPanelWidthValue,
      reservation: rightPanelReservation,
      overlay: rightPanelIsVisible && rightPanelWidthValue > 0 && !rightPanelCanReserve,
      minWidth: Math.min(minRightPanelWidth, rightPanelMaxWidth),
      maxWidth: rightPanelMaxWidth
    },
    quickCommandBar: {
      height: quickBarHeight,
      reservation: quickBarHeight,
      bottom: effectiveFooterHeight
    },
    terminalFrame,
    terminalInsets: {
      top: terminalFrame.top,
      left: terminalFrame.left,
      right: rightPanelReservation,
      bottom: Math.max(0, viewportHeight - terminalFrame.top - terminalFrame.height)
    }
  }
}
