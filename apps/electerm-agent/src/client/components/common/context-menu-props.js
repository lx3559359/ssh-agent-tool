export const contextMenuAlign = {
  offset: [0, 0],
  overflow: {
    adjustX: true,
    adjustY: true,
    shiftX: true,
    shiftY: true
  }
}

let nextContextMenuId = 0

export function createContextMenuId (scope = 'menu') {
  nextContextMenuId += 1
  return `shellpilot-${scope}-${nextContextMenuId}`
}
