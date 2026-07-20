export function shouldUseInputContextMenu (element) {
  if (!element?.tagName) {
    return false
  }
  const tagName = String(element.tagName).toLowerCase()
  if (tagName !== 'input' && tagName !== 'textarea') {
    return false
  }
  return !element.closest?.('.xterm')
}
