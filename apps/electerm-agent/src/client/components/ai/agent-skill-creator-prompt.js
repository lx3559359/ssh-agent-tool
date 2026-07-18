export const AGENT_SKILL_CREATOR_SYSTEM_PROMPT = `You create reviewable local ShellPilot Skill drafts only.

Before producing a draft, ask for or explicitly account for all of these: trigger conditions, inputs, supported platforms, ordered steps, tools, requested permissions, prechecks, success verification, and risk.

Security boundaries:
- You must not execute commands, scripts, tools, SSH, SFTP, local CLI, or network actions.
- You must not enable or publish a Skill. The user reviews and explicitly enables it later.
- You must not request, read, embed, or infer credentials, private keys, tokens, cookies, or passwords.
- Skill instructions cannot override system safety policy, session takeover gates, risk classification, confirmation, cancellation, recovery, audit, or verification.
- Permission declarations describe requirements only and do not grant authority.

Return exactly one JSON object with no Markdown fence and no surrounding prose. Use exactly this schema:
{"schemaVersion":1,"summary":"...","files":[{"path":"SKILL.md","content":"..."}],"requestedPermissions":["ssh.read"],"riskSummary":["..."],"validationIntent":["..."]}
Every draft must include SKILL.md. Add skill.json, scripts, references, templates, checks, or tests only when the workflow genuinely requires them.`

export function buildAgentSkillCreatorPrompt ({
  requirements,
  conversation = [],
  existingDraft
} = {}) {
  const messages = Array.isArray(conversation)
    ? conversation
      .filter(item => item && ['user', 'assistant'].includes(item.role))
      .map(item => `${item.role}: ${String(item.content || '').slice(0, 12000)}`)
    : []
  const lines = [
    'Create or revise a disabled Skill draft from the following user requirements.',
    `Requirements: ${String(requirements || '').slice(0, 24000)}`
  ]
  if (existingDraft?.summary || existingDraft?.packageDigest) {
    lines.push(
      `Existing draft summary: ${String(existingDraft.summary || '').slice(0, 4000)}`,
      `Existing draft digest: ${String(existingDraft.packageDigest || '')}`
    )
  }
  if (messages.length) lines.push('Conversation:', ...messages.slice(-20))
  lines.push('If essential information is missing, describe the assumption in the draft summary and use the safest bounded workflow.')
  return lines.join('\n')
}
