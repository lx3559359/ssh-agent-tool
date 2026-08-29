const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { importModule } = require('./helpers/import-esm')

const backendsModule =
  'src/client/components/sftp/remote-file-backends.js'
const sftpSafetyModule =
  'src/client/components/sftp/sftp-safety.js'

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

const protocolCapabilities = [
  'sh=1', 'cleanShell=1', 'printf=1', 'id=1', 'tr=1', 'stat=1',
  'base64=1', 'sha256=1', 'procFd=1', 'noclobber=1', 'cat=1',
  'gnuStat=1', 'gnuMv=1', 'realpath=1', 'readlink=1', 'chown=1',
  'chmod=1', 'rm=1', 'rmdir=1', 'find=1', 'head=1', 'wc=1',
  'gnuDd=1', 'mkfifo=1', 'touch=1'
].join(',')

function encodeProtocolField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function protocolMarker (token, phase, ...fields) {
  return `\u001b]698;SHELLPILOT_FILE;${token};${phase};${fields.join(';')}\u0007`
}

function parsedImportResult ({ protocol, request, markers, exitCode = 1, end = true }) {
  const token = protocol.createToken()
  const parser = protocol.createParser({ token, request })
  parser.push(protocolMarker(
    token,
    'start',
    encodeProtocolField('0'),
    encodeProtocolField('root'),
    encodeProtocolField(protocolCapabilities)
  ))
  for (const [kind, values] of markers) {
    parser.push(protocolMarker(
      token,
      'data',
      '1',
      '1',
      kind,
      ...values.map(encodeProtocolField)
    ))
  }
  if (end) parser.push(protocolMarker(token, 'end', String(exitCode)))
  return {
    exitCode: parser.exitCode(),
    identity: parser.identity(),
    ...protocol.readResult(parser)
  }
}

function createTokenFactory () {
  let sequence = 0
  return () => (++sequence).toString(16).padStart(48, '0')
}

function missing (remotePath) {
  const error = new Error(`No such file: ${remotePath}`)
  error.code = 'SFTP_NO_SUCH_FILE'
  return error
}

