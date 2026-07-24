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

function validationIssues (error) {
  const issues = error?.validation?.errors
  if (!Array.isArray(issues)) return []
  return issues.slice(0, 12).map(issue => ({
    code: String(issue?.code || 'SKILL_VALIDATION_FAILED'),
    path: String(issue?.path || ''),
    message: String(issue?.message || 'Skill package validation failed.').slice(0, 500)
  }))
}

function validationFailureMessage (error) {
  const issues = validationIssues(error)
  if (!issues.length) return ''
  const details = issues.map(issue => {
    const location = issue.path ? `${issue.path}：` : ''
    return `${location}${issue.message}（${issue.code}）`
  })
  return `Skill 草稿校验失败：${details.join('；')}`
}

function repairPrompt (originalPrompt, error) {
  return [
    originalPrompt,
    '',
    'The previous generated package was rejected by the local validator.',
    'Correct every validation issue below and return one complete replacement JSON object.',
    'Do not explain the correction and do not use Markdown fences.',
    JSON.stringify(validationIssues(error))
  ].join('\n')
}

function safeError (error, secrets = []) {
  let message = validationFailureMessage(error) ||
    String(error?.message || error || 'Skill generation failed.')
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

  function reset () {
    if (active) return false
    transition('idle')
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
      let generated
      let draft
      let currentPrompt = prompt
      for (let attempt = 0; attempt < 2; attempt += 1) {
        transition(attempt === 0 ? 'generating' : 'repairing')
        const response = await runGlobalAsync(
          'AIchat',
          currentPrompt,
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
        generated = await parseAgentSkillDraftResponse(response)
        assertCurrent(generation)
        try {
          draft = await createDraft(generated.files)
          assertCurrent(generation)
          break
        } catch (error) {
          if (attempt === 0 && validationIssues(error).length) {
            currentPrompt = repairPrompt(prompt, error)
            continue
          }
          throw error
        }
      }
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
    reset,
    getState: () => state,
    subscribe (listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function')
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }
  })
}
