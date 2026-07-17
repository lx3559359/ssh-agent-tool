const inventoryTypes = Object.freeze(['service', 'container', 'process'])
const inventoryStates = Object.freeze([
  'running',
  'stopped',
  'failed',
  'starting',
  'restarting',
  'paused',
  'unknown'
])
const inventoryAutostartStates = Object.freeze([
  'enabled',
  'disabled',
  'static',
  'masked',
  'unknown'
])
const inventorySources = Object.freeze([
  'systemd',
  'openrc',
  'sysv',
  'docker',
  'compose',
  'supervisor',
  'pm2'
])

const typeSet = new Set(inventoryTypes)
const stateSet = new Set(inventoryStates)
const autostartSet = new Set(inventoryAutostartStates)
const sourceSet = new Set(inventorySources)
const sourceRank = new Map(inventorySources.map((source, index) => [source, index]))
const groupRank = new Map([
  ['system', 0],
  ['container', 1],
  ['process-manager', 2]
])
const sourceType = Object.freeze({
  systemd: 'service',
  openrc: 'service',
  sysv: 'service',
  docker: 'container',
  compose: 'container',
  supervisor: 'process',
  pm2: 'process'
})
const KiB = 1024
const FLEET_SERVICE_INVENTORY_MAX_ITEMS = 256
const FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES = 96 * KiB
const FLEET_SERVICE_INVENTORY_MAX_ITEM_BYTES = 64 * KiB
const collectorOutputTruncationMarker = '[ShellPilot output truncated]'
const outputTruncatedErrorCode = 'OUTPUT_TRUNCATED'

function stripControlCharacters (value) {
  return [...String(value)].map(character => {
    const code = character.codePointAt(0)
    return code <= 31 || code === 127 ? ' ' : character
  }).join('')
}

