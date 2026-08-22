const maxSkippedItems = 1000
const maxCompletedBatches = 1000
const completedStatuses = new Set(['completed', 'success'])

function normalizeExpectedCount (value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('上传批次数量无效，无法汇总传输结果。')
  }
  return value
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
  const completedBatches = new Map()

  function rememberCompletedBatch (batchId) {
    completedBatches.set(batchId, true)
    if (completedBatches.size > maxCompletedBatches) {
      completedBatches.delete(completedBatches.keys().next().value)
    }
  }

  return {
    record (result = {}) {
      const normalized = normalizeTransferResult(result)
      const { batchId, transferId, expected } = normalized
      if (!batchId || !transferId) return null
      if (completedBatches.has(batchId)) return null

      const batch = batches.get(batchId) || {
        expected,
        results: new Map()
      }
      if (!batches.has(batchId)) {
        batches.set(batchId, batch)
      } else if (batch.expected !== expected) {
        throw new Error('上传批次数量发生变化，无法汇总传输结果。')
      }

      if (!batch.results.has(transferId)) {
        batch.results.set(transferId, normalized)
      }

      if (batch.results.size !== batch.expected) {
        return null
      }

      batches.delete(batchId)
      rememberCompletedBatch(batchId)
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
