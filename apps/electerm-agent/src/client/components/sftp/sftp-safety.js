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

const displacementCandidateBudget = 16

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

function requireBoundAbsentRecoveryState (state, expectedPath) {
  const path = String(expectedPath || '')
  const parentPath = path.slice(0, path.lastIndexOf('/')) || '/'
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const parent = state?.parent
  const outerKeys = ['type', 'path', 'basename', 'mustBeAbsent', 'parent']
  const parentKeys = ['path', 'device', 'inode', 'mode', 'uid', 'gid']
  if (!path.startsWith('/') || path === '/' ||
    !state || typeof state !== 'object' || Array.isArray(state) ||
    Object.keys(state).length !== outerKeys.length ||
    outerKeys.some(key => !Object.hasOwn(state, key)) ||
    state.type !== 'bound-absent' || state.path !== path ||
    state.basename !== basename || state.mustBeAbsent !== true ||
    !parent || typeof parent !== 'object' || Array.isArray(parent) ||
    Object.keys(parent).length !== parentKeys.length ||
    parentKeys.some(key => !Object.hasOwn(parent, key)) ||
    parent.path !== parentPath ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(parent.device ?? '')) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(parent.inode ?? '')) ||
    !Number.isInteger(parent.mode) || parent.mode < 0 || parent.mode > 0o7777 ||
    !Number.isSafeInteger(parent.uid) || !Number.isSafeInteger(parent.gid)) {
    throw createSftpRecoveryBindingMismatchError()
  }
  return freezeSafetyRecoveryBinding(state)
}