function cleanText (value, maxLength = 512) {
  return stripControlCharacters(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function groupForType (type) {
  if (type === 'service') return 'system'
  if (type === 'container') return 'container'
  return 'process-manager'
}

function normalizeInventoryState (value) {
  const state = cleanText(value, 128).toLowerCase()
  if (!state) return 'unknown'
  if (stateSet.has(state)) return state
  if (/\bpaused?\b/.test(state)) return 'paused'
  if (/\b(?:restarting|restart|backoff|waiting restart)\b/.test(state)) {
    return 'restarting'
  }
  if (/\b(?:failed|fatal|crashed|errored|unhealthy)\b/.test(state)) {
    return 'failed'
  }
  if (/\bexited\s*\([1-9]\d*\)/.test(state)) return 'failed'
  if (/\b(?:running|active|online|started|up)\b/.test(state)) {
    return 'running'
  }
  if (/\b(?:activating|starting|launching)\b/.test(state)) return 'starting'
  if (/\b(?:stopped|inactive|dead|exited|offline|down|created|stopping)\b/.test(state)) {
    return 'stopped'
  }
  return 'unknown'
}

function normalizeAutostart (value) {
  const state = cleanText(value, 64).toLowerCase()
  if (autostartSet.has(state)) return state
  if (/^(?:enabled-runtime|linked|linked-runtime|always|unless-stopped|on-failure)$/.test(state)) {
    return 'enabled'
  }
  if (/^(?:no|none|off)$/.test(state)) return 'disabled'
  if (/^(?:indirect|generated|transient)$/.test(state)) return 'static'
  return 'unknown'
}

function normalizeItem (value) {
  if (!value || typeof value !== 'object') return null
  const source = cleanText(value.source, 32).toLowerCase()
  const type = cleanText(value.type, 32).toLowerCase()
  const name = cleanText(value.name, 256)
  if (
    !sourceSet.has(source) ||
    !typeSet.has(type) ||
    sourceType[source] !== type ||
    !name
  ) {
    return null
  }
  const item = {
    id: `${source}:${name}`,
    name,
    type,
    group: groupForType(type),
    state: normalizeInventoryState(value.state),
    autostart: normalizeAutostart(value.autostart),
    description: cleanText(value.description),
    source
  }
  const sourceState = cleanText(value.sourceState, 128)
  if (sourceState) item.sourceState = sourceState
  return item
}

function compareText (left, right) {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a < b) return -1
  if (a > b) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function isBetterDuplicate (candidate, current) {
  const candidateRank = sourceRank.get(candidate.source)
  const currentRank = sourceRank.get(current.source)
  if (candidateRank !== currentRank) return candidateRank < currentRank
  const candidateScore = Number(candidate.state !== 'unknown') +
    Number(candidate.autostart !== 'unknown') +
    Number(Boolean(candidate.description))
  const currentScore = Number(current.state !== 'unknown') +
    Number(current.autostart !== 'unknown') +
    Number(Boolean(current.description))
  if (candidateScore !== currentScore) return candidateScore > currentScore
  return JSON.stringify(candidate) < JSON.stringify(current)
}

function normalizeServiceInventoryResult (values = []) {
  const deduplicated = new Map()
  for (const value of values || []) {
    const item = normalizeItem(value)
    if (!item) continue
    const key = `${item.type}\0${item.name.toLowerCase()}`
    const current = deduplicated.get(key)
    if (!current || isBetterDuplicate(item, current)) {
      deduplicated.set(key, item)
    }
  }
  const sorted = [...deduplicated.values()].sort((left, right) => {
    const groupDifference = groupRank.get(left.group) - groupRank.get(right.group)
    if (groupDifference) return groupDifference
    const nameDifference = compareText(left.name, right.name)
    if (nameDifference) return nameDifference
    return sourceRank.get(left.source) - sourceRank.get(right.source)
  })
  const items = []
  let serializedBytes = 2
  for (const item of sorted) {
    if (items.length >= FLEET_SERVICE_INVENTORY_MAX_ITEMS) break
    const itemBytes = Buffer.byteLength(JSON.stringify(item))
    const separatorBytes = items.length ? 1 : 0
    if (
      serializedBytes + separatorBytes + itemBytes >
      FLEET_SERVICE_INVENTORY_MAX_ITEM_BYTES
    ) {
      break
    }
    items.push(item)
    serializedBytes += separatorBytes + itemBytes
  }
  return {
    items,
    truncated: items.length < sorted.length
  }
}

function normalizeServiceInventory (values = []) {
  return normalizeServiceInventoryResult(values).items
}

function parseSections (output = '') {
  const sections = new Map()
  const markers = new Set()
  let current = ''
  let truncated = false
  for (const line of String(output).replace(/\r/g, '').split('\n')) {
    if (line === collectorOutputTruncationMarker) {
      truncated = true
      if (current) sections.get(current)?.pop()
      current = ''
      continue
    }
    const marker = line.match(/^__([A-Z0-9_]+)__$/)
    if (marker) {
      current = marker[1]
      markers.add(current)
      if (!sections.has(current)) sections.set(current, [])
    } else if (current) {
      sections.get(current).push(line)
    }
  }
  return { sections, markers, truncated }
}

function safeSourceError (source, category) {
  const messages = {
    timeout: 'Service inventory source timed out',
    permission: 'Service inventory source permission denied',
    unsupported: 'Service inventory source unavailable',
    partial: 'Service inventory output was truncated',
    unknown: 'Service inventory source failed'
  }
  const safeCategory = messages[category] ? category : 'unknown'
  return {
    ...(source ? { source } : {}),
    ...(safeCategory === 'partial' ? { code: outputTruncatedErrorCode } : {}),
    category: safeCategory,
    message: messages[safeCategory]
  }
}

function markerErrors (markers, definitions) {
  const errors = []
  const seen = new Set()
  for (const [marker, source, category] of definitions) {
    if (!markers.has(marker)) continue
    const key = `${source || ''}\0${category}`
    if (seen.has(key)) continue
    seen.add(key)
    errors.push(safeSourceError(source, category))
  }
  return errors
}

function appendOutputTruncatedError (errors) {
  if (!errors.some(error => error.code === outputTruncatedErrorCode)) {
    errors.push(safeSourceError(null, 'partial'))
  }
}

function parseSystemd (sections) {
  const unitFiles = new Map()
  for (const line of sections.get('SYSTEMD_UNIT_FILES') || []) {
    const match = line.trim().match(/^(\S+\.service)\s+(\S+)/i)
    if (!match) continue
    unitFiles.set(match[1], {
      autostart: normalizeAutostart(match[2]),
      sourceState: cleanText(match[2], 128).toLowerCase()
    })
  }
  const items = []
  const loadedNames = new Set()
  for (const line of sections.get('SYSTEMD_UNITS') || []) {
    const text = line.trim().replace(/^\u25cf\s+/, '')
    const match = text.match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/i)
    if (!match) continue
    const sourceState = `${match[3]}/${match[4]}`
    items.push({
      name: match[1],
      type: 'service',
      state: sourceState,
      autostart: unitFiles.get(match[1])?.autostart || 'unknown',
      description: match[5] || '',
      source: 'systemd',
      sourceState
    })
    loadedNames.add(match[1])
  }
  for (const [name, unitFile] of unitFiles) {
    if (loadedNames.has(name)) continue
    items.push({
      name,
      type: 'service',
      state: 'unknown',
      autostart: unitFile.autostart,
      description: '',
      source: 'systemd',
      sourceState: `unit-file/${unitFile.sourceState}`
    })
  }
  return items
}

function parseOpenRc (sections, markers) {
  const autostart = new Map()
  for (const line of sections.get('OPENRC_AUTOSTART') || []) {
    const match = line.trim().match(/^(\S+)\s+\|\s*(.*)$/)
    if (!match) continue
    autostart.set(match[1], match[2].trim() ? 'enabled' : 'disabled')
  }
  const hasAutostart = markers.has('OPENRC_AUTOSTART')
  const items = []
  for (const line of sections.get('OPENRC') || []) {
    const match = line.match(/^\s*(\S+)\s+\[\s*([^\]]+?)\s*\]\s*$/)
    if (!match) continue
    const sourceState = cleanText(match[2], 128).toLowerCase()
    items.push({
      name: match[1],
      type: 'service',
      state: sourceState,
      autostart: autostart.get(match[1]) || (hasAutostart ? 'disabled' : 'unknown'),
      description: '',
      source: 'openrc',
      sourceState
    })
  }
  return items
}