function createBackendHarness (options = {}) {
  const home = '/home/login'
  const nodes = new Map([[home, {
    type: 'directory', mode: 0o700, uid: 1000, gid: 1000
  }]])
  const rootFiles = new Map(Object.entries(options.rootFiles || {}))
  let nextPrivilegedInode = 1000
  let nextStageInode = 2000
  let stageRootPath = ''
  const privilegedNodes = new Map(Object.entries(options.privilegedTree || {}).map(
    ([remotePath, node]) => [remotePath, {
      mode: node.type === 'directory' ? 0o750 : 0o640,
      uid: 3,
      gid: 4,
      device: '1',
      inode: String(nextPrivilegedInode++),
      ...node,
      ...(node.content === undefined
        ? {}
        : { content: Buffer.from(node.content) })
    }]
  ))
  function ensurePrivilegedBinding (node) {
    if (!node) return null
    if (!node.device) node.device = '1'
    if (!node.inode) node.inode = String(nextPrivilegedInode++)
    return node
  }
  function privilegedBytes (
    node,
    offset = 0,
    length = node?.size ?? node?.content?.length ?? 0
  ) {
    const size = Number(node?.size ?? node?.content?.length ?? 0)
    const available = Math.max(0, Math.min(length, size - offset))
    if (node?.virtualByte !== undefined) {
      return Buffer.alloc(available, node.virtualByte)
    }
    return Buffer.from(node?.content || '').subarray(offset, offset + available)
  }
  if (options.privilegedTree) {
    ensurePrivilegedBinding(privilegedNodes.get('/') || (() => {
      const node = { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
      privilegedNodes.set('/', node)
      return node
    })())
    for (const remotePath of [...privilegedNodes.keys()]) {
      let parent = remotePath
      while (parent !== '/') {
        const index = parent.lastIndexOf('/')
        parent = index <= 0 ? '/' : parent.slice(0, index)
        if (!privilegedNodes.has(parent)) {
          privilegedNodes.set(parent, ensurePrivilegedBinding({
            type: 'directory', mode: 0o755, uid: 0, gid: 0
          }))
        }
      }
    }
  }
  const requests = []
  const executions = []
  const events = []
  const sftpReads = []
  let leaseReleases = 0
  let activeLeaseExecutions = 0
  let peakLeaseExecutions = 0
  const sftp = {
    id: 'sftp-1',
    terminalId: 'term-1',
    async getHomeDir () { return home },
    async realpath (remotePath) { return remotePath || home },
    async lstat (remotePath) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return {
        mode: ({ file: 0o100000, directory: 0o040000, symlink: 0o120000 })[node.type] |
          node.mode,
        size: node.type === 'file' ? node.content.length : 0,
        uid: node.uid,
        gid: node.gid,
        isDirectory: node.type === 'directory'
      }
    },
    async list (remotePath) {
      const prefix = `${remotePath}/`
      return [...nodes.keys()]
        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(path => ({ name: path.slice(prefix.length) }))
    },
    async mkdir (remotePath, attrs = {}) {
      if (nodes.has(remotePath)) throw new Error('Already exists')
      nodes.set(remotePath, {
        type: 'directory', mode: attrs.mode ?? 0o700, uid: 1000, gid: 1000
      })
      return 1
    },
    async chmod (remotePath, mode) {
      nodes.get(remotePath).mode = mode
      return 1
    },
    async createExclusiveFile (remotePath, base64, mode) {
      if (nodes.has(remotePath)) throw new Error('Target exists')
      if (options.uploadCreateFailure && remotePath.includes('/upload-')) {
        const cleanupSucceeded = options.uploadCleanupSucceeded !== false
        if (!cleanupSucceeded) {
          nodes.set(remotePath, {
            type: 'file',
            mode,
            uid: 1000,
            gid: 1000,
            content: options.uploadResidualMatches
              ? Buffer.from(base64, 'base64')
              : Buffer.from('partial upload')
          })
        }
        if (options.uploadCreateEndpointChange) sftp.id = 'sftp-2'
        const failure = Object.assign(new Error('remote upload write failed'), {
          ok: false,
          claimed: true,
          code: 'SFTP_EXCLUSIVE_WRITE_FAILED',
          message: 'remote upload write failed',
          cleanupAttempted: true,
          cleanupSucceeded,
          cleanupError: cleanupSucceeded ? null : 'remote unlink failed'
        })
        if (options.uploadCreateThrows) throw failure
        return failure
      }
      nodes.set(remotePath, {
        type: 'file',
        mode,
        uid: 1000,
        gid: 1000,
        content: Buffer.from(base64, 'base64')
      })
      events.push(`sftp:create:${remotePath}`)
      return 1
    },
    async upload ({ remotePath, options: uploadOptions, onData, onEnd }) {
      const content = Buffer.from(options.transferUploadContent || 'uploaded')
      nodes.set(remotePath, {
        type: 'file',
        mode: uploadOptions.mode,
        uid: 1000,
        gid: 1000,
        device: '2049',
        inode: String(nextStageInode++),
        content
      })
      events.push(`sftp:upload:${remotePath}`)
      await onData?.({ transferred: content.length, total: content.length })
      await onEnd?.({ transferred: content.length, total: content.length })
      return Object.freeze({
        cancel: async () => true,
        interrupt: async () => true,
        destroy: async () => true
      })
    },
    async readFile (remotePath) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return node.content.toString('utf8')
    },
    async readFileChunk (remotePath, readOptions = {}) {
      events.push(`sftp:read:${remotePath}`)
      sftpReads.push({ remotePath, ...readOptions })
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      const offset = readOptions.offset || 0
      const maxBytes = readOptions.maxBytes || 64 * 1024
      const bytes = node.content.subarray(offset, offset + maxBytes)
      return {
        base64: bytes.toString('base64'),
        offset,
        nextOffset: offset + bytes.length,
        bytesRead: bytes.length,
        totalBytes: node.content.length,
        hasMore: offset + bytes.length < node.content.length
      }
    },
    async rm (remotePath) {
      if (!nodes.has(remotePath)) throw missing(remotePath)
      nodes.delete(remotePath)
      events.push(`sftp:rm:${remotePath}`)
      return 1
    },
    async removeEmptyDirectory (remotePath) {
      if ([...nodes.keys()].some(path => path.startsWith(`${remotePath}/`))) {
        throw new Error('Directory not empty')
      }
      if (!nodes.has(remotePath)) throw missing(remotePath)
      nodes.delete(remotePath)
      events.push(`sftp:rmdir:${remotePath}`)
      return 1
    }
  }

  async function executeCore ({ request, protocol }) {
    assert.equal(typeof protocol?.buildCommand, 'function')
    requests.push(request)
    const args = request.args
    const injectedFailure = options.failPrivilegedRequest?.(request)
    if (injectedFailure) throw injectedFailure
    if (request.operation === 'stage-handshake') {
      if (options.badHandshake) throw new Error('handshake rejected')
      stageRootPath = args.rootPath
      const response = sha256(`${args.challenge}:root`)
      nodes.set(`${args.rootPath}/${args.responseName}`, {
        type: 'file',
        mode: 0o600,
        uid: 1000,
        gid: 1000,
        content: Buffer.from(response)
      })
      return {
        exitCode: 0,
        identity: { uid: '0', username: 'root' },
        kind: 'stage-handshake',
        response,
        uid: '1000',
        gid: '1000',
        mode: '700',
        rootRealPath: args.rootPath,
        rootDevice: '2049',
        rootInode: '777'
      }
    }
    if (request.operation === 'stage-cleanup') {
      events.push(`pty:cleanup:${args.objectName}`)
      if (options.cleanupFailure && args.objectName.startsWith(options.cleanupFailure)) {
        throw new Error('stage cleanup failed')
      }
      const remotePath = `${args.rootPath}/${args.objectName}`
      const node = nodes.get(remotePath)
      if (!node) return { exitCode: 0, kind: 'stage-cleanup', ok: true }
      if (node.type !== 'file' || sha256(node.content) !== args.sha256 ||
        String(node.content.length) !== args.size) {
        throw new Error('stage cleanup proof failed')
      }
      nodes.delete(remotePath)
      return { exitCode: 0, kind: 'stage-cleanup', ok: true }
    }
    if (request.operation === 'stage-export') {
      if (options.replaceSourceBeforeExport === args.sourcePath) {
        const current = privilegedNodes.get(args.sourcePath)
        privilegedNodes.set(args.sourcePath, {
          ...current,
          inode: String(nextPrivilegedInode++),
          content: Buffer.from(options.replacementSourceContent || 'evil')
        })
        options.replaceSourceBeforeExport = undefined
      }
      if (options.privilegedTree) {
        const source = ensurePrivilegedBinding(privilegedNodes.get(args.sourcePath))
        const parent = ensurePrivilegedBinding(privilegedNodes.get(
          args.sourceParentRealPath
        ))
        if (!source || source.type !== 'file' ||
          source.device !== args.sourceDevice || source.inode !== args.sourceInode ||
          parent.device !== args.sourceParentDevice ||
          parent.inode !== args.sourceParentInode) {
          throw new Error('stage export source binding changed')
        }
      }
      const bytes = options.privilegedTree
        ? Buffer.from(privilegedNodes.get(args.sourcePath)?.content || '')
        : Buffer.from(rootFiles.get(args.sourcePath) || '')
      const totalSize = options.privilegedTree
        ? Number(privilegedNodes.get(args.sourcePath)?.size ?? bytes.length)
        : bytes.length
      if (String(totalSize) !== args.expectedSize ||
        totalSize > Number(args.maxSize)) {
        throw new Error('stage export source size changed')
      }
      nodes.set(`${args.rootPath}/${args.objectName}`, {
        type: 'file', mode: 0o600, uid: 1000, gid: 1000, content: bytes
      })
      return {
        exitCode: 0,
        kind: 'stage-export',
        sha256: options.exportDigest || sha256(bytes),
        size: options.exportSize ?? bytes.length
      }
    }
    if (request.operation === 'stage-export-range') {
      const source = options.privilegedTree
        ? ensurePrivilegedBinding(privilegedNodes.get(args.sourcePath))
        : null
      const parent = options.privilegedTree
        ? ensurePrivilegedBinding(privilegedNodes.get(
          args.sourceParentRealPath
        ))
        : null
      if (options.privilegedTree && (!source || source.type !== 'file' ||
        source.device !== args.sourceDevice || source.inode !== args.sourceInode ||
        parent.device !== args.sourceParentDevice ||
        parent.inode !== args.sourceParentInode)) {
        throw new Error('stage export range source binding changed')
      }
      const bytes = options.privilegedTree
        ? privilegedBytes(source, Number(args.offset), Number(args.maxBytes))
        : Buffer.from(rootFiles.get(args.sourcePath) || '').subarray(
          Number(args.offset),
          Number(args.offset) + Number(args.maxBytes)
        )
      const totalSize = options.privilegedTree
        ? Number(source?.size ?? source?.content?.length ?? 0)
        : Buffer.from(rootFiles.get(args.sourcePath) || '').length
      if (String(totalSize) !== args.expectedSize ||
        totalSize > Number(args.maxSize)) {
        throw new Error('stage export range source size changed')
      }
      nodes.set(`${args.rootPath}/${args.objectName}`, {
        type: 'file', mode: 0o600, uid: 1000, gid: 1000, content: bytes
      })
      return {
        exitCode: 0,
        kind: 'stage-export-range',
        sha256: options.exportDigest || sha256(bytes),
        size: options.exportSize ?? bytes.length
      }
    }
    if (request.operation === 'stage-import') {
      const bytes = nodes.get(`${args.rootPath}/${args.objectName}`).content
      if (options.importFailure) {
        const tempPath = `${args.targetParentRealPath === '/'
            ? ''
            : args.targetParentRealPath}/.shellpilot-${args.objectName}.tmp`
        let tempClaim
        if (options.privilegedTree && options.importResidual) {
          const residualPath = options.importResidual === 'temp'
            ? tempPath
            : args.targetPath
          const residual = ensurePrivilegedBinding({
            type: 'file',
            mode: Number.parseInt(args.targetMode, 8),
            uid: Number(args.targetUid),
            gid: Number(args.targetGid),
            content: Buffer.from(bytes)
          })
          privilegedNodes.set(residualPath, residual)
          if (options.importResidual === 'temp') tempClaim = { ...residual }
          if (options.importForeignTarget) {
            privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
              type: 'file',
              mode: 0o600,
              uid: 99,
              gid: 99,
              content: Buffer.from(options.importForeignTargetContent || 'foreign')
            }))
          }
        }
        if (options.importForeignTargetOnly) {
          privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
            type: 'file',
            mode: Number.parseInt(args.targetMode, 8),
            uid: Number(args.targetUid),
            gid: Number(args.targetGid),
            content: Buffer.from(bytes)
          }))
        }
        if (options.importForeignTempOnly) {
          privilegedNodes.set(tempPath, ensurePrivilegedBinding({
            type: 'file',
            mode: Number.parseInt(args.targetMode, 8),
            uid: Number(args.targetUid),
            gid: Number(args.targetGid),
            content: Buffer.from(bytes)
          }))
        }
        if (options.replaceClaimedTemp && tempClaim) {
          privilegedNodes.set(tempPath, ensurePrivilegedBinding({
            type: 'file',
            mode: tempClaim.mode,
            uid: tempClaim.uid,
            gid: tempClaim.gid,
            content: Buffer.from(bytes)
          }))
        }
        if (options.importMovingResidual) {
          const exact = ensurePrivilegedBinding({
            type: 'file',
            mode: 0,
            uid: 0,
            gid: 0,
            content: Buffer.from(bytes)
          })
          tempClaim = { ...exact }
          const exactPath = options.importMovingResidual === 'target'
            ? args.targetPath
            : tempPath
          privilegedNodes.set(exactPath, exact)
          if (options.importMovingBothExact) {
            privilegedNodes.set(
              exactPath === args.targetPath ? tempPath : args.targetPath,
              exact
            )
          }
          if (options.importMovingNoExact) {
            privilegedNodes.set(exactPath, ensurePrivilegedBinding({
              type: 'file',
              mode: 0,
              uid: 0,
              gid: 0,
              content: Buffer.from(bytes)
            }))
          }
          if (options.importMovingForeignTarget) {
            privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
              type: 'file',
              mode: 0o600,
              uid: 91,
              gid: 92,
              content: Buffer.from(bytes)
            }))
          }
          if (options.importMovingForeignTemp) {
            privilegedNodes.set(tempPath, ensurePrivilegedBinding({
              type: 'file',
              mode: 0o600,
              uid: 93,
              gid: 94,
              content: Buffer.from(bytes)
            }))
          }
          return parsedImportResult({
            protocol,
            request,
            markers: [
              ['temp-claim', [exact.device, exact.inode]],
              ['moving', [exact.device, exact.inode, exact.gid]],
              ['import-cleanup', ['0', 'moving']]
            ]
          })
        }
        const error = new Error(options.importCancellation
          ? 'stage import cancelled after claim'
          : 'stage import failed')
        if (options.importCancellation) error.name = 'AbortError'
        if (options.importIncompleteParser) {
          return parsedImportResult({
            protocol,
            request,
            markers: tempClaim
              ? [['temp-claim', [tempClaim.device, tempClaim.inode]]]
              : [],
            end: false
          })
        }
        if (options.importCleanupSucceeded) {
          return parsedImportResult({
            protocol,
            request,
            markers: [['import-cleanup', ['1', 'none']]]
          })
        }
        if (options.importTempClaim && tempClaim) {
          return parsedImportResult({
            protocol,
            request,
            markers: [
              ['temp-claim', [tempClaim.device, tempClaim.inode]],
              ['import-cleanup', ['0', 'temp']]
            ]
          })
        }
        if (options.importReturnedClaim) {
          const claimed = privilegedNodes.get(args.targetPath)
          return parsedImportResult({
            protocol,
            request,
            markers: [
              ['temp-claim', [claimed.device, claimed.inode]],
              ['moving', [claimed.device, claimed.inode, '0']],
              ['installed', [
                args.sha256,
                args.size,
                claimed.device,
                claimed.inode,
                args.targetMode,
                args.targetUid,
                args.targetGid
              ]],
              ['import-cleanup', ['0', 'target']]
            ]
          })
        }
        throw error
      }
      if (args.mustBeAbsent !== '1') {
        throw new Error('stage import requires an absent target')
      }
      if (options.privilegedTree) {
        const parent = ensurePrivilegedBinding(privilegedNodes.get(
          args.targetParentRealPath
        ))
        if (!parent || parent.type !== 'directory' ||
          parent.device !== args.targetParentDevice ||
          parent.inode !== args.targetParentInode ||
          String(parent.uid) !== args.targetParentUid ||
          (parent.mode & 0o7777).toString(8) !== args.targetParentMode ||
          parent.uid !== 0 || (parent.mode & 0o022) !== 0) {
          throw new Error('stage import target parent binding changed')
        }
        if (privilegedNodes.has(args.targetPath)) {
          return parsedImportResult({
            protocol,
            request,
            markers: [['import-cleanup', ['1', 'none']]]
          })
        }
        if (options.failImportTarget === args.targetPath) {
          privilegedNodes.set(args.targetPath, {
            type: 'file',
            mode: 0o600,
            uid: 999,
            gid: 999,
            content: Buffer.from('foreign')
          })
          return parsedImportResult({
            protocol,
            request,
            markers: [['import-cleanup', ['1', 'none']]]
          })
        }
        const installed = ensurePrivilegedBinding({
          type: 'file',
          mode: Number.parseInt(args.targetMode, 8),
          uid: Number(args.targetUid),
          gid: Number(args.targetGid),
          content: Buffer.from(bytes)
        })
        privilegedNodes.set(args.targetPath, installed)
      } else {
        rootFiles.set(args.targetPath, Buffer.from(bytes))
      }
      const targetDevice = options.privilegedTree
        ? privilegedNodes.get(args.targetPath).device
        : '1'
      const targetInode = options.privilegedTree
        ? privilegedNodes.get(args.targetPath).inode
        : '101'
      return {
        exitCode: 0,
        kind: 'stage-import',
        sha256: sha256(bytes),
        size: bytes.length,
        targetDevice,
        targetInode,
        targetClaim: Object.freeze({
          targetPath: args.targetPath,
          targetDevice,
          targetInode,
          targetType: 'file',
          targetParentRealPath: args.targetParentRealPath,
          targetParentDevice: args.targetParentDevice,
          targetParentInode: args.targetParentInode,
          sha256: args.sha256,
          size: Number(args.size),
          mode: Number.parseInt(args.targetMode, 8),
          uid: Number(args.targetUid),
          gid: Number(args.targetGid)
        }),
        cleanupSucceeded: true,
        residualLocation: 'complete'
      }
    }
    if (request.operation === 'stage-import-cleanup') {
      const tempParent = ensurePrivilegedBinding(privilegedNodes.get(
        args.tempParentRealPath
      ))
      const targetParent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      const parentMatches = (parent, prefix) => parent &&
        parent.type === 'directory' &&
        parent.device === args[`${prefix}ParentDevice`] &&
        parent.inode === args[`${prefix}ParentInode`] &&
        String(parent.uid) === args[`${prefix}ParentUid`] &&
        (parent.mode & 0o7777).toString(8) === args[`${prefix}ParentMode`] &&
        parent.uid === 0 && (parent.mode & 0o022) === 0
      if (!parentMatches(tempParent, 'temp') ||
        !parentMatches(targetParent, 'target')) {
        throw new Error('stage-import cleanup parent binding changed')
      }
      const exactLocations = () => [args.tempPath, args.targetPath]
        .filter(remotePath => {
          const node = privilegedNodes.get(remotePath)
          return node?.type === args.targetType &&
            node.device === args.targetDevice &&
            node.inode === args.targetInode
        })
      const initialExact = exactLocations()
      if (initialExact.length === 0) {
        if (options.importCleanupUntrustedSuccess) {
          return { exitCode: 0, kind: 'stage-import-cleanup', ok: true }
        }
        return {
          exitCode: 0,
          kind: 'stage-import-cleanup',
          cleanupSucceeded: true,
          residualLocation: 'none'
        }
      }
      if (initialExact.length !== 1) {
        throw new Error('stage-import cleanup exact claim conflicted')
      }
      const candidatePath = initialExact[0]
      const candidate = privilegedNodes.get(candidatePath)
      const bytes = privilegedBytes(candidate)
      const currentMetadata = {
        mode: candidate.mode & 0o7777,
        uid: candidate.uid,
        gid: candidate.gid
      }
      const allowedMetadata = [
        {
          mode: Number.parseInt(args.initialMode, 8),
          uid: Number(args.initialUid),
          gid: Number(args.initialGid)
        },
        {
          mode: Number.parseInt(args.initialMode, 8),
          uid: Number(args.targetUid),
          gid: Number(args.targetGid)
        },
        {
          mode: Number.parseInt(args.targetMode, 8),
          uid: Number(args.targetUid),
          gid: Number(args.targetGid)
        }
      ]
      if (bytes.length !== Number(args.size) ||
        bytes.length > Number(args.maxSize) || sha256(bytes) !== args.sha256 ||
        !allowedMetadata.some(expected =>
          expected.mode === currentMetadata.mode &&
          expected.uid === currentMetadata.uid &&
          expected.gid === currentMetadata.gid)) {
        throw new Error('stage-import cleanup proof changed')
      }
      if (options.importMovingSecondLinkDuringCleanup) {
        const otherPath = candidatePath === args.tempPath
          ? args.targetPath
          : args.tempPath
        privilegedNodes.set(otherPath, candidate)
      }
      const finalExact = exactLocations()
      if (finalExact.length !== 1 || finalExact[0] !== candidatePath) {
        throw new Error('stage-import cleanup exact claim conflicted')
      }
      privilegedNodes.delete(candidatePath)
      if (exactLocations().length !== 0) {
        throw new Error('stage-import cleanup postcheck failed')
      }
      if (options.importCleanupCompletionLosses > 0) {
        options.importCleanupCompletionLosses -= 1
        if (options.importCleanupForeignReplacementAfterLoss) {
          privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
            type: 'file',
            mode: Number.parseInt(args.targetMode, 8),
            uid: Number(args.targetUid),
            gid: Number(args.targetGid),
            content: Buffer.from(options.importCleanupForeignContent || 'safe')
          }))
        }
        if (options.importCleanupParentReplacementAfterLoss) {
          privilegedNodes.set(args.targetParentRealPath,
            ensurePrivilegedBinding({
              type: 'directory', mode: 0o755, uid: 0, gid: 0
            }))
        }
        const error = new Error('PTY disconnected after import cleanup')
        error.name = 'DisconnectedError'
        throw error
      }
      if (options.importCleanupUntrustedSuccess) {
        return { exitCode: 0, kind: 'stage-import-cleanup', ok: true }
      }
      return {
        exitCode: 0,
        kind: 'stage-import-cleanup',
        cleanupSucceeded: true,
        residualLocation: 'none'
      }
    }
    if (request.operation === 'list' || request.operation === 'list-bound') {
      if (options.privilegedTree) {
        if (request.operation === 'list-bound' &&
          options.replaceDirectoryBeforeBoundList === args.path) {
          privilegedNodes.set(args.path, ensurePrivilegedBinding({
            type: 'directory', mode: 0o755, uid: 99, gid: 99
          }))
          options.replaceDirectoryBeforeBoundList = undefined
        }
        const parent = privilegedNodes.get(args.path)
        if (!parent || parent.type !== 'directory') throw missing(args.path)
        ensurePrivilegedBinding(parent)
        if (request.operation === 'list-bound') {
          const lexicalParent = args.path.slice(0, args.path.lastIndexOf('/')) || '/'
          const lexicalParentNode = ensurePrivilegedBinding(
            privilegedNodes.get(lexicalParent)
          )
          if (!lexicalParentNode ||
            lexicalParentNode.device !== args.sourceParentDevice ||
            lexicalParentNode.inode !== args.sourceParentInode ||
            parent.device !== args.sourceDevice ||
            parent.inode !== args.sourceInode) {
            throw new Error('bound list directory binding changed')
          }
        }
        const prefix = `${args.path}/`
        const entries = [...privilegedNodes.entries()]
          .filter(([remotePath]) => remotePath.startsWith(prefix) &&
            !remotePath.slice(prefix.length).includes('/'))
          .map(([remotePath, node]) => ({
            name: remotePath.slice(prefix.length),
            type: node.type,
            mode: ({ file: 0o100000, directory: 0o040000, symlink: 0o120000 })[node.type] | node.mode,
            size: node.type === 'file' ? (node.size ?? node.content.length) : 0,
            atime: 1,
            mtime: 2,
            uid: node.uid,
            gid: node.gid
          }))
        return { exitCode: 0, kind: request.operation, entries }
      }
      return {
        exitCode: 0,
        kind: request.operation,
        entries: [
          { name: 'file.txt', type: 'file', mode: 0o100640, size: 12, atime: 1, mtime: 2, uid: 3, gid: 4 },
          { name: 'dir', type: 'directory', mode: 0o40750, size: 0, atime: 5, mtime: 6, uid: 7, gid: 8 },
          { name: 'link', type: 'symlink', mode: 0o120777, size: 3, atime: 9, mtime: 10, uid: 11, gid: 12 }
        ]
      }
    }
    if (['lstat', 'lstat-bound', 'stat'].includes(request.operation)) {
      const stageNode = stageRootPath &&
        args.path.startsWith(`${stageRootPath}/`)
        ? nodes.get(args.path)
        : null
      if (stageNode) {
        if (request.operation === 'lstat-bound' && (
          args.sourceParentRealPath !== stageRootPath ||
          args.sourceParentDevice !== '2049' ||
          args.sourceParentInode !== '777'
        )) {
          throw new Error('stage lstat parent binding changed')
        }
        return {
          exitCode: 0,
          kind: request.operation,
          metadata: {
            mode: 0o100000 | stageNode.mode,
            type: 'file',
            size: stageNode.content.length,
            atime: 1,
            mtime: 2,
            uid: stageNode.uid,
            gid: stageNode.gid,
            device: stageNode.device,
            inode: stageNode.inode,
            parentRealPath: stageRootPath,
            parentDevice: '2049',
            parentInode: '777'
          }
        }
      }
      if (options.privilegedTree) {
        if (request.operation === 'lstat-bound') {
          const parentPath = args.path.slice(0, args.path.lastIndexOf('/')) || '/'
          const boundParent = ensurePrivilegedBinding(privilegedNodes.get(parentPath))
          if (!boundParent || boundParent.device !== args.sourceParentDevice ||
            boundParent.inode !== args.sourceParentInode) {
            throw new Error('bound lstat parent binding changed')
          }
        }
        const node = privilegedNodes.get(args.path)
        if (!node) {
          options.onPrivilegedLstat?.(args.path, privilegedNodes)
          return { exitCode: 0, kind: request.operation, missing: true }
        }
        ensurePrivilegedBinding(node)
        const parentPath = args.path === '/'
          ? '/'
          : args.path.slice(0, args.path.lastIndexOf('/')) || '/'
        const parent = ensurePrivilegedBinding(privilegedNodes.get(parentPath))
        const result = {
          exitCode: 0,
          kind: request.operation,
          metadata: {
            mode: ({ file: 0o100000, directory: 0o040000, symlink: 0o120000 })[node.type] | node.mode,
            type: node.type,
            size: node.type === 'file' ? (node.size ?? node.content.length) : 0,
            atime: 1,
            mtime: 2,
            uid: node.uid,
            gid: node.gid,
            device: node.device,
            inode: node.inode,
            parentRealPath: parentPath,
            parentDevice: parent.device,
            parentInode: parent.inode
          }
        }
        options.onPrivilegedLstat?.(args.path, privilegedNodes)
        return result
      }
      if (!rootFiles.has(args.path) && args.path.includes('/missing')) {
        if (options.genericLstatFailure) {
          return { exitCode: 1, kind: request.operation, ok: false }
        }
        if (options.missingLstatResult) {
          return { exitCode: 0, kind: request.operation, missing: true }
        }
        throw missing(args.path)
      }
      const isDirectoryPath = ['/', '/root', '/srv', '/srv/app'].includes(args.path)
      const rootFile = rootFiles.get(args.path)
      return {
        exitCode: 0,
        kind: request.operation,
        metadata: {
          mode: isDirectoryPath ? 0o40755 : 0o100640,
          type: isDirectoryPath ? 'directory' : 'file',
          size: isDirectoryPath
            ? 0
            : rootFile === undefined ? 12 : Buffer.from(rootFile).length,
          atime: 1,
          mtime: 2,
          uid: isDirectoryPath ? 0 : 3,
          gid: isDirectoryPath ? 0 : 4,
          device: '1',
          inode: '100',
          parentRealPath: args.path.slice(0, args.path.lastIndexOf('/')) || '/',
          parentDevice: '1',
          parentInode: '100'
        }
      }
    }
    if (request.operation === 'readlink' || request.operation === 'realpath') {
      return { exitCode: 0, kind: request.operation, text: `/result${args.path}` }
    }
    if (request.operation === 'sha256') {
      const bytes = Buffer.from(rootFiles.get(args.path) || '')
      return { exitCode: 0, kind: 'sha256', sha256: sha256(bytes), size: bytes.length }
    }
    if (request.operation === 'sha256-bound' ||
      request.operation === 'sha256-range-bound') {
      if (options.digestFailure) throw new Error('bounded digest failed')
      const stageNode = stageRootPath &&
        args.path.startsWith(`${stageRootPath}/`)
        ? nodes.get(args.path)
        : null
      const node = stageNode || (options.privilegedTree
        ? ensurePrivilegedBinding(privilegedNodes.get(args.path))
        : null)
      const parent = stageNode
        ? { device: '2049', inode: '777' }
        : options.privilegedTree
          ? ensurePrivilegedBinding(privilegedNodes.get(args.sourceParentRealPath))
          : null
      if ((stageNode || options.privilegedTree) && (!node || node.type !== 'file' ||
        node.device !== args.sourceDevice || node.inode !== args.sourceInode ||
        parent.device !== args.sourceParentDevice ||
        parent.inode !== args.sourceParentInode)) {
        throw new Error('sha256 source binding changed')
      }
      const totalSize = stageNode || options.privilegedTree
        ? Number(node.size ?? node.content?.length ?? 0)
        : Buffer.from(rootFiles.get(args.path) || '').length
      if (String(totalSize) !== args.expectedSize ||
        totalSize > Number(args.maxSize)) {
        throw new Error('sha256 source size changed')
      }
      const bytes = request.operation === 'sha256-range-bound'
        ? stageNode || options.privilegedTree
          ? privilegedBytes(node, Number(args.offset), Number(args.maxBytes))
          : Buffer.from(rootFiles.get(args.path) || '').subarray(
            Number(args.offset),
            Number(args.offset) + Number(args.maxBytes)
          )
        : stageNode || options.privilegedTree
          ? privilegedBytes(node, 0, totalSize)
          : Buffer.from(rootFiles.get(args.path) || '')
      return {
        exitCode: 0,
        kind: request.operation,
        sha256: sha256(bytes),
        size: bytes.length
      }
    }
    if (request.operation === 'digest-cleanup') {
      events.push(`pty:digest-cleanup:${args.objectName}`)
      if (options.digestCleanupFailures > 0) {
        options.digestCleanupFailures -= 1
        throw new Error('digest scratch cleanup failed')
      }
      return { exitCode: 0, kind: 'digest-cleanup', ok: true }
    }
    if (options.privilegedTree && request.operation === 'mkdir') {
      if (privilegedNodes.has(args.path)) throw new Error('Target exists')
      privilegedNodes.set(args.path, {
        type: 'directory', mode: 0o700, uid: 0, gid: 0
      })
      return { exitCode: 0, kind: 'mkdir', ok: true }
    }
    if (options.privilegedTree && request.operation === 'mkdir-bound') {
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      if (!parent || parent.device !== args.targetParentDevice ||
        parent.inode !== args.targetParentInode ||
        String(parent.uid) !== args.targetParentUid ||
        (parent.mode & 0o7777).toString(8) !== args.targetParentMode ||
        parent.uid !== 0 || (parent.mode & 0o022) !== 0 ||
        privilegedNodes.has(args.targetPath)) {
        throw new Error('mkdir target parent binding changed')
      }
      const node = ensurePrivilegedBinding({
        type: 'directory',
        mode: Number.parseInt(args.targetMode, 8),
        uid: Number(args.targetUid),
        gid: Number(args.targetGid)
      })
      privilegedNodes.set(args.targetPath, node)
      return {
        exitCode: 0,
        kind: 'mkdir-bound',
        device: node.device,
        inode: node.inode
      }
    }
    if (options.privilegedTree && request.operation === 'metadata-bound') {
      if (options.replaceMetadataTargetBeforeBound === args.targetPath) {
        for (const remotePath of [...privilegedNodes.keys()]) {
          if (remotePath === args.targetPath ||
            remotePath.startsWith(`${args.targetPath}/`)) {
            privilegedNodes.delete(remotePath)
          }
        }
        privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
          type: 'directory', mode: 0o755, uid: 99, gid: 99
        }))
        privilegedNodes.set(`${args.targetPath}/foreign-sentinel`,
          ensurePrivilegedBinding({
            type: 'file',
            mode: 0o600,
            uid: 99,
            gid: 99,
            content: Buffer.from('foreign')
          }))
        options.replaceMetadataTargetBeforeBound = undefined
      }
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      const node = ensurePrivilegedBinding(privilegedNodes.get(args.targetPath))
      if (!parent || !node || parent.device !== args.targetParentDevice ||
        parent.inode !== args.targetParentInode ||
        String(parent.uid) !== args.targetParentUid ||
        (parent.mode & 0o7777).toString(8) !== args.targetParentMode ||
        parent.uid !== 0 || (parent.mode & 0o022) !== 0 ||
        node.device !== args.targetDevice || node.inode !== args.targetInode ||
        node.type !== args.targetType) {
        throw new Error('metadata target binding changed')
      }
      node.uid = Number(args.targetUid)
      node.gid = Number(args.targetGid)
      node.mode = Number.parseInt(args.targetMode, 8)
      if (options.failMetadataAfterApply === args.targetPath) {
        options.failMetadataAfterApply = undefined
        throw new Error('metadata cancelled after apply')
      }
      return { exitCode: 0, kind: 'metadata-bound', ok: true }
    }
    if (options.privilegedTree && request.operation === 'touch-bound') {
      if (options.replaceTouchTargetBeforeBound === args.targetPath) {
        privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
          type: 'file',
          mode: 0o600,
          uid: 99,
          gid: 99,
          content: Buffer.from('foreign touch target')
        }))
        options.replaceTouchTargetBeforeBound = undefined
      }
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      const node = ensurePrivilegedBinding(privilegedNodes.get(args.targetPath))
      if (!parent || !node || parent.device !== args.targetParentDevice ||
        parent.inode !== args.targetParentInode ||
        String(parent.uid) !== args.targetParentUid ||
        (parent.mode & 0o7777).toString(8) !== args.targetParentMode ||
        parent.uid !== 0 || (parent.mode & 0o022) !== 0 ||
        node.device !== args.targetDevice || node.inode !== args.targetInode ||
        node.type !== args.targetType) {
        throw new Error('touch target binding changed')
      }
      node.touched = true
      return { exitCode: 0, kind: 'touch-bound', ok: true }
    }
    if (options.privilegedTree && request.operation === 'chmod') {
      privilegedNodes.get(args.path).mode = Number.parseInt(args.mode, 8)
      return { exitCode: 0, kind: 'chmod', ok: true }
    }
    if (options.privilegedTree && request.operation === 'chown') {
      privilegedNodes.get(args.path).uid = Number(args.uid)
      privilegedNodes.get(args.path).gid = Number(args.gid)
      return { exitCode: 0, kind: 'chown', ok: true }
    }
    if (request.operation === 'rename-bound') {
      if (!options.privilegedTree) {
        return { exitCode: 0, kind: 'rename-bound', ok: true }
      }
      if (options.replaceRenameSourceBeforeBound === args.sourcePath) {
        privilegedNodes.set(args.sourcePath, ensurePrivilegedBinding({
          type: args.sourceType,
          mode: 0o600,
          uid: 99,
          gid: 99,
          content: Buffer.from('foreign source')
        }))
      }
      if (options.raceRenameTarget === args.targetPath) {
        privilegedNodes.set(args.targetPath, ensurePrivilegedBinding({
          type: 'file',
          mode: 0o600,
          uid: 99,
          gid: 99,
          content: Buffer.from('foreign target')
        }))
      }
      const source = ensurePrivilegedBinding(privilegedNodes.get(args.sourcePath))
      const sourceParent = ensurePrivilegedBinding(privilegedNodes.get(
        args.sourceParentRealPath
      ))
      const targetParent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      if (!source || source.device !== args.sourceDevice ||
        source.inode !== args.sourceInode || source.type !== args.sourceType ||
        sourceParent.device !== args.sourceParentDevice ||
        sourceParent.inode !== args.sourceParentInode ||
        String(sourceParent.uid) !== args.sourceParentUid ||
        (sourceParent.mode & 0o7777).toString(8) !== args.sourceParentMode ||
        sourceParent.uid !== 0 || (sourceParent.mode & 0o022) !== 0 ||
        targetParent.device !== args.targetParentDevice ||
        targetParent.inode !== args.targetParentInode ||
        String(targetParent.uid) !== args.targetParentUid ||
        (targetParent.mode & 0o7777).toString(8) !== args.targetParentMode ||
        targetParent.uid !== 0 || (targetParent.mode & 0o022) !== 0 ||
        privilegedNodes.has(args.targetPath)) {
        throw new Error('rename bound race rejected')
      }
      const moved = [...privilegedNodes.entries()].filter(([remotePath]) =>
        remotePath === args.sourcePath || remotePath.startsWith(`${args.sourcePath}/`))
      for (const [remotePath] of moved) privilegedNodes.delete(remotePath)
      for (const [remotePath, node] of moved) {
        privilegedNodes.set(`${args.targetPath}${remotePath.slice(args.sourcePath.length)}`, node)
      }
      return { exitCode: 0, kind: 'rename-bound', ok: true }
    }
    if (options.privilegedTree && request.operation === 'rename') {
      if (privilegedNodes.has(args.target)) throw new Error('Target exists')
      const moved = [...privilegedNodes.entries()].filter(([remotePath]) =>
        remotePath === args.source || remotePath.startsWith(`${args.source}/`))
      if (!moved.length) throw missing(args.source)
      for (const [remotePath] of moved) privilegedNodes.delete(remotePath)
      for (const [remotePath, node] of moved) {
        privilegedNodes.set(`${args.target}${remotePath.slice(args.source.length)}`, node)
      }
      return { exitCode: 0, kind: 'rename', ok: true }
    }
    if (options.privilegedTree && request.operation === 'rm') {
      const effectivePath = options.redirectRm?.[args.path] || args.path
      const node = privilegedNodes.get(effectivePath)
      if (!node || node.type !== 'file') throw new Error('not a file')
      privilegedNodes.delete(effectivePath)
      options.onTreeRemove?.(effectivePath)
      return { exitCode: 0, kind: 'rm', ok: true }
    }
    if (options.privilegedTree && request.operation === 'remove-empty-directory') {
      if ([...privilegedNodes.keys()].some(remotePath =>
        remotePath.startsWith(`${args.path}/`))) {
        throw new Error('Directory not empty')
      }
      const node = privilegedNodes.get(args.path)
      if (!node || node.type !== 'directory') throw new Error('not a directory')
      privilegedNodes.delete(args.path)
      return { exitCode: 0, kind: 'remove-empty-directory', ok: true }
    }
    if (options.privilegedTree && [
      'remove-bound', 'remove-peer-bound'
    ].includes(request.operation)) {
      if (options.redirectRm?.[args.targetPath]) {
        throw new Error('remove parent binding changed')
      }
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      const node = ensurePrivilegedBinding(privilegedNodes.get(args.targetPath))
      if (options.importCleanupFailures > 0 &&
        (args.targetPath === options.importCleanupTarget ||
          args.targetPath.includes('/.shellpilot-upload-'))) {
        options.importCleanupFailures -= 1
        throw new Error('import residual cleanup failed')
      }
      const mutatedContent = options.mutateBeforeRemoveBound?.[args.targetPath]
      if (mutatedContent !== undefined && node?.type === 'file') {
        node.content = Buffer.from(mutatedContent)
        node.size = node.content.length
        delete options.mutateBeforeRemoveBound[args.targetPath]
      }
      if (request.operation === 'remove-peer-bound') {
        const peerParent = ensurePrivilegedBinding(privilegedNodes.get(
          args.peerParentRealPath
        ))
        const peer = ensurePrivilegedBinding(privilegedNodes.get(args.peerPath))
        const mutatedPeerContent = options.mutatePeerBeforeRemoveBound?.[
          args.peerPath
        ]
        if (mutatedPeerContent !== undefined && peer?.type === 'file') {
          peer.content = Buffer.from(mutatedPeerContent)
          peer.size = peer.content.length
          delete options.mutatePeerBeforeRemoveBound[args.peerPath]
        }
        if (!peerParent || !peer ||
          peerParent.device !== args.peerParentDevice ||
          peerParent.inode !== args.peerParentInode ||
          peer.device !== args.peerDevice || peer.inode !== args.peerInode ||
          peer.type !== args.peerType ||
          (peer.mode & 0o7777).toString(8) !== args.peerMode ||
          String(peer.uid) !== args.peerUid || String(peer.gid) !== args.peerGid ||
          (peer.type === 'file' && (
            sha256(privilegedBytes(peer)) !== args.peerSha256 ||
            String(peer.size ?? peer.content.length) !== args.peerSize
          ))) {
          throw new Error('remove peer proof changed')
        }
      }
      if (!parent || !node || parent.device !== args.targetParentDevice ||
        parent.inode !== args.targetParentInode ||
        node.device !== args.targetDevice || node.inode !== args.targetInode ||
        node.type !== args.targetType ||
        (node.mode & 0o7777).toString(8) !== args.targetMode ||
        String(node.uid) !== args.targetUid ||
        String(node.gid) !== args.targetGid) {
        throw new Error('remove entry binding changed')
      }
      if (node.type === 'file' && (
        sha256(privilegedBytes(node)) !== args.sha256 ||
        String(node.size ?? node.content.length) !== args.size
      )) {
        throw new Error('remove content proof changed')
      }
      if (node.type === 'directory' && [...privilegedNodes.keys()].some(path =>
        path.startsWith(`${args.targetPath}/`))) {
        throw new Error('Directory not empty')
      }
      privilegedNodes.delete(args.targetPath)
      options.onTreeRemove?.(args.targetPath)
      return { exitCode: 0, kind: request.operation, ok: true }
    }
    return { exitCode: 0, kind: request.operation, ok: true }
  }

  const lease = {
    async execute (payload) {
      executions.push(payload)
      activeLeaseExecutions += 1
      peakLeaseExecutions = Math.max(peakLeaseExecutions, activeLeaseExecutions)
      events.push(`lease:start:${payload.request.operation}`)
      if (options.strictSingleActive && activeLeaseExecutions > 1) {
        activeLeaseExecutions -= 1
        throw new Error('strict lease active conflict')
      }
      try {
        if (options.executeDelayMs) {
          await new Promise(resolve => setTimeout(resolve, options.executeDelayMs))
        }
        return await executeCore(payload)
      } finally {
        events.push(`lease:end:${payload.request.operation}`)
        activeLeaseExecutions -= 1
      }
    },
    async release () {
      leaseReleases += 1
      events.push('lease:release')
      if (options.leaseReleaseFailure) throw new Error('lease release failed')
      return true
    }
  }
  return {
    sftp,
    lease,
    requests,
    executions,
    events,
    sftpReads,
    rootFiles,
    privilegedNodes,
    nodes,
    get peakLeaseExecutions () { return peakLeaseExecutions },
    get leaseReleases () { return leaseReleases }
  }
}

