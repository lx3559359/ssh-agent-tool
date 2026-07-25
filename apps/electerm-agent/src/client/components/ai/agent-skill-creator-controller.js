import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'
import { createAgentSkillDraftFromFiles } from './agent-skill-client.js'
import {
  AGENT_SKILL_CREATOR_SYSTEM_PROMPT,
  buildAgentSkillCreatorPrompt
} from './agent-skill-creator-prompt.js'
import { parseAgentSkillDraftResponse } from './agent-skill-draft.js'
import { normalizeAgentSkillDraftFiles } from './agent-skill-draft-normalizer.js'

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
  if (!issues.length) {
    return error?.code === 'SKILL_VALIDATION_FAILED'
      ? 'AI 生成的 Skill 结构不完整，自动修正后仍未通过校验。请补充触发条件和预期结果后重试。'
      : ''
  }
  const messages = {
    SKILL_DOCUMENT_REQUIRED: '缺少 SKILL.md 主文件',
    SKILL_FRONTMATTER_REQUIRED: 'SKILL.md 缺少标准元数据区',
    SKILL_FRONTMATTER_REQUIRED_FIELD: '缺少必要字段或触发条件',
    SKILL_FRONTMATTER_KEY_INVALID: '包含不支持的元数据字段',
    SKILL_FRONTMATTER_INVALID: '元数据格式不正确',
    SKILL_FRONTMATTER_UNSAFE: '元数据包含不支持的嵌套或 YAML 语法',
    SKILL_ID_INVALID: 'Skill 标识必须使用小写英文、数字和连字符',
    SKILL_VERSION_INVALID: '版本号必须采用 1.0.0 格式',
    SKILL_MANIFEST_JSON_INVALID: 'skill.json 不是有效的 JSON',
    SKILL_MANIFEST_MISMATCH: 'skill.json 与 SKILL.md 的标识或版本不一致',
    SKILL_ARTIFACT_MISSING: '声明的脚本或文件不存在',
    SKILL_SCRIPT_UNSAFE: '脚本包含被安全策略阻止的写法'
  }
  const details = issues.map(issue => {
    const location = issue.path ? `${issue.path}：` : ''
    const message = messages[issue.code] || '结构不符合 Skill 安全规范'
    return `${location}${message}（${issue.code}）`
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

async function normalizeGeneratedDraft (generated, requirements) {
  const normalized = normalizeAgentSkillDraftFiles({
    files: generated.files,
    requirements,
    requestedPermissions: generated.requestedPermissions
  })
  if (!normalized.changed) return generated
  return parseAgentSkillDraftResponse(JSON.stringify({
    schemaVersion: generated.schemaVersion,
    summary: generated.summary,
    files: normalized.files,
    requestedPermissions: generated.requestedPermissions,
    riskSummary: generated.riskSummary,
    validationIntent: generated.validationIntent
  }))
}

function safeError (error, secrets = []) {
  const creatorMessages = {
    SKILL_CREATOR_RESPONSE_INVALID: '模型返回的草稿格式不完整，请重新生成。',
    SKILL_CREATOR_SCHEMA_INVALID: '模型返回的草稿字段不符合 Skill 规范，请重新生成。',
    SKILL_CREATOR_FILES_INVALID: '模型没有生成有效的 Skill 文件，请重新生成。',
    SKILL_CREATOR_SKILL_DOCUMENT_REQUIRED: '模型未生成 SKILL.md，请重新生成。',
    SKILL_CREATOR_PATH_INVALID: '模型生成了不安全的文件路径，草稿未保存。',
    SKILL_CREATOR_PATH_DUPLICATE: '模型生成了重复文件，草稿未保存。',
    SKILL_CREATOR_CONTENT_TOO_LARGE: '模型生成的 Skill 内容超过大小限制，草稿未保存。',
    SKILL_CREATOR_TOOL_CALL_FORBIDDEN: '创建 Skill 时禁止执行工具或命令，本次草稿未保存。'
  }
  let message = validationFailureMessage(error) ||
    creatorMessages[error?.code] ||
    String(error?.message || error || 'Skill 生成失败，请重试。')
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
        generated = await normalizeGeneratedDraft(generated, requirements)
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
