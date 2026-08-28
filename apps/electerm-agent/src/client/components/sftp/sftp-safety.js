import {
  freezeSafetyRecoveryBinding
} from '../../common/safety-operation-records.js'
import {
  assertSameSftpSafetyEndpoint,
  canonicalizeSftpSafetyEndpoint
} from './sftp-safety-endpoint.js'

const safetyDirMap = {
  backup: '.shellpilot-backups',
  trash: '.shellpilot-trash',
  displaced: '.shellpilot-before-restore'
}

const recoveryDescriptorFields = [
  'type', 'device', 'inode', 'size', 'mode', 'uid', 'gid', 'sha256'
]

function sameJsonValue (left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function requireRootRecoveryDescriptor (descriptor, label) {
  if (!descriptor || typeof descriptor !== 'object' ||
    !['file', 'directory'].includes(descriptor.type) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(descriptor.device ?? '')) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(descriptor.inode ?? '')) ||
    !Number.isSafeInteger(descriptor.size) || descriptor.size < 0 ||
    !Number.isInteger(descriptor.mode) ||
    !Number.isSafeInteger(descriptor.uid) ||
    !Number.isSafeInteger(descriptor.gid) ||
    !/^[a-f0-9]{64}$/.test(String(descriptor.sha256 || '')) ||
    Object.keys(descriptor).some(key => !recoveryDescriptorFields.includes(key))) {
    throw new Error(`root SFTP ${label}恢复证明无效。`)
  }
  return Object.fromEntries(recoveryDescriptorFields.map(key => (
    [key, descriptor[key]]
  )))
}

function requireRootRuntimeIdentity (identity) {
  if (!identity || identity.channel !== 'pty-root' ||
    String(identity.effectiveUid) !== '0' ||
    !String(identity.effectiveUsername || '').trim()) {
    throw new Error('root SFTP 恢复记录运行身份无效。')
  }
  return {
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: String(identity.effectiveUsername)
  }
}

export function createRootSftpRecoveryBinding ({
  endpoint,
  runtimeIdentity,
  source,
  backup
}) {
  return freezeSafetyRecoveryBinding({
    version: 1,
    endpoint: canonicalizeSftpSafetyEndpoint(endpoint),
    runtimeIdentity: requireRootRuntimeIdentity(runtimeIdentity),
    source: requireRootRecoveryDescriptor(source, '源文件'),
    backup: requireRootRecoveryDescriptor(backup, '备份文件')
  })
}

export function createSftpRecoveryUnboundError () {
  const error = new Error('旧版 root SFTP 恢复记录缺少精确会话与文件证明，已拒绝恢复。')
  error.code = 'REMOTE_FILE_RECOVERY_UNBOUND'
  error.legacyCode = 'ROOT_RECOVERY_UNBOUND'
  return error
}

export function createSftpRecoveryBindingMismatchError (cause) {
  const error = new Error('root SFTP 恢复记录的会话端点或文件证明已变化，已拒绝恢复。')
  error.code = 'REMOTE_FILE_RECOVERY_BINDING_MISMATCH'
  if (cause) error.cause = cause
  return error
}

export function assertRootSftpRecoveryBinding (record, {
  endpoint,
  runtimeIdentity,
  source,
  backup
}) {
  const binding = record?.metadata?.recoveryBinding
  if (!binding || binding.version !== 1) {
    throw createSftpRecoveryUnboundError()
  }
  const current = createRootSftpRecoveryBinding({
    endpoint,
    runtimeIdentity,
    source,
    backup
  })
  try {
    assertSameSftpSafetyEndpoint(binding.endpoint, current.endpoint)
  } catch (cause) {
    throw createSftpRecoveryBindingMismatchError(cause)
  }
  if (!sameJsonValue(binding.runtimeIdentity, current.runtimeIdentity) ||
    !sameJsonValue(binding.source, current.source) ||
    !sameJsonValue(binding.backup, current.backup)) {
    throw createSftpRecoveryBindingMismatchError()
  }
  return true
}

