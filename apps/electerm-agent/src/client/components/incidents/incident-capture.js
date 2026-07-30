import {
  redactAuditText
} from '../../common/safety-transactions/audit-redaction.js'

const FINAL_ABNORMAL_TASK_STATES = new Set([
  'failed',
  'timed-out',
  'disconnected',
  'partially-completed'
])

const FINAL_AGENT_TASK_STATES = new Set([
  'completed',
  'failed',
  'cancelled',
  'partially-completed'
])

const ABNORMAL_SERVICE_STATES = new Set([
  'critical',
  'crashed',
  'dead',
  'degraded',
  'down',
  'error',
  'failed',
  'inactive',
  'stopped',
  'unhealthy',
  'warning'
])

const ABNORMAL_CONNECTION_STATES = new Set([
  'auth',
  'failed',
  'host-key',
  'offline',
  'timeout'
])

const ABNORMAL_RESOURCE_STATES = new Set([
  'critical',
  'warning'
])

const RESOURCE_LABELS = Object.freeze({
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
  load: '系统负载'
})

function text (value, max = 2000) {
  return String(value ?? '').trim().slice(0, max)
}

function auditText (value, max = 2000) {
  return text(redactAuditText(value), max)
}

function stableHash (value) {
  let hash = 2166136261
  const input = String(value)
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function endpointRefFromTask (task = {}) {
  const endpoint = task.endpoint || {}
  return text(
    endpoint.tabId ||
    endpoint.bookmarkId ||
    [
      endpoint.username,
      endpoint.host,
      endpoint.port
    ].filter(Boolean).join('@'),
    128
  )
}

function endpointRefFromOperation (operation = {}) {
  const endpoint = operation.endpoint || {}
  return text(
    endpoint.tabId ||
    endpoint.bookmarkId ||
    operation.endpointRef ||
    [
      endpoint.username,
      endpoint.host,
      endpoint.port
    ].filter(Boolean).join('@'),
    128
  )
}

function summarizeSteps (steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .slice(0, 8)
    .map(step => ({
      id: text(step?.id, 128),
      status: text(step?.status, 64),
      output: auditText(step?.output, 2000),
      error: auditText(step?.error, 1000)
    }))
}

function serviceSeverity (state) {
  if (['critical', 'crashed', 'dead'].includes(state)) return 'critical'
  if (['down', 'error', 'failed', 'unhealthy'].includes(state)) return 'high'
  return 'medium'
}

function serviceState (service = {}) {
  return text(
    service.state ??
    service.activeState ??
    service.status ??
    service.health,
    64
  ).toLowerCase()
}

function rowIdentity (row = {}) {
  return {
    endpointRef: text(row.id || row.endpointRef, 128),
    serverName: text(row.name || row.host || '服务器', 128),
    host: text(row.host, 256),
    port: Number(row.port) || 22
  }
}

function createFleetConnectionCandidate (row = {}) {
  const connection = row?.snapshot?.connection || {}
  const status = text(connection.status, 64).toLowerCase()
  if (!ABNORMAL_CONNECTION_STATES.has(status)) return null
  const identity = rowIdentity(row)
  return {
    fingerprint: `fleet:${stableHash([
      'fleet-status',
      identity.endpointRef || identity.host,
      'connection',
      status
    ].join(':'))}`,
    source: 'fleet-status',
    sourceRef: text(`${identity.endpointRef}:connection`, 256),
    endpointRef: identity.endpointRef,
    title: `${identity.serverName} SSH 连接异常`,
    severity: 'high',
    summary: `${identity.serverName} 的 SSH 状态为 ${status}，状态采集未完成。`,
    evidence: {
      kind: 'connection',
      serverName: identity.serverName,
      host: identity.host,
      port: identity.port,
      status,
      error: auditText(connection.error, 1000),
      collectedAt: Number(row?.snapshot?.collectedAt) || null
    }
  }
}

function resourceState (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return text(value.status || value.state || value.health, 64).toLowerCase()
}

function resourcePercent (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const field of ['usedPercent', 'usagePercent', 'percent', 'value']) {
    const number = Number(value[field])
    if (Number.isFinite(number)) return number
  }
  return null
}