async function createRootBackend (harness, options = {}) {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  return createPrivilegedFileBackend({
    sftp: harness.sftp,
    lease: harness.lease,
    identity: options.identity || { uid: '0', username: 'root' },
    ...(Object.hasOwn(options, 'capabilities')
      ? { capabilities: options.capabilities }
      : {}),
    createToken: createTokenFactory()
  })
}

async function runRootUpload (backend, { remotePath, mode }) {
  let settleTerminal
  const terminal = new Promise(resolve => { settleTerminal = resolve })
  const transport = await backend.sftp.upload({
    localPath: 'C:\\isolated\\upload.txt',
    remotePath,
    options: { mode },
    onEnd: value => settleTerminal({ value }),
    onError: error => settleTerminal({ error })
  })
  return { transport, ...await terminal }
}

test('native backend preserves the original SFTP object identity', async () => {
  const { createNativeSftpFileBackend } = await importModule(backendsModule)
  const sftp = { marker: true }
  const backend = createNativeSftpFileBackend(sftp)
  assert.equal(Object.isFrozen(backend), true)
  assert.equal(backend.channel, 'sftp')
  assert.equal(backend.runtimeIdentity, null)
  assert.equal(backend.sftp, sftp)
  assert.equal(backend.backend, sftp)
  assert.equal(await backend.release(), true)
  assert.throws(() => createNativeSftpFileBackend(), /SFTP|sftp/)
})

