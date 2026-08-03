const MAX_AGENT_TOOL_PARALLELISM = 4

function abortError () {
  const error = new Error('Agent tool scheduling cancelled')
  error.name = 'AbortError'
  return error
}

function stableSerialize (value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function isParallelSafeRead (call) {
  const descriptor = call?.descriptor || {}
  const scheduling = descriptor.scheduling || {}
  return descriptor.scope === 'conversation' &&
    scheduling.readonly === true &&
    scheduling.stateful === false &&
    scheduling.parallelSafe === true
}

function parallelLimit (value) {
  if (!Number.isFinite(value)) return MAX_AGENT_TOOL_PARALLELISM
  return Math.max(1, Math.min(
    MAX_AGENT_TOOL_PARALLELISM,
    Math.floor(value)
  ))
}

function coalesceParallelCalls (calls) {
  const units = []
  const byKey = new Map()
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]
    const coalesce = call.descriptor?.scheduling?.coalesce === true
    const key = coalesce
      ? `${String(call.name)}:${stableSerialize(call.args)}`
      : `index:${index}`
    const existing = byKey.get(key)
    if (existing) {
      existing.indexes.push(index)
      continue
    }
    const unit = { call, indexes: [index] }
    byKey.set(key, unit)
    units.push(unit)
  }
  return units
}

async function runParallelGroup (calls, execute, options) {
  const units = coalesceParallelCalls(calls)
  const settled = new Array(units.length)
  const limit = Math.min(parallelLimit(options.maxParallel), units.length)
  let cursor = 0
  let cancelled = Boolean(options.signal?.aborted)

  async function worker () {
    while (cursor < units.length) {
      if (options.signal?.aborted) {
        cancelled = true
        return
      }
      const index = cursor
      cursor += 1
      try {
        settled[index] = {
          status: 'fulfilled',
          value: await execute(units[index].call)
        }
      } catch (reason) {
        settled[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  if (options.signal?.aborted) cancelled = true

  const results = new Array(calls.length)
  let firstFailure
  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    const outcome = settled[unitIndex]
    if (!outcome) continue
    if (outcome.status === 'rejected' && firstFailure === undefined) {
      firstFailure = outcome.reason
    }
    for (const callIndex of units[unitIndex].indexes) {
      if (outcome.status === 'fulfilled') results[callIndex] = outcome.value
    }
  }
  if (firstFailure !== undefined) throw firstFailure
  if (cancelled) throw abortError()
  return results
}

export async function scheduleAgentToolCalls (
  calls = [],
  execute,
  options = {}
) {
  if (typeof execute !== 'function') {
    throw new TypeError('Agent tool scheduler requires an executor')
  }
  const results = new Array(calls.length)
  let index = 0
  while (index < calls.length) {
    if (options.signal?.aborted) throw abortError()
    if (!isParallelSafeRead(calls[index])) {
      results[index] = await execute(calls[index])
      index += 1
      continue
    }
    let end = index + 1
    while (end < calls.length && isParallelSafeRead(calls[end])) end += 1
    const groupResults = await runParallelGroup(
      calls.slice(index, end),
      execute,
      options
    )
    for (let offset = 0; offset < groupResults.length; offset += 1) {
      results[index + offset] = groupResults[offset]
    }
    index = end
  }
  return results
}