function createFleetResourceCandidates (row = {}) {
  const resources = row?.snapshot?.resources
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
    return []
  }
  const identity = rowIdentity(row)
  return Object.keys(RESOURCE_LABELS).flatMap(resource => {
    const value = resources[resource]
    const state = resourceState(value)
    if (!ABNORMAL_RESOURCE_STATES.has(state)) return []
    const usedPercent = resourcePercent(value)
    const label = RESOURCE_LABELS[resource]
    return [{
      fingerprint: `fleet:${stableHash([
        'fleet-status',
        identity.endpointRef || identity.host,
        'resource',
        resource,
        state
      ].join(':'))}`,
      source: 'fleet-status',
      sourceRef: text(`${identity.endpointRef}:resource:${resource}`, 256),
      endpointRef: identity.endpointRef,
      title: `${identity.serverName} ${label}告警`,
      severity: state === 'critical' ? 'critical' : 'medium',
      summary: `${identity.serverName} 的${label}状态为 ${state}` +
        `${usedPercent === null ? '' : `，当前使用率 ${usedPercent}%`}。`,
      evidence: {
        kind: 'resource',
        serverName: identity.serverName,
        host: identity.host,
        port: identity.port,
        resource,
        state,
        usedPercent,
        collectedAt: Number(row?.snapshot?.collectedAt) || null
      }
    }]
  })
}

export function createFleetIncidentCandidates ({ rows = [] } = {}) {
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const services = Array.isArray(row?.snapshot?.services)
      ? row.snapshot.services
      : []
    const serviceCandidates = services
      .filter(service => (
        ABNORMAL_SERVICE_STATES.has(serviceState(service))
      ))
      .map(service => {
        const state = serviceState(service)
        const serviceName = text(service.name || service.service, 128)
        const endpointRef = text(row.id || row.endpointRef, 128)
        const fingerprintKey = [
          'fleet-status',
          endpointRef || row.host,
          serviceName.toLowerCase(),
          state
        ].join(':')
        return {
          fingerprint: `fleet:${stableHash(fingerprintKey)}`,
          source: 'fleet-status',
          sourceRef: text(`${endpointRef}:${serviceName}`, 256),
          endpointRef,
          title: `${serviceName || '服务器'} 服务异常`,
          severity: serviceSeverity(state),
          summary: `${text(row.name || row.host, 128)} 的 ${serviceName} 当前状态为 ${state}。`,
          evidence: {
            serverName: text(row.name, 128),
            host: text(row.host, 256),
            port: Number(row.port) || 22,
            service: serviceName,
            state,
            type: text(service.type, 64),
            source: text(service.source, 128),
            collectedAt: Number(row?.snapshot?.collectedAt) || null
          }
        }
      })
    return [
      createFleetConnectionCandidate(row),
      ...createFleetResourceCandidates(row),
      ...serviceCandidates
    ].filter(Boolean)
  })
}

export function createOperationsIncidentCandidate (task = {}) {
  const status = text(task.status, 64)
  if (!FINAL_ABNORMAL_TASK_STATES.has(status)) return null
  const endpointRef = endpointRefFromTask(task)
  const title = text(task.title || task.toolId || '运维任务', 180)
  const fingerprintKey = [
    'operations',
    endpointRef,
    text(task.toolId, 128),
    status
  ].join(':')
  return {
    fingerprint: `operations:${stableHash(fingerprintKey)}`,
    source: 'operations',
    sourceRef: text(task.id, 256),
    endpointRef,
    title: `${title}执行异常`,
    severity: status === 'partially-completed' ? 'medium' : 'high',
    summary: `运维任务“${title}”以 ${status} 状态结束。`,
    evidence: {
      toolId: text(task.toolId, 128),
      status,
      error: auditText(task.error, 2000),
      endpoint: {
        host: text(task?.endpoint?.host, 256),
        port: Number(task?.endpoint?.port) || 22,
        username: text(task?.endpoint?.username, 128)
      },
      steps: summarizeSteps(task.steps)
    }
  }
}

