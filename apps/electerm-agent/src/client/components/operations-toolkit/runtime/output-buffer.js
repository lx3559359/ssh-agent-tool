export function createOutputBuffer ({ maxLines = 5000 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxLines) || 5000))
  let lines = []
  let pending = ''
  let truncated = false

  function trim () {
    const total = lines.length + (pending ? 1 : 0)
    if (total <= limit) return
    lines = lines.slice(total - limit)
    truncated = true
  }

  function currentLines () {
    return pending ? [...lines, pending] : [...lines]
  }

  return {
    append (value) {
      const text = pending + String(value ?? '')
      const chunks = text.split(/\r?\n/)
      pending = chunks.pop() || ''
      lines.push(...chunks)
      trim()
    },
    clear () {
      lines = []
      pending = ''
      truncated = false
    },
    snapshot () {
      return Object.freeze({
        lines: Object.freeze(currentLines()),
        truncated
      })
    },
    toString () {
      return currentLines().join('\n')
    }
  }
}
