const INCIDENT_STATES = Object.freeze({
  investigating: 'investigating',
  waitingAction: 'waiting_action',
  verifying: 'verifying',
  resolved: 'resolved',
  unresolved: 'unresolved',
  archived: 'archived',
  falsePositive: 'false_positive'
})

const TRANSITIONS = Object.freeze({
  investigating: new Set(['waiting_action', 'verifying', 'unresolved', 'false_positive']),
  waiting_action: new Set(['investigating', 'verifying', 'unresolved']),
  verifying: new Set(['investigating', 'resolved', 'unresolved', 'false_positive']),
  resolved: new Set(['archived', 'investigating']),
  unresolved: new Set(['archived', 'investigating']),
  false_positive: new Set(['archived', 'investigating']),
  archived: new Set(['investigating'])
})

const EDITABLE_FIELDS = new Set([
  'title',
  'endpointRef',
  'sessionRefs',
  'severity',
  'serviceTags',
  'customTags',
  'summary',
  'rootCause',
  'resolution',
  'storagePolicy',
  'isPinned',
  'isFavorite'
])

const CREATE_FIELDS = new Set([
  ...EDITABLE_FIELDS
])

const SENSITIVE_KEYS = /password|passphrase|private[_-]?key|api[_-]?key|token|cookie|authorization/i
const INCIDENT_CANDIDATE_STATUSES = Object.freeze({
  pending: 'pending',
  dismissed: 'dismissed',
  converted: 'converted'
})
const CANDIDATE_SOURCES = Object.freeze([
  'fleet-status',
  'operations',
  'safety-operation',
  'ai-diagnostic',
  'manual'
])
const TIMELINE_KINDS = Object.freeze([
  'candidate',
  'diagnostic',
  'command',
  'backup',
  'change',
  'rollback',
  'verification',
  'artifact',
  'note'
])
const TIMELINE_SOURCES = Object.freeze([
  ...CANDIDATE_SOURCES,
  'incident',
  'artifact'
])
const MAX_CONTEXT_BYTES = 64 * 1024

function incidentError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function boundedText (value, field, max, required = false) {
  const text = String(value ?? '').trim()
  if (required && !text) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} is required.`)
  }
  if (text.length > max) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} exceeds ${max} characters.`)
  }
  return text
}

function assertSafeKeys (value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key)) {
      throw incidentError('INCIDENT_SENSITIVE_FIELD', `Sensitive field is not allowed: ${path}${key}`)
    }
    assertSafeKeys(child, `${path}${key}.`)
  }
}

function uniqueTags (value, field) {
  if (!Array.isArray(value)) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} must be an array.`)
  }
  return [...new Set(value.map(item => boundedText(item, field, 64)).filter(Boolean))].slice(0, 30)
}

function boundedEnum (value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} is required.`)
  }
  if (!allowed.includes(value)) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} is invalid.`)
  }
  return value
}

function assertAllowedFields (value, allowed) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) {
      throw incidentError('INCIDENT_FIELD_READONLY', `Field cannot be edited: ${key}`)
    }
  }
}

function boundedJsonObject (value, field) {
  const input = value === undefined || value === null ? {} : value
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} must be an object.`)
  }
  assertSafeKeys(input)
  let serialized
  try {
    serialized = JSON.stringify(input)
  } catch {
    throw incidentError('INCIDENT_VALIDATION_FAILED', `${field} must be JSON serializable.`)
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTEXT_BYTES) {
    throw incidentError(
      'INCIDENT_VALIDATION_FAILED',
      `${field} exceeds ${MAX_CONTEXT_BYTES} bytes.`
    )
  }
  return JSON.parse(serialized)
}

function createIncidentCandidate (draft, options) {
  assertSafeKeys(draft)
  const now = Number(options.now)
  return {
    id: boundedText(options.id, 'id', 128, true),
    fingerprint: boundedText(draft.fingerprint, 'fingerprint', 256, true),
    source: boundedEnum(
      draft.source,
      'source',
      CANDIDATE_SOURCES,
      'manual'
    ),
    sourceRef: boundedText(draft.sourceRef, 'sourceRef', 256),
    endpointRef: boundedText(draft.endpointRef, 'endpointRef', 128),
    title: boundedText(draft.title, 'title', 200, true),
    severity: boundedEnum(
      draft.severity,
      'severity',
      ['low', 'medium', 'high', 'critical'],
      'medium'
    ),
    summary: boundedText(draft.summary, 'summary', 20000),
    evidence: boundedJsonObject(draft.evidence, 'evidence'),
    status: INCIDENT_CANDIDATE_STATUSES.pending,
    incidentId: '',
    firstSeenAt: now,
    lastSeenAt: now,
    occurrenceCount: 1,
    createdAt: now,
    updatedAt: now
  }
}

function createIncidentTimelineEvent (draft, options) {
  assertSafeKeys(draft)
  return {
    id: boundedText(options.id, 'id', 128, true),
    incidentId: boundedText(options.incidentId, 'incidentId', 128, true),
    kind: boundedEnum(draft.kind, 'kind', TIMELINE_KINDS, 'note'),
    source: boundedEnum(draft.source, 'source', TIMELINE_SOURCES, 'manual'),
    sourceRef: boundedText(draft.sourceRef, 'sourceRef', 256),
    title: boundedText(draft.title, 'title', 200, true),
    body: boundedText(draft.body, 'body', 20000),
    metadata: boundedJsonObject(draft.metadata, 'metadata'),
    createdAt: Number(options.now)
  }
}