test('backup helper works through the real privileged facade and fails closed on lstat errors', async t => {
  const { backupRemoteFiles } = await importModule(sftpSafetyModule)
  const now = new Date('2026-07-12T08:09:10Z')
  const sourcePath = '/root/app.conf'
  const baseBackupPath =
    '/root/.shellpilot-backups/app.conf-20260712-080910'
  const harness = createBackendHarness({
    privilegedTree: {
      '/': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      '/root': { type: 'directory', mode: 0o700, uid: 0, gid: 0 },
      [sourcePath]: {
        type: 'file', mode: 0o600, uid: 0, gid: 0, content: 'safe'
      }
    }
  })
  const backend = await createRootBackend(harness)
  try {
    const first = await backupRemoteFiles({
      sftp: backend.sftp,
      files: [{ path: '/root', name: 'app.conf', isDirectory: false }],
      now
    })
    const second = await backupRemoteFiles({
      sftp: backend.sftp,
      files: [{ path: '/root', name: 'app.conf', isDirectory: false }],
      now
    })
    assert.equal(first[0].backupPath, baseBackupPath)
    assert.equal(second[0].backupPath, `${baseBackupPath}-2`)
    assert.equal(
      harness.privilegedNodes.get(baseBackupPath).content.toString(),
      'safe'
    )
    assert.equal(
      harness.privilegedNodes.get(`${baseBackupPath}-2`).content.toString(),
      'safe'
    )
  } finally {
    await backend.release()
  }

  for (const failure of [
    Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    Object.assign(new Error('transport disconnected'), {
      code: 'ECONNRESET'
    }),
    Object.assign(new Error('generic privileged failure'), {
      code: 'PRIVILEGED_FILE_OPERATION_FAILED'
    })
  ]) {
    await t.test(failure.code, async () => {
      const failedHarness = createBackendHarness({
        privilegedTree: {
          '/': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
          '/root': { type: 'directory', mode: 0o700, uid: 0, gid: 0 },
          [sourcePath]: {
            type: 'file', mode: 0o600, uid: 0, gid: 0, content: 'safe'
          }
        },
        failPrivilegedRequest: request => (
          request.operation === 'lstat' &&
          request.args.path === baseBackupPath
            ? failure
            : null
        )
      })
      const failedBackend = await createRootBackend(failedHarness)
      try {
        await assert.rejects(backupRemoteFiles({
          sftp: failedBackend.sftp,
          files: [{ path: '/root', name: 'app.conf', isDirectory: false }],
          now
        }), error => error === failure)
        assert.equal(failedHarness.privilegedNodes.has(baseBackupPath), false)
      } finally {
        await failedBackend.release()
      }
    })
  }
})

test('privileged backend validates root identity and bounded lease and releases failed creation', async () => {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  const harness = createBackendHarness({ badHandshake: true })
  await assert.rejects(
    createPrivilegedFileBackend({
      sftp: harness.sftp,
      lease: harness.lease,
      identity: { uid: '0', username: 'root' },
      createToken: createTokenFactory()
    }),
    /handshake rejected/
  )
  assert.equal(harness.leaseReleases, 1)
  for (const value of [
    { sftp: harness.sftp, lease: {}, identity: { uid: '0', username: 'root' } },
    { sftp: harness.sftp, lease: harness.lease, identity: { uid: '1000', username: 'login' } },
    { sftp: harness.sftp, lease: harness.lease, identity: { uid: '0', username: '' } }
  ]) {
    await assert.rejects(createPrivilegedFileBackend(value), /lease|租约|root|身份|username/i)
  }
})

test('privileged backend releases every releasable lease after construction validation fails', async () => {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  const harness = createBackendHarness()
  for (const setup of [
    {
      label: 'missing SFTP',
      pattern: /SFTP|sftp/,
      build: lease => ({
        lease,
        identity: { uid: '0', username: 'root' }
      })
    },
    {
      label: 'non-root identity',
      pattern: /root|身份/,
      build: lease => ({
        sftp: harness.sftp,
        lease,
        identity: { uid: '1000', username: 'login' }
      })
    },
    {
      label: 'missing execute',
      pattern: /lease|租约/,
      build: lease => ({
        sftp: harness.sftp,
        lease: { release: lease.release },
        identity: { uid: '0', username: 'root' }
      })
    }
  ]) {
    let releases = 0
    const lease = {
      async execute () {},
      async release () {
        releases += 1
        return true
      }
    }
    await assert.rejects(
      createPrivilegedFileBackend(setup.build(lease)),
      setup.pattern,
      setup.label
    )
    assert.equal(releases, 1, setup.label)
  }

  let releases = 0
  const releaseFailure = new Error('validation cleanup failed')
  const validationError = await createPrivilegedFileBackend({
    sftp: harness.sftp,
    lease: {
      async execute () {},
      async release () {
        releases += 1
        throw releaseFailure
      }
    },
    identity: { uid: '1000', username: 'login' }
  }).catch(error => error)
  assert.match(validationError.message, /root|身份/)
  assert.equal(validationError.releaseError, releaseFailure)
  assert.equal(releases, 1)

  await assert.rejects(createPrivilegedFileBackend({
    sftp: harness.sftp,
    lease: { execute () {} },
    identity: { uid: '0', username: 'root' }
  }), /lease|租约/)
})

test('privileged backend clones and freezes a validated boolean capability map', async () => {
  const capabilities = { list: true, copyEntry: false }
  const harness = createBackendHarness()
  const backend = await createRootBackend(harness, { capabilities })
  assert.notEqual(backend.capabilities, capabilities)
  assert.deepEqual(backend.capabilities, capabilities)
  assert.equal(Object.isFrozen(backend.capabilities), true)
  capabilities.list = false
  assert.equal(backend.capabilities.list, true)
  await backend.release()

  for (const invalid of [[], { list: 1 }, { 'bad key': true }]) {
    const invalidHarness = createBackendHarness()
    await assert.rejects(
      createRootBackend(invalidHarness, { capabilities: invalid }),
      /capabilit/i
    )
    assert.equal(invalidHarness.leaseReleases, 1)
  }
})

test('privileged facade rejects partial octal strings and unsafe numeric modes', async () => {
  const harness = createBackendHarness()
  const backend = await createRootBackend(harness)
  const before = harness.requests.length
  for (const mode of ['600junk', '08', 9007199254740992]) {
    await assert.rejects(backend.sftp.chmod('/root/file', mode), /mode/i)
  }
  assert.equal(harness.requests.length, before)
  await backend.release()
})

test('root upload normalizes supported Windows stat type bits before stage-import', async () => {
  const harness = createBackendHarness({
    transferUploadContent: 'uploaded on Windows',
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o700, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  for (const [name, sourceMode, targetMode] of [
    ['permissions', 0o640, 0o640],
    ['octal-string', '0750', 0o750],
    ['file', 0o100666, 0o666],
    ['directory', 0o040777, 0o777]
  ]) {
    const targetPath = `/root/windows-${name}-mode.txt`
    const result = await runRootUpload(backend, {
      remotePath: targetPath,
      mode: sourceMode
    })

    assert.equal(result.error, undefined)
    assert.equal(
      result.value.transferred,
      Buffer.byteLength('uploaded on Windows')
    )
    const imported = harness.requests.find(request => (
      request.operation === 'stage-import' &&
      request.args.targetPath === targetPath
    ))
    assert.equal(imported.args.targetMode, targetMode.toString(8))
    assert.equal(harness.privilegedNodes.get(targetPath).mode, targetMode)
  }
  assert.equal(harness.requests.filter(request => (
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  )).length, 4)
  assert.equal([...harness.nodes.keys()].some(path => path.includes('/upload-')), false)
  await backend.release()
})

test('root upload rejects invalid local modes before import and cleans every stage', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o700, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)
  const invalidModes = [
    0o010666,
    0o060777,
    0o120777,
    0o140777,
    NaN,
    -1,
    1.5,
    0o200000,
    '100666'
  ]

  for (const [index, mode] of invalidModes.entries()) {
    const targetPath = `/root/invalid-upload-${index}`
    const importsBefore = harness.requests.filter(request => (
      request.operation === 'stage-import'
    )).length
    const cleanupsBefore = harness.requests.filter(request => (
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    )).length
    const result = await runRootUpload(backend, { remotePath: targetPath, mode })

    assert.match(result.error?.message || '', /mode/i)
    assert.equal(harness.requests.filter(request => (
      request.operation === 'stage-import'
    )).length, importsBefore)
    assert.equal(harness.privilegedNodes.has(targetPath), false)
    assert.equal(harness.requests.filter(request => (
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    )).length, cleanupsBefore + 1)
    assert.equal([...harness.nodes.keys()].some(path => path.includes('/upload-')), false)
  }
  await backend.release()
})

test('root write requestedMode validation does not accept local stat type bits', async () => {
  const harness = createBackendHarness({ missingLstatResult: true })
  const backend = await createRootBackend(harness)

  for (const mode of [0o100666, 0o040777]) {
    await assert.rejects(
      backend.sftp.writeFile('/root/missing-mode', 'safe', mode),
      /mode/i
    )
  }
  assert.equal(harness.requests.some(request => (
    request.operation === 'stage-import'
  )), false)
  await backend.release()
})

test('privileged backend serializes every PTY request and release waits for accepted work', async () => {
  const harness = createBackendHarness({
    strictSingleActive: true,
    executeDelayMs: 5
  })
  const backend = await createRootBackend(harness)

  await Promise.all([
    backend.sftp.list('/root'),
    backend.sftp.stat('/root/file'),
    backend.sftp.realpath('/root/file')
  ])
  assert.equal(harness.peakLeaseExecutions, 1)

  const accepted = backend.sftp.list('/root')
  const release = backend.release()
  assert.equal((await accepted).length, 3)
  assert.equal(await release, true)
  assert.equal(harness.peakLeaseExecutions, 1)
  assert.equal(harness.events.at(-1), 'lease:release')
  await assert.rejects(backend.sftp.stat('/root/file'), /released|释放|关闭/i)
})

test('privileged facade maps fixed metadata and mutation methods to protocol requests', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/file': 'content' },
    missingLstatResult: true
  })
  const backend = await createRootBackend(harness)
  const facade = backend.sftp
  assert.equal(Object.isFrozen(backend), true)
  assert.equal(Object.isFrozen(backend.runtimeIdentity), true)
  assert.deepEqual(backend.runtimeIdentity, {
    channel: 'pty-root', effectiveUid: '0', effectiveUsername: 'root'
  })
  assert.equal(backend.channel, 'pty-root')
  assert.equal(backend.backend, facade)
  assert.equal(Object.isFrozen(facade), true)

  assert.deepEqual(await facade.list('/root'), [
    { name: 'file.txt', type: '-', size: 12, accessTime: 1000, modifyTime: 2000, mode: 0o100640, owner: 3, group: 4 },
    { name: 'dir', type: 'd', size: 0, accessTime: 5000, modifyTime: 6000, mode: 0o40750, owner: 7, group: 8 },
    { name: 'link', type: 'l', size: 3, accessTime: 9000, modifyTime: 10000, mode: 0o120777, owner: 11, group: 12 }
  ])
  assert.deepEqual(await facade.lstat('/root/file'), {
    mode: 0o100640,
    type: 'file',
    size: 7,
    atime: 1,
    mtime: 2,
    uid: 3,
    gid: 4,
    device: '1',
    inode: '100',
    parentRealPath: '/root',
    parentDevice: '1',
    parentInode: '100',
    isDirectory: false
  })
  assert.equal((await facade.stat('/root/file')).type, 'file')
  assert.equal(await facade.readlink('/root/link'), '/result/root/link')
  assert.equal(await facade.realpath('/root/file'), '/result/root/file')

  await facade.rename('/root/a', '/root/missing-b')
  await facade.mv('/root/d', '/root/missing-e')
  assert.equal(typeof facade.copyEntry, 'function')
  assert.equal(typeof facade.removeEntry, 'function')
  assert.equal(typeof facade.cp, 'function')

  assert.deepEqual(
    harness.requests.filter(request => !request.operation.startsWith('stage-'))
      .map(request => [request.operation, request.args]),
    [
      ['list', { path: '/root' }],
      ['lstat', { path: '/root/file' }],
      ['stat', { path: '/root/file' }],
      ['readlink', { path: '/root/link' }],
      ['realpath', { path: '/root/file' }],
      ['lstat', { path: '/root/a' }],
      ['lstat', { path: '/root/missing-b' }],
      ['lstat', { path: '/root' }],
      ['rename-bound', {
        sourcePath: '/root/a',
        sourceParentRealPath: '/root',
        sourceParentDevice: '1',
        sourceParentInode: '100',
        sourceParentUid: '0',
        sourceParentMode: '755',
        sourceDevice: '1',
        sourceInode: '100',
        sourceType: 'file',
        targetPath: '/root/missing-b',
        targetParentRealPath: '/root',
        targetParentDevice: '1',
        targetParentInode: '100',
        targetParentUid: '0',
        targetParentMode: '755'
      }],
      ['lstat', { path: '/root/d' }],
      ['lstat', { path: '/root/missing-e' }],
      ['lstat', { path: '/root' }],
      ['rename-bound', {
        sourcePath: '/root/d',
        sourceParentRealPath: '/root',
        sourceParentDevice: '1',
        sourceParentInode: '100',
        sourceParentUid: '0',
        sourceParentMode: '755',
        sourceDevice: '1',
        sourceInode: '100',
        sourceType: 'file',
        targetPath: '/root/missing-e',
        targetParentRealPath: '/root',
        targetParentDevice: '1',
        targetParentInode: '100',
        targetParentUid: '0',
        targetParentMode: '755'
      }]
    ]
  )
  await backend.release()
})

test('privileged public mutations route only through bound operations', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      '/root/file': { type: 'file', mode: 0o640, uid: 3, gid: 4, content: 'x' },
      '/root/touched': { type: 'file', mode: 0o600, uid: 0, gid: 0, content: 'x' },
      '/root/empty': { type: 'directory', mode: 0o700, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await backend.sftp.mkdir('/root/new-dir')
  await backend.sftp.touch('/root/touched')
  await backend.sftp.touch('/root/new-file')
  await backend.sftp.chmod('/root/file', 0o600)
  await backend.sftp.chown('/root/file', 10, 11)
  await backend.sftp.rm('/root/file')
  await backend.sftp.rmdir('/root/empty')

  const operations = harness.requests.map(request => request.operation)
  for (const operation of ['mkdir', 'touch', 'rm', 'rmdir', 'chmod', 'chown']) {
    assert.equal(operations.includes(operation), false, operation)
  }
  assert.equal(operations.includes('mkdir-bound'), true)
  assert.equal(operations.includes('touch-bound'), true)
  assert.ok(operations.filter(operation => operation === 'metadata-bound').length >= 2)
  assert.ok(operations.filter(operation => operation === 'remove-bound').length >= 2)
  assert.equal(harness.privilegedNodes.get('/root/new-dir').type, 'directory')
  assert.equal(harness.privilegedNodes.get('/root/new-file').content.length, 0)
  assert.equal(harness.privilegedNodes.has('/root/file'), false)
  assert.equal(harness.privilegedNodes.has('/root/empty'), false)
  await backend.release()
})

