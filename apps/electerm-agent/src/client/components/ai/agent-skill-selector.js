import { agentSkillClient } from './agent-skill-client.js'
import { getAgentSkills } from './agent-skills.js'

const explicitSkillPattern = /\$([a-z0-9]+(?:-[a-z0-9]+)*)/g

function normalizeMatchText (value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase()
}

export function parseExplicitSkillIds (prompt) {
  const ids = []
  const seen = new Set()
  const source = String(prompt || '').normalize('NFKC')
  for (const match of source.matchAll(explicitSkillPattern)) {
    const id = match[1]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function matchImplicitAgentSkill (prompt, catalog = []) {
  const haystack = normalizeMatchText(prompt)
  const matches = []
  for (const skill of getAgentSkills({ customSkills: catalog })) {
    if (!skill.implicitMatching) continue
    for (const trigger of skill.triggers) {
      const needle = normalizeMatchText(trigger)
      if (needle && haystack.includes(needle)) {
        matches.push({ skill, specificity: needle.length })
      }
    }
  }
  matches.sort((left, right) => (
    right.specificity - left.specificity || left.skill.id.localeCompare(right.skill.id)
  ))
  return matches[0]?.skill || null
}

function failureFor (id, reasonCode, message) {
  return Object.freeze({ id, reasonCode, message })
}

function selectionResult ({
  catalog,
  selected = [],
  explicit = false,
  requiresUserChoice = false,
  failure = null,
  warnings = []
}) {
  return Object.freeze({
    catalog: Object.freeze([...catalog]),
    selected: Object.freeze([...selected]),
    explicit,
    requiresUserChoice,
    failure,
    warnings: Object.freeze([...warnings]),
    skillBindings: Object.freeze(selected.map(item => Object.freeze({
      id: item.metadata.id,
      version: item.metadata.version,
      digest: item.metadata.packageDigest
    }))),
    artifactDigests: Object.freeze(selected.map(item => Object.freeze({
      id: `${item.metadata.id}:SKILL.md`,
      path: 'SKILL.md',
      digest: item.document.digest
    })))
  })
}

async function loadSelectedSkill (metadata, client) {
  const before = await client.getAgentSkillMetadata(metadata.id)
  const matchesSelection = candidate => (
    candidate?.skillId === metadata.id &&
    candidate?.enabled === true &&
    candidate?.state === 'enabled' &&
    candidate?.valid === true &&
    candidate?.version === metadata.version &&
    candidate?.packageDigest === metadata.packageDigest
  )
  if (!matchesSelection(before)) {
    const error = new Error('Selected Skill changed before its document was loaded.')
    error.code = 'SKILL_DIGEST_MISMATCH'
    throw error
  }
  const document = await client.readAgentSkillFile(metadata.id, 'SKILL.md')
  if (!document || document.path !== 'SKILL.md' ||
    !String(document.content || '').trim() || !String(document.digest || '').trim()) {
    const error = new Error('Selected Skill document is invalid.')
    error.code = 'SKILL_INVALID'
    throw error
  }
  const after = await client.getAgentSkillMetadata(metadata.id)
  if (!matchesSelection(after) ||
    before.packageDigest !== after.packageDigest ||
    before.version !== after.version) {
    const error = new Error('Selected Skill changed while its document was loaded.')
    error.code = 'SKILL_DIGEST_MISMATCH'
    throw error
  }
  return Object.freeze({
    metadata: Object.freeze({
      ...metadata,
      requestedPermissions: Object.freeze([...(after.requestedPermissions || [])]),
      riskSummary: Object.freeze({ ...(after.riskSummary || {}) })
    }),
    document: Object.freeze({ ...document })
  })
}

function explicitFailure (id, rawMetadata, error) {
  if (!rawMetadata) {
    return failureFor(id, 'SKILL_NOT_FOUND', `Skill $${id} does not exist.`)
  }
  if (rawMetadata.enabled !== true || rawMetadata.state !== 'enabled') {
    return failureFor(id, 'SKILL_DISABLED', `Skill $${id} is not enabled.`)
  }
  if (rawMetadata.valid === false) {
    return failureFor(id, 'SKILL_INVALID', `Skill $${id} did not pass validation.`)
  }
  return failureFor(
    id,
    String(error?.code || 'SKILL_INVALID'),
    String(error?.message || `Skill $${id} could not be loaded.`)
  )
}

export async function selectAgentSkills ({
  prompt = '',
  client = agentSkillClient
} = {}) {
  const rawCatalog = await client.listAgentSkills()
  const catalog = getAgentSkills({ customSkills: rawCatalog })
  const explicitIds = parseExplicitSkillIds(prompt)
  if (explicitIds.length) {
    const selected = []
    for (const id of explicitIds) {
      const rawMetadata = (rawCatalog || []).find(item => (
        String(item?.skillId || item?.id || '') === id
      ))
      const metadata = catalog.find(item => item.id === id)
      if (!metadata) {
        return selectionResult({
          catalog,
          explicit: true,
          requiresUserChoice: true,
          failure: explicitFailure(id, rawMetadata)
        })
      }
      try {
        selected.push(await loadSelectedSkill(metadata, client))
      } catch (error) {
        return selectionResult({
          catalog,
          explicit: true,
          requiresUserChoice: true,
          failure: explicitFailure(id, rawMetadata, error)
        })
      }
    }
    return selectionResult({ catalog, selected, explicit: true })
  }

  const implicit = matchImplicitAgentSkill(prompt, catalog)
  if (!implicit) return selectionResult({ catalog })
  try {
    return selectionResult({
      catalog,
      selected: [await loadSelectedSkill(implicit, client)]
    })
  } catch (error) {
    return selectionResult({
      catalog,
      warnings: [failureFor(
        implicit.id,
        String(error?.code || 'SKILL_INVALID'),
        String(error?.message || 'Implicit Skill could not be loaded.')
      )]
    })
  }
}
