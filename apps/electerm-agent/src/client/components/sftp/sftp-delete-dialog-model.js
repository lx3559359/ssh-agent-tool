export function buildDeleteTargetPreview (files = [], options = {}) {
  const separator = options.separator || ', '
  const names = files.slice(0, 3)
    .map(file => String(file?.name || file?.path || ''))
    .filter(Boolean)
  return {
    count: files.length,
    names: names.join(separator),
    remaining: Math.max(0, files.length - names.length)
  }
}