test('privileged public bound mutations preserve replacements and reject untrusted parents', async () => {
  const parentRace = createBackendHarness({
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    },
    onPrivilegedLstat (remotePath, nodes) {
      if (remotePath === '/root/new-dir') nodes.get('/root').mode = 0o777
    }
  })
  const parentRaceBackend = await createRootBackend(parentRace)
  await assert.rejects(
    parentRaceBackend.sftp.mkdir('/root/new-dir'),
    /parent|binding|操作失败/i
  )
  assert.equal(parentRace.privilegedNodes.has('/root/new-dir'), false)
  await parentRaceBackend.release()

  const targetRace = createBackendHarness({
    replaceTouchTargetBeforeBound: '/root/file',
    replaceMetadataTargetBeforeBound: '/root/dir',
    redirectRm: { '/root/remove': '/root/foreign' },
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      '/root/file': { type: 'file', mode: 0o600, uid: 0, gid: 0, content: 'owned' },
      '/root/dir': { type: 'directory', mode: 0o700, uid: 0, gid: 0 },
      '/root/remove': { type: 'file', mode: 0o600, uid: 0, gid: 0, content: 'owned' },
      '/root/foreign': { type: 'file', mode: 0o600, uid: 99, gid: 99, content: 'foreign' }
    }
  })
  const targetRaceBackend = await createRootBackend(targetRace)
  await assert.rejects(targetRaceBackend.sftp.touch('/root/file'), /binding|操作失败/i)
  assert.equal(targetRace.privilegedNodes.get('/root/file').content.toString(), 'foreign touch target')
  await assert.rejects(targetRaceBackend.sftp.chmod('/root/dir', 0o755), /binding|操作失败/i)
  assert.equal(targetRace.privilegedNodes.get('/root/dir').uid, 99)
  await assert.rejects(targetRaceBackend.sftp.rm('/root/remove'), /binding|操作失败/i)
  assert.equal(targetRace.privilegedNodes.get('/root/remove').content.toString(), 'owned')
  assert.equal(targetRace.privilegedNodes.get('/root/foreign').content.toString(), 'foreign')
  await targetRaceBackend.release()
})

test('privileged rename binds both parents and preserves raced foreign entries', async () => {
  const success = createBackendHarness({
    privilegedTree: {
      '/root/source': { type: 'file', content: 'owned' }
    }
  })
  const successBackend = await createRootBackend(success)
  assert.equal(await successBackend.sftp.rename('/root/source', '/root/target'), 1)
  assert.equal(success.privilegedNodes.has('/root/source'), false)
  assert.equal(success.privilegedNodes.get('/root/target').content.toString(), 'owned')
  const request = success.requests.find(item => item.operation === 'rename-bound')
  assert.equal(request.args.sourceDevice, request.args.sourceParentDevice)
  assert.equal(request.args.sourceDevice, request.args.targetParentDevice)
  await successBackend.release()

  const sourceRace = createBackendHarness({
    replaceRenameSourceBeforeBound: '/root/source',
    privilegedTree: {
      '/root/source': { type: 'file', content: 'owned' }
    }
  })
  const sourceRaceBackend = await createRootBackend(sourceRace)
  await assert.rejects(
    sourceRaceBackend.sftp.rename('/root/source', '/root/target'),
    /rename|binding|race|操作失败/i
  )
  assert.equal(sourceRace.privilegedNodes.has('/root/target'), false)
  assert.equal(
    sourceRace.privilegedNodes.get('/root/source').content.toString(),
    'foreign source'
  )
  await sourceRaceBackend.release()

  const targetRace = createBackendHarness({
    raceRenameTarget: '/root/target',
    privilegedTree: {
      '/root/source': { type: 'file', content: 'owned' }
    }
  })
  const targetRaceBackend = await createRootBackend(targetRace)
  await assert.rejects(
    targetRaceBackend.sftp.rename('/root/source', '/root/target'),
    /rename|exists|race|操作失败/i
  )
  assert.equal(targetRace.privilegedNodes.get('/root/source').content.toString(), 'owned')
  assert.equal(targetRace.privilegedNodes.get('/root/target').content.toString(), 'foreign target')
  await targetRaceBackend.release()
})

test('real transaction adapter cannot overwrite a target raced into bound rename', async () => {
  const { createSftpTransactionAdapter } = await importModule(
    'src/client/components/sftp/sftp-transaction-adapter.js'
  )
  const { buildSideEffectSafetyRequest } = await importModule(
    'src/client/common/safety-transactions/side-effect-model.js'
  )
  const sourcePath = '/srv/app/source.txt'
  const targetPath = '/srv/app/target.txt'
  const harness = createBackendHarness({
    raceRenameTarget: targetPath,
    privilegedTree: {
      [sourcePath]: { type: 'file', content: 'owned source' }
    }
  })
  const backend = await createRootBackend(harness)
  const operation = await buildSideEffectSafetyRequest({
    id: 'privileged-rename-raced-target',
    source: 'sftp',
    title: 'privileged rename race',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'sftp'
    },
    effect: {
      adapter: 'sftp',
      action: 'rename',
      paths: { source: sourcePath, target: targetPath },
      resources: [
        { path: sourcePath, type: 'file' },
        { path: targetPath, type: 'file' }
      ],
      type: 'file',
      expected: {}
    }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => backend.sftp })
  Object.assign(operation, await adapter.prepare(operation))
  assert.equal(harness.requests.some(request => request.operation === 'mkdir-bound'), true)
  assert.equal(harness.requests.some(request =>
    ['mkdir', 'touch', 'rm', 'rmdir', 'chmod', 'chown'].includes(
      request.operation
    )), false)

  await assert.rejects(adapter.beforeExecute(operation), /rename|race|操作失败/i)
  assert.equal(
    harness.privilegedNodes.get(sourcePath).content.toString(),
    'owned source'
  )
  assert.equal(
    harness.privilegedNodes.get(targetPath).content.toString(),
    'foreign target'
  )
  await backend.release()
})

test('real transaction adapter cleans a non-root-owned snapshot staging tree', async () => {
  const { createSftpTransactionAdapter } = await importModule(
    'src/client/components/sftp/sftp-transaction-adapter.js'
  )
  const { buildSideEffectSafetyRequest } = await importModule(
    'src/client/common/safety-transactions/side-effect-model.js'
  )
  const sourcePath = '/srv/app/tree'
  const operationId = 'privileged-non-root-snapshot-cleanup'
  const operationDir = `/srv/app/.shellpilot-transactions/${operationId}`
  const snapshotPath = `${operationDir}/source`
  const stagingPath = `${snapshotPath}.preparing`
  const harness = createBackendHarness({
    raceRenameTarget: snapshotPath,
    privilegedTree: {
      [sourcePath]: {
        type: 'directory', mode: 0o750, uid: 1000, gid: 1000
      },
      [`${sourcePath}/nested`]: {
        type: 'directory', mode: 0o750, uid: 1001, gid: 1001
      },
      [`${sourcePath}/nested/file`]: {
        type: 'file', mode: 0o640, uid: 1002, gid: 1002, content: 'snapshot'
      }
    }
  })
  const backend = await createRootBackend(harness)
  const operation = await buildSideEffectSafetyRequest({
    id: operationId,
    source: 'sftp',
    title: 'privileged non-root snapshot cleanup',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'sftp'
    },
    effect: {
      adapter: 'sftp',
      action: 'delete',
      paths: { source: sourcePath },
      resources: [{ path: sourcePath, type: 'directory' }],
      type: 'directory',
      expected: { absent: true }
    }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => backend.sftp })

  await assert.rejects(adapter.prepare(operation), /rename|race|操作失败/i)
  assert.deepEqual(
    [...harness.privilegedNodes.keys()].filter(path =>
      path === stagingPath || path.startsWith(`${stagingPath}/`)),
    []
  )
  assert.equal(harness.privilegedNodes.has(snapshotPath), true,
    'the raced snapshot target remains foreign and must not be removed')
  await backend.release()
})

test('privileged reads use bounded logical streams and never send secrets through PTY', async () => {
  const secret = Buffer.from('TOP-SECRET\u0000bytes')
  const harness = createBackendHarness({ rootFiles: { '/root/secret': secret } })
  const backend = await createRootBackend(harness)

  assert.equal(await backend.sftp.readFile('/root/secret'), secret.toString('utf8'))
  const prefix = await backend.sftp.readFileChunk('/root/secret', {
    offset: 0,
    maxBytes: 4
  })
  const chunk = await backend.sftp.readFileChunk('/root/secret', {
    offset: prefix.nextOffset,
    maxBytes: 6
  })
  assert.deepEqual(chunk, {
    base64: secret.subarray(4, 10).toString('base64'),
    offset: 4,
    nextOffset: 10,
    bytesRead: 6,
    totalBytes: secret.length,
    hasMore: true
  })
  const suffix = await backend.sftp.readFileChunk('/root/secret', {
    offset: chunk.nextOffset,
    maxBytes: 64 * 1024
  })
  assert.equal(suffix.hasMore, false)
  assert.equal(await backend.sftp.readFile('/root/secret'), secret.toString('utf8'))
  assert.equal((await backend.sftp.list('/')).length, 3)
  const resume = await backend.sftp.describeResumeEntry('/root/secret', 4)
  assert.deepEqual(resume, {
    size: secret.length,
    mtimeMs: 2000,
    firstSha256: sha256(secret.subarray(0, 4)),
    lastSha256: sha256(secret.subarray(secret.length - 4)),
    boundarySha256: sha256(secret.subarray(secret.length - 4))
  })
  assert.equal(harness.requests.filter(request => request.operation === 'stage-export').length, 0)
  assert.equal(harness.requests.filter(request => request.operation === 'stage-export-range').length, 5)
  assert.equal(harness.requests.filter(request => request.operation === 'sha256-range-bound').length, 2)
  assert.equal(harness.requests.filter(request => (
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  )).length, 5)
  assert.equal(JSON.stringify(harness.requests).includes('TOP-SECRET'), false)
  assert.equal(JSON.stringify(harness.requests).includes(secret.toString('base64')), false)
  await backend.release()

  for (const mismatch of [
    { exportDigest: 'f'.repeat(64) },
    { exportSize: secret.length + 1 }
  ]) {
    const rejectedHarness = createBackendHarness({
      rootFiles: { '/root/secret': secret },
      ...mismatch
    })
    const rejected = await createRootBackend(rejectedHarness)
    await assert.rejects(
      rejected.sftp.readFile('/root/secret'),
      /SHA|digest|摘要|size|大小|chunk|分块/i
    )
    await assert.rejects(rejected.release(), /cleanup proof|摘要|大小/i)
  }
})

test('privileged resume fingerprints a huge declared file with exactly two bounded digest windows', async () => {
  const hugeSize = 1024 * 1024 * 1024 * 1024
  const boundary = 64 * 1024
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/huge': {
        type: 'file',
        size: hugeSize,
        virtualByte: 7,
        content: ''
      }
    }
  })
  const backend = await createRootBackend(harness)
  const initialSftpReads = harness.sftpReads.length
  const result = await backend.sftp.describeResumeEntry('/root/huge', boundary)
  const expectedDigest = sha256(Buffer.alloc(boundary, 7))

  assert.equal(result.size, hugeSize)
  assert.equal(result.firstSha256, expectedDigest)
  assert.equal(result.lastSha256, expectedDigest)
  const ranges = harness.requests.filter(request =>
    request.operation === 'sha256-range-bound')
  assert.equal(ranges.length, 2)
  assert.deepEqual(ranges.map(request => ({
    offset: request.args.offset,
    maxBytes: request.args.maxBytes,
    expectedSize: request.args.expectedSize
  })), [
    { offset: '0', maxBytes: String(boundary), expectedSize: String(hugeSize) },
    {
      offset: String(hugeSize - boundary),
      maxBytes: String(boundary),
      expectedSize: String(hugeSize)
    }
  ])
  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-export' ||
    request.operation === 'stage-export-range'), false)
  assert.equal(harness.sftpReads.length, initialSftpReads)
  await backend.release()
})

test('bounded digest failures track scratch cleanup without preserving a fake stage object', async () => {
  const harness = createBackendHarness({
    digestFailure: true,
    digestCleanupFailures: 1,
    privilegedTree: {
      '/root/huge': { type: 'file', size: 1024, virtualByte: 0x61 }
    }
  })
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.describeResumeEntry('/root/huge'),
    /bounded digest failed/
  )
  assert.equal(harness.requests.filter(request =>
    request.operation === 'digest-cleanup').length, 1)
  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')), false)
  assert.equal(await backend.release(), true)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'digest-cleanup').length, 2)
})

test('failed stage-import retries an exact temp cleanup during release', async () => {
  const targetPath = '/cancelled'
  const harness = createBackendHarness({
    importFailure: true,
    importResidual: 'temp',
    importTempClaim: true,
    importCleanupFailures: 1,
    importCleanupTarget: targetPath,
    privilegedTree: {}
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.message, /stage-import/)
      assert.match(error.cleanupError?.message || '', /cleanup failed/)
      return true
    }
  )
  const importIndex = harness.requests.findIndex(request =>
    request.operation === 'stage-import')
  const cleanupIndex = harness.requests.findIndex(request =>
    request.operation === 'remove-bound' &&
    request.args.targetPath.includes('/.shellpilot-upload-'))
  assert.ok(cleanupIndex > importIndex)
  assert.equal(harness.executions[cleanupIndex].signal, undefined)
  const residualPath = harness.requests[cleanupIndex].args.targetPath
  assert.equal(harness.privilegedNodes.has(residualPath), true)

  assert.equal(await backend.release(), true)
  assert.equal(harness.privilegedNodes.has(residualPath), false)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'remove-bound' &&
    request.args.targetPath === residualPath).length, 2)
})

test('failed stage-import cleans its claimed temp without touching a foreign target', async () => {
  const targetPath = '/root/foreign'
  const harness = createBackendHarness({
    importFailure: true,
    importResidual: 'temp',
    importTempClaim: true,
    importForeignTarget: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.message, /stage-import/)
      assert.equal(error.cleanupError, undefined)
      return true
    }
  )
  assert.equal(harness.privilegedNodes.get(targetPath).content.toString(), 'foreign')
  assert.equal(harness.privilegedNodes.has(
    harness.requests.find(request => request.operation === 'remove-bound')
      .args.targetPath
  ), false)
  assert.equal(await backend.release(), true)
  assert.equal(harness.privilegedNodes.get(targetPath).content.toString(), 'foreign')
})

test('cancelled stage-import never rebinds a same-content foreign final target', async () => {
  const targetPath = '/root/foreign-same-content'
  const harness = createBackendHarness({
    importFailure: true,
    importCancellation: true,
    importForeignTargetOnly: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.message, /stage import cancelled/)
      assert.match(error.cleanupError?.message || '', /ambiguous|ownership|claim/i)
      return true
    }
  )
  assert.equal(harness.privilegedNodes.get(targetPath).content.toString(), 'safe')
  assert.equal(harness.requests.some(request =>
    request.operation === 'sha256-bound' && request.args.path === targetPath), false)
  assert.equal(harness.requests.some(request =>
    request.operation === 'remove-bound' && request.args.targetPath === targetPath), false)
  await assert.rejects(backend.release(), /ambiguous|ownership|claim/i)
  assert.equal(harness.privilegedNodes.get(targetPath).content.toString(), 'safe')
})

test('cancelled stage-import never infers ownership of an unclaimed foreign temp', async () => {
  const targetPath = '/root/unclaimed-temp-target'
  const harness = createBackendHarness({
    importFailure: true,
    importCancellation: true,
    importForeignTempOnly: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.message, /stage import cancelled/)
      assert.match(error.cleanupError?.message || '', /unresolved|claim/i)
      return true
    }
  )
  const request = harness.requests.find(item => item.operation === 'stage-import')
  const tempPath = `/root/.shellpilot-${request.args.objectName}.tmp`
  assert.equal(harness.privilegedNodes.get(tempPath).content.toString(), 'safe')
  assert.equal(harness.requests.some(item =>
    item.operation === 'sha256-bound' && item.args.path === tempPath), false)
  assert.equal(harness.requests.some(item =>
    item.operation === 'remove-bound' && item.args.targetPath === tempPath), false)
  await assert.rejects(backend.release(), /unresolved|claim/i)
  assert.equal(harness.privilegedNodes.get(tempPath).content.toString(), 'safe')
})

