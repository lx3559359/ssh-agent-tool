function normalizeDimension (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return 1
  }
  return Math.max(1, Math.floor(number))
}

export function normalizeTerminalResizeSize (cols, rows) {
  return {
    cols: normalizeDimension(cols),
    rows: normalizeDimension(rows)
  }
}
