const maxSkippedItems = 1000
const completedStatuses = new Set(['completed', 'success'])

function normalizeExpectedCount (value) {
  const expected = Number(value)
  return Number.isInteger(expected) && expected > 0 ? expected : 1
}

function normalizeTransferResult (result = {}) {
  return {
    batchId: String(result.batchId || ''),
    transferId: String(result.transferId || ''),
    expected: normalizeExpectedCount(result.expected),
    status: String(result.status || ''),
    skipped: Array.isArray(result.skipped) ? result.skipped : []
  }
}

function summarizeBatchResults ({ batchId, expected, results }) {
  const summary = {
    batchId,
    expected,
    completed: 0,
    skippedCount: 0,
    exceptionCount: 0,
    skipped: []
  }

  for (const result of results.values()) {
    if (completedStatuses.has(result.status)) {
      summary.completed += 1
      continue
    }
    if (result.status === 'skipped') {
      summary.skippedCount += result.skipped.length || 1
      for (const item of result.skipped) {
        if (summary.skipped.length >= maxSkippedItems) break
        summary.skipped.push(item)
      }
      continue
    }
    summary.exceptionCount += 1
  }

  return summary
}

export function createTransferBatchResultCollector () {
  const batches = new Map()

  return {
    record (result = {}) {
      const normalized = normalizeTransferResult(result)
      const { batchId, transferId, expected } = normalized
      if (!batchId || !transferId) return null

      const batch = batches.get(batchId) || {
        expected,
        results: new Map()
      }
      if (!batches.has(batchId)) {
        batches.set(batchId, batch)
      } else if (batch.expected !== expected) {
        batch.expected = expected
      }

      if (!batch.results.has(transferId)) {
        batch.results.set(transferId, normalized)
      }

      if (batch.results.size < batch.expected) {
        return null
      }

      batches.delete(batchId)
      return summarizeBatchResults({
        batchId,
        expected: batch.expected,
        results: batch.results
      })
    },
    get size () {
      return batches.size
    }
  }
}

export const sharedTransferBatchResultCollector = createTransferBatchResultCollector()
