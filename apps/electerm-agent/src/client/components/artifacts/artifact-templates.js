const TEMPLATE_PROVENANCE = Object.freeze([
  'server',
  'capturedAt',
  'traceId'
])

function section (title) {
  return Object.freeze({ title, content: '' })
}

function table (title, columns) {
  return Object.freeze({ title, columns: Object.freeze(columns), rows: Object.freeze([]) })
}

function template (definition) {
  return Object.freeze({
    ...definition,
    formats: Object.freeze(definition.formats),
    sections: Object.freeze(definition.sections || []),
    tables: Object.freeze(definition.tables || []),
    provenance: TEMPLATE_PROVENANCE
  })
}

export const ARTIFACT_TEMPLATES = Object.freeze([
  template({
    type: 'diagnostic-report',
    label: '运维诊断报告',
    description: '整理故障现象、检查证据、原因判断和处理建议。',
    formats: ['md', 'docx', 'pdf', 'html'],
    sshSession: 'optional',
    sections: [
      section('问题概述'),
      section('诊断证据'),
      section('原因分析'),
      section('处理建议')
    ]
  }),
  template({
    type: 'inspection-report',
    label: '服务器巡检报告',
    description: '汇总系统、资源、网络、服务和安全状态。',
    formats: ['md', 'docx', 'pdf', 'html'],
    sshSession: 'required',
    sections: [
      section('巡检摘要'),
      section('系统与资源'),
      section('网络与服务'),
      section('风险与建议')
    ]
  }),
  template({
    type: 'asset-inventory',
    label: '服务器资产清单',
    description: '生成服务器、服务、端口和软件资产表格。',
    formats: ['csv', 'xlsx', 'pdf'],
    sshSession: 'optional',
    sections: [section('资产说明')],
    tables: [
      table('服务器资产', ['名称', '地址', '系统', '状态']),
      table('服务与端口', ['服务器', '服务', '端口', '状态'])
    ]
  }),
  template({
    type: 'change-record',
    label: '运维变更记录',
    description: '记录变更内容、执行结果、备份和回滚入口。',
    formats: ['md', 'docx', 'pdf', 'html'],
    sshSession: 'required',
    sections: [
      section('变更目的'),
      section('执行记录'),
      section('验证结果'),
      section('备份与回滚')
    ]
  }),
  template({
    type: 'security-report',
    label: '安全检查报告',
    description: '整理账号、端口、防火墙、登录和暴露面检查结果。',
    formats: ['md', 'docx', 'pdf', 'html'],
    sshSession: 'required',
    sections: [
      section('检查范围'),
      section('风险发现'),
      section('证据'),
      section('加固建议')
    ]
  }),
  template({
    type: 'incident-review',
    label: '故障复盘报告',
    description: '记录影响、时间线、根因、恢复过程和改进项。',
    formats: ['md', 'docx', 'pdf', 'html'],
    sshSession: 'optional',
    sections: [
      section('故障影响'),
      section('事件时间线'),
      section('根因分析'),
      section('恢复过程'),
      section('改进计划')
    ]
  }),
  template({
    type: 'custom-document',
    label: '自定义文档',
    description: '按当前对话生成可编辑的通用文档。',
    formats: ['md', 'docx', 'pdf', 'html'],
    sshSession: 'optional',
    sections: [section('正文')]
  }),
  template({
    type: 'custom-spreadsheet',
    label: '自定义表格',
    description: '按当前对话生成可编辑的数据表格。',
    formats: ['csv', 'xlsx'],
    sshSession: 'optional',
    tables: [table('数据表', ['项目', '内容'])]
  })
])

const templateMap = new Map(
  ARTIFACT_TEMPLATES.map(item => [item.type, item])
)

export function getArtifactTemplate (type) {
  return templateMap.get(String(type || '')) || null
}
