import { redactAuditText } from '../../../common/safety-transactions/audit-redaction.js'

const defaultStorageKey = 'shellpilot-operations-task-history-v1'

function truncateUtf8 (value, maxBytes) {
  const bytes = new TextEncoder().encode(String(value ?? ''))
  if (bytes.length <= maxBytes) return new TextDecoder().decode(bytes)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const minimum = Math.max(0, maxBytes - 3)
  for (let end = maxBytes; end >= minimum; end--) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {
      // A UTF-8 code point can span at most four bytes.
    }
  }
  return ''
}

function sanitizeStep (step, maxStepBytes) {
  return {
    ...step,
    command: step.command ? redactAuditText(step.command) : step.command,
    output: truncateUtf8(
      redactAuditText(step.output || ''),
      maxStepBytes
    )
  }
}

function sanitizeRecord (record, maxStepBytes) {
  return {
    ...record,
    error: record.error ? redactAuditText(record.error) : record.error,
    steps: (record.steps || []).map(step => sanitizeStep(step, maxStepBytes))
  }
}

export function createOperationsTaskRecordStore ({
  maxRecords = 100,
  maxStepBytes = 256 * 1024,
  storage,
  storageKey = defaultStorageKey
} = {}) {
  if (!storage?.read || !storage?.write) {
    throw new Error('运维任务记录存储不可用')
  }
  let records = storage.read(storageKey) || []

  function persist () {
    storage.write(records, storageKey)
  }

  return Object.freeze({
    save (record) {
      const safe = sanitizeRecord(record, maxStepBytes)
      records = [
        safe,
        ...records.filter(item => item.id !== safe.id)
      ].slice(0, maxRecords)
      persist()
      return safe
    },
    get (id) {
      return records.find(item => item.id === id) || null
    },
    list () {
      return structuredClone(records)
    },
    clear () {
      records = []
      persist()
    }
  })
}