test('stage-import exact temp claim preserves a same-content replacement', async () => {
  const targetPath = '/root/replaced-temp-target'
  const harness = createBackendHarness({
    importFailure: true,
    importResidual: 'temp',
    importTempClaim: true,
    replaceClaimedTemp: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.cleanupError?.message || '', /claim|binding|inode/i)
      return true
    }
  )
  const request = harness.requests.find(item => item.operation === 'stage-import')
  const tempPath = `/root/.shellpilot-${request.args.objectName}.tmp`
  assert.equal(harness.privilegedNodes.get(tempPath).content.toString(), 'safe')
  assert.equal(harness.requests.some(item =>
    item.operation === 'remove-bound' && item.args.targetPath === tempPath), false)
  await assert.rejects(backend.release(), /claim|binding|inode/i)
  assert.equal(harness.privilegedNodes.get(tempPath).content.toString(), 'safe')
})

test('stage-import keeps an exact temp claim pending when cleanup keeps failing', async () => {
  const harness = createBackendHarness({
    importFailure: true,
    importResidual: 'temp',
    importTempClaim: true,
    importCleanupFailures: 3,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile('/root/temp-cleanup-failure', Buffer.from('safe')),
    error => {
      assert.match(error.cleanupError?.message || '', /cleanup failed/)
      return true
    }
  )
  await assert.rejects(backend.release(), /cleanup failed/)
  assert.ok(harness.requests.filter(item =>
    item.operation === 'remove-bound' &&
    item.args.targetPath.includes('/.shellpilot-upload-')).length >= 2)
})

test('stage-import requires authoritative cleanup status for every error', async () => {
  for (const importIncompleteParser of [false, true]) {
    const harness = createBackendHarness({
      importFailure: true,
      importIncompleteParser,
      privilegedTree: {
        '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
      }
    })
    const backend = await createRootBackend(harness)
    await assert.rejects(
      backend.sftp.writeFile('/root/unconfirmed', Buffer.from('safe')),
      error => {
        assert.match(error.cleanupError?.message || '', /unresolved|status/i)
        return true
      }
    )
    await assert.rejects(backend.release(), /unresolved|status/i)
  }
})

test('stage-import accepts parser-confirmed cleanup without inventing a claim', async () => {
  const harness = createBackendHarness({
    importFailure: true,
    importCleanupSucceeded: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile('/root/confirmed-clean', Buffer.from('safe')),
    error => {
      assert.equal(error.code, 'PRIVILEGED_FILE_OPERATION_FAILED')
      assert.equal(error.cleanupError, undefined)
      return true
    }
  )
  assert.equal(await backend.release(), true)
})

test('failed stage-import parser feed preserves its exact claim for cleanup', async () => {
  const targetPath = '/root/claimed-final'
  const harness = createBackendHarness({
    importFailure: true,
    importResidual: 'target',
    importReturnedClaim: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    /stage-import/
  )
  assert.equal(harness.privilegedNodes.has(targetPath), false)
  const removal = harness.requests.find(request =>
    request.operation === 'remove-bound' && request.args.targetPath === targetPath)
  assert.ok(removal)
  assert.match(removal.args.targetDevice, /^(?:0|[1-9]\d*)$/)
  assert.match(removal.args.targetInode, /^(?:0|[1-9]\d*)$/)
  await backend.release()
})

test('moving stage-import locates an exact target after the temp path disappears', async () => {
  const targetPath = '/root/moved-before-signal'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'target',
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    /stage-import/
  )
  assert.equal(harness.privilegedNodes.has(targetPath), false)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-import-cleanup').length, 1)
  assert.equal(harness.requests.some(request =>
    ['sha256-bound', 'remove-bound'].includes(request.operation) &&
      [request.args.path, request.args.targetPath].includes(targetPath)), false)
  assert.equal(await backend.release(), true)
})

test('moving stage-import locates an exact temp when the no-clobber move fails', async () => {
  const targetPath = '/root/move-failed'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'temp',
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    /stage-import/
  )
  const request = harness.requests.find(item => item.operation === 'stage-import')
  const tempPath = `/root/.shellpilot-${request.args.objectName}.tmp`
  assert.equal(harness.privilegedNodes.has(tempPath), false)
  assert.equal(harness.requests.filter(item =>
    item.operation === 'stage-import-cleanup').length, 1)
  assert.equal(harness.requests.some(item =>
    ['sha256-bound', 'remove-bound'].includes(item.operation) &&
      (item.args.path === tempPath || item.args.targetPath === tempPath)), false)
  assert.equal(await backend.release(), true)
})

test('moving stage-import retains an exact claim if a second hardlink appears during cleanup proof', async () => {
  const targetPath = '/root/moving-hardlink-race'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'target',
    importMovingSecondLinkDuringCleanup: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.cleanupError?.message || '', /cleanup|claim|conflict/i)
      return true
    }
  )
  const importRequest = harness.requests.find(item =>
    item.operation === 'stage-import')
  const tempPath = `/root/.shellpilot-${importRequest.args.objectName}.tmp`
  assert.equal(harness.privilegedNodes.has(targetPath), true)
  assert.equal(harness.privilegedNodes.has(tempPath), true)
  assert.equal(
    harness.privilegedNodes.get(targetPath).inode,
    harness.privilegedNodes.get(tempPath).inode
  )
  assert.equal(harness.requests.filter(item =>
    item.operation === 'stage-import-cleanup').length, 1)
  assert.equal(harness.requests.some(item =>
    ['sha256-bound', 'remove-bound'].includes(item.operation)), false)

  await assert.rejects(backend.release(), /cleanup|claim|conflict/i)
  assert.equal(harness.privilegedNodes.has(targetPath), true)
  assert.equal(harness.privilegedNodes.has(tempPath), true)
})

test('moving stage-import cleanup converges after lost completion and preserves a foreign replacement', async () => {
  const targetPath = '/root/moving-cleanup-lost-completion'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'target',
    importCleanupCompletionLosses: 1,
    importCleanupForeignReplacementAfterLoss: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.cleanupError?.message || '', /disconnected/i)
      return true
    }
  )
  const foreign = harness.privilegedNodes.get(targetPath)
  assert.equal(foreign.content.toString(), 'safe')
  assert.equal(harness.requests.filter(item =>
    item.operation === 'stage-import-cleanup').length, 1)

  assert.equal(await backend.release(), true)
  assert.equal(harness.requests.filter(item =>
    item.operation === 'stage-import-cleanup').length, 2)
  assert.equal(harness.privilegedNodes.get(targetPath), foreign)
})

test('moving stage-import cleanup does not infer idempotent success after parent replacement', async () => {
  const targetPath = '/root/moving-cleanup-parent-replaced'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'target',
    importCleanupCompletionLosses: 1,
    importCleanupParentReplacementAfterLoss: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    /stage-import/
  )
  await assert.rejects(backend.release(), /parent binding changed/)
  assert.equal(harness.requests.filter(item =>
    item.operation === 'stage-import-cleanup').length, 2)
  assert.equal(harness.leaseReleases, 1)
})

test('moving stage-import pending cleanup requires authoritative protocol status', async () => {
  const targetPath = '/root/moving-cleanup-untrusted-status'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'target',
    importCleanupUntrustedSuccess: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.cleanupError?.message || '', /authoritative|status/i)
      return true
    }
  )
  await assert.rejects(backend.release(), /authoritative|status/i)
  assert.equal(harness.requests.filter(item =>
    item.operation === 'stage-import-cleanup').length, 2)
})

test('moving stage-import cleans only its exact inode beside a foreign path', async () => {
  for (const scenario of [
    {
      importMovingResidual: 'target',
      importMovingForeignTemp: true,
      exactPath: 'target',
      foreignPath: 'temp'
    },
    {
      importMovingResidual: 'temp',
      importMovingForeignTarget: true,
      exactPath: 'temp',
      foreignPath: 'target'
    }
  ]) {
    const targetPath = `/root/moving-foreign-${scenario.exactPath}`
    const harness = createBackendHarness({
      importFailure: true,
      ...scenario,
      privilegedTree: {
        '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
      }
    })
    const backend = await createRootBackend(harness)
    await assert.rejects(
      backend.sftp.writeFile(targetPath, Buffer.from('safe')),
      /stage-import/
    )
    const request = harness.requests.find(item => item.operation === 'stage-import')
    const tempPath = `/root/.shellpilot-${request.args.objectName}.tmp`
    const exactPath = scenario.exactPath === 'target' ? targetPath : tempPath
    const foreignPath = scenario.foreignPath === 'target' ? targetPath : tempPath
    assert.equal(harness.privilegedNodes.has(exactPath), false)
    assert.equal(harness.privilegedNodes.get(foreignPath).content.toString(), 'safe')
    assert.equal(harness.requests.some(item =>
      item.operation === 'remove-bound' && item.args.targetPath === foreignPath), false)
    assert.equal(await backend.release(), true)
  }
})

test('moving stage-import fails safe when its exact inode remains at both paths', async () => {
  const targetPath = '/root/moving-ambiguous-both'
  const harness = createBackendHarness({
    importFailure: true,
    importMovingResidual: 'target',
    importMovingBothExact: true,
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile(targetPath, Buffer.from('safe')),
    error => {
      assert.match(error.cleanupError?.message || '', /conflicted/)
      return true
    }
  )
  assert.equal(harness.requests.some(item =>
    item.operation === 'remove-bound'), false)
  await assert.rejects(backend.release(), /conflicted/)
  assert.equal(harness.privilegedNodes.has(targetPath), true)
})

test('direct privileged remove APIs reject an over-budget file before digest', async () => {
  const hugeSize = 8 * 1024 * 1024 * 1024 + 1
  const harness = createBackendHarness({
    digestFailure: true,
    privilegedTree: {
      '/root/huge': {
        type: 'file', size: hugeSize, virtualByte: 0x61, content: ''
      }
    }
  })
  const backend = await createRootBackend(harness)

  for (const remove of [
    () => backend.sftp.rm('/root/huge'),
    () => backend.sftp.removeEntry('/root/huge', {})
  ]) {
    await assert.rejects(remove(), /budget|8 GiB|预算|上限/i)
  }
  assert.equal(harness.requests.some(request =>
    request.operation === 'sha256-bound' && request.args.path === '/root/huge'), false)
  await backend.release()
})

test('privileged chunk streams re-export after EOF and observe same-size source changes', async () => {
  const original = Buffer.from('AAAA-BBBB-CCCC')
  const replacement = Buffer.from('ZZZZ-YYYY-XXXX')
  assert.equal(replacement.length, original.length)
  const harness = createBackendHarness({
    rootFiles: { '/root/changing': original }
  })
  const backend = await createRootBackend(harness)

  const firstA = await backend.sftp.readFileChunk('/root/changing', {
    offset: 0,
    maxBytes: 5
  })
  const firstB = await backend.sftp.readFileChunk('/root/changing', {
    offset: firstA.nextOffset,
    maxBytes: 64 * 1024
  })
  assert.equal(Buffer.concat([
    Buffer.from(firstA.base64, 'base64'),
    Buffer.from(firstB.base64, 'base64')
  ]).toString(), original.toString())

  harness.rootFiles.set('/root/changing', replacement)
  const second = await backend.sftp.readFileChunk('/root/changing', {
    offset: 0,
    maxBytes: 64 * 1024
  })
  assert.equal(Buffer.from(second.base64, 'base64').toString(), replacement.toString())
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-export-range' &&
    request.args.sourcePath === '/root/changing'
  ).length, 3)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  ).length, 3)
  await backend.release()
})

test('real transaction adapter re-exports a privileged source and refuses same-size external delete changes', async () => {
  const { createSftpTransactionAdapter } = await importModule(
    'src/client/components/sftp/sftp-transaction-adapter.js'
  )
  const { buildSideEffectSafetyRequest } = await importModule(
    'src/client/common/safety-transactions/side-effect-model.js'
  )
  const sourcePath = '/srv/app/config.bin'
  const harness = createBackendHarness({
    privilegedTree: {
      '/srv': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      '/srv/app': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      [sourcePath]: { type: 'file', mode: 0o640, uid: 0, gid: 0, content: 'AAAA' }
    }
  })
  const backend = await createRootBackend(harness)
  const operation = await buildSideEffectSafetyRequest({
    id: 'privileged-delete-same-size-change',
    source: 'sftp',
    title: 'privileged delete regression',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'sftp'
    },
    effect: {
      adapter: 'sftp',
      action: 'delete',
      paths: { source: sourcePath },
      resources: [{ path: sourcePath, type: 'file' }],
      type: 'file',
      expected: { absent: true }
    }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => backend.sftp })
  Object.assign(operation, await adapter.prepare(operation))
  const exportsAfterPrepare = harness.requests.filter(request =>
    request.operation === 'stage-export-range' &&
    request.args.sourcePath === sourcePath).length

  harness.privilegedNodes.get(sourcePath).content = Buffer.from('BBBB')
  await assert.rejects(
    adapter.beforeExecute(operation),
    /changed|external|original|变化|未执行/i
  )
  assert.equal(harness.privilegedNodes.get(sourcePath).content.toString(), 'BBBB')
  assert.ok(harness.requests.filter(request =>
    request.operation === 'stage-export-range' &&
    request.args.sourcePath === sourcePath).length > exportsAfterPrepare)
  await backend.release()
})

test('privileged readFile rejects files over 8 MiB without unbounded reads', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/too-large': Buffer.alloc(8 * 1024 * 1024 + 1, 7) }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.readFile('/root/too-large'),
    /8 MiB|上限|limit/i
  )
  const contentReads = harness.sftpReads.filter(read =>
    read.remotePath.includes('/download-')
  )
  assert.equal(contentReads.length, 0)
  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-export' ||
    request.operation === 'stage-export-range'), false)
  await backend.release()
})

test('privileged chunk streams reject non-contiguous offsets and replace active zero-offset reads', async () => {
  const content = Buffer.from('0123456789')
  const harness = createBackendHarness({ rootFiles: { '/root/stream': content } })
  const backend = await createRootBackend(harness)

  const first = await backend.sftp.readFileChunk('/root/stream', {
    offset: 0,
    maxBytes: 3
  })
  assert.equal(first.nextOffset, 3)
  const restarted = await backend.sftp.readFileChunk('/root/stream', {
    offset: 0,
    maxBytes: 2
  })
  assert.equal(restarted.nextOffset, 2)
  await assert.rejects(
    backend.sftp.readFileChunk('/root/stream', { offset: 1, maxBytes: 2 }),
    /offset|连续|logical|逻辑/i
  )
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-export-range' &&
    request.args.sourcePath === '/root/stream'
  ).length, 2)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  ).length, 2)
  await backend.release()
})

test('privileged mutations invalidate related logical read stages before changing paths', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/file': 'abcdefgh' },
    missingLstatResult: true
  })
  const backend = await createRootBackend(harness)
  const first = await backend.sftp.readFileChunk('/root/file', {
    offset: 0,
    maxBytes: 2
  })
  const cleanupBefore = harness.requests.filter(request =>
    request.operation === 'stage-cleanup').length

  await backend.sftp.rm('/root/file')
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup').length, cleanupBefore)
  await assert.rejects(
    backend.sftp.readFileChunk('/root/file', {
      offset: first.nextOffset,
      maxBytes: 2
    }),
    /offset|连续/
  )

  const renamed = await backend.sftp.readFileChunk('/root/file', {
    offset: 0,
    maxBytes: 2
  })
  await backend.sftp.rename('/root/file', '/root/missing-renamed')
  await assert.rejects(
    backend.sftp.readFileChunk('/root/file', {
      offset: renamed.nextOffset,
      maxBytes: 2
    }),
    /offset|连续/
  )
  await backend.release()
})