function parseSysV (sections) {
  const autostart = new Map()
  for (const line of sections.get('SYSV_AUTOSTART') || []) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const settings = parts.slice(1).join(' ')
    if (/:on\b/i.test(settings)) autostart.set(parts[0], 'enabled')
    else if (/:off\b/i.test(settings)) autostart.set(parts[0], 'disabled')
  }
  const items = []
  for (const line of sections.get('SYSV') || []) {
    const match = line.match(/^\s*\[\s*([+?-])\s*\]\s+(\S+)\s*$/)
    const plain = line.trim().match(/^[a-zA-Z0-9_.@+-]+$/)?.[0]
    if (!match && !plain) continue
    const name = match?.[2] || plain
    const sourceState = match?.[1] || 'unknown'
    const state = sourceState === '+'
      ? 'running'
      : (sourceState === '-' ? 'stopped' : 'unknown')
    items.push({
      name,
      type: 'service',
      state,
      autostart: autostart.get(name) || 'unknown',
      description: '',
      source: 'sysv',
      sourceState
    })
  }
  return items
}

function parseSystemServiceInventory (output = '') {
  const parsed = parseSections(output)
  const normalized = normalizeServiceInventoryResult([
    ...parseSystemd(parsed.sections),
    ...parseOpenRc(parsed.sections, parsed.markers),
    ...parseSysV(parsed.sections)
  ])
  const errors = markerErrors(parsed.markers, [
    ['SYSTEMD_FAILED', 'systemd', 'unknown'],
    ['SYSTEMD_AUTOSTART_FAILED', 'systemd', 'unknown'],
    ['OPENRC_FAILED', 'openrc', 'unknown'],
    ['OPENRC_AUTOSTART_FAILED', 'openrc', 'unknown'],
    ['SYSV_FAILED', 'sysv', 'unknown'],
    ['SYSV_AUTOSTART_FAILED', 'sysv', 'unknown'],
    ['SYSTEM_MISSING', null, 'unsupported']
  ])
  if (parsed.truncated || normalized.truncated) appendOutputTruncatedError(errors)
  return {
    items: normalized.items,
    errors
  }
}