function createIncidentRecord (draft, options) {
  assertSafeKeys(draft)
  assertAllowedFields(draft, CREATE_FIELDS)
  const now = Number(options.now)
  const id = boundedText(options.id, 'id', 128, true)
  return {
    id,
    title: boundedText(draft.title, 'title', 200, true),
    endpointRef: boundedText(draft.endpointRef, 'endpointRef', 128),
    sessionRefs: uniqueTags(draft.sessionRefs || [], 'sessionRefs'),
    state: INCIDENT_STATES.investigating,
    severity: boundedEnum(
      draft.severity,
      'severity',
      ['low', 'medium', 'high', 'critical'],
      'medium'
    ),
    serviceTags: uniqueTags(draft.serviceTags || [], 'serviceTags'),
    customTags: uniqueTags(draft.customTags || [], 'customTags'),
    summary: boundedText(draft.summary, 'summary', 20000),
    rootCause: boundedText(draft.rootCause, 'rootCause', 20000),
    resolution: boundedText(draft.resolution, 'resolution', 20000),
    verificationStatus: 'pending',
    storagePolicy: boundedEnum(
      draft.storagePolicy,
      'storagePolicy',
      ['light', 'standard', 'full'],
      'standard'
    ),
    isPinned: Boolean(draft.isPinned),
    isFavorite: Boolean(draft.isFavorite),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    archivedAt: null
  }
}

function createIncidentPatch (patch) {
  assertSafeKeys(patch)
  assertAllowedFields(patch, EDITABLE_FIELDS)
  const normalized = {}
  if ('title' in patch) normalized.title = boundedText(patch.title, 'title', 200, true)
  if ('endpointRef' in patch) normalized.endpointRef = boundedText(patch.endpointRef, 'endpointRef', 128)
  if ('sessionRefs' in patch) normalized.sessionRefs = uniqueTags(patch.sessionRefs, 'sessionRefs')
  if ('serviceTags' in patch) normalized.serviceTags = uniqueTags(patch.serviceTags, 'serviceTags')
  if ('customTags' in patch) normalized.customTags = uniqueTags(patch.customTags, 'customTags')
  if ('summary' in patch) normalized.summary = boundedText(patch.summary, 'summary', 20000)
  if ('rootCause' in patch) normalized.rootCause = boundedText(patch.rootCause, 'rootCause', 20000)
  if ('resolution' in patch) normalized.resolution = boundedText(patch.resolution, 'resolution', 20000)
  if ('severity' in patch) {
    normalized.severity = boundedEnum(
      patch.severity,
      'severity',
      ['low', 'medium', 'high', 'critical']
    )
  }
  if ('storagePolicy' in patch) {
    normalized.storagePolicy = boundedEnum(
      patch.storagePolicy,
      'storagePolicy',
      ['light', 'standard', 'full']
    )
  }
  if ('isPinned' in patch) normalized.isPinned = Boolean(patch.isPinned)
  if ('isFavorite' in patch) normalized.isFavorite = Boolean(patch.isFavorite)
  return normalized
}

function validateTransition (
  currentState,
  input,
  currentVerificationStatus = 'pending'
) {
  const nextState = boundedText(input.state, 'state', 32, true)
  if (!TRANSITIONS[currentState]?.has(nextState)) {
    throw incidentError('INCIDENT_TRANSITION_INVALID', `${currentState} cannot transition to ${nextState}.`)
  }
  if (nextState === INCIDENT_STATES.archived) {
    return {
      state: nextState,
      verificationStatus: boundedEnum(
        currentVerificationStatus,
        'verificationStatus',
        ['pending', 'mitigated', 'passed_manual', 'passed_auto'],
        'pending'
      )
    }
  }
  if (nextState === INCIDENT_STATES.resolved) {
    if (!['passed_manual', 'passed_auto'].includes(input.verificationStatus)) {
      throw incidentError(
        'INCIDENT_VERIFICATION_REQUIRED',
        'Resolved incidents require a passed verification.'
      )
    }
    const verificationStatus = boundedEnum(
      input.verificationStatus,
      'verificationStatus',
      ['passed_manual', 'passed_auto']
    )
    return { state: nextState, verificationStatus }
  }
  if (nextState === INCIDENT_STATES.unresolved) {
    const verificationStatus = boundedEnum(
      input.verificationStatus,
      'verificationStatus',
      ['pending', 'mitigated'],
      'pending'
    )
    return { state: nextState, verificationStatus }
  }
  return { state: nextState, verificationStatus: 'pending' }
}

module.exports = {
  INCIDENT_STATES,
  INCIDENT_CANDIDATE_STATUSES,
  TRANSITIONS,
  createIncidentRecord,
  createIncidentPatch,
  createIncidentCandidate,
  createIncidentTimelineEvent,
  validateTransition,
  incidentError
}
