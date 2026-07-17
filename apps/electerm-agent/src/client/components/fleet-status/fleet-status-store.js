import { createFleetStatusClient } from '../../common/fleet-status-client.js'
import {
  classifyFleetStatusError,
  createFleetStatusSnapshot
} from './fleet-status-model.js'

export const defaultFleetStatusConcurrency = 5
export const defaultFleetStatusCacheTtlMs = 60_000

const allFilter = 'all'

function defaultTaskId () {
  const random = globalThis.crypto?.randomUUID?.() ||
    Math.random().toString(36).slice(2)
  return `fleet-ui-${Date.now()}-${random}`
}

function bookmarkId (bookmark, index = 0) {
  return String(bookmark?.id || bookmark?._id || `bookmark-${index}`)
}

function normalizeList (value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function safeText (value) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function isSshBookmark (bookmark) {
  const explicitType = safeText(bookmark?.type).trim()
  const type = explicitType || safeText(bookmark?.termType).trim() || 'ssh'
  return type.toLowerCase() === 'ssh'
}

function sshBookmarks (value) {
  return Array.isArray(value) ? value.filter(isSshBookmark) : []
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

function safeConnectionIdentity (connection = {}) {
  return {
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
    keepaliveCountMax: safeText(connection.keepaliveCountMax)
  }
}

function connectionIdentity (bookmark) {
  const identity = safeConnectionIdentity(bookmark)
  identity.connectionHoppings = normalizeList(bookmark?.connectionHoppings)
    .map(hopping => safeConnectionIdentity(hopping))
  return JSON.stringify(identity)
}

function resultTargetId (result) {
  return safeText(
    result?.target?.id ||
    result?.target?.bookmarkId ||
    result?.bookmarkId ||
    result?.targetId
  )
}

function publicBookmarkSignature (bookmarks, groups) {
  return JSON.stringify({
    bookmarks: bookmarks.map((bookmark, index) => ({
      id: bookmarkId(bookmark, index),
      title: safeText(bookmark?.title),
      name: safeText(bookmark?.name),
      host: safeText(bookmark?.host || bookmark?.hostname),
      port: safeText(bookmark?.port),
      tags: normalizeList(bookmark?.tags).map(safeText),
      labels: normalizeList(bookmark?.labels).map(safeText),
      groupId: safeText(bookmark?.groupId || bookmark?.categoryId)
    })),
    groups: groups.map(group => ({
      id: safeText(group?.id),
      title: safeText(group?.title || group?.name),
      bookmarkIds: normalizeList(group?.bookmarkIds).map(safeText)
    }))
  })
}

function resultErrorPresentation (result) {
  const status = safeText(result?.status).toLowerCase()
  const code = safeText(result?.error?.code).toUpperCase()
  if (code === 'MISSING_RESULT') {
    return { category: 'unknown', message: '\u672a\u6536\u5230\u8be5\u670d\u52a1\u5668\u7684\u91c7\u96c6\u7ed3\u679c' }
  }
  const category = ({
    AUTH_FAILED: 'auth',
    HOST_KEY_MISMATCH: 'host-key',
    PERMISSION_DENIED: 'permission'
  })[code] || classifyFleetStatusError({
    category: result?.error?.category,
    code,
    status
  })
  const messages = {
    timeout: '采集超时',
    cancelled: '采集已取消',
    auth: 'SSH 认证失败',
    'host-key': 'SSH 主机密钥校验失败',
    permission: '权限不足',
    unsupported: '服务器不支持该操作'
  }
  if (messages[category]) return { category, message: messages[category] }
  if (code === 'CONNECTION_FAILED' || code === 'TERMINAL_UNAVAILABLE') {
    return { category: 'unknown', message: 'SSH 连接失败' }
  }
  return { category: 'unknown', message: '采集失败' }
}

function successfulProbeData (result) {
  const probes = Array.isArray(result?.probes) ? result.probes : []
  return new Map(probes
    .filter(probe => probe?.status === 'success')
    .map(probe => [probe.id, probe.data]))
}

function failedProbeCategories (result) {
  const probes = Array.isArray(result?.probes) ? result.probes : []
  return new Map(probes
    .filter(probe => probe?.status !== 'success')
    .map(probe => [safeText(probe?.id), classifyFleetStatusError({
      category: probe?.category ?? probe?.error?.category,
      code: probe?.code ?? probe?.error?.code,
      status: probe?.status
    })]))
}

function snapshotFromSuccess (result, collectedAt, createSnapshot) {
  if (result?.snapshot && typeof result.snapshot === 'object') {
    return createSnapshot(result.snapshot)
  }
  if (result?.connection && typeof result.connection === 'object') {
    return createSnapshot(result)
  }

  const probes = successfulProbeData(result)
  const probeErrors = failedProbeCategories(result)
  const system = probes.get('system') || {}
  const resources = probes.get('resources') || {}
  const services = Array.isArray(probes.get('services'))
    ? probes.get('services')
    : []
  const platformServices = Array.isArray(probes.get('containers'))
    ? probes.get('containers').map(service => ({
      ...service,
      platformService: true
    }))
    : []
  const network = probes.get('network') || {}
  const firewall = probes.get('firewall') || {}
  const serviceProbeErrors = [...probeErrors]
    .filter(([id]) => !['system', 'resources', 'network', 'firewall'].includes(id))
    .map(([probeId, error]) => ({ probeId, error }))

  return createSnapshot({
    connection: {
      status: 'connected',
      latencyMs: result?.connection?.latencyMs ?? result?.latencyMs ?? null
    },
    resources: {
      cpu: resources.cpu ?? null,
      memory: resources.memory ?? null,
      disk: resources.disk ?? resources.filesystems ?? null,
      load: resources.load ?? null,
      uptime: resources.uptime ?? system.uptime ?? system.uptimeSeconds ??
        (probeErrors.has('system')
          ? { error: probeErrors.get('system') }
          : ''),
      ...(probeErrors.has('resources')
        ? { error: probeErrors.get('resources') }
        : {})
    },
    services: [...services, ...platformServices, ...serviceProbeErrors],
    network: {
      interfaces: Array.isArray(network.interfaces) ? network.interfaces : [],
      defaultRoute: network.defaultRoute ?? null,
      dns: Array.isArray(network.dns)
        ? network.dns
        : (Array.isArray(network.dnsServers) ? network.dnsServers : []),
      ...(probeErrors.has('network')
        ? { error: probeErrors.get('network') }
        : {})
    },
    firewall: {
      provider: typeof firewall.provider === 'string' ? firewall.provider : '',
      enabled: typeof firewall.enabled === 'boolean' ? firewall.enabled : null,
      ...(probeErrors.has('firewall')
        ? { error: probeErrors.get('firewall') }
        : {})
    },
    collectedAt: result?.collectedAt || collectedAt
  })
}

function snapshotFromResult (result, collectedAt, createSnapshot) {
  if (result?.status === 'success') {
    return {
      snapshot: snapshotFromSuccess(result, collectedAt, createSnapshot),
      errorMessage: '',
      cacheable: true
    }
  }
  const error = resultErrorPresentation(result)
  return {
    snapshot: createSnapshot({
      connection: {
        status: error.category === 'unknown' ? 'failed' : error.category,
        error: error.category
      },
      collectedAt
    }),
    errorMessage: error.message,
    cacheable: true
  }
}

export function createFleetStatusStore (options = {}) {
  const client = options.client || createFleetStatusClient(options.clientOptions)
  const now = typeof options.now === 'function' ? options.now : Date.now
  const createTaskId = options.createTaskId || defaultTaskId
  const createSnapshot = options.createSnapshot || createFleetStatusSnapshot
  const concurrency = options.concurrency || defaultFleetStatusConcurrency
  const cacheTtlMs = options.cacheTtlMs || defaultFleetStatusCacheTtlMs

  function resolvedConnectionIdentity (bookmark) {
    if (typeof client.connectionIdentity === 'function') {
      try {
        const identity = client.connectionIdentity(bookmark)
        if (typeof identity === 'string') return identity
      } catch {
        // Fall through to the local credential-free identity.
      }
    }
    return connectionIdentity(bookmark)
  }

  const listeners = new Set()
  const selectedIds = new Set()
  const snapshots = new Map()
  const inFlight = new Map()
  const generations = new Map()
  const activeTasks = new Map()
  let bookmarks = [...sshBookmarks(options.bookmarks)]
  let bookmarkGroups = Array.isArray(options.bookmarkGroups)
    ? [...options.bookmarkGroups]
    : []
  let sourceSignature = publicBookmarkSignature(bookmarks, bookmarkGroups)
  let connectionIdentities = new Map(bookmarks.map((bookmark, index) => [
    bookmarkId(bookmark, index),
    resolvedConnectionIdentity(bookmark)
  ]))
  let filters = { search: '', group: allFilter, status: allFilter }
  let stateSnapshot

  function sourceBookmarks () {
    const current = options.getBookmarks?.()
    return Array.isArray(current) ? current : bookmarks
  }

  function sourceGroups () {
    const current = options.getBookmarkGroups?.()
    return Array.isArray(current) ? current : bookmarkGroups
  }

  function groupForBookmark (bookmark, id) {
    const directGroupId = safeText(bookmark?.groupId || bookmark?.categoryId)
    const group = bookmarkGroups.find(item => (
      safeText(item?.id) === directGroupId ||
      normalizeList(item?.bookmarkIds).map(safeText).includes(id)
    ))
    return {
      groupId: safeText(group?.id || directGroupId),
      group: safeText(group?.title || group?.name) || '未分组'
    }
  }

  function allRows () {
    return bookmarks.map((bookmark, index) => {
      const id = bookmarkId(bookmark, index)
      const group = groupForBookmark(bookmark, id)
      const entry = snapshots.get(id)
      const snapshot = entry?.snapshot || null
      return {
        id,
        name: safeText(bookmark?.title || bookmark?.name || bookmark?.host) || '--',
        host: safeText(bookmark?.host || bookmark?.hostname),
        port: bookmark?.port === undefined || bookmark?.port === null
          ? ''
          : safeText(bookmark.port),
        tags: [
          ...normalizeList(bookmark?.tags),
          ...normalizeList(bookmark?.labels)
        ].map(safeText).filter(Boolean),
        ...group,
        snapshot,
        overallStatus: snapshot?.overallStatus || 'pending',
        errorMessage: entry?.errorMessage || '',
        selected: selectedIds.has(id),
        cachedAt: entry?.cachedAt || 0
      }
    })
  }

  function visibleRows () {
    const keyword = filters.search.trim().toLowerCase()
    return allRows().filter(row => {
      const searchMatch = !keyword || [
        row.name,
        row.host,
        ...row.tags
      ].some(value => safeText(value).toLowerCase().includes(keyword))
      const groupMatch = filters.group === allFilter ||
        row.groupId === filters.group
      const statusMatch = filters.status === allFilter ||
        row.overallStatus === filters.status
      return searchMatch && groupMatch && statusMatch
    })
  }

  function buildState () {
    const rows = visibleRows()
    const cachedTimes = [...snapshots.values()]
      .map(entry => entry.cachedAt || 0)
      .filter(Boolean)
    return {
      rows,
      visibleRows: rows,
      bookmarkCount: bookmarks.length,
      filters: { ...filters },
      selectedIds: [...selectedIds],
      selectedCount: selectedIds.size,
      running: activeTasks.size > 0,
      cacheTtlMs,
      lastCacheAt: cachedTimes.length ? Math.max(...cachedTimes) : 0,
      groups: bookmarkGroups
        .filter(group => group?.id)
        .map(group => ({
          value: safeText(group.id),
          label: safeText(group.title || group.name) || '未命名分组'
        }))
    }
  }

  function notify () {
    stateSnapshot = buildState()
    for (const listener of listeners) listener()
  }

  function updateSources (nextBookmarks, nextGroups, shouldNotify = true) {
    const normalizedBookmarks = [...sshBookmarks(nextBookmarks)]
    const normalizedGroups = Array.isArray(nextGroups) ? [...nextGroups] : []
    const nextSignature = publicBookmarkSignature(normalizedBookmarks, normalizedGroups)
    const nextConnectionIdentities = new Map(normalizedBookmarks.map((bookmark, index) => [
      bookmarkId(bookmark, index),
      resolvedConnectionIdentity(bookmark)
    ]))
    const changedConnectionIds = new Set()
    for (const [id, identity] of connectionIdentities) {
      if (nextConnectionIdentities.get(id) !== identity) {
        changedConnectionIds.add(id)
      }
    }
    for (const id of nextConnectionIdentities.keys()) {
      if (!connectionIdentities.has(id)) changedConnectionIds.add(id)
    }
    bookmarks = normalizedBookmarks
    bookmarkGroups = normalizedGroups
    connectionIdentities = nextConnectionIdentities
    if (nextSignature === sourceSignature && !changedConnectionIds.size) {
      return false
    }
    sourceSignature = nextSignature

    const currentIds = new Set(bookmarks.map(bookmarkId))
    for (const id of changedConnectionIds) {
      snapshots.delete(id)
      generations.set(id, (generations.get(id) || 0) + 1)
      inFlight.delete(id)
    }
    for (const id of [...snapshots.keys()]) {
      if (!currentIds.has(id)) snapshots.delete(id)
    }
    for (const id of [...selectedIds]) {
      if (!currentIds.has(id)) selectedIds.delete(id)
    }
    for (const id of [...inFlight.keys()]) {
      if (!currentIds.has(id)) {
        generations.set(id, (generations.get(id) || 0) + 1)
        inFlight.delete(id)
      }
    }
    if (shouldNotify) notify()
    return true
  }

  function syncSources () {
    updateSources(sourceBookmarks(), sourceGroups())
  }

  function isFresh (id) {
    const cachedAt = snapshots.get(id)?.cachedAt
    return Boolean(cachedAt && now() - cachedAt <= cacheTtlMs)
  }

  function applyCollectionResult (target, result, generation, token) {
    const id = bookmarkId(target)
    if (
      token.cancelled ||
      generations.get(id) !== generation ||
      !bookmarks.some((bookmark, index) => bookmarkId(bookmark, index) === id)
    ) {
      return
    }
    const collectedAt = now()
    const normalized = snapshotFromResult(
      result || { status: 'error' },
      new Date(collectedAt).toISOString(),
      createSnapshot
    )
    snapshots.set(id, {
      snapshot: normalized.snapshot,
      errorMessage: normalized.errorMessage,
      cachedAt: normalized.cacheable ? collectedAt : 0
    })
  }

  function collectTargets (targets) {
    const taskId = createTaskId()
    const token = { taskId, cancelled: false }
    const targetGenerations = new Map()
    for (const target of targets) {
      const id = bookmarkId(target)
      const generation = (generations.get(id) || 0) + 1
      generations.set(id, generation)
      targetGenerations.set(id, generation)
    }
    activeTasks.set(taskId, token)

    let request
    try {
      request = client.collect({
        bookmarks: targets,
        concurrency,
        taskId
      })
    } catch (error) {
      request = Promise.reject(error)
    }

    const operation = Promise.resolve(request)
      .then(response => {
        const results = Array.isArray(response?.results) ? response.results : []
        const byId = new Map(results
          .map(result => [resultTargetId(result), result])
          .filter(([id]) => id))
        targets.forEach(target => {
          const id = bookmarkId(target)
          applyCollectionResult(
            target,
            byId.get(id) || {
              status: 'error',
              error: { code: 'MISSING_RESULT' }
            },
            targetGenerations.get(id),
            token
          )
        })
      })
      .catch(() => {
        for (const target of targets) {
          const id = bookmarkId(target)
          applyCollectionResult(
            target,
            { status: 'error' },
            targetGenerations.get(id),
            token
          )
        }
      })
      .finally(() => {
        if (activeTasks.get(taskId) === token) activeTasks.delete(taskId)
        for (const target of targets) {
          const id = bookmarkId(target)
          const current = inFlight.get(id)
          if (current?.taskId === taskId &&
              current.generation === targetGenerations.get(id)) {
            inFlight.delete(id)
          }
        }
        notify()
      })

    for (const target of targets) {
      const id = bookmarkId(target)
      inFlight.set(id, {
        taskId,
        generation: targetGenerations.get(id),
        promise: operation
      })
    }
    notify()
    return operation
  }

  function refreshTargets (targets, force) {
    const waiting = []
    const pendingTargets = []
    for (const target of targets) {
      const id = bookmarkId(target)
      if (!force && isFresh(id)) continue
      const current = inFlight.get(id)
      if (!force && current) waiting.push(current.promise)
      else pendingTargets.push(target)
    }
    if (pendingTargets.length) waiting.push(collectTargets(pendingTargets))
    return waiting.length ? Promise.all(waiting) : Promise.resolve([])
  }

  function refreshAll ({ force = false } = {}) {
    syncSources()
    return refreshTargets(bookmarks, force)
  }

  function refreshOne (id, { force = false } = {}) {
    syncSources()
    const normalizedId = safeText(id)
    const target = bookmarks.find((bookmark, index) => (
      bookmarkId(bookmark, index) === normalizedId
    ))
    return target
      ? refreshTargets([target], force)
      : Promise.resolve([])
  }

  async function cancel () {
    const tasks = [...activeTasks.values()]
    if (!tasks.length) return []
    for (const token of tasks) token.cancelled = true
    activeTasks.clear()
    for (const [id, current] of inFlight) {
      generations.set(id, Math.max(
        generations.get(id) || 0,
        current.generation + 1
      ))
    }
    inFlight.clear()
    notify()
    return Promise.allSettled(tasks.map(token => client.cancel(token.taskId)))
  }

  function setFilters (updates = {}) {
    filters = {
      search: updates.search === undefined
        ? filters.search
        : safeText(updates.search),
      group: updates.group === undefined
        ? filters.group
        : (safeText(updates.group) || allFilter),
      status: updates.status === undefined
        ? filters.status
        : (safeText(updates.status) || allFilter)
    }
    notify()
    return { ...filters }
  }

  function toggleSelected (id) {
    const normalizedId = safeText(id)
    if (!bookmarks.some((bookmark, index) => bookmarkId(bookmark, index) === normalizedId)) {
      return false
    }
    if (selectedIds.has(normalizedId)) selectedIds.delete(normalizedId)
    else selectedIds.add(normalizedId)
    notify()
    return selectedIds.has(normalizedId)
  }

  function clearSelected () {
    if (!selectedIds.size) return false
    selectedIds.clear()
    notify()
    return true
  }

  function getSelectedRows () {
    return allRows().filter(row => selectedIds.has(row.id))
  }

  function subscribe (listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  stateSnapshot = buildState()

  return {
    refreshAll,
    refreshOne,
    cancel,
    setFilters,
    toggleSelected,
    clearSelected,
    getVisibleRows: visibleRows,
    getSelectedRows,
    getState: () => stateSnapshot,
    subscribe,
    setBookmarks: (nextBookmarks, nextGroups = bookmarkGroups) => (
      updateSources(nextBookmarks, nextGroups)
    )
  }
}
