import { createFleetStatusClient } from '../../common/fleet-status-client.js'
import {
  filterFleetServiceRows,
  isAbnormalFleetService,
  normalizeFleetServiceInventoryResult
} from './fleet-service-selector-model.js'

export const defaultFleetServiceConcurrency = 5
export const defaultFleetServiceCacheTtlMs = 60_000

function safeText (value) {
  return String(value ?? '')
}

function bookmarkId (bookmark, index = 0) {
  return safeText(bookmark?.id || bookmark?._id || `bookmark-${index}`)
}

function profileIdentity (value) {
  if (!value || typeof value !== 'object') return safeText(value)
  return safeText(value.id || value._id || value.name)
}

function proxyIdentity (value) {
  const source = safeText(value).trim()
  if (!source) return ''
  const scheme = source.match(/^([a-z][a-z0-9+.-]*:\/\/)/i)?.[1] || ''
  const remainder = source.slice(scheme.length)
  const authority = remainder.split(/[/?#]/, 1)[0]
  const endpoint = authority.slice(authority.lastIndexOf('@') + 1)
  return endpoint ? `${scheme}${endpoint}` : ''
}

function localConnectionIdentity (connection = {}) {
  const hopping = Array.isArray(connection.connectionHoppings)
    ? connection.connectionHoppings.map(localConnectionIdentity)
    : []
  return JSON.stringify({
    host: safeText(connection.host || connection.hostname),
    port: safeText(connection.port),
    username: safeText(connection.username || connection.user),
    profile: profileIdentity(
      connection.profile || connection.profileId || connection.sshProfile
    ),
    proxy: proxyIdentity(connection.proxy),
    encode: safeText(connection.encode),
    useSshAgent: Boolean(connection.useSshAgent),
    sshAgent: safeText(connection.sshAgent),
    cipher: safeText(connection.cipher),
    compress: Boolean(connection.compress),
    isMFA: Boolean(connection.isMFA),
    ignoreKeyboardInteractive: Boolean(connection.ignoreKeyboardInteractive),
    hasHopping: Boolean(connection.hasHopping),
    term: safeText(connection.term),
    envLang: safeText(connection.envLang),
    readyTimeout: safeText(connection.readyTimeout),
    keepaliveInterval: safeText(connection.keepaliveInterval),
    keepaliveCountMax: safeText(connection.keepaliveCountMax),
    connectionHoppings: hopping
  })
}

function publicServer (bookmark, index) {
  const id = bookmarkId(bookmark, index)
  return {
    id,
    name: safeText(bookmark?.title || bookmark?.name || bookmark?.host) || '--',
    host: safeText(bookmark?.host || bookmark?.hostname),
    port: bookmark?.port === undefined || bookmark?.port === null
      ? ''
      : safeText(bookmark.port)
  }
}

function loadingResult (items = []) {
  return {
    status: 'loading',
    message: '正在检测',
    items: Array.isArray(items)
      ? items
      : [],
    truncated: false
  }
}

function cancelledResult () {
  return {
    status: 'cancelled',
    message: '已取消',
    items: [],
    truncated: false
  }
}

function sameTargetKeys (left, right) {
  if (left.length !== right.length) return false
  return left.every((target, index) => target.key === right[index]?.key)
}

export function createFleetServiceSelectorStore (options = {}) {
  const client = options.client || createFleetStatusClient(options.clientOptions)
  const collectServiceInventory = options.collectServiceInventory || (
    args => client.inventory(args)
  )
  const now = typeof options.now === 'function' ? options.now : Date.now
  const requestedConcurrency = Number(options.concurrency)
  const concurrency = Math.min(defaultFleetServiceConcurrency, Math.max(
    1,
    Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : defaultFleetServiceConcurrency
  ))
  const cacheTtlMs = options.cacheTtlMs || defaultFleetServiceCacheTtlMs
  const identityResolver = options.connectionIdentity || client.connectionIdentity
  const listeners = new Set()
  const cache = new Map()
  const entries = new Map()
  const inFlight = new Map()
  const selectedIds = new Set()
  const queue = []
  let targets = []
  let filters = { search: '', group: 'all', status: 'all' }
  let opened = false
  let epoch = 0
  let activeRun = null
  let runningRequests = 0
  let stateSnapshot

  function resolvedIdentity (bookmark) {
    if (typeof identityResolver === 'function') {
      try {
        const identity = identityResolver.call(client, bookmark)
        if (typeof identity === 'string') return identity
      } catch {
        // Use the local credential-free fallback below.
      }
    }
    return localConnectionIdentity(bookmark)
  }

  function normalizeTargets (bookmarks) {
    return (Array.isArray(bookmarks) ? bookmarks : []).map((bookmark, index) => {
      const server = publicServer(bookmark, index)
      const identity = resolvedIdentity(bookmark)
      return {
        bookmark,
        server,
        id: server.id,
        key: `${server.id}\u0000${identity}`
      }
    })
  }

  function isFresh (key) {
    const cachedAt = cache.get(key)?.cachedAt
    return Boolean(cachedAt && now() - cachedAt <= cacheTtlMs)
  }

  function allRows () {
    const groupRank = new Map([
      ['system', 0],
      ['container', 1],
      ['process-manager', 2]
    ])
    return targets.flatMap(target => {
      const result = entries.get(target.key)?.result
      return (result?.items || []).map(service => ({
        ...service,
        id: `${target.key}\u0000${service.id}`,
        serviceId: service.id,
        serverId: target.id,
        serverName: target.server.name,
        selected: selectedIds.has(`${target.id}:${service.id}`)
      }))
    }).sort((left, right) => {
      const groupDifference = groupRank.get(left.group) - groupRank.get(right.group)
      if (groupDifference) return groupDifference
      const serverDifference = left.serverName.localeCompare(right.serverName, 'zh-CN')
      if (serverDifference) return serverDifference
      return left.name.localeCompare(right.name, 'zh-CN')
    })
  }

  function pruneSelection (rows) {
    const rowIds = new Set(rows.map(row => row.id))
    for (const id of selectedIds) {
      if (!rowIds.has(id)) selectedIds.delete(id)
    }
  }

  function buildState () {
    const rows = allRows()
    pruneSelection(rows)
    const visibleRows = filterFleetServiceRows(rows, filters)
    const selectedRows = rows.filter(row => selectedIds.has(row.id))
    const servers = targets.map(target => {
      const entry = entries.get(target.key)
      const result = entry?.result || loadingResult()
      return {
        ...target.server,
        key: target.key,
        status: result.status,
        message: result.message,
        itemCount: result.items.length,
        truncated: result.truncated,
        cachedAt: entry?.cachedAt || 0
      }
    })
    return {
      open: opened,
      servers,
      rows,
      visibleRows,
      selectedRows,
      selectedIds: [...selectedIds],
      selectedCount: selectedIds.size,
      abnormalCount: rows.filter(isAbnormalFleetService).length,
      targetCount: targets.length,
      filters: { ...filters },
      running: servers.some(server => server.status === 'loading'),
      truncated: servers.some(server => server.truncated),
      cacheTtlMs,
      concurrency
    }
  }

  function notify () {
    stateSnapshot = buildState()
    for (const listener of listeners) listener()
  }

  function currentTarget (key) {
    return targets.some(target => target.key === key)
  }

  function normalizeThrownFailure (error) {
    return normalizeFleetServiceInventoryResult({
      status: error?.name === 'AbortError' ? 'cancelled' : 'error',
      error: {
        code: safeText(error?.code),
        category: safeText(error?.category)
      }
    })
  }

  function finishQueuedTask (task, result, shouldCache) {
    const current = inFlight.get(task.target.key)
    if (current?.promise === task.promise) inFlight.delete(task.target.key)
    task.run.pending -= 1
    if (shouldCache && task.run.epoch === epoch && currentTarget(task.target.key)) {
      const cachedAt = now()
      cache.set(task.target.key, { result, cachedAt })
      entries.set(task.target.key, { result, cachedAt })
    }
    if (activeRun === task.run && task.run.pending === 0) activeRun = null
    task.resolve(result)
    if (task.run.epoch === epoch && opened) notify()
  }

  function pump () {
    while (runningRequests < concurrency && queue.length) {
      const task = queue.shift()
      if (
        task.run.cancelled ||
        task.run.controller.signal.aborted ||
        task.run.epoch !== epoch
      ) {
        finishQueuedTask(task, cancelledResult(), false)
        continue
      }
      runningRequests += 1
      Promise.resolve()
        .then(() => collectServiceInventory({
          bookmark: task.target.bookmark,
          signal: task.run.controller.signal
        }))
        .then(normalizeFleetServiceInventoryResult, normalizeThrownFailure)
        .then(result => {
          const shouldCache = result.status !== 'cancelled' &&
            !task.run.cancelled &&
            !task.run.controller.signal.aborted
          finishQueuedTask(task, result, shouldCache)
        })
        .finally(() => {
          runningRequests -= 1
          pump()
        })
    }
  }

  function ensureRun () {
    if (
      activeRun &&
      !activeRun.cancelled &&
      !activeRun.controller.signal.aborted &&
      activeRun.epoch === epoch
    ) {
      return activeRun
    }
    activeRun = {
      controller: new AbortController(),
      cancelled: false,
      epoch,
      pending: 0
    }
    return activeRun
  }

  function scheduleTarget (target) {
    const existing = inFlight.get(target.key)
    if (existing) return existing.promise
    const run = ensureRun()
    let resolveTask
    const promise = new Promise(resolve => { resolveTask = resolve })
    const task = { target, run, promise, resolve: resolveTask }
    run.pending += 1
    inFlight.set(target.key, { promise, run })
    queue.push(task)
    pump()
    return promise
  }

  function refreshTargets ({ force = false } = {}) {
    const waiting = []
    for (const target of targets) {
      if (!force && isFresh(target.key)) {
        entries.set(target.key, cache.get(target.key))
        continue
      }
      const existing = inFlight.get(target.key)
      if (existing) waiting.push(existing.promise)
      else waiting.push(scheduleTarget(target))
    }
    notify()
    return waiting.length ? Promise.all(waiting) : Promise.resolve([])
  }

  function abortActive (markCancelled) {
    epoch += 1
    if (activeRun) {
      activeRun.cancelled = true
      activeRun.controller.abort()
      activeRun = null
    }
    inFlight.clear()
    if (markCancelled) {
      for (const target of targets) {
        const entry = entries.get(target.key)
        if (!entry || entry.result.status === 'loading') {
          entries.set(target.key, { result: cancelledResult(), cachedAt: 0 })
        }
      }
    }
    pump()
  }

  function open (bookmarks) {
    const nextTargets = normalizeTargets(bookmarks)
    if (!sameTargetKeys(targets, nextTargets) && activeRun) {
      abortActive(false)
    }
    targets = nextTargets
    opened = true
    for (const target of targets) {
      if (isFresh(target.key)) entries.set(target.key, cache.get(target.key))
      else if (!inFlight.has(target.key)) {
        const previousItems = entries.get(target.key)?.result?.items
        entries.set(target.key, {
          result: loadingResult(previousItems),
          cachedAt: 0
        })
      }
    }
    return refreshTargets()
  }

  function refresh ({ force = true } = {}) {
    if (force) {
      abortActive(false)
      for (const target of targets) {
        const previousItems = entries.get(target.key)?.result?.items
        entries.set(target.key, {
          result: loadingResult(previousItems),
          cachedAt: 0
        })
      }
    }
    return refreshTargets({ force })
  }

  function cancel () {
    if (!stateSnapshot.running) return false
    abortActive(true)
    notify()
    return true
  }

  function close () {
    const wasOpen = opened
    opened = false
    abortActive(true)
    if (wasOpen) notify()
    return wasOpen
  }

  function setFilters (updates = {}) {
    filters = {
      search: updates.search === undefined
        ? filters.search
        : safeText(updates.search),
      group: updates.group === undefined
        ? filters.group
        : (safeText(updates.group) || 'all'),
      status: updates.status === undefined
        ? filters.status
        : (safeText(updates.status) || 'all')
    }
    notify()
    return { ...filters }
  }

  function toggleSelected (id) {
    const normalizedId = safeText(id)
    if (!allRows().some(row => row.id === normalizedId)) return false
    if (selectedIds.has(normalizedId)) selectedIds.delete(normalizedId)
    else selectedIds.add(normalizedId)
    notify()
    return selectedIds.has(normalizedId)
  }

  function setRowsSelected (rows, shouldSelect) {
    let changed = 0
    for (const row of rows) {
      const selected = selectedIds.has(row.id)
      if (shouldSelect && !selected) {
        selectedIds.add(row.id)
        changed += 1
      } else if (!shouldSelect && selected) {
        selectedIds.delete(row.id)
        changed += 1
      }
    }
    if (changed) notify()
    return changed
  }

  function setVisibleSelected (shouldSelect) {
    return setRowsSelected(
      filterFleetServiceRows(allRows(), filters),
      Boolean(shouldSelect)
    )
  }

  function selectVisible () {
    return setVisibleSelected(true)
  }

  function selectAbnormal () {
    const rows = allRows().filter(isAbnormalFleetService)
    return setRowsSelected(rows, true)
  }

  function clearSelected () {
    if (!selectedIds.size) return false
    selectedIds.clear()
    notify()
    return true
  }

  function subscribe (listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  stateSnapshot = buildState()
  return {
    open,
    refresh,
    cancel,
    close,
    setFilters,
    toggleSelected,
    setVisibleSelected,
    selectVisible,
    selectAbnormal,
    clearSelected,
    getState: () => stateSnapshot,
    subscribe
  }
}