function requireRootRuntimeIdentity (identity) {
  const fields = [
    'loginUsername', 'channel', 'effectiveUid', 'effectiveUsername'
  ]
  if (!identity || typeof identity !== 'object' || Array.isArray(identity) ||
    Object.keys(identity).length !== fields.length ||
    fields.some(field => !Object.hasOwn(identity, field)) ||
    typeof identity.loginUsername !== 'string' ||
    !identity.loginUsername.trim() ||
    identity.channel !== 'pty-root' ||
    identity.effectiveUid !== '0' ||
    typeof identity.effectiveUsername !== 'string' ||
    !identity.effectiveUsername.trim()) {
    throw new Error('root SFTP 恢复记录运行身份无效。')
  }
  return {
    loginUsername: identity.loginUsername,
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: identity.effectiveUsername
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

export function assertSftpRecoveryIdentityProvenance (record) {
  const binding = record?.metadata?.recoveryBinding
  const outerIdentity = record?.metadata?.runtimeIdentity
  if (!binding) {
    if (outerIdentity?.channel === 'pty-root') {
      throw createSftpRecoveryUnboundError()
    }
    return Object.freeze({ requiresRoot: false })
  }
  if (binding.version !== 1) throw createSftpRecoveryUnboundError()
  try {
    const boundIdentity = requireRootRuntimeIdentity(binding.runtimeIdentity)
    const normalizedOuter = requireRootRuntimeIdentity(outerIdentity)
    if (!sameJsonValue(boundIdentity, normalizedOuter)) {
      throw createSftpRecoveryBindingMismatchError()
    }
    return Object.freeze({
      requiresRoot: true,
      runtimeIdentity: freezeSafetyRecoveryBinding(boundIdentity)
    })
  } catch (cause) {
    if (cause?.code === 'REMOTE_FILE_RECOVERY_BINDING_MISMATCH') throw cause
    throw createSftpRecoveryBindingMismatchError(cause)
  }
}

export function assertRootSftpRecoveryBinding (record, {
  endpoint,
  runtimeIdentity,
  source,
  backup,
  sourcePath = record?.sourcePath,
  expectedSource
}) {
  const binding = record?.metadata?.recoveryBinding
  if (!binding || binding.version !== 1) {
    throw createSftpRecoveryUnboundError()
  }
  const originalBoundSource = requireRootRecoveryDescriptor(
    binding.source,
    '原始源文件'
  )
  const boundExpectedSource = expectedSource
    ? requireRootRecoveryDescriptor(expectedSource, '恢复中源文件')
    : originalBoundSource
  const current = createRootSftpRecoveryBinding({
    endpoint,
    runtimeIdentity,
    source: source?.type === 'bound-absent' ? boundExpectedSource : source,
    backup
  })
  try {
    assertSameSftpSafetyEndpoint(binding.endpoint, current.endpoint)
  } catch (cause) {
    throw createSftpRecoveryBindingMismatchError(cause)
  }
  const sourceMatches = source?.type === 'bound-absent'
    ? Boolean(requireBoundAbsentRecoveryState(source, sourcePath))
    : sameJsonValue(boundExpectedSource, current.source)
  if (!sameJsonValue(binding.runtimeIdentity, current.runtimeIdentity) ||
    !sourceMatches ||
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
  persistRecord,
  recoveryProof,
  generateDisplacementToken = generateSecureDisplacementToken
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
  const displacedBasePath = buildSftpSafetyPath(
    record.sourcePath,
    'displaced',
    now
  )
  let displacedPath = persistedDisplacement?.path || ''
  let currentRecord = record
  let displacement = persistedDisplacement || null
  const proofBound = Boolean(recoveryProof &&
    typeof sftp?.copyEntry === 'function' &&
    typeof sftp?.removeEntry === 'function' &&
    typeof describeEntry === 'function')
  if (recoveryProof && !proofBound) {
    throw createSftpRecoveryBindingMismatchError(new Error(
      'root SFTP 恢复后端缺少证明绑定方法。'
    ))
  }
  let restoreTargetState = recoveryProof?.source
  const persist = async value => {
    currentRecord = typeof persistRecord === 'function'
      ? (await persistRecord(value)) || value
      : value
    return currentRecord
  }
  const observeRecoveryDescriptor = async path => {
    try {
      return {
        descriptor: await describeEntry(path, { allowAbsent: true })
      }
    } catch (error) {
      let descriptor = null
      if (error?.actualDescriptor &&
        typeof error.actualDescriptor === 'object') {
        try {
          descriptor = freezeSafetyRecoveryBinding(error.actualDescriptor)
        } catch {}
      }
      return {
        descriptor,
        observationFailure: freezeSafetyRecoveryBinding({
          path,
          code: String(error?.code || ''),
          message: error?.message || String(error)
        })
      }
    }
  }
  const persistProofMismatch = async primaryCause => {
    const proofMismatch = freezeSafetyRecoveryBinding({
      path: String(primaryCause?.path || ''),
      expectedDescriptor: primaryCause?.expectedDescriptor,
      actualDescriptor: primaryCause?.actualDescriptor
    })
    const uncertainRecord = {
      ...currentRecord,
      status: 'uncertain',
      rollbackStatus: 'uncertain',
      ...(displacement ? { displacement } : {}),
      proofMismatch,
      error: primaryCause?.message || String(primaryCause),
      failedAt: now.toISOString()
    }
    await persist(uncertainRecord)
    return createSftpRecoveryUncertainError({
      message: 'SFTP 恢复证明在实际修改时发生变化，已保留精确证据供核对。',
      primaryCause,
      displacedPath: displacement?.path,
      displacedDescriptor: displacement?.descriptor,
      record: uncertainRecord
    })
  }
  if (proofBound && displacement?.status === 'duplicated') {
    const retainedDisplacements = [
      ...(Array.isArray(currentRecord.retainedDisplacements)
        ? currentRecord.retainedDisplacements
        : []),
      {
        ...displacement,
        status: 'preserved-duplicate',
        preservedAt: now.toISOString()
      }
    ]
    await persist({
      ...currentRecord,
      retainedDisplacements,
      displacement: null
    })
    displacement = null
    displacedPath = ''
  }
  if (!displacement || displacement.status === 'planned') {
    let sourceExists = proofBound
      ? recoveryProof.source?.type !== 'bound-absent'
      : false
    if (!proofBound) {
      try {
        await sftp.stat(record.sourcePath)
        sourceExists = true
      } catch (err) {
        const message = String(err?.message || err)
        if (!/no such|not found|does not exist/i.test(message)) throw err
      }
    }
    if (sourceExists) {
      let displacedDescriptor = displacement?.descriptor ||
        (proofBound
          ? recoveryProof.source
          : typeof describeEntry === 'function'
            ? await describeEntry(record.sourcePath)
            : await describeDisplacedEntry(sftp, record.sourcePath))
      let displacedTargetState
      let displacementAttempts = 0
      const collisionHistory = [
        ...(Array.isArray(displacement?.collisionHistory)
          ? displacement.collisionHistory
          : [])
      ]
      const rememberCollision = (path, descriptor, expectedDescriptor) => {
        collisionHistory.push(freezeSafetyRecoveryBinding({
          path,
          descriptor,
          ...(expectedDescriptor ? { expectedDescriptor } : {}),
          observedAt: now.toISOString()
        }))
      }
      const planProofBoundDisplacement = async () => {
        while (displacementAttempts < displacementCandidateBudget) {
          displacementAttempts += 1
          const token = requireDisplacementToken(
            generateDisplacementToken()
          )
          const candidatePath = `${displacedBasePath}-${token}`
          const candidateState = await describeEntry(candidatePath, {
            allowAbsent: true
          })
          if (candidateState?.type !== 'bound-absent') {
            rememberCollision(candidatePath, candidateState)
            continue
          }
          displacedPath = candidatePath
          displacedTargetState = requireBoundAbsentRecoveryState(
            candidateState,
            candidatePath
          )
          displacement = {
            path: displacedPath,
            descriptor: displacedDescriptor,
            targetState: displacedTargetState,
            collisionHistory: [...collisionHistory],
            status: 'planned',
            plannedAt: now.toISOString()
          }
          await persist({ ...currentRecord, displacement })
          return
        }
        const planning = freezeSafetyRecoveryBinding({
          status: 'collision-exhausted',
          collisionHistory,
          exhaustedAt: now.toISOString()
        })
        const uncertainRecord = {
          ...currentRecord,
          status: 'uncertain',
          rollbackStatus: 'uncertain',
          displacement: null,
          displacementPlanning: planning,
          error: 'SFTP 恢复位移名称冲突预算已耗尽。',
          failedAt: now.toISOString()
        }
        await persist(uncertainRecord)
        throw createSftpRecoveryCollisionError(
          planning.collisionHistory,
          uncertainRecord
        )
      }
      if (proofBound) {
        await ensureRemoteDir(sftp, splitPath(displacedBasePath).parent)
        if (displacement?.status === 'planned' && displacement.path) {
          displacedPath = displacement.path
          const persistedTargetState = displacement.targetState
          const candidateState = await describeEntry(displacedPath, {
            allowAbsent: true
          })
          if (persistedTargetState?.type === 'bound-absent' &&
            sameJsonValue(persistedTargetState, candidateState)) {
            displacedTargetState = requireBoundAbsentRecoveryState(
              candidateState,
              displacedPath
            )
          } else {
            rememberCollision(
              displacedPath,
              candidateState,
              persistedTargetState
            )
            displacement = null
            displacedPath = ''
            await planProofBoundDisplacement()
          }
        } else {
          await planProofBoundDisplacement()
        }
      } else {
        displacedPath ||= displacedBasePath
        await ensureRemoteDir(sftp, splitPath(displacedPath).parent)
        displacement = {
          path: displacedPath,
          descriptor: displacedDescriptor,
          status: 'planned',
          plannedAt: displacement?.plannedAt || now.toISOString()
        }
        await persist({ ...currentRecord, displacement })
      }
      if (proofBound) {
        let copiedDescriptor
        let copyCompleted = false
        while (!copyCompleted) {
          try {
            copiedDescriptor = await sftp.copyEntry(
              record.sourcePath,
              displacedPath,
              {
                expectedSource: displacedDescriptor,
                expectedTarget: displacedTargetState
              }
            )
            copyCompleted = true
          } catch (primaryCause) {
            const targetObservation = await observeRecoveryDescriptor(
              displacedPath
            )
            const targetOccupied = targetObservation.descriptor &&
              targetObservation.descriptor.type !== 'bound-absent'
            const targetProofCollision =
              primaryCause?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH' &&
              primaryCause.path === displacedPath
            const noClobberCollision = primaryCause?.code === 'EEXIST' ||
              /already exists|file exists|eexist/i.test(
                String(primaryCause?.message || '')
              )
            if (targetOccupied &&
              (targetProofCollision || noClobberCollision)) {
              rememberCollision(
                displacedPath,
                targetObservation.descriptor,
                displacedTargetState
              )
              displacement = null
              displacedPath = ''
              await planProofBoundDisplacement()
              continue
            }
            if (primaryCause?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') {
              throw await persistProofMismatch(primaryCause)
            }
            throw primaryCause
          }
        }
        displacedDescriptor = await describeEntry(displacedPath)
        if (copiedDescriptor && typeof copiedDescriptor === 'object' &&
          !sameJsonValue(copiedDescriptor, displacedDescriptor)) {
          const mismatch = new Error(
            'root SFTP displaced copy 在源删除前被替换。'
          )
          mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
          mismatch.path = displacedPath
          mismatch.expectedDescriptor = copiedDescriptor
          mismatch.actualDescriptor = displacedDescriptor
          throw await persistProofMismatch(mismatch)
        }
        try {
          await sftp.removeEntry(record.sourcePath, {
            expectedSource: recoveryProof.source,
            expectedPeer: {
              path: displacedPath,
              descriptor: displacedDescriptor
            }
          })
        } catch (primaryCause) {
          const sourceObservation = await observeRecoveryDescriptor(
            record.sourcePath
          )
          const sourceDescriptor = sourceObservation.descriptor
          displacement = {
            ...displacement,
            descriptor: displacedDescriptor,
            sourceDescriptor,
            ...(sourceObservation.observationFailure
              ? { sourceObservationFailure: sourceObservation.observationFailure }
              : {}),
            status: 'duplicated',
            duplicatedAt: now.toISOString()
          }
          const uncertainRecord = {
            ...currentRecord,
            status: 'uncertain',
            rollbackStatus: 'uncertain',
            displacement,
            error: primaryCause?.message || String(primaryCause),
            failedAt: now.toISOString()
          }
          await persist(uncertainRecord)
          const uncertainError = createSftpRecoveryUncertainError({
            message: 'SFTP 恢复位移只完成了证明副本，源路径未能精确删除。',
            primaryCause,
            displacedPath,
            displacedDescriptor,
            record: uncertainRecord
          })
          uncertainError.sourceDescriptor = sourceDescriptor
          throw uncertainError
        }
        restoreTargetState = await describeEntry(
          record.sourcePath,
          { allowAbsent: true }
        )
        const finalDisplacedObservation = await observeRecoveryDescriptor(
          displacedPath
        )
        const finalDisplacedDescriptor =
          finalDisplacedObservation.descriptor
        if (!finalDisplacedDescriptor ||
          !sameJsonValue(displacedDescriptor, finalDisplacedDescriptor)) {
          displacement = {
            ...displacement,
            descriptor: displacedDescriptor,
            sourceState: restoreTargetState,
            ...(finalDisplacedObservation.observationFailure
              ? {
                  displacedObservationFailure:
                    finalDisplacedObservation.observationFailure
                }
              : {}),
            status: 'uncertain',
            uncertainAt: now.toISOString()
          }
          const mismatch = new Error(
            'root SFTP displaced copy 在源删除期间被替换。'
          )
          mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
          mismatch.path = displacedPath
          mismatch.expectedDescriptor = displacedDescriptor
          mismatch.actualDescriptor = finalDisplacedDescriptor
          throw await persistProofMismatch(mismatch)
        }
      } else {
        await sftp.rename(record.sourcePath, displacedPath)
      }
      displacement = {
        ...displacement,
        descriptor: displacedDescriptor,
        ...(restoreTargetState
          ? { sourceState: restoreTargetState }
          : {}),
        status: 'displaced',
        displacedAt: now.toISOString()
      }
      await persist({ ...currentRecord, displacement })
    } else if (displacement?.status === 'planned') {
      if (proofBound) {
        const displacedState = recoveryProof.displaced ||
          await describeEntry(displacedPath, { allowAbsent: true })
        if (displacedState?.type === 'bound-absent' ||
          !sameJsonValue(displacedState, displacement.descriptor)) {
          const mismatch = new Error(
            'root SFTP planned displacement 恢复证明发生变化。'
          )
          mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
          mismatch.path = displacedPath
          mismatch.expectedDescriptor = displacement.descriptor
          mismatch.actualDescriptor = displacedState
          throw await persistProofMismatch(mismatch)
        }
        displacement = {
          ...displacement,
          descriptor: displacedState,
          sourceState: restoreTargetState,
          status: 'displaced',
          displacedAt: displacement.displacedAt || now.toISOString()
        }
        await persist({ ...currentRecord, displacement })
      } else {
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
  }

  let installedCopyDescriptor
  try {
    if (proofBound) {
      installedCopyDescriptor = await sftp.copyEntry(
        record.backupPath,
        record.sourcePath,
        {
          expectedSource: recoveryProof.backup,
          expectedTarget: restoreTargetState
        }
      )
    } else if (record.kind === 'trash' || record.kind === 'rename') {
      await sftp.rename(record.backupPath, record.sourcePath)
    } else {
      await sftp.cp(record.backupPath, record.sourcePath)
    }
  } catch (err) {
    if (err?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH' &&
      displacement?.status !== 'displaced') {
      throw await persistProofMismatch(err)
    }
    if (displacement?.status === 'displaced') {
      let compensationCopied = false
      let compensationRemoved = false
      let compensationTargetDescriptor
      try {
        if (proofBound) {
          const copiedDescriptor = await sftp.copyEntry(
            displacedPath,
            record.sourcePath,
            {
              expectedSource: displacement.descriptor,
              expectedTarget: displacement.sourceState || restoreTargetState
            }
          )
          compensationCopied = true
          compensationTargetDescriptor = await describeEntry(
            record.sourcePath
          )
          if (copiedDescriptor && typeof copiedDescriptor === 'object' &&
            !sameJsonValue(
              copiedDescriptor,
              compensationTargetDescriptor
            )) {
            const mismatch = new Error(
              'root SFTP compensation copy 在精确删除前被替换。'
            )
            mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
            mismatch.path = record.sourcePath
            mismatch.expectedDescriptor = copiedDescriptor
            mismatch.actualDescriptor = compensationTargetDescriptor
            throw mismatch
          }
          await sftp.removeEntry(displacedPath, {
            expectedSource: displacement.descriptor,
            expectedPeer: {
              path: record.sourcePath,
              descriptor: compensationTargetDescriptor
            }
          })
          compensationRemoved = true
          const finalCompensationTarget = await describeEntry(
            record.sourcePath
          )
          if (!sameJsonValue(
            compensationTargetDescriptor,
            finalCompensationTarget
          )) {
            const mismatch = new Error(
              'root SFTP compensation target 在位移副本删除期间被替换。'
            )
            mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
            mismatch.path = record.sourcePath
            mismatch.expectedDescriptor = compensationTargetDescriptor
            mismatch.actualDescriptor = finalCompensationTarget
            throw mismatch
          }
        } else {
          await sftp.rename(displacedPath, record.sourcePath)
        }
        const compensatedDisplacement = {
          ...displacement,
          status: 'compensated',
          compensatedAt: now.toISOString()
        }
        const proofMismatch = err?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
          ? freezeSafetyRecoveryBinding({
            path: String(err.path || ''),
            expectedDescriptor: err.expectedDescriptor,
            actualDescriptor: err.actualDescriptor
          })
          : null
        await persist({
          ...currentRecord,
          status: proofMismatch ? 'uncertain' : 'failed',
          rollbackStatus: proofMismatch ? 'uncertain' : 'failed',
          displacement: null,
          lastDisplacement: compensatedDisplacement,
          ...(proofMismatch ? { proofMismatch } : {})
        })
        if (Object.isExtensible(err)) err.recoveryRecord = currentRecord
      } catch (rollbackCause) {
        let compensationSourceDescriptor
        let compensationDisplacedDescriptor
        let compensationSourceObservationFailure
        let compensationDisplacedObservationFailure
        if (proofBound && compensationCopied) {
          const [sourceObservation, displacedObservation] = await Promise.all([
            observeRecoveryDescriptor(record.sourcePath),
            observeRecoveryDescriptor(displacedPath)
          ])
          compensationSourceDescriptor = sourceObservation.descriptor
          compensationDisplacedDescriptor = displacedObservation.descriptor
          compensationSourceObservationFailure =
            sourceObservation.observationFailure
          compensationDisplacedObservationFailure =
            displacedObservation.observationFailure
        }
        displacement = {
          ...displacement,
          ...(compensationCopied && !compensationRemoved
            ? {
                descriptor: compensationDisplacedDescriptor,
                sourceDescriptor: compensationSourceDescriptor,
                ...(compensationSourceObservationFailure
                  ? {
                      sourceObservationFailure:
                        compensationSourceObservationFailure
                    }
                  : {}),
                ...(compensationDisplacedObservationFailure
                  ? {
                      displacedObservationFailure:
                        compensationDisplacedObservationFailure
                    }
                  : {}),
                status: 'duplicated',
                duplicatedAt: now.toISOString()
              }
            : compensationCopied
              ? {
                  descriptor: compensationDisplacedDescriptor,
                  sourceDescriptor: compensationSourceDescriptor,
                  ...(compensationSourceObservationFailure
                    ? {
                        sourceObservationFailure:
                          compensationSourceObservationFailure
                      }
                    : {}),
                  ...(compensationDisplacedObservationFailure
                    ? {
                        displacedObservationFailure:
                          compensationDisplacedObservationFailure
                      }
                    : {}),
                  status: 'uncertain',
                  uncertainAt: now.toISOString()
                }
              : {
                  status: 'uncertain',
                  uncertainAt: now.toISOString()
                })
        }
        const mismatch = [err, rollbackCause].find(error => (
          error?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
        ))
        const uncertainRecord = {
          ...currentRecord,
          status: 'uncertain',
          rollbackStatus: 'uncertain',
          displacement,
          ...(mismatch
            ? {
                proofMismatch: freezeSafetyRecoveryBinding({
                  path: String(mismatch.path || ''),
                  expectedDescriptor: mismatch.expectedDescriptor,
                  actualDescriptor: mismatch.actualDescriptor
                })
              }
            : {}),
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

  if (proofBound && (record.kind === 'trash' || record.kind === 'rename')) {
    let installedDescriptor
    let backupRemoved = false
    try {
      installedDescriptor = await describeEntry(record.sourcePath)
      if (installedCopyDescriptor &&
        typeof installedCopyDescriptor === 'object' &&
        !sameJsonValue(installedCopyDescriptor, installedDescriptor)) {
        const mismatch = new Error(
          'root SFTP restored target 在备份精确删除前被替换。'
        )
        mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
        mismatch.path = record.sourcePath
        mismatch.expectedDescriptor = installedCopyDescriptor
        mismatch.actualDescriptor = installedDescriptor
        throw mismatch
      }
      await sftp.removeEntry(record.backupPath, {
        expectedSource: recoveryProof.backup,
        expectedPeer: {
          path: record.sourcePath,
          descriptor: installedDescriptor
        }
      })
      backupRemoved = true
      const finalInstalledDescriptor = await describeEntry(record.sourcePath)
      if (!sameJsonValue(installedDescriptor, finalInstalledDescriptor)) {
        const mismatch = new Error(
          'root SFTP restored target 在备份删除期间被替换。'
        )
        mismatch.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
        mismatch.path = record.sourcePath
        mismatch.expectedDescriptor = installedDescriptor
        mismatch.actualDescriptor = finalInstalledDescriptor
        throw mismatch
      }
    } catch (primaryCause) {
      const [sourceObservation, backupObservation] = await Promise.all([
        observeRecoveryDescriptor(record.sourcePath),
        observeRecoveryDescriptor(record.backupPath)
      ])
      const sourceDescriptor = sourceObservation.descriptor
      const backupDescriptor = backupObservation.descriptor
      const mismatch = primaryCause?.code ===
        'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
        ? freezeSafetyRecoveryBinding({
          path: String(primaryCause.path || record.backupPath),
          expectedDescriptor: primaryCause.expectedDescriptor,
          actualDescriptor: primaryCause.actualDescriptor
        })
        : null
      const backupDisposition = freezeSafetyRecoveryBinding({
        status: backupRemoved ? 'removed-uncertain' : 'duplicated',
        sourcePath: record.sourcePath,
        sourceDescriptor,
        backupPath: record.backupPath,
        backupDescriptor,
        ...(sourceObservation.observationFailure
          ? { sourceObservationFailure: sourceObservation.observationFailure }
          : {}),
        ...(backupObservation.observationFailure
          ? { backupObservationFailure: backupObservation.observationFailure }
          : {}),
        duplicatedAt: now.toISOString()
      })
      const uncertainRecord = {
        ...currentRecord,
        status: 'uncertain',
        rollbackStatus: 'uncertain',
        ...(displacement ? { displacement } : {}),
        backupDisposition,
        ...(mismatch ? { proofMismatch: mismatch } : {}),
        error: primaryCause?.message || String(primaryCause),
        failedAt: now.toISOString()
      }
      await persist(uncertainRecord)
      const uncertainError = createSftpRecoveryUncertainError({
        message: 'SFTP 恢复内容已安装，但原备份未能精确删除，已保留两侧证明。',
        primaryCause,
        displacedPath: displacement?.path,
        displacedDescriptor: displacement?.descriptor,
        record: uncertainRecord
      })
      uncertainError.sourceDescriptor = sourceDescriptor
      uncertainError.backupDescriptor = backupDescriptor
      throw uncertainError
    }
  }

  return {
    ...currentRecord,
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

function generateSecureDisplacementToken () {
  const random = globalThis.crypto?.getRandomValues
  if (typeof random !== 'function') {
    throw new Error('当前环境无法生成安全的 SFTP 恢复位移名称。')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

function requireDisplacementToken (value) {
  const token = String(value || '')
  if (!/^[a-f0-9]{24,64}$/.test(token)) {
    throw new Error('SFTP 恢复位移随机标识无效。')
  }
  return token
}

function createSftpRecoveryCollisionError (history, recoveryRecord) {
  const error = new Error('SFTP 恢复位移名称在安全尝试预算内均被占用。')
  error.code = 'REMOTE_FILE_RECOVERY_COLLISION'
  error.collisionHistory = history
  error.recoveryRecord = recoveryRecord
  error.displacementPlanning = recoveryRecord?.displacementPlanning
  return error
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