export function createSftpRecoveryUncertainError ({
  message = 'SFTP 恢复结果不确定，需要人工核对恢复记录。',
  primaryCause,
  rollbackCause,
  displacedPath,
  displacedDescriptor,
  record
} = {}) {
  const error = new Error(message)
  error.code = 'REMOTE_FILE_RECOVERY_UNCERTAIN'
  error.primaryCause = primaryCause
  error.rollbackCause = rollbackCause
  error.displacedPath = displacedPath || ''
  error.displacedDescriptor = displacedDescriptor
  error.recoveryRecord = record
  return error
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

async function describeDisplacedEntry (sftp, path) {
  if (typeof sftp?.describeRecoveryEntry === 'function') {
    return sftp.describeRecoveryEntry(path)
  }
  const stat = typeof sftp?.lstat === 'function'
    ? await sftp.lstat(path)
    : await sftp.stat(path)
  const directory = typeof stat?.isDirectory === 'function'
    ? stat.isDirectory()
    : Boolean(stat?.isDirectory || stat?.type === 'd' ||
      stat?.type === 'directory')
  return Object.freeze({
    type: directory ? 'directory' : 'file',
    size: Number(stat?.size || 0),
    mode: Number(stat?.mode || 0),
    uid: Number(stat?.uid ?? stat?.owner ?? 0),
    gid: Number(stat?.gid ?? stat?.group ?? 0)
  })
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

async function findAvailableSftpSafetyPath (sftp, basePath) {
  if (typeof sftp?.stat !== 'function') return basePath
  for (let index = 1; index <= 1000; index++) {
    const candidate = index === 1 ? basePath : `${basePath}-${index}`
    try {
      await sftp.stat(candidate)
    } catch (err) {
      const message = String(err?.message || err)
      if (/no such|not found|does not exist|enoent/i.test(message)) {
        return candidate
      }
      throw err
    }
  }
  throw new Error('SFTP 备份名称冲突过多，请清理历史备份后重试。')
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

export async function backupRemoteFiles ({
  sftp,
  files = [],
  tab,
  now = new Date(),
  onRecord
}) {
  const records = []
  const createdDirs = new Set()
  for (const file of files) {
    const sourcePath = getFilePath(file)
    const backupPath = await findAvailableSftpSafetyPath(
      sftp,
      buildSftpSafetyPath(sourcePath, 'backup', now)
    )
    const backupDir = splitPath(backupPath).parent
    await ensureRemoteDir(sftp, backupDir, createdDirs)
    await sftp.cp(sourcePath, backupPath)
    const record = createSftpRecoveryRecord({
      kind: 'backup',
      sourcePath,
      backupPath,
      file,
      tab,
      now
    })
    records.push(typeof onRecord === 'function'
      ? (await onRecord(record)) || record
      : record)
  }
  return records
}

export async function softDeleteRemoteFiles ({ sftp, files = [], tab, now = new Date() }) {
  const records = []
  const createdDirs = new Set()
  for (const file of files) {
    const sourcePath = getFilePath(file)
    const backupPath = await findAvailableSftpSafetyPath(
      sftp,
      buildSftpSafetyPath(sourcePath, 'trash', now)
    )
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

export async function restoreSftpRecoveryRecord ({
  sftp,
  record,
  now = new Date(),
  describeEntry,
  persistRecord
}) {
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
  const persistedDisplacement = record.displacement
  const displacedPath = persistedDisplacement?.path ||
    buildSftpSafetyPath(record.sourcePath, 'displaced', now)
  let currentRecord = record
  let displacement = persistedDisplacement || null
  const persist = async value => {
    currentRecord = typeof persistRecord === 'function'
      ? (await persistRecord(value)) || value
      : value
    return currentRecord
  }
  if (!displacement || displacement.status === 'planned') {
    let sourceExists = false
    try {
      await sftp.stat(record.sourcePath)
      sourceExists = true
    } catch (err) {
      const message = String(err?.message || err)
      if (!/no such|not found|does not exist/i.test(message)) throw err
    }
    if (sourceExists) {
      const displacedDescriptor = displacement?.descriptor ||
        (typeof describeEntry === 'function'
          ? await describeEntry(record.sourcePath)
          : await describeDisplacedEntry(sftp, record.sourcePath))
      displacement = {
        path: displacedPath,
        descriptor: displacedDescriptor,
        status: 'planned',
        plannedAt: displacement?.plannedAt || now.toISOString()
      }
      await persist({ ...currentRecord, displacement })
      await ensureRemoteDir(sftp, splitPath(displacedPath).parent)
      await sftp.rename(record.sourcePath, displacedPath)
      displacement = {
        ...displacement,
        status: 'displaced',
        displacedAt: now.toISOString()
      }
      await persist({ ...currentRecord, displacement })
    } else if (displacement?.status === 'planned') {
      try {
        await sftp.stat(displacedPath)
        displacement = {
          ...displacement,
          status: 'displaced',
          displacedAt: displacement.displacedAt || now.toISOString()
        }
        await persist({ ...currentRecord, displacement })
      } catch (err) {
        const message = String(err?.message || err)
        if (/no such|not found|does not exist/i.test(message)) {
          throw createSftpRecoveryUncertainError({
            message: 'SFTP 恢复位移状态无法确认，需要人工核对。',
            displacedPath,
            displacedDescriptor: displacement.descriptor,
            record: currentRecord
          })
        }
        throw err
      }
    }
  }

  try {
    if (record.kind === 'trash' || record.kind === 'rename') {
      await sftp.rename(record.backupPath, record.sourcePath)
    } else {
      await sftp.cp(record.backupPath, record.sourcePath)
    }
  } catch (err) {
    if (displacement?.status === 'displaced') {
      try {
        await sftp.rename(displacedPath, record.sourcePath)
        const compensatedDisplacement = {
          ...displacement,
          status: 'compensated',
          compensatedAt: now.toISOString()
        }
        await persist({
          ...currentRecord,
          status: 'failed',
          rollbackStatus: 'failed',
          displacement: null,
          lastDisplacement: compensatedDisplacement
        })
        if (Object.isExtensible(err)) err.recoveryRecord = currentRecord
      } catch (rollbackCause) {
        displacement = {
          ...displacement,
          status: 'uncertain',
          uncertainAt: now.toISOString()
        }
        const uncertainRecord = {
          ...currentRecord,
          status: 'uncertain',
          rollbackStatus: 'uncertain',
          displacement,
          error: `${err?.message || err}; 补偿失败：${rollbackCause?.message || rollbackCause}`,
          failedAt: now.toISOString()
        }
        let persistenceCause
        try {
          await persist(uncertainRecord)
        } catch (error) {
          persistenceCause = error
        }
        const uncertainError = createSftpRecoveryUncertainError({
          primaryCause: err,
          rollbackCause,
          displacedPath,
          displacedDescriptor: displacement.descriptor,
          record: uncertainRecord
        })
        if (persistenceCause) uncertainError.persistenceCause = persistenceCause
        throw uncertainError
      }
    }
    throw err
  }

  return {
    ...record,
    status: 'restored',
    rollbackStatus: 'completed',
    restoredAt: now.toISOString(),
    displacedPath: displacement?.status === 'displaced' ? displacedPath : '',
    ...(displacement
      ? {
          displacement: {
            ...displacement,
            status: displacement.status === 'displaced'
              ? 'preserved'
              : displacement.status
          }
        }
      : {})
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