test('privileged write rejects oversized bytes and strings before hashing or Base64 encoding', async () => {
  const harness = createBackendHarness({ missingLstatResult: true })
  const backend = await createRootBackend(harness)
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const originalBtoa = globalThis.btoa
  const originalDigest = globalThis.crypto.subtle.digest.bind(
    globalThis.crypto.subtle
  )
  let hashCalls = 0
  let base64Calls = 0
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      subtle: {
        digest (...args) {
          hashCalls += 1
          return originalDigest(...args)
        }
      }
    }
  })
  globalThis.btoa = () => {
    base64Calls += 1
    throw new Error('unexpected Base64 encoding')
  }
  try {
    await assert.rejects(
      backend.sftp.writeFile(
        '/root/missing-large-bytes',
        new Uint8Array(8 * 1024 * 1024 + 1)
      ),
      /8 MiB|上限|limit/i
    )
    await assert.rejects(
      backend.sftp.writeFile(
        '/root/missing-large-string',
        'x'.repeat(8 * 1024 * 1024 + 1)
      ),
      /8 MiB|上限|limit/i
    )
    await assert.rejects(
      backend.sftp.writeFile(
        '/root/missing-large-unicode',
        '\u0800'.repeat(Math.floor((8 * 1024 * 1024) / 3) + 1)
      ),
      /8 MiB|上限|limit/i
    )
    assert.equal(hashCalls, 0)
    assert.equal(base64Calls, 0)
    assert.equal(harness.requests.some(request =>
      request.operation === 'stage-import'), false)
  } finally {
    globalThis.btoa = originalBtoa
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
    await backend.release()
  }
})

test('privileged writes upload exclusive bytes then import only digest size and metadata', async () => {
  const secret = Buffer.from('WRITE-SECRET\u0000bytes')
  const harness = createBackendHarness({ missingLstatResult: true })
  const backend = await createRootBackend(harness)
  assert.equal(await backend.sftp.writeFile('/root/missing-target', secret, 0o640), 1)
  assert.deepEqual(harness.rootFiles.get('/root/missing-target'), secret)
  const imported = harness.requests.find(request => request.operation === 'stage-import')
  assert.equal(imported.args.targetPath, '/root/missing-target')
  assert.equal(imported.args.sha256, sha256(secret))
  assert.equal(imported.args.size, String(secret.length))
  assert.equal(imported.args.targetMode, '640')
  assert.equal(imported.args.targetUid, '0')
  assert.equal(imported.args.targetGid, '0')
  assert.equal(imported.args.mustBeAbsent, '1')
  assert.equal(JSON.stringify(harness.requests).includes('WRITE-SECRET'), false)
  assert.equal(JSON.stringify(harness.requests).includes(secret.toString('base64')), false)
  assert.equal(harness.requests.some(request => request.operation === 'stage-cleanup'), true)
  await backend.release()

  const existingHarness = createBackendHarness({
    rootFiles: { '/root/existing-target': 'old' }
  })
  const existing = await createRootBackend(existingHarness)
  const createsBefore = existingHarness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length
  await assert.rejects(
    existing.sftp.writeFile('/root/existing-target', secret),
    /安全事务|缺失目标/
  )
  assert.equal(existingHarness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length, createsBefore)
  assert.equal(existingHarness.requests.some(
    request => request.operation === 'stage-import'
  ), false)
  await existing.release()

  const failedHarness = createBackendHarness({
    importFailure: true,
    importCleanupSucceeded: true,
    missingLstatResult: true
  })
  const failed = await createRootBackend(failedHarness)
  await assert.rejects(
    failed.sftp.writeFile('/root/missing-target', secret, 0o600),
    /stage-import/
  )
  assert.equal(failedHarness.requests.some(request => request.operation === 'stage-cleanup'), true)
  await failed.release()
})

test('privileged write never overwrites a creator raced after trusted missing', async () => {
  const targetPath = '/root/new-target'
  const options = {
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    },
    onPrivilegedLstat (remotePath, nodes) {
      if (remotePath !== targetPath || nodes.has(targetPath)) return
      nodes.set(targetPath, {
        type: 'file',
        mode: 0o600,
        uid: 99,
        gid: 99,
        content: Buffer.from('foreign')
      })
    }
  }
  const harness = createBackendHarness(options)
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.writeFile(targetPath, 'owned', 0o600),
    /exists|operation|操作|import/i
  )
  assert.equal(harness.privilegedNodes.get(targetPath).content.toString(), 'foreign')
  await backend.release()
})

test('privileged lstat maps only trusted missing results to transaction ENOENT', async () => {
  const { describeSftpTransferEntry } = await importModule(
    'src/client/components/sftp/sftp-transaction-adapter.js'
  )
  const harness = createBackendHarness({ missingLstatResult: true })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.lstat('/root/missing-target'),
    error => error?.code === 'ENOENT' &&
      error.message === 'No such privileged file: /root/missing-target'
  )
  assert.deepEqual(
    await describeSftpTransferEntry(backend.sftp, '/root/missing-target'),
    { absent: true }
  )
  await backend.release()
})

test('privileged write fails closed on an indeterminate lstat error', async () => {
  const harness = createBackendHarness({ genericLstatFailure: true })
  const backend = await createRootBackend(harness)
  const createsBefore = harness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length

  await assert.rejects(
    backend.sftp.writeFile('/root/missing-target', Buffer.from('secret'), 0o600),
    /root 文件操作失败：lstat/
  )
  assert.equal(harness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length, createsBefore)
  assert.equal(harness.requests.some(request => request.operation === 'stage-import'), false)
  await backend.release()
})

test('privileged write rejects a claimed upload stage failure before import', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile('/root/missing-target', Buffer.from('secret'), 0o600),
    /remote upload write failed/
  )
  assert.equal(harness.requests.some(request => request.operation === 'stage-import'), false)
  await backend.release()
})

test('privileged write retains an unclean claimed upload for immediate and release cleanup', async () => {
  for (const uploadCreateThrows of [false, true]) {
    const harness = createBackendHarness({
      missingLstatResult: true,
      uploadCreateFailure: true,
      uploadCleanupSucceeded: false,
      uploadResidualMatches: true,
      uploadCreateThrows,
      cleanupFailure: 'upload-'
    })
    const backend = await createRootBackend(harness)

    const error = await backend.sftp.writeFile(
      '/root/missing-target',
      Buffer.from('secret'),
      0o600
    ).catch(error => error)
    assert.equal(error.message, 'remote upload write failed')
    assert.match(error.cleanupError?.message || '', /remote unlink failed/)
    assert.match(error.cleanupRetryError?.message || '', /stage cleanup failed/)
    assert.equal(harness.requests.filter(request =>
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    ).length, 1)
    const cleanup = harness.requests.find(request =>
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    )
    assert.equal(cleanup.args.sha256, sha256(Buffer.from('secret')))
    assert.equal(cleanup.args.size, '6')

    await assert.rejects(backend.release(), /stage cleanup failed/)
    assert.equal(harness.requests.filter(request =>
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    ).length, 2)
    assert.equal(harness.leaseReleases, 1)
  }
})

test('successful immediate cleanup removes an unclean claimed upload record', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true,
    uploadCleanupSucceeded: false,
    uploadResidualMatches: true
  })
  const backend = await createRootBackend(harness)

  const error = await backend.sftp.writeFile(
    '/root/missing-target',
    Buffer.from('secret'),
    0o600
  ).catch(error => error)
  assert.equal(error.message, 'remote upload write failed')
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  ).length, 1)
  assert.equal(await backend.release(), true)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  ).length, 1)
})

test('privileged write preserves an unverified partial upload without cleanup proof', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true,
    uploadCleanupSucceeded: false
  })
  const backend = await createRootBackend(harness)

  const error = await backend.sftp.writeFile(
    '/root/missing-target',
    Buffer.from('secret'),
    0o600
  ).catch(error => error)
  assert.equal(error.message, 'remote upload write failed')
  assert.match(error.cleanupRetryError?.message || '', /摘要|大小|digest|size/i)
  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  ), false)
  assert.equal([...harness.nodes.values()].some(node =>
    node.type === 'file' && node.content?.toString() === 'partial upload'
  ), true)
  await assert.rejects(backend.release(), /residual|验证|保留/i)
  assert.equal(harness.leaseReleases, 1)
})

test('privileged write keeps its create error when abandoning the stage fails', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true,
    uploadCleanupSucceeded: false,
    uploadCreateEndpointChange: true
  })
  const backend = await createRootBackend(harness)
  const readsBefore = harness.events.filter(event =>
    event.startsWith('sftp:read:')
  ).length

  const error = await backend.sftp.writeFile(
    '/root/missing-target',
    Buffer.from('secret'),
    0o600
  ).catch(error => error)
  assert.equal(error.message, 'remote upload write failed')
  assert.match(error.cleanupError?.message || '', /remote unlink failed/)
  assert.match(error.cleanupRetryError?.message || '', /session|endpoint|会话|端点/i)
  assert.equal(harness.requests.some(request => request.operation === 'stage-import'), false)
  assert.equal(harness.requests.some(request => request.operation === 'stage-cleanup'), false)
  assert.equal(harness.events.filter(event =>
    event.startsWith('sftp:read:')
  ).length, readsBefore)
  assert.equal([...harness.nodes.keys()].some(path => path.includes('/upload-')), true)
  await assert.rejects(backend.release(), /session|endpoint|会话|端点/i)
  assert.equal(harness.leaseReleases, 1)
})

test('privileged release closes first continues cleanup and lease release and is idempotent', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/secret': 'secret' },
    cleanupFailure: 'download-'
  })
  const backend = await createRootBackend(harness)
  const residual = backend.staging.allocate('download')
  backend.staging.remember(residual.path, {
    sha256: sha256(Buffer.from('secret')),
    size: '6'
  })
  await assert.rejects(backend.release(), /stage cleanup failed/)
  assert.equal(harness.leaseReleases, 1)
  assert.equal(harness.events.at(-1), 'lease:release')
  await assert.rejects(backend.release(), /stage cleanup failed/)
  assert.equal(harness.leaseReleases, 1)
  await assert.rejects(backend.sftp.list('/root'), /released|释放|关闭/i)
})

test('privileged backend still releases its lease when staging endpoint changed', async () => {
  const harness = createBackendHarness()
  const backend = await createRootBackend(harness)
  const requestsBefore = harness.requests.length
  harness.sftp.id = 'sftp-2'

  const firstError = await backend.release().catch(error => error)
  assert.match(firstError.message, /session|endpoint|会话|端点/i)
  assert.equal(harness.requests.length, requestsBefore)
  assert.equal(harness.leaseReleases, 1)
  assert.equal(harness.events.at(-1), 'lease:release')

  const secondError = await backend.release().catch(error => error)
  assert.equal(secondError, firstError)
  assert.equal(harness.leaseReleases, 1)
})

test('privileged copyEntry copies a bounded tree without recursive shell operations and preserves metadata', async () => {
  const controller = new AbortController()
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o751, uid: 21, gid: 22 },
      '/root/source/file': { type: 'file', mode: 0o640, uid: 23, gid: 24, content: 'alpha' },
      '/root/source/sub': { type: 'directory', mode: 0o750, uid: 25, gid: 26 },
      '/root/source/sub/nested': { type: 'file', mode: 0o600, uid: 27, gid: 28, content: 'beta' }
    }
  })
  const backend = await createRootBackend(harness)
  const start = harness.executions.length

  assert.equal(await backend.sftp.copyEntry(
    '/root/source',
    '/root/copied',
    { signal: controller.signal }
  ), 1)
  assert.equal(harness.privilegedNodes.get('/root/copied').mode, 0o751)
  assert.equal(harness.privilegedNodes.get('/root/copied').uid, 21)
  assert.equal(harness.privilegedNodes.get('/root/copied/file').content.toString(), 'alpha')
  assert.equal(harness.privilegedNodes.get('/root/copied/file').mode, 0o640)
  assert.equal(harness.privilegedNodes.get('/root/copied/sub/nested').content.toString(), 'beta')
  assert.equal(harness.requests.some(request => request.operation === 'copy-entry'), false)
  assert.equal(harness.requests.some(request => request.operation === 'remove-entry'), false)
  assert.ok(harness.requests.filter(request => request.operation === 'stage-import')
    .every(request => request.args.mustBeAbsent === '1'))
  assert.ok(harness.requests.filter(request => request.operation === 'stage-export')
    .every(request => Number(request.args.expectedSize) <=
      Number(request.args.maxSize)))
  assert.ok(harness.requests.filter(request => request.operation === 'sha256-bound')
    .every(request => Number(request.args.expectedSize) <=
      Number(request.args.maxSize)))
  const directories = harness.requests.filter(request =>
    request.operation === 'mkdir-bound')
  assert.ok(directories.length > 0)
  assert.ok(directories.every(request =>
    request.args.targetMode === '700' &&
    request.args.targetUid === '0' &&
    request.args.targetGid === '0'))
  const metadata = harness.requests.filter(request =>
    request.operation === 'metadata-bound')
  assert.deepEqual(metadata.map(request => request.args.targetPath), [
    '/root/copied/sub',
    '/root/copied'
  ])
  const publicExecutions = harness.executions.slice(start).filter(({ request }) =>
    request.operation !== 'stage-cleanup')
  assert.ok(publicExecutions.length > 0)
  assert.ok(publicExecutions.every(execution => execution.signal === controller.signal))

  await backend.release()
})

test('privileged recovery descriptor binds a bounded tree without exposing raw backend state', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o751, uid: 21, gid: 22 },
      '/root/source/file': {
        type: 'file',
        mode: 0o640,
        uid: 23,
        gid: 24,
        content: 'alpha'
      }
    }
  })
  const backend = await createRootBackend(harness)

  const descriptor = await backend.sftp.describeRecoveryEntry('/root/source')

  assert.equal(descriptor.type, 'directory')
  assert.equal(descriptor.device, harness.privilegedNodes.get('/root/source').device)
  assert.equal(descriptor.inode, harness.privilegedNodes.get('/root/source').inode)
  assert.equal(descriptor.mode, 0o751)
  assert.equal(descriptor.uid, 21)
  assert.equal(descriptor.gid, 22)
  assert.match(descriptor.sha256, /^[a-f0-9]{64}$/)
  assert.equal(Object.isFrozen(descriptor), true)
  assert.ok(harness.requests.some(request => request.operation === 'sha256-bound'))
  assert.equal(descriptor.manifest, undefined)
  assert.equal(descriptor.backend, undefined)

  await backend.release()
})

test('privileged recovery descriptor freezes an exact absent target and its non-root parent', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/srv/user': {
        type: 'directory',
        mode: 0o750,
        uid: 1000,
        gid: 1000,
        device: '7',
        inode: '70'
      }
    }
  })
  const backend = await createRootBackend(harness)

  const descriptor = await backend.sftp.describeRecoveryEntry(
    '/srv/user/missing.conf',
    { allowAbsent: true }
  )

  assert.deepEqual(descriptor, {
    type: 'bound-absent',
    path: '/srv/user/missing.conf',
    basename: 'missing.conf',
    mustBeAbsent: true,
    parent: {
      path: '/srv/user',
      device: '7',
      inode: '70',
      mode: 0o750,
      uid: 1000,
      gid: 1000
    }
  })
  assert.equal(Object.isFrozen(descriptor), true)
  assert.equal(Object.isFrozen(descriptor.parent), true)
  assert.ok(harness.requests.some(request =>
    request.operation === 'lstat-bound' &&
    request.args.path === '/srv/user/missing.conf' &&
    request.args.sourceParentDevice === '7' &&
    request.args.sourceParentInode === '70'))

  await backend.release()
})

