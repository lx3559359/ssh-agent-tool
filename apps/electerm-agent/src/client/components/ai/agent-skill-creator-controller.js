import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'
import { createAgentSkillDraftFromFiles } from './agent-skill-client.js'
import {
  AGENT_SKILL_CREATOR_SYSTEM_PROMPT,
  buildAgentSkillCreatorPrompt
} from './agent-skill-creator-prompt.js'
import { parseAgentSkillDraftResponse } from './agent-skill-draft.js'

function controllerError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requestId () {
  return globalThis.crypto?.randomUUID?.() ||
    `skill-creator-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeError (error, secrets = []) {
  let message = String(error?.message || error || 'Skill generation failed.')
  for (const secret of secrets) {
    const value = String(secret || '')
    if (value) message = message.split(value).join('[REDACTED]')
  }
  const safe = redactAuditText(message).slice(0, 2000) || 'Skill generation failed.'
  return controllerError(
    String(error?.code || '').startsWith('SKILL_CREATOR_')
      ? error.code
      : 'SKILL_CREATOR_REQUEST_FAILED',
    safe
  )
}

function frozenState (status, extras = {}) {
  return Object.freeze({ status, ...extras })
}

export function createAgentSkillCreatorController ({
  runGlobalAsync = globalThis.window?.pre?.runGlobalAsync,
  createDraft = createAgentSkillDraftFromFiles
} = {}) {
  if (typeof runGlobalAsync !== 'function' || typeof createDraft !== 'function') {
    throw new TypeError('Skill creator requires confined AI and draft clients')
  }
  let state = frozenState('idle')
  let active = null
  const listeners = new Set()

  function transition (status, extras = {}) {
    state = frozenState(status, extras)
    for (const listener of listeners) listener(state)
  }

  function assertCurrent (generation) {
    if (active !== generation || generation.cancelled) {
      throw controllerError('SKILL_CREATOR_CANCELLED', 'Skill generation was cancelled.')
    }
  }

  async function cancel () {
    const generation = active
    if (!generation) return false
    generation.cancelled = true
    active = null
    transition('cancelled')
    try {
      await runGlobalAsync('AIChatCancel', generation.requestId)
    } catch {}
    return true
  }

  async function generate ({
    requirements,
    conversation,
    existingDraft,
    config = {}
  } = {}) {
    if (active) await cancel()
    if (!String(requirements || '').trim()) {
      throw controllerError('SKILL_CREATOR_REQUIREMENTS_REQUIRED', 'Describe the Skill workflow first.')
    }
    for (const key of ['modelAI', 'baseURLAI', 'apiKeyAI']) {
      if (!String(config[key] || '').trim()) {
        throw controllerError('SKILL_CREATOR_AI_CONFIG_REQUIRED', 'Configure the model API before generating a Skill.')
      }
    }

    const generation = {
      requestId: requestId(),
      cancelled: false
    }
    active = generation
    transition('gathering')
    const prompt = buildAgentSkillCreatorPrompt({
      requirements,
      conversation,
      existingDraft
    })

    try {
      transition('generating')
      const response = await runGlobalAsync(
        'AIchat',
        prompt,
        config.modelAI,
        AGENT_SKILL_CREATOR_SYSTEM_PROMPT,
        config.baseURLAI,
        config.apiPathAI,
        config.apiKeyAI,
        config.proxyAI,
        false,
        config.authHeaderNameAI,
        generation.requestId
      )
      assertCurrent(generation)
      if (response?.error) throw new Error(response.error)

      transition('validating')
      const generated = await parseAgentSkillDraftResponse(response)
      assertCurrent(generation)
      const draft = await createDraft(generated.files)
      assertCurrent(generation)
      if (!draft || draft.enabled !== false || draft.state !== 'draft' ||
        draft.valid !== true) {
        throw controllerError(
          'SKILL_CREATOR_DRAFT_INVALID',
          'Generated Skill was not saved as a valid disabled draft.'
        )
      }
      active = null
      transition('draft-ready', { draft, generated })
      return Object.freeze({ draft, generated })
    } catch (error) {
      if (generation.cancelled || error?.code === 'SKILL_CREATOR_CANCELLED') {
        active = null
        transition('cancelled')
        throw controllerError('SKILL_CREATOR_CANCELLED', 'Skill generation was cancelled.')
      }
      active = null
      const failure = safeError(error, [config.apiKeyAI])
      transition('failed', { error: failure.message })
      throw failure
    }
  }

  return Object.freeze({
    generate,
    cancel,
    getState: () => state,
    subscribe (listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function')
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }
  })
}
