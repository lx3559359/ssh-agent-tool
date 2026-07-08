const builtInAgentSkills = [
  {
    id: 'linux-health',
    title: 'Linux 健康检查',
    description: '检查负载、CPU、内存、磁盘、关键服务和最近系统日志。',
    prompt: [
      '适用于“服务器慢、负载高、基础巡检”等问题。',
      '优先收集 uptime、free -h、df -hT、systemctl --failed、journalctl -p warning -n 80 等只读信息。',
      '输出结论时按“现象、证据、风险、下一步”组织。'
    ].join('\n')
  },
  {
    id: 'nginx-troubleshooting',
    title: 'Nginx 排查',
    description: '排查 Nginx 502、监听端口、配置测试、错误日志和上游服务。',
    prompt: [
      '适用于 Nginx 502、访问慢、端口未监听、证书或反代异常。',
      '优先查看 nginx -t、systemctl status nginx、ss -tnlp、最近 error.log，并结合应用上游端口判断。',
      '不要直接修改 Nginx 配置或重启服务，除非用户明确确认。'
    ].join('\n')
  },
  {
    id: 'docker-troubleshooting',
    title: 'Docker 排查',
    description: '排查 Docker 服务、容器状态、端口映射、日志和资源占用。',
    prompt: [
      '适用于容器异常、服务不可达、镜像启动失败、Docker 资源占用。',
      '优先查看 docker ps -a、docker logs --tail、docker inspect、docker stats --no-stream 等只读信息。',
      '删除容器、重启容器、清理镜像或卷属于高风险操作，必须二次确认。'
    ].join('\n')
  },
  {
    id: 'disk-cleanup',
    title: '磁盘清理建议',
    description: '定位磁盘占用来源并给出安全清理建议。',
    prompt: [
      '适用于磁盘满、日志过大、部署目录占用异常。',
      '优先用 df -hT、du -xh --max-depth=1、journalctl --disk-usage 等只读命令定位。',
      '清理、删除、truncate、docker system prune 等写入或删除操作必须说明风险并等待用户确认。'
    ].join('\n')
  }
]

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
  return uniqueSkillsById([
    ...getBuiltInAgentSkills(),
    ...(customSkills || [])
      .map(normalizeSkill)
      .filter(Boolean)
  ])
}

export function buildAgentSkillPrompt ({ customSkills = [] } = {}) {
  const skills = getAgentSkills({ customSkills })
  if (!skills.length) {
    return ''
  }
  const lines = [
    '可用 Skill：',
    '当用户问题匹配某个 Skill 时，优先按该 Skill 的排查思路组织计划、证据和建议；Skill 不是固定按钮，用户也可以在配置中新增自定义 Skill。'
  ]
  for (const skill of skills) {
    lines.push(
      `- ${skill.id}｜${skill.title}`,
      skill.description ? `  说明：${skill.description}` : '',
      `  方法：${skill.prompt}`
    )
  }
  return lines.filter(Boolean).join('\n')
}
