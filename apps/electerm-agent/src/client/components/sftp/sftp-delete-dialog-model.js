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

export function redactDeletePreparationError (error) {
  return String(error?.message || error || '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, '$1***@')
    .replace(
      /\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s;,]+/gi,
      'Authorization=***'
    )
    .replace(
      /\b(password|passwd|token|secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s;,]+)/gi,
      '$1=***'
    )
}
