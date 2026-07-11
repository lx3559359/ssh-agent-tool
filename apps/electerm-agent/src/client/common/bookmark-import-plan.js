import copy from 'json-deep-copy'

export const bookmarkImportStrategies = {
  keepLocal: 'keep-local',
  overwrite: 'overwrite',
  duplicate: 'duplicate'
}

function normalize (value) {
  if (Array.isArray(value)) {
    return value.map(normalize)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = normalize(value[key])
    return result
  }, {})
}

function sameValue (left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function connectionKey (bookmark = {}) {
  const host = String(bookmark.host || '').trim().toLowerCase()
  if (!host) return ''
  const port = Number(bookmark.port) || 22
  const username = String(bookmark.username || '').trim().toLowerCase()
  const type = String(bookmark.type || 'ssh').trim().toLowerCase()
  return `${type}|${host}|${port}|${username}`
}

function createIdGenerator (idFactory) {
  let index = 0
  return (prefix) => {
    index += 1
    return idFactory?.(prefix, index) || `${prefix}-import-${Date.now()}-${index}`
  }
}

function remapIds (values, mapping) {
  return [...new Set((values || []).map(id => mapping.get(id) || id))]
}

function createReport (strategy) {
  return {
    strategy,
    added: 0,
    updated: 0,
    skipped: 0,
    duplicated: 0,
    groupAdded: 0,
    groupUpdated: 0,
    groupSkipped: 0,
    groupDuplicated: 0,
    conflicts: []
  }
}

export function buildBookmarkImportPlan ({
  localBookmarks = [],
  localBookmarkGroups = [],
  incomingBookmarks = [],
  incomingBookmarkGroups = [],
  strategy = bookmarkImportStrategies.keepLocal,
  idFactory
} = {}) {
  const nextId = createIdGenerator(idFactory)
  const bookmarks = copy(localBookmarks)
  const bookmarkGroups = copy(localBookmarkGroups)
  const bookmarkById = new Map(bookmarks.map(item => [item.id, item]))
  const bookmarkByConnection = new Map(
    bookmarks.map(item => [connectionKey(item), item]).filter(([key]) => key)
  )
  const bookmarkIdMap = new Map()
  const report = createReport(strategy)

  for (const source of copy(incomingBookmarks)) {
    const byId = source.id ? bookmarkById.get(source.id) : null
    const key = connectionKey(source)
    const byConnection = key ? bookmarkByConnection.get(key) : null
    const existing = byId || byConnection
    const conflictType = byId
      ? (sameValue(byId, source) ? 'same-id-same-value' : 'same-id-different-value')
      : (byConnection ? 'same-connection-different-id' : '')

    if (!existing) {
      bookmarks.push(source)
      bookmarkById.set(source.id, source)
      if (key) bookmarkByConnection.set(key, source)
      bookmarkIdMap.set(source.id, source.id)
      report.added += 1
      continue
    }

    if (conflictType === 'same-id-same-value') {
      bookmarkIdMap.set(source.id, existing.id)
      report.skipped += 1
      continue
    }

    report.conflicts.push({
      kind: 'bookmark',
      type: conflictType,
      incomingId: source.id,
      localId: existing.id,
      title: source.title || source.host || source.id
    })

    if (strategy === bookmarkImportStrategies.keepLocal) {
      bookmarkIdMap.set(source.id, existing.id)
      report.skipped += 1
      continue
    }

    if (strategy === bookmarkImportStrategies.overwrite) {
      const replacement = { ...source, id: existing.id }
      const index = bookmarks.findIndex(item => item.id === existing.id)
      bookmarks[index] = replacement
      bookmarkById.set(existing.id, replacement)
      if (key) bookmarkByConnection.set(key, replacement)
      bookmarkIdMap.set(source.id, existing.id)
      report.updated += 1
      continue
    }

    const duplicate = { ...source, id: nextId('bookmark') }
    bookmarks.push(duplicate)
    bookmarkById.set(duplicate.id, duplicate)
    bookmarkIdMap.set(source.id, duplicate.id)
    report.duplicated += 1
  }

  const groupById = new Map(bookmarkGroups.map(item => [item.id, item]))
  const groupIdMap = new Map()
  for (const group of incomingBookmarkGroups) {
    const existing = groupById.get(group.id)
    if (!existing) {
      groupIdMap.set(group.id, group.id)
      continue
    }
    const same = sameValue(existing, group)
    if (same) {
      groupIdMap.set(group.id, existing.id)
      report.groupSkipped += 1
      continue
    }
    report.conflicts.push({
      kind: 'group',
      type: same ? 'same-id-same-value' : 'same-id-different-value',
      incomingId: group.id,
      localId: existing.id,
      title: group.title || group.id
    })
    if (strategy === bookmarkImportStrategies.keepLocal) {
      groupIdMap.set(group.id, existing.id)
      report.groupSkipped += 1
    } else if (strategy === bookmarkImportStrategies.overwrite) {
      groupIdMap.set(group.id, existing.id)
    } else {
      groupIdMap.set(group.id, nextId('group'))
    }
  }

  for (const source of copy(incomingBookmarkGroups)) {
    const mappedId = groupIdMap.get(source.id) || source.id
    const existing = groupById.get(mappedId)
    const remapped = {
      ...source,
      id: mappedId,
      bookmarkIds: remapIds(source.bookmarkIds, bookmarkIdMap),
      bookmarkGroupIds: remapIds(source.bookmarkGroupIds, groupIdMap)
    }

    if (!existing) {
      bookmarkGroups.push(remapped)
      groupById.set(mappedId, remapped)
      if (mappedId === source.id) {
        report.groupAdded += 1
      } else {
        report.groupDuplicated += 1
      }
      continue
    }
    if (strategy === bookmarkImportStrategies.overwrite && !sameValue(existing, remapped)) {
      const index = bookmarkGroups.findIndex(item => item.id === mappedId)
      bookmarkGroups[index] = remapped
      groupById.set(mappedId, remapped)
      report.groupUpdated += 1
    }
  }

  return {
    bookmarks,
    bookmarkGroups,
    report
  }
}

export function formatBookmarkImportReport (report = {}) {
  return [
    `新增连接 ${report.added || 0} 个`,
    `覆盖连接 ${report.updated || 0} 个`,
    `创建副本 ${report.duplicated || 0} 个`,
    `跳过连接 ${report.skipped || 0} 个`,
    `新增分组 ${report.groupAdded || 0} 个`,
    `覆盖分组 ${report.groupUpdated || 0} 个`,
    `分组副本 ${report.groupDuplicated || 0} 个`,
    `跳过分组 ${report.groupSkipped || 0} 个`
  ].join('，')
}
