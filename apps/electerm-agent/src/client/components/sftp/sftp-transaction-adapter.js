const digestChunkBytes = 64 * 1024
const maxManifestBytes = 256 * 1024
const maxDescriptorDepth = 128
const maxDescriptorNodes = 10000
const digestAlgorithm = 'SHELLPILOT-SHA-256-CHAIN-V1'
const fileTypeMask = 0o170000
const fileTypeModes = {
  0o100000: 'file',
  0o040000: 'directory',
  0o120000: 'symlink'
}

function joinRemotePath (...parts) {
  const result = []
  for (const part of parts.join('/').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') result.pop()
    else result.push(part)
  }
  return `/${result.join('/')}`
}

function parentRemotePath (value) {
  const path = joinRemotePath(value)
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

function safeOperationId (value) {
  const id = String(value || '')
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(id)) {
    throw new Error('SFTP 安全事务标识无效。')
  }
  return id
}

function isMissingError (error) {
  const code = error?.code
  return code === 2 || code === 'ENOENT' || code === 'SFTP_NO_SUCH_FILE' ||
    /no such|not found|does not exist/i.test(String(error?.message || error))
}

function bytesFromBase64 (value) {
  const binary = globalThis.atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function concatBytes (...values) {
  const length = values.reduce((total, value) => total + value.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.byteLength
  }
  return result
}

function lengthBytes (value) {
  let remaining = BigInt(value)
  const result = new Uint8Array(8)
  for (let index = result.length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

async function sha256Bytes (value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 SFTP 快照摘要计算。')
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value))
}

function hexBytes (value) {
  return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

class BoundedDigest {
  constructor () {
    this.state = new Uint8Array(32)
    this.block = new Uint8Array(digestChunkBytes)
    this.used = 0
    this.size = 0
  }

  async update (value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    let offset = 0
    while (offset < bytes.byteLength) {
      const length = Math.min(
        this.block.byteLength - this.used,
        bytes.byteLength - offset
      )
      this.block.set(bytes.subarray(offset, offset + length), this.used)
      this.used += length
      this.size += length
      offset += length
      if (this.used === this.block.byteLength) {
        this.state = await sha256Bytes(concatBytes(
          this.state,
          new Uint8Array([0]),
          this.block
        ))
        this.used = 0
      }
    }
  }

  async finish () {
    const digest = await sha256Bytes(concatBytes(
      this.state,
      new Uint8Array([1]),
      this.block.subarray(0, this.used),
      lengthBytes(this.size)
    ))
    return {
      size: this.size,
      digest: hexBytes(digest),
      digestAlgorithm
    }
  }
}

export async function digestSftpText (text) {
  const value = String(text ?? '')
  const digest = new BoundedDigest()
  const encoder = new TextEncoder()
  const characterChunk = 16 * 1024
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + characterChunk)
    const last = value.charCodeAt(end - 1)
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    await digest.update(encoder.encode(value.slice(offset, end)))
    offset = end
  }
  return digest.finish()
}

async function digestRemoteFile (sftp, path, expectedSize) {
  if (typeof sftp.readFileChunk !== 'function') {
    throw new Error('当前 SFTP 连接不支持有界文件摘要读取。')
  }
  const digest = new BoundedDigest()
  let offset = 0
  let totalBytes
  do {
    const chunk = await sftp.readFileChunk(path, {
      offset,
      maxBytes: digestChunkBytes
    })
    if (!chunk || chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.nextOffset) || chunk.nextOffset < offset ||
      !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes < 0) {
      throw new Error('SFTP 分块读取结果无效，已停止摘要计算。')
    }
    if (totalBytes !== undefined && chunk.totalBytes !== totalBytes) {
      throw new Error('SFTP 文件在摘要计算期间发生变化。')
    }
    totalBytes = chunk.totalBytes
    const bytes = bytesFromBase64(chunk.base64)
    if (bytes.byteLength !== chunk.bytesRead ||
      chunk.nextOffset !== offset + bytes.byteLength ||
      (chunk.hasMore && bytes.byteLength === 0)) {
      throw new Error('SFTP 分块读取长度无效，已停止摘要计算。')
    }
    await digest.update(bytes)
    offset = chunk.nextOffset
  } while (offset < totalBytes)
  const result = await digest.finish()
  if (result.size !== totalBytes ||
    (expectedSize !== undefined && result.size !== expectedSize)) {
    throw new Error('SFTP 文件大小与摘要读取结果不一致。')
  }
  return result
}

