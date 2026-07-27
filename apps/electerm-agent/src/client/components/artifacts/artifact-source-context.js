import { redactArtifactText } from './artifact-model.js'

export const ARTIFACT_CONTEXT_LIMITS = Object.freeze({
  terminal: 32 * 1024,
  excerpt: 32 * 1024,
  total: 92 * 1024
})

const SECRET_KEY = /(?:api[_-]?key|token|password|passwd|cookie|secret|private[_-]?key)/i
const MAX_GENERIC_TEXT = 4096
const MAX_EXCERPTS = 8
const MAX_FLEET_SERVERS = 200
const MAX_SAFETY_OPERATIONS = 100

function boundedText (value, limit = MAX_GENERIC_TEXT) {
  return redactArtifactText(String(value ?? '')).slice(0, limit)
}

function sanitizeValue (value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return boundedText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item => sanitizeValue(item, depth + 1))
  }
  if (typeof value !== 'object') return boundedText(value)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
  )
}

function provenanceFrom (input = {}) {
  return {
    server: boundedText(input.server, 160),
    capturedAt: boundedText(input.capturedAt, 80),
    traceId: boundedText(input.traceId, 160)
  }
}

function mergeProvenance (target, source = {}) {
  for (const key of ['server', 'capturedAt', 'traceId']) {
    if (!target[key] && source[key]) target[key] = source[key]
  }
}

function normalizeExcerpts (items, kind) {
  if (!Array.isArray(items)) return []
  return items.slice(0, MAX_EXCERPTS).map(item => ({
    kind,
    name: boundedText(item?.name, 512),
    content: boundedText(item?.content, ARTIFACT_CONTEXT_LIMITS.excerpt)
  }))
}

export function buildTerminalArtifactContext (input = {}) {
  return {
    provenance: provenanceFrom(input),
    terminal: {
      output: boundedText(input.output, ARTIFACT_CONTEXT_LIMITS.terminal)
    }
  }
}

export function buildDiagnosticArtifactContext (input = {}) {
  return {
    provenance: provenanceFrom(input),
    excerpts: [
      ...normalizeExcerpts(input.logs, 'log'),
      ...normalizeExcerpts(input.files, 'file')
    ].slice(0, MAX_EXCERPTS),
    diagnostics: sanitizeValue(input.diagnostics || input.result || {})
  }
}

export function buildFleetArtifactContext (input = {}) {
  return {
    provenance: provenanceFrom(input),
    fleet: {
      servers: sanitizeValue(
        Array.isArray(input.servers)
          ? input.servers.slice(0, MAX_FLEET_SERVERS)
          : []
      )
    }
  }
}

export function buildSafetyArtifactContext (input = {}) {
  const operations = Array.isArray(input.operations)
    ? input.operations.slice(0, MAX_SAFETY_OPERATIONS)
    : []
  return {
    provenance: provenanceFrom(input),
    safety: {
      operations: operations.map(operation => ({
        id: boundedText(operation?.id, 160),
        action: boundedText(operation?.action, 512),
        status: boundedText(operation?.status, 80),
        backupRef: boundedText(operation?.backupRef, 512),
        rollbackRef: boundedText(operation?.rollbackRef, 512),
        traceId: boundedText(operation?.traceId, 160)
      }))
    }
  }
}

function reduceContextSize (context) {
  const excerpts = context.excerpts || []
  const terminal = context.terminal
  const fleet = context.fleet?.servers || []
  const operations = context.safety?.operations || []

  while (JSON.stringify(context).length > ARTIFACT_CONTEXT_LIMITS.total) {
    const lastExcerpt = excerpts[excerpts.length - 1]
    if (lastExcerpt?.content?.length > 1024) {
      lastExcerpt.content = lastExcerpt.content.slice(0, Math.max(
        1024,
        lastExcerpt.content.length - 4096
      ))
      continue
    }
    if (excerpts.length > 1) {
      excerpts.pop()
      continue
    }
    if (terminal?.output?.length > 1024) {
      terminal.output = terminal.output.slice(0, Math.max(
        1024,
        terminal.output.length - 4096
      ))
      continue
    }
    if (fleet.length > 1) {
      fleet.pop()
      continue
    }
    if (operations.length > 1) {
      operations.pop()
      continue
    }
    if (context.diagnostics) {
      context.diagnostics = { truncated: true }
      continue
    }
    break
  }
  return context
}

export function mergeArtifactContexts (...contexts) {
  const merged = {
    provenance: { server: '', capturedAt: '', traceId: '' },
    excerpts: []
  }
  for (const rawContext of contexts.flat()) {
    if (!rawContext || typeof rawContext !== 'object') continue
    const context = sanitizeValue(rawContext)
    mergeProvenance(merged.provenance, context.provenance)
    if (context.terminal) merged.terminal = context.terminal
    if (Array.isArray(context.excerpts)) merged.excerpts.push(...context.excerpts)
    if (context.diagnostics) merged.diagnostics = context.diagnostics
    if (context.fleet) merged.fleet = context.fleet
    if (context.safety) merged.safety = context.safety
  }
  merged.excerpts = merged.excerpts.slice(0, MAX_EXCERPTS)
  return reduceContextSize(merged)
}
