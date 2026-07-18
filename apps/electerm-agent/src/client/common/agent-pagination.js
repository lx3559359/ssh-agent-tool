const encoder = new TextEncoder()

function boundedInteger (value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

export function paginateAgentList (items, options = {}) {
  const values = Array.isArray(items) ? items : []
  const cursor = boundedInteger(options.cursor, 0, 0, values.length)
  const limit = boundedInteger(options.limit, 100, 1, 200)
  const maxBytes = boundedInteger(options.maxBytes, 24 * 1024, 1024, 28 * 1024)
  const page = []
  let bytes = 2
  for (let index = cursor; index < values.length && page.length < limit; index += 1) {
    const itemBytes = encoder.encode(JSON.stringify(values[index])).length + (page.length ? 1 : 0)
    if (page.length && bytes + itemBytes > maxBytes) break
    page.push(values[index])
    bytes += itemBytes
  }
  const nextIndex = cursor + page.length
  return {
    items: page,
    cursor,
    nextCursor: nextIndex < values.length ? String(nextIndex) : null,
    hasMore: nextIndex < values.length,
    total: values.length
  }
}
