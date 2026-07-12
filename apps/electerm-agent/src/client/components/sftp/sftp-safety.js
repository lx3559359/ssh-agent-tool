const safetyDirMap = {
  backup: '.shellpilot-backups',
  trash: '.shellpilot-trash',
  displaced: '.shellpilot-before-restore'
}

function normalizePath (value = '/') {
  const normalized = String(value || '/').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

function splitPath (value) {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf('/')
  return {
    parent: index <= 0 ? '/' : normalized.slice(0, index),
    name: normalized.slice(index + 1) || 'root'
  }
}

function joinPath (...parts) {
  return normalizePath(parts.filter(Boolean).join('/'))
}

function formatTimestamp (now = new Date()) {
  return now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
}

function getFilePath (file) {
  return joinPath(file.path || '/', file.name)
}

async function ensureRemoteDir (sftp, path, createdDirs) {
  if (createdDirs?.has(path)) return
  try {
    await sftp.mkdir(path)
  } catch (err) {
    const message = String(err?.message || err)
    if (!/exist|failure|already/i.test(message)) throw err
  }
  createdDirs?.add(path)
}

export function buildSftpSafetyPath (sourcePath, kind = 'backup', now = new Date()) {
  const { parent, name } = splitPath(sourcePath)
  const safetyDir = safetyDirMap[kind] || safetyDirMap.backup
  return joinPath(parent, safetyDir, `${name}-${formatTimestamp(now)}`)
}

export function createSftpRecoveryRecord ({
  kind,
  sourcePath,
  backupPath,
  file,
  tab = {},
  now = new Date()
}) {
  return {
    id: `${kind}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'sftp',
    kind,
    title: kind === 'trash' ? 'SFTP 安全删除' : 'SFTP 快捷备份',
    sourcePath,
    target: sourcePath,
    backupPath,
    isDirectory: Boolean(file?.isDirectory),
    tabId: tab.id || '',
    host: tab.host || '',
    port: Number(tab.port || 22),
    username: tab.username || tab.user || '',
    serverTitle: tab.title || tab.name || '',
    createdAt: now.toISOString(),
    status: 'available',
    rollbackStatus: 'available'
  }
}

export function createSftpMutationRecoveryRecord ({
  kind,
  sourcePath,
  backupPath = '',
  previousMode,
  file,
  tab = {},
  now = new Date()
}) {
  const titleMap = {
    rename: 'SFTP 重命名',
    chmod: 'SFTP 权限修改'
  }
  return {
    id: `${kind}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'sftp',
    kind,
    title: titleMap[kind] || 'SFTP 修改操作',
    sourcePath,
    target: sourcePath,
    backupPath,
    previousMode,
    isDirectory: Boolean(file?.isDirectory),
    tabId: tab.id || '',
    host: tab.host || '',
    port: Number(tab.port || 22),
    username: tab.username || tab.user || '',
    serverTitle: tab.title || tab.name || '',
    createdAt: now.toISOString(),
    status: 'available',
    rollbackStatus: 'available'
  }
}

export async function backupRemoteFiles ({ sftp, files = [], tab, now = new Date() }) {
  const records = []
  const createdDirs = new Set()
  for (const file of files) {
    const sourcePath = getFilePath(file)
    const backupPath = buildSftpSafetyPath(sourcePath, 'backup', now)
    const backupDir = splitPath(backupPath).parent
    await ensureRemoteDir(sftp, backupDir, createdDirs)
    await sftp.cp(sourcePath, backupPath)
    records.push(createSftpRecoveryRecord({
      kind: 'backup',
      sourcePath,
      backupPath,
      file,
      tab,
      now
    }))
  }
  return records
}

export async function softDeleteRemoteFiles ({ sftp, files = [], tab, now = new Date() }) {
  const records = []
  const createdDirs = new Set()
  for (const file of files) {
    const sourcePath = getFilePath(file)
    const backupPath = buildSftpSafetyPath(sourcePath, 'trash', now)
    const trashDir = splitPath(backupPath).parent
    await ensureRemoteDir(sftp, trashDir, createdDirs)
    await sftp.rename(sourcePath, backupPath)
    records.push(createSftpRecoveryRecord({
      kind: 'trash',
      sourcePath,
      backupPath,
      file,
      tab,
      now
    }))
  }
  return records
}

export async function restoreSftpRecoveryRecord ({ sftp, record, now = new Date() }) {
  if (record.kind === 'chmod') {
    await sftp.chmod(record.sourcePath, record.previousMode)
    return {
      ...record,
      status: 'restored',
      rollbackStatus: 'completed',
      restoredAt: now.toISOString(),
      displacedPath: ''
    }
  }
  const displacedPath = buildSftpSafetyPath(record.sourcePath, 'displaced', now)
  let displaced = false
  try {
    await sftp.stat(record.sourcePath)
    await ensureRemoteDir(sftp, splitPath(displacedPath).parent)
    await sftp.rename(record.sourcePath, displacedPath)
    displaced = true
  } catch (err) {
    const message = String(err?.message || err)
    if (!/no such|not found|does not exist/i.test(message)) throw err
  }

  try {
    if (record.kind === 'trash' || record.kind === 'rename') {
      await sftp.rename(record.backupPath, record.sourcePath)
    } else {
      await sftp.cp(record.backupPath, record.sourcePath)
    }
  } catch (err) {
    if (displaced) {
      await sftp.rename(displacedPath, record.sourcePath).catch(() => {})
    }
    throw err
  }

  return {
    ...record,
    status: 'restored',
    rollbackStatus: 'completed',
    restoredAt: now.toISOString(),
    displacedPath: displaced ? displacedPath : ''
  }
}

export function mergeSftpRecoveryRecords (records = [], added = [], limit = 100) {
  const merged = [...added, ...records]
  const ids = new Set()
  return merged.filter(record => {
    if (!record?.id || ids.has(record.id)) return false
    ids.add(record.id)
    return true
  }).slice(0, limit)
}

export function findLatestSftpRecoveryRecord (records = [], sourcePath, tabId) {
  return records.find(record => {
    return record.status === 'available' &&
      record.sourcePath === sourcePath &&
      (!tabId || !record.tabId || record.tabId === tabId)
  })
}