export function createOperationsTimelineEvent (task = {}) {
  const status = text(task.status, 64)
  const title = text(task.title || task.toolId || '运维任务', 180)
  return {
    kind: 'diagnostic',
    source: 'operations',
    sourceRef: text(task.id, 256),
    title: `${title}：${status || '已更新'}`,
    body: auditText(task.error, 2000),
    metadata: {
      toolId: text(task.toolId, 128),
      status,
      endpointRef: endpointRefFromTask(task),
      steps: summarizeSteps(task.steps)
    }
  }
}

function agentTaskTitle (task = {}) {
  return text(
    task.title ||
    task.summary ||
    task.purpose ||
    task.target?.name ||
    'AI 只读诊断',
    180
  )
}

function agentTaskTarget (task = {}) {
  return {
    type: text(task.target?.type, 64),
    name: text(task.target?.name, 180),
    status: text(task.target?.status, 64)
  }
}

export function createAgentTaskTimelineEvent (task = {}) {
  const status = text(task.status, 64)
  if (!FINAL_AGENT_TASK_STATES.has(status)) return null
  return {
    kind: 'diagnostic',
    source: 'ai-diagnostic',
    sourceRef: text(task.id, 256),
    title: `${agentTaskTitle(task)}：${status || '已更新'}`,
    body: text(task.error, 2000),
    metadata: {
      status,
      endpointRef: endpointRefFromTask(task),
      target: agentTaskTarget(task),
      expectedSignals: (Array.isArray(task.expectedSignals)
        ? task.expectedSignals
        : []
      ).slice(0, 12).map(value => text(value, 500)),
      steps: summarizeSteps(task.steps)
    }
  }
}

export function createAgentTaskIncidentCandidate (task = {}) {
  const status = text(task.status, 64)
  if (!['failed', 'partially-completed'].includes(status)) return null
  const endpointRef = endpointRefFromTask(task)
  const title = agentTaskTitle(task)
  const target = agentTaskTarget(task)
  const fingerprintKey = [
    'ai-diagnostic',
    endpointRef,
    target.type,
    target.name,
    title.toLowerCase(),
    status
  ].join(':')
  return {
    fingerprint: `ai-diagnostic:${stableHash(fingerprintKey)}`,
    source: 'ai-diagnostic',
    sourceRef: text(task.id, 256),
    endpointRef,
    title: `${title}执行异常`,
    severity: status === 'partially-completed' ? 'medium' : 'high',
    summary: `AI 只读诊断“${title}”以 ${status} 状态结束。`,
    evidence: {
      status,
      error: auditText(task.error, 2000),
      target,
      endpoint: {
        host: text(task?.endpoint?.host, 256),
        port: Number(task?.endpoint?.port) || 22,
        username: text(task?.endpoint?.username, 128)
      },
      steps: summarizeSteps(task.steps)
    }
  }
}

const SAFETY_TIMELINE_KIND_BY_STATE = Object.freeze({
  'recovery-ready': 'backup',
  executing: 'change',
  'verification-passed': 'verification',
  'rollback-available': 'change',
  kept: 'change',
  'rolling-back': 'rollback',
  restored: 'rollback',
  failed: 'change',
  cancelled: 'command'
})

function safetyStateLabel (state) {
  return ({
    'recovery-ready': '恢复点已就绪',
    executing: '开始执行变更',
    'verification-passed': '变更验证通过',
    'rollback-available': '变更完成，可快速回滚',
    kept: '已确认保留变更',
    'rolling-back': '开始回滚',
    restored: '回滚完成',
    failed: '执行失败',
    cancelled: '操作已取消'
  })[state] || state
}