test('privileged recovery descriptor does not treat non-ENOENT failures as absent', async () => {
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  const harness = createBackendHarness({
    privilegedTree: {
      '/srv/user': {
        type: 'directory', mode: 0o750, uid: 1000, gid: 1000
      }
    },
    onPrivilegedLstat: path => {
      if (path === '/srv/user/denied.conf') throw denied
    }
  })
  const backend = await createRootBackend(harness)

  const error = await backend.sftp.describeRecoveryEntry(
    '/srv/user/denied.conf',
    { allowAbsent: true }
  ).catch(error => error)

  assert.equal(error, denied)
  await backend.release()
})

test('privileged proof-bound copy returns the exact frozen created descriptor', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/backup': { type: 'file', content: 'safe', mode: 0o600 }
    }
  })
  const backend = await createRootBackend(harness)
  const expectedSource = await backend.sftp.describeRecoveryEntry('/root/backup')
  const expectedTarget = await backend.sftp.describeRecoveryEntry(
    '/root/restored',
    { allowAbsent: true }
  )

  const created = await backend.sftp.copyEntry(
    '/root/backup',
    '/root/restored',
    { expectedSource, expectedTarget }
  )
  const current = await backend.sftp.describeRecoveryEntry('/root/restored')

  assert.deepEqual(created, current)
  assert.equal(Object.isFrozen(created), true)
  assert.notEqual(created.inode, expectedSource.inode)
  assert.equal(created.sha256, expectedSource.sha256)
  await backend.release()
})

test('privileged copyEntry rejects a same-inode source changed after recovery preflight', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/backup': { type: 'file', content: 'safe', mode: 0o600 }
    }
  })
  const backend = await createRootBackend(harness)
  const expectedSource = await backend.sftp.describeRecoveryEntry('/root/backup')
  const expectedTarget = await backend.sftp.describeRecoveryEntry(
    '/root/restored',
    { allowAbsent: true }
  )
  const source = harness.privilegedNodes.get('/root/backup')
  const originalInode = source.inode
  source.content = Buffer.from('evil')

  const error = await backend.sftp.copyEntry('/root/backup', '/root/restored', {
    expectedSource,
    expectedTarget
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.deepEqual(error.expectedDescriptor, expectedSource)
  assert.equal(error.actualDescriptor.inode, originalInode)
  assert.notEqual(error.actualDescriptor.sha256, expectedSource.sha256)
  assert.equal(harness.privilegedNodes.has('/root/restored'), false)
  await backend.release()
})

test('privileged copyEntry preserves a creator raced after an exact absent preflight', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/srv/user': { type: 'directory', mode: 0o750, uid: 1000, gid: 1000 },
      '/srv/user/backup': { type: 'file', content: 'safe', mode: 0o600 }
    }
  })
  const backend = await createRootBackend(harness)
  const expectedSource = await backend.sftp.describeRecoveryEntry('/srv/user/backup')
  const expectedTarget = await backend.sftp.describeRecoveryEntry(
    '/srv/user/restored',
    { allowAbsent: true }
  )
  harness.privilegedNodes.set('/srv/user/restored', {
    type: 'file',
    content: Buffer.from('foreign'),
    mode: 0o640,
    uid: 1000,
    gid: 1000,
    device: '7',
    inode: '700'
  })

  const error = await backend.sftp.copyEntry(
    '/srv/user/backup',
    '/srv/user/restored',
    { expectedSource, expectedTarget }
  ).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.deepEqual(error.expectedDescriptor, expectedTarget)
  assert.equal(error.path, '/srv/user/restored')
  assert.equal(error.actualDescriptor.type, 'file')
  assert.equal(
    harness.privilegedNodes.get('/srv/user/restored').content.toString(),
    'foreign'
  )
  await backend.release()
})

test('privileged removeEntry preserves a same-inode source changed after recovery preflight', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/displaced': { type: 'file', content: 'safe', mode: 0o600 }
    }
  })
  const backend = await createRootBackend(harness)
  const expectedSource = await backend.sftp.describeRecoveryEntry('/root/displaced')
  const source = harness.privilegedNodes.get('/root/displaced')
  source.content = Buffer.from('evil')

  const error = await backend.sftp.removeEntry('/root/displaced', {
    expectedSource
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.deepEqual(error.expectedDescriptor, expectedSource)
  assert.notEqual(error.actualDescriptor.sha256, expectedSource.sha256)
  assert.equal(
    harness.privilegedNodes.get('/root/displaced').content.toString(),
    'evil'
  )
  await backend.release()
})

test('privileged removeEntry preserves its source when the required copy peer changes', async () => {
  const harness = createBackendHarness({
    mutatePeerBeforeRemoveBound: { '/root/peer': 'evil' },
    privilegedTree: {
      '/root/source': { type: 'file', content: 'safe', mode: 0o600 },
      '/root/peer': { type: 'file', content: 'safe', mode: 0o600 }
    }
  })
  const backend = await createRootBackend(harness)
  const expectedSource = await backend.sftp.describeRecoveryEntry('/root/source')
  const expectedPeer = await backend.sftp.describeRecoveryEntry('/root/peer')

  const error = await backend.sftp.removeEntry('/root/source', {
    expectedSource,
    expectedPeer: { path: '/root/peer', descriptor: expectedPeer }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.equal(error.path, '/root/peer')
  assert.deepEqual(error.expectedDescriptor, expectedPeer)
  assert.equal(harness.privilegedNodes.has('/root/source'), true)
  assert.ok(harness.requests.some(request =>
    request.operation === 'remove-peer-bound'))
  await backend.release()
})

test('privileged copyEntry rejects special files, nested targets, excessive depth, and raced targets', async () => {
  const special = createBackendHarness({
    privilegedTree: {
      '/root/link': { type: 'symlink', mode: 0o777, uid: 3, gid: 4 }
    }
  })
  const specialBackend = await createRootBackend(special)
  await assert.rejects(
    specialBackend.sftp.copyEntry('/root/link', '/root/copy', {}),
    /special|symlink|类型|特殊/i
  )
  assert.equal(special.privilegedNodes.has('/root/copy'), false)
  await specialBackend.release()

  const tree = {
    '/root/deep': { type: 'directory' }
  }
  let parent = '/root/deep'
  for (let depth = 1; depth <= 129; depth += 1) {
    parent += `/d${depth}`
    tree[parent] = { type: 'directory' }
  }
  const deep = createBackendHarness({ privilegedTree: tree })
  const deepBackend = await createRootBackend(deep)
  await assert.rejects(
    deepBackend.sftp.copyEntry('/root/deep', '/root/copy', {}),
    /深度|budget|预算/i
  )
  await assert.rejects(
    deepBackend.sftp.describeRecoveryEntry('/root/deep'),
    /深度|budget|预算/i
  )
  assert.equal(deep.privilegedNodes.has('/root/copy'), false)
  await assert.rejects(
    deepBackend.sftp.copyEntry('/root/deep', '/root/deep/copy', {}),
    /内部|source|源/i
  )
  await deepBackend.release()

  const huge = createBackendHarness({
    privilegedTree: {
      '/root/huge': {
        type: 'file',
        content: '',
        size: 8 * 1024 * 1024 * 1024 + 1
      }
    }
  })
  const hugeBackend = await createRootBackend(huge)
  await assert.rejects(
    hugeBackend.sftp.copyEntry('/root/huge', '/root/copy', {}),
    /字节|budget|预算/i
  )
  assert.equal(huge.requests.some(request =>
    request.operation === 'stage-export'), false)
  await hugeBackend.release()

  const wideTree = { '/root/wide': { type: 'directory' } }
  for (let index = 0; index < 10000; index += 1) {
    wideTree[`/root/wide/f${index}`] = { type: 'file', content: '' }
  }
  const wide = createBackendHarness({ privilegedTree: wideTree })
  const wideBackend = await createRootBackend(wide)
  await assert.rejects(
    wideBackend.sftp.copyEntry('/root/wide', '/root/copy', {}),
    /节点|budget|预算/i
  )
  assert.equal(wide.privilegedNodes.has('/root/copy'), false)
  await wideBackend.release()

  const raced = createBackendHarness({
    failImportTarget: '/root/copied/b',
    privilegedTree: {
      '/root/source': { type: 'directory' },
      '/root/source/a': { type: 'file', content: 'owned' },
      '/root/source/b': { type: 'file', content: 'source-b' }
    }
  })
  const racedBackend = await createRootBackend(raced)
  await assert.rejects(
    racedBackend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /raced|exists|操作失败/i
  )
  assert.equal(raced.privilegedNodes.has('/root/copied/a'), false)
  assert.equal(raced.privilegedNodes.get('/root/copied/b').content.toString(), 'foreign')
  assert.equal(raced.privilegedNodes.has('/root/copied'), true,
    'foreign raced child prevents empty-directory rollback')
  await racedBackend.release()
})

test('privileged copyEntry rolls back a proven imported target when stage cleanup fails', async () => {
  const options = {
    cleanupFailure: 'download-',
    privilegedTree: {
      '/root/source': { type: 'file', mode: 0o640, content: 'owned' }
    }
  }
  const harness = createBackendHarness(options)
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /stage cleanup failed/
  )
  assert.equal(harness.privilegedNodes.has('/root/copied'), false)
  options.cleanupFailure = undefined
  await backend.release()
})

test('privileged copy rollback preserves a same-inode target modified after import', async () => {
  const options = {
    cleanupFailure: 'download-',
    mutateBeforeRemoveBound: { '/root/copied': 'evil!' },
    privilegedTree: {
      '/root/source': { type: 'file', mode: 0o640, content: 'owned' }
    }
  }
  const harness = createBackendHarness(options)
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /stage cleanup failed/
  )
  assert.equal(
    harness.privilegedNodes.get('/root/copied').content.toString(),
    'evil!'
  )
  options.cleanupFailure = undefined
  await backend.release()
})

test('privileged copy rollback removes children after deferred metadata changed parent ownership', async () => {
  const harness = createBackendHarness({
    failMetadataAfterApply: '/root/copied',
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o750, uid: 41, gid: 42 },
      '/root/source/sub': { type: 'directory', mode: 0o750, uid: 43, gid: 44 },
      '/root/source/sub/file': { type: 'file', mode: 0o640, uid: 45, gid: 46, content: 'owned' }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /metadata cancelled/
  )
  const residuals = [...harness.privilegedNodes.keys()].filter(path =>
    path === '/root/copied' || path.startsWith('/root/copied/'))
  assert.deepEqual(residuals, [])
  await backend.release()
})

test('privileged copy never mutates a directory child replaced before deferred metadata', async () => {
  const harness = createBackendHarness({
    replaceMetadataTargetBeforeBound: '/root/copied',
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o755 },
      '/root/source/file': { type: 'file', content: 'owned' }
    }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /metadata|binding|changed|操作失败/i
  )
  assert.equal(
    harness.privilegedNodes.get('/root/copied/foreign-sentinel').content.toString(),
    'foreign'
  )
  assert.equal(harness.privilegedNodes.get('/root/copied').uid, 99)
  await backend.release()
})

test('privileged copy rejects a same-size source replacement after its manifest', async () => {
  const harness = createBackendHarness({
    replaceSourceBeforeExport: '/root/source',
    replacementSourceContent: 'evil',
    privilegedTree: {
      '/root/source': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /source|源|identity|binding|摘要|digest/i
  )
  assert.equal(harness.privilegedNodes.has('/root/copied'), false)
  await assert.rejects(backend.release(), /owned residual|无法验证/)
})

test('privileged removeEntry builds a bounded manifest, propagates AbortSignal, and stops after cancellation', async () => {
  const controller = new AbortController()
  const removed = []
  const harness = createBackendHarness({
    onTreeRemove (remotePath) {
      removed.push(remotePath)
      if (removed.length === 1) controller.abort(new Error('stop tree removal'))
    },
    privilegedTree: {
      '/root/tree': { type: 'directory', mode: 0o700, uid: 0, gid: 0 },
      '/root/tree/a': { type: 'file', content: 'a' },
      '/root/tree/b': { type: 'file', content: 'b' }
    }
  })
  const backend = await createRootBackend(harness)
  const start = harness.executions.length
  await assert.rejects(
    backend.sftp.removeEntry('/root/tree', { signal: controller.signal }),
    /stop tree removal|abort/i
  )
  assert.equal(removed.length, 1)
  assert.equal(harness.privilegedNodes.has('/root/tree'), true)
  assert.equal([...harness.privilegedNodes.keys()].filter(path =>
    path.startsWith('/root/tree/')).length, 1)
  const mutationExecutions = harness.executions.slice(start).filter(({ request }) =>
    request.operation === 'remove-bound')
  assert.equal(mutationExecutions.length, 1)
  assert.ok(mutationExecutions.every(execution => execution.signal === controller.signal))
  await assert.rejects(
    backend.sftp.removeEntry('/root/tree', { signal: {} }),
    /signal|AbortSignal/i
  )
  for (const options of [new Date(), { signal: controller.signal, extra: true }]) {
    await assert.rejects(
      backend.sftp.removeEntry('/root/tree', options),
      /options/i
    )
  }
  await backend.release()
})

test('privileged removeEntry preserves a same-inode file rewritten after its manifest proof', async () => {
  const harness = createBackendHarness({
    mutateBeforeRemoveBound: { '/root/file': 'evil' },
    privilegedTree: {
      '/root/file': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const originalInode = harness.privilegedNodes.get('/root/file').inode
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.removeEntry('/root/file', {}),
    /digest|摘要|content|proof|变化/i
  )
  assert.equal(harness.privilegedNodes.get('/root/file').inode, originalInode)
  assert.equal(harness.privilegedNodes.get('/root/file').content.toString(), 'evil')
  await backend.release()
})

test('privileged bounded remove accepts a non-root-owned parent', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/srv/user': { type: 'directory', mode: 0o750, uid: 1000, gid: 1000 },
      '/srv/user/snapshot': { type: 'file', mode: 0o600, uid: 1000, gid: 1000, content: 'snapshot' }
    }
  })
  const backend = await createRootBackend(harness)

  assert.equal(await backend.sftp.rm('/srv/user/snapshot'), 1)
  assert.equal(harness.privilegedNodes.has('/srv/user/snapshot'), false)
  await backend.release()
})

test('privileged remove never follows a replaced manifest parent into a foreign tree', async () => {
  const harness = createBackendHarness({
    redirectRm: { '/root/tree/victim': '/foreign/victim' },
    privilegedTree: {
      '/root/tree': { type: 'directory', mode: 0o700, uid: 0, gid: 0 },
      '/root/tree/victim': { type: 'file', content: 'owned' },
      '/foreign': { type: 'directory' },
      '/foreign/victim': { type: 'file', content: 'foreign' }
    }
  })
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.removeEntry('/root/tree', {}),
    /binding|parent|inode|操作|empty/i
  )
  assert.equal(harness.privilegedNodes.get('/foreign/victim').content.toString(), 'foreign')
  await backend.release()
})

test('privileged directory manifests enumerate only through a bound directory', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o750 },
      '/root/source/file': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const backend = await createRootBackend(harness)
  await backend.sftp.copyEntry('/root/source', '/root/copied', {})
  assert.equal(harness.requests.some(request =>
    request.operation === 'list-bound' &&
    request.args.path === '/root/source' &&
    request.args.sourceDevice &&
    request.args.sourceInode), true)
  await backend.release()

  const raced = createBackendHarness({
    replaceDirectoryBeforeBoundList: '/root/source',
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o750 },
      '/root/source/file': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const racedBackend = await createRootBackend(raced)
  await assert.rejects(
    racedBackend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /binding|directory|操作/i
  )
  assert.equal(raced.privilegedNodes.has('/root/copied'), false)
  await racedBackend.release()
})
