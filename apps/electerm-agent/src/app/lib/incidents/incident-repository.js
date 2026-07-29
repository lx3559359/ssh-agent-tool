const crypto = require('node:crypto')
const {
  createIncidentRecord,
  createIncidentPatch,
  validateTransition,
  incidentError
} = require('./incident-model')

const PAGE_SIZES = new Set([20, 40, 80])
const SEARCH_NOTE_LIMIT = 200
const SEARCH_NOTE_BYTES = 1024 * 1024

function parseJsonArray (value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapIncident (row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    endpointRef: row.endpoint_ref,
    sessionRefs: parseJsonArray(row.session_refs_json),
    state: row.state,
    severity: row.severity,
    serviceTags: parseJsonArray(row.service_tags_json),
    customTags: parseJsonArray(row.custom_tags_json),
    summary: row.summary,
    rootCause: row.root_cause,
    resolution: row.resolution,
    verificationStatus: row.verification_status,
    storagePolicy: row.storage_policy,
    isPinned: Boolean(row.is_pinned),
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    archivedAt: row.archived_at
  }
}

function mapNote (row) {
  return {
    id: row.id,
    incidentId: row.incident_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapStateEvent (row) {
  return {
    id: row.id,
    incidentId: row.incident_id,
    fromState: row.from_state,
    toState: row.to_state,
    verificationStatus: row.verification_status,
    actor: row.actor,
    createdAt: row.created_at
  }
}

function toFtsQuery (value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map(token => `"${token.replaceAll('"', '""')}"*`)
    .join(' AND ')
}

function buildListQuery (filters) {
  const joins = []
  const where = []
  const params = {}
  const fts = toFtsQuery(filters.query)
  if (fts) {
    joins.push('JOIN incident_search ON incident_search.incident_id = i.id')
    where.push('incident_search MATCH $query')
    params.$query = fts
  }
  if (filters.endpointRef) {
    where.push('i.endpoint_ref = $endpointRef')
    params.$endpointRef = filters.endpointRef
  }
  if (filters.state?.length) {
    const names = filters.state.map((_, index) => `$state${index}`)
    where.push(`i.state IN (${names.join(', ')})`)
    filters.state.forEach((state, index) => {
      params[`$state${index}`] = state
    })
  }
  if (filters.severity?.length) {
    const names = filters.severity.map((_, index) => `$severity${index}`)
    where.push(`i.severity IN (${names.join(', ')})`)
    filters.severity.forEach((severity, index) => {
      params[`$severity${index}`] = severity
    })
  }
  if (filters.serviceTags?.length) {
    const names = filters.serviceTags.map((_, index) => `$serviceTag${index}`)
    where.push(`
      EXISTS (
        SELECT 1 FROM json_each(i.service_tags_json)
        WHERE value IN (${names.join(', ')})
      )
    `)
    filters.serviceTags.forEach((tag, index) => {
      params[`$serviceTag${index}`] = tag
    })
  }
  if (filters.customTags?.length) {
    const names = filters.customTags.map((_, index) => `$customTag${index}`)
    where.push(`
      EXISTS (
        SELECT 1 FROM json_each(i.custom_tags_json)
        WHERE value IN (${names.join(', ')})
      )
    `)
    filters.customTags.forEach((tag, index) => {
      params[`$customTag${index}`] = tag
    })
  }
  if (Number.isFinite(filters.updatedFrom)) {
    where.push('i.updated_at >= $updatedFrom')
    params.$updatedFrom = filters.updatedFrom
  }
  if (Number.isFinite(filters.updatedTo)) {
    where.push('i.updated_at <= $updatedTo')
    params.$updatedTo = filters.updatedTo
  }
  if (filters.favoriteOnly) {
    where.push('i.is_favorite = 1')
  }
  return {
    joins: joins.join(' '),
    where: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  }
}

function createIncidentRepository ({
  getDatabase,
  now = Date.now,
  createId = () => crypto.randomUUID()
}) {
  const db = () => getDatabase()

  function transaction (action) {
    const database = db()
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = action(database)
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function requireIncidentRow (database, id) {
    const row = database.prepare(
      'SELECT * FROM incidents WHERE id = ?'
    ).get(id)
    if (!row) {
      throw incidentError('INCIDENT_NOT_FOUND', `Incident not found: ${id}`)
    }
    return row
  }

  function refreshSearchIndex (database, incidentId) {
    const incident = requireIncidentRow(database, incidentId)
    const noteRows = database.prepare(`
      SELECT body FROM incident_notes
      WHERE incident_id = ?
      ORDER BY created_at DESC
      LIMIT ${SEARCH_NOTE_LIMIT}
    `).all(incidentId)
    let noteText = ''
    for (const row of noteRows.reverse()) {
      const next = noteText ? `${noteText}\n${row.body}` : row.body
      if (Buffer.byteLength(next, 'utf8') > SEARCH_NOTE_BYTES) break
      noteText = next
    }
    database.prepare(
      'DELETE FROM incident_search WHERE incident_id = ?'
    ).run(incidentId)
    database.prepare(`
      INSERT INTO incident_search (
        incident_id, title, summary, root_cause, resolution,
        service_tags, custom_tags, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incident.id,
      incident.title,
      incident.summary,
      incident.root_cause,
      incident.resolution,
      parseJsonArray(incident.service_tags_json).join(' '),
      parseJsonArray(incident.custom_tags_json).join(' '),
      noteText
    )
  }

  function create (draft) {
    const record = createIncidentRecord(draft, {
      id: createId(),
      now: now()
    })
    return transaction(database => {
      database.prepare(`
        INSERT INTO incidents (
          id, title, endpoint_ref, session_refs_json, state, severity,
          service_tags_json, custom_tags_json, summary, root_cause,
          resolution, verification_status, storage_policy, is_pinned,
          is_favorite, created_at, updated_at, resolved_at, archived_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        record.id,
        record.title,
        record.endpointRef,
        JSON.stringify(record.sessionRefs),
        record.state,
        record.severity,
        JSON.stringify(record.serviceTags),
        JSON.stringify(record.customTags),
        record.summary,
        record.rootCause,
        record.resolution,
        record.verificationStatus,
        record.storagePolicy,
        Number(record.isPinned),
        Number(record.isFavorite),
        record.createdAt,
        record.updatedAt,
        record.resolvedAt,
        record.archivedAt
      )
      database.prepare(`
        INSERT INTO incident_state_events (
          id, incident_id, from_state, to_state,
          verification_status, actor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        createId(),
        record.id,
        null,
        record.state,
        record.verificationStatus,
        'user',
        record.createdAt
      )
      refreshSearchIndex(database, record.id)
      return record
    })
  }

  function get (id) {
    const database = db()
    const incident = mapIncident(requireIncidentRow(database, id))
    const notes = database.prepare(`
      SELECT * FROM incident_notes
      WHERE incident_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(id).map(mapNote)
    const stateEvents = database.prepare(`
      SELECT * FROM incident_state_events
      WHERE incident_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(id).map(mapStateEvent)
    return {
      ...incident,
      notes,
      stateEvents
    }
  }

  const COLUMN_BY_FIELD = Object.freeze({
    title: 'title',
    endpointRef: 'endpoint_ref',
    sessionRefs: 'session_refs_json',
    severity: 'severity',
    serviceTags: 'service_tags_json',
    customTags: 'custom_tags_json',
    summary: 'summary',
    rootCause: 'root_cause',
    resolution: 'resolution',
    storagePolicy: 'storage_policy',
    isPinned: 'is_pinned',
    isFavorite: 'is_favorite'
  })

  function toDatabaseValue (field, value) {
    if (['sessionRefs', 'serviceTags', 'customTags'].includes(field)) {
      return JSON.stringify(value)
    }
    if (['isPinned', 'isFavorite'].includes(field)) {
      return Number(value)
    }
    return value
  }

  function update (id, patch) {
    const normalized = createIncidentPatch(patch)
    const entries = Object.entries(normalized)
    if (!entries.length) return get(id)
    const updatedAt = now()
    transaction(database => {
      requireIncidentRow(database, id)
      const assignments = entries.map(
        ([field], index) => `${COLUMN_BY_FIELD[field]} = $value${index}`
      )
      const params = {
        $id: id,
        $updatedAt: updatedAt
      }
      entries.forEach(([field, value], index) => {
        params[`$value${index}`] = toDatabaseValue(field, value)
      })
      database.prepare(`
        UPDATE incidents
        SET ${assignments.join(', ')}, updated_at = $updatedAt
        WHERE id = $id
      `).run(params)
      refreshSearchIndex(database, id)
    })
    return get(id)
  }

  function transition (id, input) {
    const changedAt = now()
    transaction(database => {
      const current = requireIncidentRow(database, id)
      const next = validateTransition(
        current.state,
        input,
        current.verification_status
      )
      const resolvedAt = next.state === 'resolved'
        ? changedAt
        : next.state === 'investigating'
          ? null
          : current.resolved_at
      const archivedAt = next.state === 'archived' ? changedAt : null
      database.prepare(`
        UPDATE incidents
        SET state = ?, verification_status = ?, updated_at = ?,
            resolved_at = ?, archived_at = ?
        WHERE id = ?
      `).run(
        next.state,
        next.verificationStatus,
        changedAt,
        resolvedAt,
        archivedAt,
        id
      )
      database.prepare(`
        INSERT INTO incident_state_events (
          id, incident_id, from_state, to_state,
          verification_status, actor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        createId(),
        id,
        current.state,
        next.state,
        next.verificationStatus,
        String(input.actor || 'user').trim().slice(0, 128) || 'user',
        changedAt
      )
      refreshSearchIndex(database, id)
    })
    return get(id)
  }

  function normalizeNoteBody (body) {
    const value = String(body || '').trim()
    if (!value || value.length > 20000) {
      throw incidentError(
        'INCIDENT_VALIDATION_FAILED',
        'Incident note must contain between 1 and 20000 characters.'
      )
    }
    return value
  }

  function addNote (incidentId, body) {
    const note = {
      id: createId(),
      incidentId,
      body: normalizeNoteBody(body),
      createdAt: now()
    }
    note.updatedAt = note.createdAt
    transaction(database => {
      requireIncidentRow(database, incidentId)
      database.prepare(`
        INSERT INTO incident_notes (
          id, incident_id, body, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        note.id,
        note.incidentId,
        note.body,
        note.createdAt,
        note.updatedAt
      )
      database.prepare(
        'UPDATE incidents SET updated_at = ? WHERE id = ?'
      ).run(note.updatedAt, incidentId)
      refreshSearchIndex(database, incidentId)
    })
    return note
  }

  function deleteNote (incidentId, noteId) {
    transaction(database => {
      requireIncidentRow(database, incidentId)
      const result = database.prepare(`
        DELETE FROM incident_notes
        WHERE id = ? AND incident_id = ?
      `).run(noteId, incidentId)
      if (!result.changes) {
        throw incidentError('INCIDENT_NOTE_NOT_FOUND', `Incident note not found: ${noteId}`)
      }
      database.prepare(
        'UPDATE incidents SET updated_at = ? WHERE id = ?'
      ).run(now(), incidentId)
      refreshSearchIndex(database, incidentId)
    })
    return { deleted: true, noteId }
  }

  function normalizeFilters (filters = {}) {
    const pageSize = PAGE_SIZES.has(Number(filters.pageSize))
      ? Number(filters.pageSize)
      : 40
    return {
      ...filters,
      page: Math.max(1, Math.floor(Number(filters.page) || 1)),
      pageSize,
      state: Array.isArray(filters.state) ? filters.state.slice(0, 10) : [],
      severity: Array.isArray(filters.severity) ? filters.severity.slice(0, 10) : [],
      serviceTags: Array.isArray(filters.serviceTags) ? filters.serviceTags.slice(0, 30) : [],
      customTags: Array.isArray(filters.customTags) ? filters.customTags.slice(0, 30) : []
    }
  }

  function executeList (filters) {
    const normalized = normalizeFilters(filters)
    const { joins, where, params } = buildListQuery(normalized)
    const offset = (normalized.page - 1) * normalized.pageSize
    const database = db()
    const total = database.prepare(`
      SELECT COUNT(DISTINCT i.id) AS total
      FROM incidents i ${joins} ${where}
    `).get(params).total
    const rows = database.prepare(`
      SELECT i.*
      FROM incidents i ${joins} ${where}
      ORDER BY i.is_pinned DESC, i.updated_at DESC, i.id ASC
      LIMIT $limit OFFSET $offset
    `).all({
      ...params,
      $limit: normalized.pageSize,
      $offset: offset
    })
    return {
      items: rows.map(mapIncident),
      total,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages: Math.max(1, Math.ceil(total / normalized.pageSize))
    }
  }

  function isSearchIndexError (error) {
    return /fts5|incident_search|malformed|database disk image is malformed/i.test(
      String(error?.message || '')
    )
  }

  function list (filters, retried = false) {
    try {
      return executeList(filters)
    } catch (error) {
      if (!isSearchIndexError(error)) throw error
      if (retried) {
        const wrapped = incidentError(
          'INCIDENT_SEARCH_INDEX_CORRUPT',
          'Incident search index could not be repaired.'
        )
        wrapped.cause = error
        throw wrapped
      }
      try {
        ensureSearchIndex()
      } catch (repairError) {
        const wrapped = incidentError(
          'INCIDENT_SEARCH_INDEX_CORRUPT',
          'Incident search index could not be repaired.'
        )
        wrapped.cause = repairError
        throw wrapped
      }
      return list(filters, true)
    }
  }

  function ensureSearchIndex () {
    return transaction(database => {
      database.exec('DELETE FROM incident_search')
      let offset = 0
      let rebuilt = 0
      while (true) {
        const rows = database.prepare(`
          SELECT id FROM incidents
          ORDER BY id ASC
          LIMIT 200 OFFSET ?
        `).all(offset)
        if (!rows.length) break
        for (const row of rows) {
          refreshSearchIndex(database, row.id)
          rebuilt += 1
        }
        offset += rows.length
      }
      return rebuilt
    })
  }

  function startOfCurrentWeek () {
    const date = new Date(now())
    const day = date.getDay() || 7
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - day + 1)
    return date.getTime()
  }

  function summary () {
    const database = db()
    const terminalStates = "('resolved', 'archived', 'false_positive')"
    const unresolvedCount = database.prepare(`
      SELECT COUNT(*) AS total FROM incidents
      WHERE state NOT IN ${terminalStates}
    `).get().total
    const handledThisWeek = database.prepare(`
      SELECT COUNT(*) AS total FROM incidents
      WHERE state IN ('resolved', 'unresolved', 'false_positive')
        AND updated_at >= ?
    `).get(startOfCurrentWeek()).total
    const recentUnresolved = database.prepare(`
      SELECT * FROM incidents
      WHERE state NOT IN ${terminalStates}
      ORDER BY is_pinned DESC, updated_at DESC, id ASC
      LIMIT 3
    `).all().map(mapIncident)
    return {
      unresolvedCount,
      handledThisWeek,
      recentUnresolved
    }
  }

  try {
    const database = db()
    const incidentCount = database.prepare(
      'SELECT COUNT(*) AS total FROM incidents'
    ).get().total
    const searchCount = database.prepare(
      'SELECT COUNT(*) AS total FROM incident_search'
    ).get().total
    if (incidentCount !== searchCount) ensureSearchIndex()
  } catch (error) {
    if (!isSearchIndexError(error)) throw error
    ensureSearchIndex()
  }

  return Object.freeze({
    create,
    get,
    update,
    transition,
    addNote,
    deleteNote,
    list,
    summary,
    ensureSearchIndex
  })
}

module.exports = {
  createIncidentRepository,
  toFtsQuery,
  buildListQuery
}