function typeFromStat (stat) {
  return fileTypeModes[Number(stat?.mode) & fileTypeMask] ||
    (stat?.isDirectory === true ? 'directory' : 'special')
}

function safeMode (stat) {
  return Number(stat?.mode) & 0o7777
}

async function lstatOrAbsent (sftp, path) {
  try {
    return await sftp.lstat(path)
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

function assertSupportedType (type) {
  if (type === 'symlink') {
    throw new Error('SFTP 符号链接首版不支持安全事务，已拒绝操作。')
  }
  if (!['file', 'directory'].includes(type)) {
    throw new Error('SFTP 特殊文件首版不支持安全事务，已拒绝操作。')
  }
}

function assertEntryName (name) {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error('SFTP 目录项名称无效，无法完成整树快照。')
  }
}

function createDescriptorBudget () {
  return { remainingNodes: maxDescriptorNodes }
}

async function describeModeEntry (sftp, path) {
  const stat = await lstatOrAbsent(sftp, path)
  if (!stat) return { absent: true }
  const type = typeFromStat(stat)
  assertSupportedType(type)
  return { type, mode: safeMode(stat) }
}

async function describeEntry (
  sftp,
  path,
  budget = createDescriptorBudget(),
  depth = 0
) {
  if (depth > maxDescriptorDepth || budget.remainingNodes <= 0) {
    throw new Error('SFTP 目录快照超过深度或节点上限，已拒绝继续操作。')
  }
  budget.remainingNodes -= 1
  const stat = await lstatOrAbsent(sftp, path)
  if (!stat) return { absent: true }
  const type = typeFromStat(stat)
  assertSupportedType(type)
  const descriptor = {
    type,
    mode: safeMode(stat)
  }
  if (type === 'file') {
    const digest = await digestRemoteFile(sftp, path, Number(stat.size))
    return { ...descriptor, ...digest }
  }
  const entries = await sftp.list(path)
  if (!Array.isArray(entries)) {
    throw new Error('SFTP 目录列表无效，无法完成整树快照。')
  }
  descriptor.entries = []
  for (const entry of [...entries].sort((left, right) => (
    String(left.name).localeCompare(String(right.name))
  ))) {
    const name = String(entry?.name || '')
    assertEntryName(name)
    descriptor.entries.push({
      name,
      entry: await describeEntry(
        sftp,
        joinRemotePath(path, name),
        budget,
        depth + 1
      )
    })
  }
  return descriptor
}

function sameDescriptor (left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function matchesExpected (descriptor, expected) {
  if (expected?.absent === true) return descriptor?.absent === true
  if (descriptor?.absent === true) return false
  if (expected?.type && descriptor.type !== expected.type) return false
  if (expected?.mode !== undefined && descriptor.mode !== expected.mode) return false
  if (expected?.size !== undefined && descriptor.size !== expected.size) return false
  if (expected?.digest && descriptor.digest !== expected.digest) return false
  if (expected?.digestAlgorithm &&
    descriptor.digestAlgorithm !== expected.digestAlgorithm) return false
  return true
}

async function ensureDirectory (sftp, path) {
  const normalized = joinRemotePath(path)
  if (normalized === '/') return
  const existing = await lstatOrAbsent(sftp, normalized)
  if (existing) {
    if (typeFromStat(existing) !== 'directory') {
      throw new Error('SFTP 事务目录路径已被非目录占用。')
    }
    return
  }
  await ensureDirectory(sftp, parentRemotePath(normalized))
  try {
    await sftp.mkdir(normalized)
  } catch (error) {
    if (error?.code !== 'EEXIST' && !/already exists/i.test(String(error?.message || error))) {
      throw error
    }
    const created = await lstatOrAbsent(sftp, normalized)
    if (!created || typeFromStat(created) !== 'directory') throw error
  }
}

async function removeTransactionEntry (sftp, path) {
  const stat = await lstatOrAbsent(sftp, path)
  if (!stat) return
  if (typeof sftp.removeEntry !== 'function') {
    throw new Error('当前 SFTP 连接不支持纯 SFTP 删除。')
  }
  await sftp.removeEntry(path)
}

function buildPlanSkeleton (operation) {
  const action = operation.effect.action
  const paths = operation.effect.paths
  const primary = paths.source || paths.target
  if (primary === '/') {
    throw new Error('SFTP 根目录不支持首版安全事务。')
  }
  const operationDir = joinRemotePath(
    parentRemotePath(primary),
    '.shellpilot-transactions',
    safeOperationId(operation.id)
  )
  const slots = action === 'rename'
    ? [['source', paths.source], ['target', paths.target]]
    : [[action === 'editor-save' ? 'target' : 'source', primary]]
  return {
    adapter: 'sftp',
    action,
    operationDir,
    manifestPath: joinRemotePath(operationDir, 'manifest.json'),
    resources: slots.map(([slot, path]) => ({
      slot,
      path,
      snapshotPath: joinRemotePath(operationDir, slot),
      stagingPath: joinRemotePath(operationDir, `${slot}.preparing`),
      executionPath: joinRemotePath(operationDir, `${slot}.execute`),
      executionPreviousPath: joinRemotePath(
        operationDir,
        `${slot}.execute-previous`
      ),
      restoreTempPath: joinRemotePath(operationDir, `${slot}.restore-temp`),
      displacedPath: joinRemotePath(operationDir, `${slot}.displaced`)
    }))
  }
}

function buildArtifacts (plan) {
  return Object.fromEntries([
    ['manifest', plan.manifestPath],
    ...(plan.action === 'chmod'
      ? []
      : plan.resources.map(resource => [resource.slot, resource.snapshotPath]))
  ])
}

async function readBoundedText (sftp, path) {
  let offset = 0
  let totalBytes
  const chunks = []
  do {
    const chunk = await sftp.readFileChunk(path, {
      offset,
      maxBytes: Math.min(digestChunkBytes, maxManifestBytes - offset)
    })
    if (!chunk || chunk.offset !== offset || chunk.nextOffset <= offset ||
      chunk.totalBytes > maxManifestBytes) {
      throw new Error('SFTP 恢复清单超出上限或分块无效。')
    }
    totalBytes = chunk.totalBytes
    chunks.push(bytesFromBase64(chunk.base64))
    offset = chunk.nextOffset
  } while (offset < totalBytes)
  return new TextDecoder().decode(concatBytes(...chunks))
}

async function verifySnapshot (sftp, resource) {
  if (resource.original.absent === true) return
  const snapshot = await describeEntry(sftp, resource.snapshotPath)
  if (!sameDescriptor(snapshot, resource.original)) {
    throw new Error('SFTP 快照校验失败，已拒绝继续操作。')
  }
}

async function validateManifest (sftp, operation, manifest) {
  const expected = buildPlanSkeleton(operation)
  if (manifest?.schemaVersion !== 1 || manifest?.complete !== true ||
    manifest.id !== operation.id || manifest.effectKey !== operation.effectKey ||
    manifest.endpointKey !== operation.endpointKey ||
    manifest.plan?.adapter !== 'sftp' ||
    manifest.plan?.operationDir !== expected.operationDir ||
    manifest.plan?.manifestPath !== expected.manifestPath ||
    manifest.plan?.action !== operation.effect.action ||
    !Array.isArray(manifest.plan?.resources) ||
    manifest.plan.resources.length !== expected.resources.length) {
    throw new Error('SFTP 恢复清单与当前事务不匹配。')
  }
  for (let index = 0; index < expected.resources.length; index += 1) {
    const actual = manifest.plan.resources[index]
    const skeleton = expected.resources[index]
    for (const field of [
      'slot',
      'path',
      'snapshotPath',
      'stagingPath',
      'executionPath',
      'executionPreviousPath',
      'restoreTempPath',
      'displacedPath'
    ]) {
      if (actual?.[field] !== skeleton[field]) {
        throw new Error('SFTP 恢复清单资源路径已被修改。')
      }
    }
    if (manifest.plan.action !== 'chmod') await verifySnapshot(sftp, actual)
  }
  const artifacts = buildArtifacts(manifest.plan)
  if (!sameDescriptor(artifacts, manifest.artifacts)) {
    throw new Error('SFTP 恢复清单产物已被修改。')
  }
  return {
    manifestComplete: true,
    plan: manifest.plan,
    artifacts: manifest.artifacts,
    summary: '已复用并验证现有 SFTP 恢复快照。'
  }
}

async function loadManifest (sftp, operation) {
  const plan = buildPlanSkeleton(operation)
  if (!await lstatOrAbsent(sftp, plan.manifestPath)) return null
  let manifest
  try {
    manifest = JSON.parse(await readBoundedText(sftp, plan.manifestPath))
  } catch (error) {
    throw new Error(`SFTP 恢复清单读取失败：${error?.message || error}`)
  }
  return validateManifest(sftp, operation, manifest)
}

async function copyVerifiedSnapshot (sftp, resource) {
  if (resource.original.absent === true) return
  const existing = await lstatOrAbsent(sftp, resource.snapshotPath)
  if (existing) {
    await verifySnapshot(sftp, resource)
    return
  }
  await removeTransactionEntry(sftp, resource.stagingPath)
  if (typeof sftp.copyEntry !== 'function') {
    throw new Error('当前 SFTP 连接不支持纯 SFTP 快照复制。')
  }
  await sftp.copyEntry(resource.path, resource.stagingPath)
  const staged = await describeEntry(sftp, resource.stagingPath)
  if (!sameDescriptor(staged, resource.original)) {
    throw new Error('SFTP 快照复制不完整，已拒绝生成恢复清单。')
  }
  await sftp.rename(resource.stagingPath, resource.snapshotPath)
  await verifySnapshot(sftp, resource)
}

async function prepareNewManifest (sftp, operation) {
  const plan = buildPlanSkeleton(operation)
  await ensureDirectory(sftp, plan.operationDir)
  for (const resource of plan.resources) {
    resource.original = operation.effect.action === 'chmod'
      ? await describeModeEntry(sftp, resource.path)
      : await describeEntry(sftp, resource.path)
    if (resource.original.absent !== true) {
      if (resource.original.type !== operation.effect.type) {
        throw new Error('SFTP 资源类型与请求不一致，已拒绝操作。')
      }
    } else if (!['editor-save', 'rename'].includes(operation.effect.action) ||
      resource.slot === 'source') {
      throw new Error('SFTP 源资源不存在，无法创建恢复点。')
    }
  }

  if (operation.effect.action === 'rename') {
    const [source, target] = plan.resources
    const sourceParent = await sftp.stat(parentRemotePath(source.path))
    const targetParent = await sftp.stat(parentRemotePath(target.path))
    const sourceParentPath = parentRemotePath(source.path)
    const targetParentPath = parentRemotePath(target.path)
    const hasDeviceIds = Number.isInteger(sourceParent?.dev) &&
      Number.isInteger(targetParent?.dev)
    if ((hasDeviceIds && sourceParent.dev !== targetParent.dev) ||
      (!hasDeviceIds && sourceParentPath !== targetParentPath)) {
      throw new Error('SFTP 重命名跨文件系统，首版已拒绝操作。')
    }
  }

  if (operation.effect.action !== 'chmod') {
    for (const resource of plan.resources) {
      await copyVerifiedSnapshot(sftp, resource)
    }
  }
  const artifacts = buildArtifacts(plan)
  const manifest = {
    schemaVersion: 1,
    complete: true,
    id: operation.id,
    endpointKey: operation.endpointKey,
    effectKey: operation.effectKey,
    plan,
    artifacts
  }
  const preparingManifest = `${plan.manifestPath}.preparing`
  await removeTransactionEntry(sftp, preparingManifest)
  await sftp.writeFile(preparingManifest, JSON.stringify(manifest), 0o600)
  if (await lstatOrAbsent(sftp, plan.manifestPath)) {
    throw new Error('SFTP 恢复清单已存在但未通过复用校验。')
  }
  await sftp.rename(preparingManifest, plan.manifestPath)
  const verified = await loadManifest(sftp, operation)
  if (!verified) throw new Error('SFTP 恢复清单提交失败。')
  return {
    ...verified,
    summary: 'SFTP 快照和恢复清单已完成。'
  }
}

async function requireManifest (sftp, operation) {
  const prepared = await loadManifest(sftp, operation)
  if (!prepared || !sameDescriptor(prepared.plan, operation.plan) ||
    !sameDescriptor(prepared.artifacts, operation.artifacts)) {
    throw new Error('SFTP 恢复清单与已绑定事务不一致。')
  }
  return prepared
}

async function assertOriginalState (sftp, resource, action) {
  const current = action === 'chmod'
    ? await describeModeEntry(sftp, resource.path)
    : await describeEntry(sftp, resource.path)
  if (!sameDescriptor(current, resource.original)) {
    throw new Error('SFTP 资源在确认前已发生变化，未执行修改。')
  }
}

async function verifyExecuteState (sftp, operation) {
  const action = operation.effect.action
  const resources = operation.plan.resources
  if (action === 'editor-save') {
    const current = await describeEntry(sftp, resources[0].path)
    const mode = operation.effect.requestedMode ??
      (resources[0].original.absent ? undefined : resources[0].original.mode)
    const expected = {
      ...operation.effect.expected,
      type: 'file',
      ...(mode === undefined
        ? {}
        : { mode })
    }
    if (!matchesExpected(current, expected)) {
      throw new Error('SFTP 编辑器保存后的大小、摘要或权限验证失败。')
    }
    return
  }
  if (action === 'chmod') {
    const current = await describeModeEntry(sftp, resources[0].path)
    if (current.absent || current.type !== resources[0].original.type ||
      current.mode !== operation.effect.requestedMode) {
      throw new Error('SFTP chmod 后的权限验证失败。')
    }
    return
  }
  if (action === 'rename') {
    const source = await describeEntry(sftp, resources[0].path)
    const target = await describeEntry(sftp, resources[1].path)
    if (source.absent !== true || !sameDescriptor(target, resources[0].original)) {
      throw new Error('SFTP 重命名后的源/目标验证失败。')
    }
    return
  }
  const source = await describeEntry(sftp, resources[0].path)
  if (source.absent !== true) throw new Error('SFTP 删除后的路径仍然存在。')
}

async function restoreFromSnapshot (
  sftp,
  resource,
  postExpected,
  allowInterruptedSwap = false
) {
  const current = await describeEntry(sftp, resource.path)
  if (sameDescriptor(current, resource.original)) return
  const displaced = await describeEntry(sftp, resource.displacedPath)
  if (current.absent === true) {
    if (postExpected?.absent !== true && displaced.absent === true) {
      const previous = await describeEntry(sftp, resource.executionPreviousPath)
      if (!allowInterruptedSwap || !sameDescriptor(previous, resource.original)) {
        throw new Error('SFTP 当前目标出现外部变化，已拒绝覆盖。')
      }
    }
  } else if (!matchesExpected(current, postExpected)) {
    throw new Error('SFTP 当前目标出现外部变化，已拒绝覆盖。')
  }

  await verifySnapshot(sftp, resource)
  let restoreTemp = await describeEntry(sftp, resource.restoreTempPath)
  if (restoreTemp.absent === true) {
    if (typeof sftp.copyEntry !== 'function') {
      throw new Error('当前 SFTP 连接不支持纯 SFTP 快照恢复。')
    }
    await sftp.copyEntry(resource.snapshotPath, resource.restoreTempPath)
    restoreTemp = await describeEntry(sftp, resource.restoreTempPath)
  }
  if (!sameDescriptor(restoreTemp, resource.original)) {
    throw new Error('SFTP 恢复临时副本验证失败。')
  }

  if (current.absent !== true) {
    if (displaced.absent !== true) {
      throw new Error('SFTP displaced 路径已有内容，已拒绝覆盖。')
    }
    await sftp.rename(resource.path, resource.displacedPath)
  }
  if ((await describeEntry(sftp, resource.path)).absent === true) {
    await sftp.rename(resource.restoreTempPath, resource.path)
  }
}

async function restoreAbsent (sftp, resource, postExpected) {
  const current = await describeEntry(sftp, resource.path)
  if (current.absent === true) return
  if (!matchesExpected(current, postExpected)) {
    throw new Error('SFTP 当前目标出现外部变化，已拒绝覆盖。')
  }
  const displaced = await describeEntry(sftp, resource.displacedPath)
  if (displaced.absent !== true) {
    throw new Error('SFTP displaced 路径已有内容，已拒绝覆盖。')
  }
  await sftp.rename(resource.path, resource.displacedPath)
}

function postExpectedFor (operation, resource) {
  if (operation.effect.action === 'editor-save') {
    const mode = operation.effect.requestedMode ??
      (resource.original.absent ? undefined : resource.original.mode)
    return {
      ...operation.effect.expected,
      type: 'file',
      ...(mode === undefined
        ? {}
        : { mode })
    }
  }
  if (operation.effect.action === 'chmod') {
    return { type: resource.original.type, mode: operation.effect.requestedMode }
  }
  if (operation.effect.action === 'rename') {
    return resource.slot === 'source'
      ? { absent: true }
      : operation.plan.resources[0].original
  }
  return { absent: true }
}

export function createSftpTransactionAdapter ({ getSftp } = {}) {
  if (typeof getSftp !== 'function') {
    throw new Error('SFTP 安全事务缺少连接解析器。')
  }

  function requireSftp () {
    const sftp = getSftp()
    if (!sftp) throw new Error('当前 SFTP 连接已断开，未执行远程修改。')
    return sftp
  }

  return {
    supports (operation) {
      return operation?.operationKind === 'side-effect' &&
        operation?.effect?.adapter === 'sftp' &&
        ['editor-save', 'delete', 'rename', 'chmod'].includes(operation.effect.action)
    },

    async prepare (operation) {
      const sftp = requireSftp()
      const existing = await loadManifest(sftp, operation)
      return existing || prepareNewManifest(sftp, operation)
    },

    async beforeExecute (operation, context = {}) {
      const sftp = requireSftp()
      await requireManifest(sftp, operation)
      for (const resource of operation.plan.resources) {
        await assertOriginalState(sftp, resource, operation.effect.action)
      }
      const action = operation.effect.action
      if (action === 'editor-save') {
        const text = context.input?.text
        if (typeof text !== 'string') {
          throw new Error('SFTP 编辑器保存缺少待写入文本。')
        }
        const expected = await digestSftpText(text)
        if (!matchesExpected(expected, operation.effect.expected)) {
          throw new Error('SFTP 编辑器文本与已确认摘要不一致。')
        }
        const resource = operation.plan.resources[0]
        const mode = operation.effect.requestedMode ??
          (resource.original.absent ? undefined : resource.original.mode)
        if (await lstatOrAbsent(sftp, resource.executionPath) ||
          await lstatOrAbsent(sftp, resource.executionPreviousPath)) {
          throw new Error('SFTP 编辑器事务置换路径已被占用，未修改目标文件。')
        }
        await sftp.writeFile(resource.executionPath, text, mode)
        const staged = await describeEntry(sftp, resource.executionPath)
        if (!matchesExpected(staged, {
          ...operation.effect.expected,
          type: 'file',
          ...(mode === undefined ? {} : { mode })
        })) {
          throw new Error('SFTP 编辑器暂存文件验证失败，未修改目标文件。')
        }
        await assertOriginalState(sftp, resource, action)
        if (resource.original.absent !== true) {
          await sftp.rename(resource.path, resource.executionPreviousPath)
        }
        await sftp.rename(resource.executionPath, resource.path)
      } else if (action === 'chmod') {
        await sftp.chmod(
          operation.plan.resources[0].path,
          operation.effect.requestedMode
        )
      } else if (action === 'rename') {
        await sftp.rename(
          operation.plan.resources[0].path,
          operation.plan.resources[1].path
        )
      } else {
        const resource = operation.plan.resources[0]
        if (typeof sftp.removeEntry !== 'function') {
          throw new Error('当前 SFTP 连接不支持纯 SFTP 删除。')
        }
        if (await lstatOrAbsent(sftp, resource.executionPath)) {
          throw new Error('SFTP 删除事务执行路径已被占用，未修改源资源。')
        }
        await sftp.rename(resource.path, resource.executionPath)
        await sftp.removeEntry(resource.executionPath)
      }
      return { summary: `SFTP ${action} 已执行，等待验证。` }
    },

    async verifyExecute (operation) {
      const sftp = requireSftp()
      await requireManifest(sftp, operation)
      await verifyExecuteState(sftp, operation)
      return { verified: true, summary: 'SFTP 修改后状态验证通过。' }
    },

    async rollback (operation) {
      const sftp = requireSftp()
      await requireManifest(sftp, operation)
      if (operation.effect.action === 'chmod') {
        const resource = operation.plan.resources[0]
        const current = await describeModeEntry(sftp, resource.path)
        if (sameDescriptor(current, resource.original)) {
          return { summary: 'SFTP 权限已处于原始状态。' }
        }
        if (!matchesExpected(current, postExpectedFor(operation, resource))) {
          throw new Error('SFTP 权限出现外部变化，已拒绝回滚。')
        }
        await sftp.chmod(resource.path, resource.original.mode)
        return { summary: 'SFTP 原始权限已恢复。' }
      }
      for (const resource of operation.plan.resources) {
        const expected = postExpectedFor(operation, resource)
        if (resource.original.absent === true) {
          await restoreAbsent(sftp, resource, expected)
        } else {
          await restoreFromSnapshot(
            sftp,
            resource,
            expected,
            Boolean(operation.failedAt)
          )
        }
      }
      return { summary: 'SFTP 快照已恢复，快照本身保持不变。' }
    },

    async verifyRollback (operation) {
      const sftp = requireSftp()
      await requireManifest(sftp, operation)
      for (const resource of operation.plan.resources) {
        const current = operation.effect.action === 'chmod'
          ? await describeModeEntry(sftp, resource.path)
          : await describeEntry(sftp, resource.path)
        if (!sameDescriptor(current, resource.original)) {
          throw new Error('SFTP 回滚后的资源验证失败，可保留快照后重试。')
        }
      }
      return { verified: true, summary: 'SFTP 回滚状态验证通过。' }
    }
  }
}

export { digestRemoteFile }