function parseDocker (sections) {
  const restartById = new Map()
  const restartByName = new Map()
  for (const line of sections.get('DOCKER_RESTART') || []) {
    const fields = line.split('\t')
    if (fields.length !== 5) continue
    const [id, rawName, state, exitCode, policy] = fields
    const value = { state, exitCode, policy }
    if (id) restartById.set(id, value)
    if (rawName) restartByName.set(rawName.replace(/^\//, ''), value)
  }
  const items = []
  for (const line of sections.get('DOCKER') || []) {
    if (!line.trim()) continue
    const fields = line.split('\t')
    if (fields.length !== 6) continue
    const [id, name, state, status] = fields
    if (!id || !name) continue
    const details = restartById.get(id) || restartByName.get(name) || {}
    const failed = Number(details.exitCode) > 0 || /\bexited\s*\([1-9]\d*\)/i.test(status)
    const sourceState = failed ? 'failed' : (details.state || state || status)
    items.push({
      name,
      type: 'container',
      state: sourceState,
      autostart: normalizeAutostart(details.policy),
      description: status,
      source: 'docker',
      sourceState
    })
  }
  return items
}

function isExpectedComposeProject (project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return false
  const keys = Object.keys(project).sort()
  const hasExpectedKeys = (
    keys.length === 2 &&
    keys[0] === 'Name' &&
    keys[1] === 'Status'
  ) || (
    keys.length === 3 &&
    keys[0] === 'ConfigFiles' &&
    keys[1] === 'Name' &&
    keys[2] === 'Status'
  )
  return hasExpectedKeys && typeof project.Name === 'string' &&
    Boolean(project.Name.trim()) && typeof project.Status === 'string'
}

function parseCompose (sections) {
  const lines = sections.get('COMPOSE') || []
  const items = []
  const text = lines.join('\n').trim()
  if (text.startsWith('[')) {
    try {
      const projects = JSON.parse(text)
      if (!Array.isArray(projects)) return { items, failed: true }
      for (const project of projects) {
        if (!isExpectedComposeProject(project)) continue
        items.push({
          name: project.Name,
          type: 'container',
          state: project.Status,
          autostart: 'unknown',
          description: project.Status,
          source: 'compose',
          sourceState: project.Status
        })
      }
      return { items, failed: false }
    } catch (error) {
      return { items, failed: true }
    }
  }
  for (const line of lines) {
    const fields = line.split('\t')
    if (fields.length !== 2) continue
    const [name, status] = fields
    if (!name.trim() || !status.trim() || /^name$/i.test(name.trim())) continue
    items.push({
      name,
      type: 'container',
      state: status,
      autostart: 'unknown',
      description: status,
      source: 'compose',
      sourceState: status
    })
  }
  return { items, failed: false }
}

function parseContainerInventory (output = '') {
  const parsed = parseSections(output)
  const compose = parseCompose(parsed.sections)
  const errors = markerErrors(parsed.markers, [
    ['DOCKER_FAILED', 'docker', 'unknown'],
    ['DOCKER_RESTART_FAILED', 'docker', 'unknown'],
    ['DOCKER_MISSING', 'docker', 'unsupported'],
    ['COMPOSE_FAILED', 'compose', 'unknown'],
    ['COMPOSE_MISSING', 'compose', 'unsupported']
  ])
  if (compose.failed) errors.push(safeSourceError('compose', 'unknown'))
  const normalized = normalizeServiceInventoryResult([
    ...parseDocker(parsed.sections),
    ...compose.items
  ])
  if (parsed.truncated || normalized.truncated) appendOutputTruncatedError(errors)
  return {
    items: normalized.items,
    errors
  }
}

function parseSupervisor (sections) {
  const items = []
  for (const line of sections.get('SUPERVISOR') || []) {
    if (line.includes('\t')) continue
    const match = line.match(/^\s*(\S+)\s+(RUNNING|STOPPED|STARTING|BACKOFF|STOPPING|EXITED|FATAL|UNKNOWN)\b/i)
    if (!match) continue
    items.push({
      name: match[1],
      type: 'process',
      state: match[2],
      autostart: 'unknown',
      description: '',
      source: 'supervisor',
      sourceState: match[2].toLowerCase()
    })
  }
  return items
}

function tableCells (line) {
  const cells = line.split(/\u2502|\|/).map(value => value.trim())
  if (!cells[0]) cells.shift()
  if (!cells[cells.length - 1]) cells.pop()
  return cells
}

function parsePm2 (sections) {
  const lines = sections.get('PM2') || []
  const headerIndex = lines.findIndex(line => {
    const cells = tableCells(line).map(value => value.toLowerCase())
    return cells.includes('name') && cells.includes('status')
  })
  if (headerIndex < 0) return []
  const headers = tableCells(lines[headerIndex]).map(value => value.toLowerCase())
  const nameIndex = headers.indexOf('name')
  const statusIndex = headers.indexOf('status')
  const items = []
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = tableCells(line)
    if (cells.length !== headers.length) continue
    const name = cells[nameIndex]
    const state = cells[statusIndex]
    if (!name || !state) continue
    items.push({
      name,
      type: 'process',
      state,
      autostart: 'unknown',
      description: '',
      source: 'pm2',
      sourceState: state
    })
  }
  return items
}

function parseProcessManagerInventory (output = '') {
  const parsed = parseSections(output)
  const normalized = normalizeServiceInventoryResult([
    ...parseSupervisor(parsed.sections),
    ...parsePm2(parsed.sections)
  ])
  const errors = markerErrors(parsed.markers, [
    ['SUPERVISOR_FAILED', 'supervisor', 'unknown'],
    ['SUPERVISOR_MISSING', 'supervisor', 'unsupported'],
    ['PM2_FAILED', 'pm2', 'unknown'],
    ['PM2_MISSING', 'pm2', 'unsupported']
  ])
  if (parsed.truncated || normalized.truncated) appendOutputTruncatedError(errors)
  return {
    items: normalized.items,
    errors
  }
}

function mergeServiceInventoryResults (results = []) {
  const items = []
  const errors = []
  let hasOutputTruncatedError = false
  for (const result of results || []) {
    if (Array.isArray(result?.items)) items.push(...result.items)
    const resultErrors = Array.isArray(result?.errors) ? result.errors : []
    for (const error of resultErrors) {
      if (error?.code === outputTruncatedErrorCode) {
        if (hasOutputTruncatedError) continue
        hasOutputTruncatedError = true
      }
      errors.push(error)
    }
  }
  const normalized = normalizeServiceInventoryResult(items)
  if (normalized.truncated) appendOutputTruncatedError(errors)
  return {
    items: normalized.items,
    errors,
    truncated: normalized.truncated
  }
}

module.exports = {
  FLEET_SERVICE_INVENTORY_MAX_ITEMS,
  FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES,
  inventoryAutostartStates,
  inventorySources,
  inventoryStates,
  inventoryTypes,
  mergeServiceInventoryResults,
  normalizeInventoryState,
  normalizeServiceInventory,
  parseContainerInventory,
  parseProcessManagerInventory,
  parseSystemServiceInventory
}
