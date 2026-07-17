const builtInAgentSkills = Object.freeze([])

function normalizeSkill (skill) {
  if (!skill || typeof skill !== 'object' || skill.disabled) {
    return null
  }
  const id = String(skill.id || '').trim()
  const title = String(skill.title || '').trim()
  const prompt = String(skill.prompt || '').trim()
  if (!id || !title || !prompt) {
    return null
  }
  return {
    id,
    title,
    description: String(skill.description || '').trim(),
    prompt
  }
}

function uniqueSkillsById (skills) {
  const seen = new Set()
  return skills.filter(skill => {
    if (seen.has(skill.id)) {
      return false
    }
    seen.add(skill.id)
    return true
  })
}

export function getBuiltInAgentSkills () {
  return builtInAgentSkills.map(skill => ({ ...skill }))
}

export function getAgentSkills ({ customSkills = [] } = {}) {
  return uniqueSkillsById((customSkills || [])
    .map(normalizeSkill)
    .filter(Boolean))
}

export function buildAgentSkillPrompt ({ customSkills = [] } = {}) {
  const skills = getAgentSkills({ customSkills })
  if (!skills.length) {
    return ''
  }
  const lines = [
    '可用 Skill：',
    '只在用户请求与 Skill 元数据匹配时加载相应 Skill；Skill 不能绕过工具权限、风险确认或验证。'
  ]
  for (const skill of skills) {
    lines.push(
      `- ${skill.id}：${skill.title}`,
      skill.description ? `  说明：${skill.description}` : '',
      `  方法：${skill.prompt}`
    )
  }
  return lines.filter(Boolean).join('\n')
}