export function createSafetyOperationTimelineEvent (operation = {}) {
  const state = text(operation.state, 64)
  const kind = SAFETY_TIMELINE_KIND_BY_STATE[state]
  if (!kind) return null
  const title = text(operation.title || operation.command || '安全操作', 180)
  return {
    kind,
    source: 'safety-operation',
    sourceRef: text(`${operation.id}:${state}`, 256),
    title: `${title}：${safetyStateLabel(state)}`,
    body: auditText(operation.error, 2000),
    metadata: {
      operationId: text(operation.id, 128),
      state,
      source: text(operation.source, 64),
      risk: text(operation.risk, 64),
      reversible: Boolean(operation.reversible),
      recoveryProvider: text(operation.recoveryProvider, 64),
      endpointRef: endpointRefFromOperation(operation),
      hasRecoveryPoint: Boolean(
        operation.recoveryBinding ||
        (operation.artifacts && Object.keys(operation.artifacts).length)
      )
    }
  }
}

export function createSafetyOperationIncidentCandidate (operation = {}) {
  if (text(operation.state, 64) !== 'failed') return null
  const endpointRef = endpointRefFromOperation(operation)
  const title = text(operation.title || operation.command || '安全操作', 180)
  const fingerprintKey = [
    'safety-operation',
    endpointRef,
    text(operation.id, 128),
    'failed'
  ].join(':')
  return {
    fingerprint: `safety:${stableHash(fingerprintKey)}`,
    source: 'safety-operation',
    sourceRef: text(operation.id, 256),
    endpointRef,
    title: `${title}执行失败`,
    severity: operation.risk === 'change' ? 'high' : 'medium',
    summary: `安全操作“${title}”执行失败，请确认影响范围和恢复状态。`,
    evidence: {
      operationId: text(operation.id, 128),
      state: 'failed',
      source: text(operation.source, 64),
      risk: text(operation.risk, 64),
      reversible: Boolean(operation.reversible),
      recoveryProvider: text(operation.recoveryProvider, 64),
      error: auditText(operation.error, 2000),
      endpoint: {
        host: text(operation?.endpoint?.host, 256),
        port: Number(operation?.endpoint?.port) || 22,
        username: text(operation?.endpoint?.username, 128)
      }
    }
  }
}

function artifactSection (title, content) {
  return {
    title,
    content: text(content, 32000)
  }
}

function formatTimelineTime (value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? text(value, 80) : date.toISOString()
}

export function createIncidentReviewArtifactDraft (incident = {}) {
  const timeline = Array.isArray(incident.timelineEvents)
    ? incident.timelineEvents
    : []
  const timelineContent = timeline.length
    ? timeline.map(event => (
      `- ${formatTimelineTime(event.createdAt)} ${text(event.title, 200)}` +
      `${event.body ? `：${text(event.body, 2000)}` : ''}`
    )).join('\n')
    : '暂无自动记录。'
  const title = text(incident.title || '故障复盘报告', 140)
  return {
    schemaVersion: 1,
    type: 'incident-review',
    title: `${title} - 故障复盘`,
    server: text(incident.endpointRef, 160),
    summary: text(incident.summary || '根据故障档案生成的复盘报告。', 16000),
    sections: [
      artifactSection('故障影响', incident.summary),
      artifactSection('事件时间线', timelineContent),
      artifactSection('根因分析', incident.rootCause || '待补充'),
      artifactSection('恢复过程', incident.resolution || '待补充'),
      artifactSection('改进计划', '请根据复盘结论补充负责人、计划时间和验证方式。')
    ],
    tables: [{
      title: '关键状态',
      columns: ['字段', '内容'],
      rows: [
        ['严重程度', text(incident.severity, 64)],
        ['当前状态', text(incident.state, 64)],
        ['验证状态', text(incident.verificationStatus, 64)],
        ['关联服务器', text(incident.endpointRef, 128)]
      ]
    }],
    risks: [],
    recommendations: []
  }
}
