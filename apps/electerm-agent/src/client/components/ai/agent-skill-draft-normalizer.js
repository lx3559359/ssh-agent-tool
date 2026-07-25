const allowedManifestKeys = [
  'schemaVersion',
  'id',
  'version',
  'implicitMatching',
  'requestedPermissions',
  'tools',
  'prechecks',
  'scripts',
  'verification'
]

function text (value, fallback, maxLength) {
  const safeCharacters = [...String(value || '')]
    .map(character => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : character
    })
    .join('')
  const normalized = safeCharacters
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || fallback).slice(0, maxLength)
}

function idHash (value) {
  let hash = 2166136261
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function skillId (candidate, requirements) {
  const normalize = value => String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  const direct = normalize(candidate)
  if (direct) return direct
  const inferred = normalize(requirements)
  if (inferred && !['skill', 'new-skill', 'custom-skill'].includes(inferred)) {
    return inferred
  }
  return `custom-skill-${idHash(requirements || candidate)}`
}

function listValue (value) {
  if (Array.isArray(value)) return value
  const raw = String(value || '').trim()
  if (!raw) return []
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',')
  }
  return [raw]
}

function cleanList (value, maxItems = 32, maxLength = 160) {
  return [...new Set(listValue(value)
    .map(item => text(String(item).replace(/^['"]|['"]$/g, ''), '', maxLength))
    .filter(Boolean))]
    .slice(0, maxItems)
}

function splitSkillDocument (content) {
  const source = String(content || '').replace(/^\uFEFF/, '')
  const lines = source.split(/\r?\n/)
  if (lines[0] !== '---') return { metadata: {}, body: source.trim(), controlled: false }
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) return { metadata: {}, body: source.trim(), controlled: false }

  const metadata = {}
  let activeList = ''
  let controlled = true
  const allowed = new Set([
    'id',
    'name',
    'description',
    'version',
    'triggers',
    'permissions'
  ])
  for (const line of lines.slice(1, closingIndex)) {
    if (!line.trim()) continue
    const item = line.match(/^ {2}-\s+(.+)$/)
    if (item && activeList) {
      metadata[activeList].push(item[1])
      continue
    }
    const field = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):(?:\s*(.*))$/)
    if (!field) {
      controlled = false
      continue
    }
    const [, key, raw = ''] = field
    if (!allowed.has(key) || Object.prototype.hasOwnProperty.call(metadata, key)) {
      controlled = false
      activeList = ''
      continue
    }
    if (['triggers', 'permissions'].includes(key)) {
      metadata[key] = cleanList(raw)
      if (raw.trim()) controlled = false
      activeList = key
    } else {
      metadata[key] = raw.replace(/^['"]|['"]$/g, '')
      activeList = ''
    }
  }
  controlled = controlled &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.id || '') &&
    Boolean(String(metadata.name || '').trim()) &&
    Boolean(String(metadata.description || '').trim()) &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version || '') &&
    cleanList(metadata.triggers).length > 0
  return {
    metadata,
    body: lines.slice(closingIndex + 1).join('\n').trim(),
    controlled
  }
}

function quotedList (name, values) {
  if (!values.length) return []
  return [
    `${name}:`,
    ...values.map(value => `  - ${JSON.stringify(value)}`)
  ]
}

function normalizedSkillDocument ({
  content,
  requirements,
  requestedPermissions
}) {
  const { metadata, body, controlled } = splitSkillDocument(content)
  const id = skillId(metadata.id, requirements)
  const name = text(metadata.name, text(requirements, '自定义 Skill', 80), 80)
  const description = text(
    metadata.description,
    text(requirements, '根据用户描述执行受控工作流程。', 180),
    240
  )
  const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version || '')
    ? metadata.version
    : '1.0.0'
  const triggers = cleanList(metadata.triggers)
  if (!triggers.length) {
    triggers.push(text(requirements, name, 160))
  }
  const permissions = cleanList([
    ...cleanList(metadata.permissions),
    ...cleanList(requestedPermissions)
  ]).filter(permission => /^[a-z][a-z0-9.-]{0,63}$/.test(permission))
  if (controlled && permissions.every(permission => (
    cleanList(metadata.permissions).includes(permission)
  ))) {
    return {
      content,
      id,
      version,
      requestedPermissions: permissions
    }
  }
  const workflow = body || [
    '# 工作流程',
    '',
    '1. 收集完成任务所需的必要输入。',
    '2. 按用户描述执行受控步骤。',
    '3. 返回结果、验证信息与已知限制。'
  ].join('\n')
  const frontmatter = [
    '---',
    `id: ${id}`,
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    `version: ${version}`,
    ...quotedList('triggers', triggers),
    ...quotedList('permissions', permissions),
    '---'
  ]
  return {
    content: `${frontmatter.join('\n')}\n\n${workflow.trim()}\n`,
    id,
    version,
    requestedPermissions: permissions
  }
}

function normalizedManifest (content, skill) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    return content
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return content

  const result = {}
  for (const key of allowedManifestKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) result[key] = parsed[key]
  }
  result.schemaVersion = 1
  result.id = skill.id
  result.version = skill.version
  result.implicitMatching = result.implicitMatching === true
  result.requestedPermissions = cleanList([
    ...cleanList(result.requestedPermissions),
    ...skill.requestedPermissions
  ])
  result.tools = cleanList(result.tools)
  if (!Array.isArray(result.prechecks)) result.prechecks = []
  if (!Array.isArray(result.scripts)) result.scripts = []
  if (!Array.isArray(result.verification)) result.verification = []
  return `${JSON.stringify(result, null, 2)}\n`
}

export function normalizeAgentSkillDraftFiles ({
  files,
  requirements,
  requestedPermissions
} = {}) {
  if (!Array.isArray(files)) return { files: [], changed: false }
  const sourceSkill = files.find(file => file?.path === 'SKILL.md')
  if (!sourceSkill || typeof sourceSkill.content !== 'string') {
    return { files, changed: false }
  }

  const skill = normalizedSkillDocument({
    content: sourceSkill.content,
    requirements,
    requestedPermissions
  })
  const normalized = files.map(file => {
    if (file.path === 'SKILL.md') return { ...file, content: skill.content }
    if (file.path === 'skill.json' && typeof file.content === 'string') {
      return { ...file, content: normalizedManifest(file.content, skill) }
    }
    return file
  })
  return {
    files: normalized,
    changed: normalized.some((file, index) => file.content !== files[index]?.content)
  }
}
