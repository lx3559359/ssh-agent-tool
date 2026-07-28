import {
  finalOperationTaskStatuses,
  operationTaskKinds,
  operationTaskStatuses
} from '../../common/operation-tasks/models.js'

const finalStatuses = new Set(finalOperationTaskStatuses)

const kindPresentations = Object.freeze({
  [operationTaskKinds.sftpTransfer]: {
    label: 'SFTP 传输',
    source: 'sftp'
  },
  [operationTaskKinds.sshTunnel]: {
    label: 'SSH 隧道',
    source: 'ssh-tunnel'
  },
  [operationTaskKinds.aiFileChange]: {
    label: 'AI 文件修改',
    source: 'agent'
  },
  [operationTaskKinds.manualBackup]: {
    label: '手动备份',
    source: 'sftp'
  }
})

export const operationTaskStatusPresentations = Object.freeze({
  [operationTaskStatuses.queued]: ['等待中', 'default'],
  [operationTaskStatuses.running]: ['执行中', 'processing'],
  [operationTaskStatuses.pausing]: ['正在暂停', 'processing'],
  [operationTaskStatuses.paused]: ['已暂停', 'warning'],
  [operationTaskStatuses.interrupted]: ['已中断', 'warning'],
  [operationTaskStatuses.resuming]: ['正在恢复', 'processing'],
  [operationTaskStatuses.completed]: ['已完成', 'success'],
  [operationTaskStatuses.failed]: ['失败', 'error'],
  [operationTaskStatuses.cancelled]: ['已取消', 'default']
})

function operationTaskError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function endpointMatches (endpoint = {}, tab = {}) {
  return Boolean(
    endpoint.host &&
    endpoint.host === tab.host &&
    Number(endpoint.port || 22) === Number(tab.port || 22) &&
    String(endpoint.username || '') === String(tab.username || tab.user || '')
  )
}

function formatEndpoint (endpoint = {}) {
  const host = String(endpoint.host || '未记录')
  const port = Number(endpoint.port || 22)
  const username = String(endpoint.username || '')
  return `${username ? `${username}@` : ''}${host}:${port}`
}

function taskDetail (task) {
  const metadata = task.metadata || {}
  if (task.kind === operationTaskKinds.sftpTransfer) {
    return `${metadata.fromPath || '未知来源'} → ${metadata.toPath || '未知目标'}`
  }
  if (task.kind === operationTaskKinds.sshTunnel) {
    const definition = metadata.definition || {}
    const local = definition.localPort ? `127.0.0.1:${definition.localPort}` : ''
    const remote = definition.remoteHost && definition.remotePort
      ? `${definition.remoteHost}:${definition.remotePort}`
      : ''
    return [metadata.health || '', local && remote ? `${local} → ${remote}` : '']
      .filter(Boolean)
      .join(' · ')
  }
  if (task.kind === operationTaskKinds.aiFileChange) {
    return `${Number(metadata.fileCount) || 0} 个文件`
  }
  return String(metadata.path || '')
}

export function operationTaskGroup (task = {}) {
  return finalStatuses.has(task.status) ? 'history' : 'running'
}

export function operationTaskSource (task = {}) {
  return kindPresentations[task.kind]?.source || 'terminal'
}

export function buildOperationTaskView (task = {}) {
  const kind = kindPresentations[task.kind] || {
    label: '操作任务',
    source: 'terminal'
  }
  const status = operationTaskStatusPresentations[task.status] || [
    String(task.status || '未知'),
    'default'
  ]
  return {
    id: String(task.id || ''),
    kind: String(task.kind || ''),
    kindLabel: kind.label,
    status: String(task.status || ''),
    statusLabel: status[0],
    statusColor: status[1],
    title: String(task.title || kind.label),
    endpoint: formatEndpoint(task.endpoint),
    detail: taskDetail(task),
    progress: task.progress || {
      transferred: 0,
      total: 0,
      percent: 0,
      speed: 0,
      etaSeconds: 0
    },
    updatedAt: task.updatedAt,
    events: Array.isArray(task.metadata?.events)
      ? task.metadata.events.slice(-50)
      : []
  }
}

export function buildTransferResumeItem (task, tab) {
  if (task?.kind !== operationTaskKinds.sftpTransfer) {
    throw operationTaskError(
      'TRANSFER_RESUME_KIND_INVALID',
      '该记录不是 SFTP 传输任务'
    )
  }
  if (![operationTaskStatuses.paused, operationTaskStatuses.interrupted].includes(task.status)) {
    throw operationTaskError(
      'TRANSFER_RESUME_STATUS_INVALID',
      '当前传输状态不能恢复'
    )
  }
  if (!endpointMatches(task.endpoint, tab)) {
    throw operationTaskError(
      'TRANSFER_RESUME_ENDPOINT_MISMATCH',
      '请先连接原服务器，再恢复传输'
    )
  }
  const metadata = task.metadata || {}
  if (!metadata.checkpoint?.partialPath || !Number.isFinite(Number(metadata.checkpoint.offset))) {
    throw operationTaskError(
      'TRANSFER_RESUME_CHECKPOINT_MISSING',
      '该传输没有完整暂停检查点，无法安全续传'
    )
  }
  if (!metadata.transferId || !metadata.fromPath || !metadata.toPath ||
    !metadata.typeFrom || !metadata.typeTo) {
    throw operationTaskError(
      'TRANSFER_RESUME_METADATA_MISSING',
      '该传输缺少恢复参数'
    )
  }
  return {
    id: String(metadata.transferId),
    host: tab.host,
    tabType: tab.type || 'ssh',
    typeFrom: metadata.typeFrom,
    typeTo: metadata.typeTo,
    fromPath: metadata.fromPath,
    toPath: metadata.toPath,
    title: tab.title || tab.name || tab.host,
    tabId: tab.id,
    checkpoint: metadata.checkpoint,
    sourceDescriptor: metadata.sourceDescriptor,
    safetyOperationId: metadata.safetyOperationId,
    conflictPolicy: metadata.conflictPolicy || 'mergeOrOverwriteAll',
    status: 'resuming',
    paused: false,
    pausing: false,
    operation: ''
  }
}

export function findLiveTransferTask (taskId, transfers = window.refsTransfers) {
  if (!(transfers instanceof Map)) return undefined
  return [...transfers.values()].find(entry => entry?.operationTaskId === taskId)
}
