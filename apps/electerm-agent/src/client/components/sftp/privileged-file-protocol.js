import {
  assertPtyTaskToken,
  createPtyTaskToken
} from '../operations-toolkit/runtime/pty-task-protocol.js'
import { createStreamingSha256 } from './streaming-sha256.js'

const allowedOperations = new Set([
  'probe',
  'list',
  'list-bound',
  'lstat',
  'lstat-bound',
  'stat',
  'readlink',
  'realpath',
  'mkdir-bound',
  'metadata-bound',
  'touch-bound',
  'rename-bound',
  'remove-bound',
  'remove-peer-bound',
  'stage-handshake',
  'stage-export',
  'stage-export-range',
  'stage-import',
  'stage-import-cleanup',
  'stage-cleanup',
  'digest-cleanup',
  'sha256',
  'sha256-bound',
  'sha256-range-bound'
])

const maxPrivilegedTransferBytes = 8 * 1024 * 1024 * 1024
export const privilegedFilePtyFrameByteLimit = 3840
const privilegedFilePlanChunkCharacters = 2600
const maxPrivilegedFilePlanEncodedBytes = 300 * 1024
const maxPrivilegedFilePlanFrames = 128

const requiredStageCapabilities = Object.freeze({
  'stage-handshake': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'gnuStat', 'realpath', 'chown', 'gnuDd', 'mkfifo', 'rm',
    'rmdir', 'cat'
  ]),
  'stage-export': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'gnuDd', 'gnuStat', 'realpath', 'chown', 'chmod', 'rm'
  ]),
  'stage-export-range': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'gnuDd', 'gnuStat', 'realpath', 'chown', 'chmod', 'rm'
  ]),
  'stage-import': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'cat', 'gnuStat', 'gnuMv', 'realpath', 'chown', 'chmod', 'rm',
    'gnuDd', 'mkfifo', 'rmdir'
  ]),
  'stage-import-cleanup': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256',
    'procFd', 'noclobber', 'gnuStat', 'realpath', 'rm', 'gnuDd',
    'mkfifo', 'rmdir', 'cat'
  ]),
  'stage-cleanup': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'gnuStat', 'realpath', 'rm', 'gnuDd', 'mkfifo', 'rmdir',
    'cat'
  ]),
  'digest-cleanup': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'gnuStat',
    'realpath', 'rm', 'rmdir'
  ])
})

const requiredOperationCapabilities = Object.freeze({
  ...requiredStageCapabilities,
  lstat: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath'
  ]),
  'lstat-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath'
  ]),
  stat: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat'
  ]),
  readlink: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'readlink'
  ]),
  realpath: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'realpath'
  ]),
  'rename-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'gnuMv', 'stat',
    'gnuStat', 'realpath', 'procFd'
  ]),
  'mkdir-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'chown', 'chmod', 'rmdir', 'procFd'
  ]),
  'metadata-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'chown', 'chmod', 'procFd'
  ]),
  'touch-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'procFd', 'touch'
  ]),
  'remove-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'sha256', 'procFd', 'rm', 'rmdir', 'gnuDd', 'mkfifo', 'cat'
  ]),
  'remove-peer-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'sha256', 'procFd', 'rm', 'rmdir', 'gnuDd', 'mkfifo', 'cat'
  ]),
  'sha256-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'sha256', 'procFd', 'gnuDd', 'mkfifo', 'rm', 'rmdir', 'cat'
  ]),
  'sha256-range-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'realpath', 'sha256', 'procFd', 'gnuDd', 'mkfifo', 'rm', 'rmdir', 'cat'
  ]),
  sha256: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'sha256', 'stat', 'gnuStat'
  ]),
  list: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'find', 'head', 'wc', 'realpath'
  ]),
  'list-bound': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'find', 'head', 'wc', 'realpath'
  ])
})

const capabilityShellVariables = Object.freeze({
  cleanShell: '__sp_clean_shell_cap',
  printf: '__sp_printf_cap',
  id: '__sp_id_cap',
  tr: '__sp_tr_cap',
  stat: '__sp_stat_cap',
  base64: '__sp_base64_cap',
  sha256: '__sp_sha256_cap',
  procFd: '__sp_proc_fd_cap',
  noclobber: '__sp_noclobber_cap',
  cat: '__sp_cat_cap',
  gnuStat: '__sp_gnu_stat_cap',
  gnuMv: '__sp_gnu_mv_cap',
  realpath: '__sp_realpath_cap',
  readlink: '__sp_readlink_cap',
  chown: '__sp_chown_cap',
  chmod: '__sp_chmod_cap',
  rm: '__sp_rm_cap',
  rmdir: '__sp_rmdir_cap',
  find: '__sp_find_cap',
  head: '__sp_head_cap',
  wc: '__sp_wc_cap',
  gnuDd: '__sp_gnu_dd_cap',
  mkfifo: '__sp_mkfifo_cap',
  touch: '__sp_touch_cap'
})

function encodeUtf8Base64 (value) {
  const bytes = new TextEncoder().encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function utf8ByteLength (value) {
  return new TextEncoder().encode(value).byteLength
}

function decodeUtf8Base64 (value, label = '字段') {
  const encoded = String(value ?? '')
  if (encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`root 文件协议 ${label} Base64 无效`)
  }
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (encodeUtf8Base64(decoded) !== encoded) throw new Error('non-canonical')
    return decoded
  } catch {
    throw new Error(`root 文件协议 ${label} UTF-8 编码无效`)
  }
}

function shellQuote (value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`
}

function hasUnpairedSurrogate (value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) return true
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true
    }
  }
  return false
}

function isCanonicalStageRootPath (value) {
  if (!value.startsWith('/') || value === '/' || value.endsWith('/')) return false
  return value.slice(1).split('/').every(part => part && part !== '.' && part !== '..')
}

function isCanonicalAbsoluteFilePath (value) {
  return isCanonicalStageRootPath(value)
}

function isCanonicalAbsoluteDirectoryPath (value) {
  return value === '/' || isCanonicalStageRootPath(value)
}

function parentAbsolutePath (value) {
  const index = value.lastIndexOf('/')
  return index <= 0 ? '/' : value.slice(0, index)
}

const operationArguments = Object.freeze({
  probe: [],
  list: ['path'],
  'list-bound': [
    'path', 'sourceParentRealPath', 'sourceParentDevice',
    'sourceParentInode', 'sourceDevice', 'sourceInode'
  ],
  lstat: ['path'],
  'lstat-bound': [
    'path', 'sourceParentRealPath', 'sourceParentDevice', 'sourceParentInode'
  ],
  stat: ['path'],
  readlink: ['path'],
  realpath: ['path'],
  'mkdir-bound': [
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetParentUid', 'targetParentMode',
    'targetMode', 'targetUid', 'targetGid'
  ],
  'metadata-bound': [
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetParentUid', 'targetParentMode',
    'targetDevice', 'targetInode', 'targetType', 'targetMode',
    'targetUid', 'targetGid'
  ],
  'touch-bound': [
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetParentUid', 'targetParentMode',
    'targetDevice', 'targetInode', 'targetType'
  ],
  'rename-bound': [
    'sourcePath', 'sourceParentRealPath', 'sourceParentDevice',
    'sourceParentInode', 'sourceParentUid', 'sourceParentMode',
    'sourceDevice', 'sourceInode', 'sourceType',
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetParentUid', 'targetParentMode'
  ],
  'remove-bound': [
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetDevice', 'targetInode', 'targetType',
    'targetMode', 'targetUid', 'targetGid', 'sha256', 'size'
  ],
  'remove-peer-bound': [
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetDevice', 'targetInode', 'targetType',
    'targetMode', 'targetUid', 'targetGid', 'sha256', 'size',
    'peerPath', 'peerParentRealPath', 'peerParentDevice',
    'peerParentInode', 'peerDevice', 'peerInode', 'peerType',
    'peerMode', 'peerUid', 'peerGid', 'peerSha256', 'peerSize'
  ],
  'stage-handshake': [
    'rootPath', 'challengeName', 'responseName', 'challenge',
    'challengeSize', 'rootUid', 'rootGid', 'rootMode'
  ],
  'stage-export': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'sourcePath',
    'sourceParentRealPath', 'sourceParentDevice', 'sourceParentInode',
    'sourceDevice', 'sourceInode', 'expectedSize', 'maxSize'
  ],
  'stage-export-range': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'sourcePath',
    'sourceParentRealPath', 'sourceParentDevice', 'sourceParentInode',
    'sourceDevice', 'sourceInode', 'expectedSize', 'maxSize',
    'offset', 'maxBytes'
  ],
  'stage-import': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'targetPath',
    'sha256', 'size', 'targetMode', 'targetUid', 'targetGid', 'mustBeAbsent',
    'targetParentRealPath', 'targetParentDevice', 'targetParentInode',
    'targetParentUid', 'targetParentMode', 'targetDevice', 'targetInode'
  ],
  'stage-import-cleanup': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName',
    'tempPath', 'tempParentRealPath', 'tempParentDevice',
    'tempParentInode', 'tempParentUid', 'tempParentMode',
    'targetPath', 'targetParentRealPath', 'targetParentDevice',
    'targetParentInode', 'targetParentUid', 'targetParentMode',
    'targetDevice', 'targetInode', 'targetType', 'sha256', 'size',
    'maxSize', 'initialMode', 'initialUid', 'initialGid',
    'targetMode', 'targetUid', 'targetGid'
  ],
  'stage-cleanup': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'sha256', 'size'
  ],
  'digest-cleanup': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName'
  ],
  sha256: ['path'],
  'sha256-bound': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'path',
    'sourceParentRealPath', 'sourceParentDevice', 'sourceParentInode',
    'sourceDevice', 'sourceInode', 'expectedSize', 'maxSize'
  ],
  'sha256-range-bound': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'path',
    'sourceParentRealPath', 'sourceParentDevice', 'sourceParentInode',
    'sourceDevice', 'sourceInode', 'expectedSize', 'maxSize',
    'offset', 'maxBytes'
  ]
})

const argumentVariables = Object.freeze({
  path: '__sp_path',
  rootPath: '__sp_rootPath',
  rootRealPath: '__sp_rootRealPath',
  rootDevice: '__sp_rootDevice',
  rootInode: '__sp_rootInode',
  rootUid: '__sp_rootUid',
  rootGid: '__sp_rootGid',
  rootMode: '__sp_rootMode',
  challengeName: '__sp_challengeName',
  responseName: '__sp_responseName',
  challenge: '__sp_challenge',
  challengeSize: '__sp_challengeSize',
  objectName: '__sp_objectName',
  sourcePath: '__sp_sourcePath',
  sourceParentRealPath: '__sp_sourceParentRealPath',
  sourceParentDevice: '__sp_sourceParentDevice',
  sourceParentInode: '__sp_sourceParentInode',
  sourceParentUid: '__sp_sourceParentUid',
  sourceParentMode: '__sp_sourceParentMode',
  sourceDevice: '__sp_sourceDevice',
  sourceInode: '__sp_sourceInode',
  sourceType: '__sp_sourceType',
  targetPath: '__sp_targetPath',
  tempPath: '__sp_tempPath',
  tempParentRealPath: '__sp_tempParentRealPath',
  tempParentDevice: '__sp_tempParentDevice',
  tempParentInode: '__sp_tempParentInode',
  tempParentUid: '__sp_tempParentUid',
  tempParentMode: '__sp_tempParentMode',
  sha256: '__sp_expectedSha256',
  size: '__sp_expectedSize',
  targetMode: '__sp_targetMode',
  targetUid: '__sp_targetUid',
  targetGid: '__sp_targetGid',
  mustBeAbsent: '__sp_mustBeAbsent',
  targetParentRealPath: '__sp_targetParentRealPath',
  targetParentDevice: '__sp_targetParentDevice',
  targetParentInode: '__sp_targetParentInode',
  targetParentUid: '__sp_targetParentUid',
  targetParentMode: '__sp_targetParentMode',
  targetDevice: '__sp_targetDevice',
  targetInode: '__sp_targetInode',
  targetType: '__sp_targetType',
  peerPath: '__sp_peerPath',
  peerParentRealPath: '__sp_peerParentRealPath',
  peerParentDevice: '__sp_peerParentDevice',
  peerParentInode: '__sp_peerParentInode',
  peerDevice: '__sp_peerDevice',
  peerInode: '__sp_peerInode',
  peerType: '__sp_peerType',
  peerMode: '__sp_peerMode',
  peerUid: '__sp_peerUid',
  peerGid: '__sp_peerGid',
  peerSha256: '__sp_peerExpectedSha256',
  peerSize: '__sp_peerExpectedSize',
  initialMode: '__sp_initialMode',
  initialUid: '__sp_initialUid',
  initialGid: '__sp_initialGid',
  expectedSize: '__sp_expectedSize',
  maxSize: '__sp_maxSize',
  offset: '__sp_offset',
  maxBytes: '__sp_maxBytes'
})

const argumentEnvironmentVariables = Object.freeze({
  path: 'SHELLPILOT_ARG_PATH',
  rootPath: 'SHELLPILOT_ARG_ROOT_PATH',
  rootRealPath: 'SHELLPILOT_ARG_ROOT_REAL_PATH',
  rootDevice: 'SHELLPILOT_ARG_ROOT_DEVICE',
  rootInode: 'SHELLPILOT_ARG_ROOT_INODE',
  rootUid: 'SHELLPILOT_ARG_ROOT_UID',
  rootGid: 'SHELLPILOT_ARG_ROOT_GID',
  rootMode: 'SHELLPILOT_ARG_ROOT_MODE',
  challengeName: 'SHELLPILOT_ARG_CHALLENGE_NAME',
  responseName: 'SHELLPILOT_ARG_RESPONSE_NAME',
  challenge: 'SHELLPILOT_ARG_CHALLENGE',
  challengeSize: 'SHELLPILOT_ARG_CHALLENGE_SIZE',
  objectName: 'SHELLPILOT_ARG_OBJECT_NAME',
  sourcePath: 'SHELLPILOT_ARG_SOURCE_PATH',
  sourceParentRealPath: 'SHELLPILOT_ARG_SOURCE_PARENT_REAL_PATH',
  sourceParentDevice: 'SHELLPILOT_ARG_SOURCE_PARENT_DEVICE',
  sourceParentInode: 'SHELLPILOT_ARG_SOURCE_PARENT_INODE',
  sourceParentUid: 'SHELLPILOT_ARG_SOURCE_PARENT_UID',
  sourceParentMode: 'SHELLPILOT_ARG_SOURCE_PARENT_MODE',
  sourceDevice: 'SHELLPILOT_ARG_SOURCE_DEVICE',
  sourceInode: 'SHELLPILOT_ARG_SOURCE_INODE',
  sourceType: 'SHELLPILOT_ARG_SOURCE_TYPE',
  targetPath: 'SHELLPILOT_ARG_TARGET_PATH',
  tempPath: 'SHELLPILOT_ARG_TEMP_PATH',
  tempParentRealPath: 'SHELLPILOT_ARG_TEMP_PARENT_REAL_PATH',
  tempParentDevice: 'SHELLPILOT_ARG_TEMP_PARENT_DEVICE',
  tempParentInode: 'SHELLPILOT_ARG_TEMP_PARENT_INODE',
  tempParentUid: 'SHELLPILOT_ARG_TEMP_PARENT_UID',
  tempParentMode: 'SHELLPILOT_ARG_TEMP_PARENT_MODE',
  sha256: 'SHELLPILOT_ARG_SHA256',
  size: 'SHELLPILOT_ARG_SIZE',
  targetMode: 'SHELLPILOT_ARG_TARGET_MODE',
  targetUid: 'SHELLPILOT_ARG_TARGET_UID',
  targetGid: 'SHELLPILOT_ARG_TARGET_GID',
  mustBeAbsent: 'SHELLPILOT_ARG_MUST_BE_ABSENT',
  targetParentRealPath: 'SHELLPILOT_ARG_TARGET_PARENT_REAL_PATH',
  targetParentDevice: 'SHELLPILOT_ARG_TARGET_PARENT_DEVICE',
  targetParentInode: 'SHELLPILOT_ARG_TARGET_PARENT_INODE',
  targetParentUid: 'SHELLPILOT_ARG_TARGET_PARENT_UID',
  targetParentMode: 'SHELLPILOT_ARG_TARGET_PARENT_MODE',
  targetDevice: 'SHELLPILOT_ARG_TARGET_DEVICE',
  targetInode: 'SHELLPILOT_ARG_TARGET_INODE',
  targetType: 'SHELLPILOT_ARG_TARGET_TYPE',
  peerPath: 'SHELLPILOT_ARG_PEER_PATH',
  peerParentRealPath: 'SHELLPILOT_ARG_PEER_PARENT_REAL_PATH',
  peerParentDevice: 'SHELLPILOT_ARG_PEER_PARENT_DEVICE',
  peerParentInode: 'SHELLPILOT_ARG_PEER_PARENT_INODE',
  peerDevice: 'SHELLPILOT_ARG_PEER_DEVICE',
  peerInode: 'SHELLPILOT_ARG_PEER_INODE',
  peerType: 'SHELLPILOT_ARG_PEER_TYPE',
  peerMode: 'SHELLPILOT_ARG_PEER_MODE',
  peerUid: 'SHELLPILOT_ARG_PEER_UID',
  peerGid: 'SHELLPILOT_ARG_PEER_GID',
  peerSha256: 'SHELLPILOT_ARG_PEER_SHA256',
  peerSize: 'SHELLPILOT_ARG_PEER_SIZE',
  initialMode: 'SHELLPILOT_ARG_INITIAL_MODE',
  initialUid: 'SHELLPILOT_ARG_INITIAL_UID',
  initialGid: 'SHELLPILOT_ARG_INITIAL_GID',
  expectedSize: 'SHELLPILOT_ARG_EXPECTED_SIZE',
  maxSize: 'SHELLPILOT_ARG_MAX_SIZE',
  offset: 'SHELLPILOT_ARG_OFFSET',
  maxBytes: 'SHELLPILOT_ARG_MAX_BYTES'
})

function assertRequestContract (request) {
  const expected = operationArguments[request.operation]
  const actual = Object.keys(request.args)
  if (actual.some(key => !expected.includes(key))) {
    throw new Error('root 文件操作参数合同无效')
  }
  if (expected.some(key => !Object.hasOwn(request.args, key) || !request.args[key])) {
    throw new Error('root 文件操作缺少必要参数')
  }
  for (const key of [
    'rootDevice', 'rootInode', 'rootUid', 'rootGid',
    'size', 'challengeSize', 'expectedSize', 'maxSize', 'offset', 'maxBytes',
    'targetUid', 'targetGid', 'sourceParentDevice', 'sourceParentUid',
    'sourceParentInode', 'sourceDevice', 'sourceInode',
    'targetParentDevice', 'targetParentInode', 'targetParentUid',
    'targetDevice', 'targetInode', 'tempParentDevice', 'tempParentInode',
    'tempParentUid', 'initialUid', 'initialGid',
    'peerParentDevice', 'peerParentInode', 'peerDevice', 'peerInode',
    'peerUid', 'peerGid'
  ]) {
    if (Object.hasOwn(request.args, key) &&
      !/^(?:0|[1-9]\d*)$/.test(request.args[key])) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  for (const key of ['rootMode', 'targetMode', 'sourceParentMode',
    'targetParentMode', 'tempParentMode', 'initialMode', 'peerMode']) {
    if (Object.hasOwn(request.args, key) &&
      !/^(?:0|[1-7][0-7]{0,3})$/.test(request.args[key])) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  if (Object.hasOwn(request.args, 'mustBeAbsent') &&
    request.args.mustBeAbsent !== '1') {
    throw new Error('root 文件操作参数值无效：mustBeAbsent')
  }
  for (const key of ['sourceType', 'targetType', 'peerType']) {
    if (Object.hasOwn(request.args, key) &&
      !['file', 'directory'].includes(request.args[key])) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  for (const key of [
    'size', 'peerSize', 'challengeSize', 'expectedSize', 'maxSize',
    'offset', 'maxBytes'
  ]) {
    if (Object.hasOwn(request.args, key) &&
      !Number.isSafeInteger(Number(request.args[key]))) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  if (Object.hasOwn(request.args, 'expectedSize') &&
    Number(request.args.expectedSize) > Number(request.args.maxSize)) {
    throw new Error('root 文件操作 expectedSize 超过 maxSize')
  }
  if (Object.hasOwn(request.args, 'maxBytes') &&
    (Number(request.args.maxBytes) < 1 || Number(request.args.maxBytes) > 65536)) {
    throw new Error('root 文件操作 maxBytes 超过 65536')
  }
  if (Object.hasOwn(request.args, 'challengeSize') &&
    (Number(request.args.challengeSize) < 1 ||
      Number(request.args.challengeSize) > 128)) {
    throw new Error('root 文件操作 challengeSize 超过 128')
  }
  if (Object.hasOwn(request.args, 'offset') &&
    Number(request.args.offset) > Number(request.args.expectedSize)) {
    throw new Error('root 文件操作 offset 超过 expectedSize')
  }
  if (['stage-import', 'stage-import-cleanup', 'stage-cleanup',
    'remove-bound', 'remove-peer-bound'].includes(request.operation) &&
    Number(request.args.size) > maxPrivilegedTransferBytes) {
    throw new Error('root 文件操作 size 超过传输上限')
  }
  if (request.operation === 'remove-peer-bound' &&
    Number(request.args.peerSize) > maxPrivilegedTransferBytes) {
    throw new Error('root 文件操作 peerSize 超过传输上限')
  }
  if (request.operation === 'stage-import-cleanup' && (
    Number(request.args.size) > Number(request.args.maxSize) ||
    Number(request.args.maxSize) > maxPrivilegedTransferBytes ||
    request.args.targetType !== 'file' ||
    request.args.tempPath === request.args.targetPath)) {
    throw new Error('root 文件操作 stage-import-cleanup proof 无效')
  }
  if (request.operation === 'stage-export' &&
    Number(request.args.maxSize) > maxPrivilegedTransferBytes) {
    throw new Error('root 文件操作 maxSize 超过传输上限')
  }
  if ((request.operation.startsWith('stage-') ||
    request.operation === 'digest-cleanup' ||
    ['sha256-bound', 'sha256-range-bound'].includes(request.operation)) &&
    request.args.rootMode !== '700') {
    throw new Error('root 文件操作握手 mode 必须为 700')
  }
  for (const key of ['challenge', 'sha256', 'peerSha256']) {
    if (Object.hasOwn(request.args, key) &&
      !/^[a-fA-F0-9]{64}$/.test(request.args[key])) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  for (const key of ['challengeName', 'responseName', 'objectName']) {
    if (Object.hasOwn(request.args, key) &&
      (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.args[key]) ||
        request.args[key] === '.' || request.args[key] === '..')) {
      throw new Error(`root 文件操作 ${key} 无效`)
    }
  }
  return request
}

function decodeCondition (request) {
  return operationArguments[request.operation].map(key => {
    const variable = argumentVariables[key]
    const environmentVariable = argumentEnvironmentVariables[key]
    return `${variable}="$(__sp_decode "$${environmentVariable}")" && ` +
      `${variable}=\${${variable}%?}`
  }).join(' && ')
}

const listBody = [
  '__sp_listReal="$(realpath -- "$__sp_path")" || return $?;',
  '__sp_listReal=$' + '{__sp_listReal%?};',
  '__sp_listReal=$' + '{__sp_listReal%?};',
  '[ "$__sp_listReal" = "$__sp_path" ] || return 1;',
  '[ ! -L "$__sp_path" ] && [ -d "$__sp_path" ] || return 1;',
  '__sp_requestedDevice="$(stat -c %d -- "$__sp_path")" || return $?;',
  '__sp_requestedInode="$(stat -c %i -- "$__sp_path")" || return $?;',
  'cd -- "$__sp_path" || return $?;',
  '__sp_listPwd="$(pwd -P && printf .)" || return $?;',
  '__sp_pwdSentinel="$(printf "\\n.")" || return $?;',
  'case "$__sp_listPwd" in *"$__sp_pwdSentinel") __sp_listPwd=$' +
    '{__sp_listPwd%"$__sp_pwdSentinel"} ;; *) return 1 ;; esac;',
  '__sp_listCwdReal="$(realpath -- .)" || return $?;',
  '__sp_listCwdReal=$' + '{__sp_listCwdReal%?};',
  '__sp_listCwdReal=$' + '{__sp_listCwdReal%?};',
  '[ "$__sp_listCwdReal" = "$__sp_listPwd" ] || return 1;',
  '__sp_listDevice="$(stat -c %d -- .)" || return $?;',
  '__sp_listInode="$(stat -c %i -- .)" || return $?;',
  '[ "$__sp_requestedDevice" = "$__sp_listDevice" ] || return 1;',
  '[ "$__sp_requestedInode" = "$__sp_listInode" ] || return 1;',
  '[ "$(stat -c %d -- "$__sp_path")" = "$__sp_listDevice" ] || return 1;',
  '[ "$(stat -c %i -- "$__sp_path")" = "$__sp_listInode" ] || return 1;',
  'find . -mindepth 1 -maxdepth 1 -print >/dev/null 2>&1 || return $?;',
  '__sp_preflight="$( ( find . -mindepth 1 -maxdepth 1 -printf x 2>/dev/null; __sp_findStatus=$?; if [ "$__sp_findStatus" -eq 0 ]; then printf 0; else printf 1; fi ) | head -c 20001 )" || return $?;',
  'case "$__sp_preflight" in *0) __sp_preflightEntries=$' + '{__sp_preflight%?} ;; *) return 1 ;; esac;',
  'case "$__sp_preflightEntries" in *[!x]*) return 1 ;; esac;',
  '__sp_preflightCount=$' + '{#__sp_preflightEntries};',
  '[ "$__sp_preflightCount" -le 20000 ] || return 1;',
  'set +f || return $?;',
  '__sp_total=0;',
  'for __sp_entry in ./.[!.]* ./..?* ./*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_total=$((__sp_total + 1));',
  '  [ "$__sp_total" -le 20000 ] || return 1;',
  'done;',
  '__sp_seq=0;',
  '__sp_metadataBytes=0;',
  'for __sp_entry in ./.[!.]* ./..?* ./*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_seq=$((__sp_seq + 1));',
  '  [ "$__sp_seq" -le "$__sp_total" ] && [ "$__sp_seq" -le 20000 ] || return 1;',
  '  __sp_name=$' + '{__sp_entry##*/};',
  '  __sp_stat="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$__sp_entry")" || return $?;',
  '  __sp_emit_entry "$__sp_seq" "$__sp_total" "$__sp_name" "$__sp_stat" || return $?;',
  'done'
].join(' ')

const listBoundBody = [
  '__sp_bind_entry_parent "$__sp_path" "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || return $?;',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_sourceDevice" "$__sp_sourceInode" directory || return 1;',
  'cd -- "./$__sp_boundName" || return $?;',
  '[ "$(pwd -P)" = "$__sp_path" ] || return 1;',
  '[ "$(stat -c %d -- .)" = "$__sp_sourceDevice" ] || return 1;',
  '[ "$(stat -c %i -- .)" = "$__sp_sourceInode" ] || return 1;',
  'find . -mindepth 1 -maxdepth 1 -print >/dev/null 2>&1 || return $?;',
  '__sp_preflight="$( ( find . -mindepth 1 -maxdepth 1 -printf x 2>/dev/null; __sp_findStatus=$?; if [ "$__sp_findStatus" -eq 0 ]; then printf 0; else printf 1; fi ) | head -c 20001 )" || return $?;',
  'case "$__sp_preflight" in *0) __sp_preflightEntries=$' + '{__sp_preflight%?} ;; *) return 1 ;; esac;',
  'case "$__sp_preflightEntries" in *[!x]*) return 1 ;; esac;',
  '__sp_preflightCount=$' + '{#__sp_preflightEntries};',
  '[ "$__sp_preflightCount" -le 20000 ] || return 1;',
  'set +f || return $?;',
  '__sp_total=0;',
  'for __sp_entry in ./.[!.]* ./..?* ./*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_total=$((__sp_total + 1));',
  '  [ "$__sp_total" -le 20000 ] || return 1;',
  'done;',
  '__sp_seq=0;',
  '__sp_metadataBytes=0;',
  'for __sp_entry in ./.[!.]* ./..?* ./*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_seq=$((__sp_seq + 1));',
  '  [ "$__sp_seq" -le "$__sp_total" ] && [ "$__sp_seq" -le 20000 ] || return 1;',
  '  __sp_name=$' + '{__sp_entry##*/};',
  '  __sp_stat="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$__sp_entry")" || return $?;',
  '  __sp_emit_entry "$__sp_seq" "$__sp_total" "$__sp_name" "$__sp_stat" || return $?;',
  'done'
].join(' ')

const stageHandshakeBody = [
  '__sp_valid_name "$__sp_challengeName"',
  '__sp_valid_name "$__sp_responseName"',
  '__sp_actualRealPath="$(realpath -- "$__sp_rootPath")"',
  '__sp_actualRealPath=$' + '{__sp_actualRealPath%?}',
  '__sp_actualRealPath=$' + '{__sp_actualRealPath%?}',
  '[ "$__sp_actualRealPath" = "$__sp_rootPath" ]',
  '[ ! -L "$__sp_rootPath" ] && [ -d "$__sp_rootPath" ]',
  'cd -- "$__sp_rootPath"',
  '[ "$(pwd -P)" = "$__sp_actualRealPath" ]',
  '__sp_actualMode="$(stat -c %a -- .)"',
  '__sp_actualUid="$(stat -c %u -- .)"',
  '__sp_actualGid="$(stat -c %g -- .)"',
  '__sp_actualDevice="$(stat -c %d -- .)"',
  '__sp_actualInode="$(stat -c %i -- .)"',
  '[ "$__sp_actualMode" = 700 ] && [ "$__sp_actualMode" = "$__sp_rootMode" ]',
  '[ "$__sp_actualUid" = "$__sp_rootUid" ] && [ "$__sp_actualGid" = "$__sp_rootGid" ]',
  '[ ! -L "./$__sp_challengeName" ] && [ -f "./$__sp_challengeName" ]',
  '[ ! -e "./$__sp_responseName" ] && [ ! -L "./$__sp_responseName" ]',
  'exec 3< "./$__sp_challengeName"',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_challengeDevice="$(stat -L -c %d -- "$__sp_fd3")"',
  '__sp_challengeInode="$(stat -L -c %i -- "$__sp_fd3")"',
  '[ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_challengeSize" ]',
  '__sp_path_matches_fd "./$__sp_challengeName" "$__sp_challengeDevice" "$__sp_challengeInode"',
  '__sp_rootDevice="$__sp_actualDevice"',
  '__sp_rootInode="$__sp_actualInode"',
  '__sp_objectName="$__sp_challengeName"',
  '__sp_actualChallenge="$(__sp_bounded_digest 0 "$__sp_challengeSize")"',
  '[ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_challengeSize" ]',
  '__sp_path_matches_fd "./$__sp_challengeName" "$__sp_challengeDevice" "$__sp_challengeInode"',
  'exec 3<&-',
  '[ "$__sp_actualChallenge" = "$__sp_challenge" ]',
  '__sp_response="$(__sp_sha256_text "$__sp_challenge:root")"',
  '( umask 077; set -C || exit $?; printf %s "$__sp_response" > "./$__sp_responseName" )',
  'chown -h -- "$__sp_rootUid:$__sp_rootGid" "./$__sp_responseName"',
  '[ ! -L "./$__sp_responseName" ] && [ -f "./$__sp_responseName" ]',
  '[ "$(stat -c %u -- "./$__sp_responseName")" = "$__sp_rootUid" ]',
  '[ "$(stat -c %g -- "./$__sp_responseName")" = "$__sp_rootGid" ]',
  '[ "$(stat -c %a -- "./$__sp_responseName")" = 600 ]',
  '[ "$(stat -c %s -- "./$__sp_responseName")" = 64 ]',
  '__sp_expectedResponseDigest="$(__sp_sha256_text "$__sp_response")"',
  'exec 3< "./$__sp_responseName"',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_responseDevice="$(stat -L -c %d -- "$__sp_fd3")"',
  '__sp_responseInode="$(stat -L -c %i -- "$__sp_fd3")"',
  '[ "$(stat -L -c %s -- "$__sp_fd3")" = 64 ]',
  '__sp_path_matches_fd "./$__sp_responseName" "$__sp_responseDevice" "$__sp_responseInode"',
  '__sp_objectName="$__sp_responseName"',
  '__sp_actualResponseDigest="$(__sp_bounded_digest 0 64)"',
  '[ "$(stat -L -c %s -- "$__sp_fd3")" = 64 ]',
  '__sp_path_matches_fd "./$__sp_responseName" "$__sp_responseDevice" "$__sp_responseInode"',
  'exec 3<&-',
  '[ "$__sp_actualResponseDigest" = "$__sp_expectedResponseDigest" ]',
  '__sp_emit_handshake "$__sp_response" "$__sp_rootUid" "$__sp_rootGid" "$__sp_actualMode" "$__sp_actualRealPath" "$__sp_actualDevice" "$__sp_actualInode"'
].join(' && ')

function createStageExportBody (range) {
  const sizeSetup = range
    ? [
        '[ "$__sp_offset" -le "$__sp_expectedSize" ] || return 1',
        '__sp_windowSize=$((__sp_expectedSize - __sp_offset))',
        '[ "$__sp_windowSize" -le "$__sp_maxBytes" ] || __sp_windowSize="$__sp_maxBytes"'
      ]
    : ['__sp_offset=0', '__sp_windowSize="$__sp_expectedSize"']
  return [
    '__sp_bind_root || return $?',
    '[ ! -e "./$__sp_objectName" ] && [ ! -L "./$__sp_objectName" ] || return 1',
    '[ "$__sp_expectedSize" -le "$__sp_maxSize" ] || return 1',
    ...sizeSetup,
    '__sp_bind_entry_parent "$__sp_sourcePath" "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || return $?',
    '__sp_entry_matches "./$__sp_boundName" "$__sp_sourceDevice" "$__sp_sourceInode" file || return 1',
    'exec 4< "./$__sp_boundName" || return $?',
    '__sp_fd4="/proc/$$/fd/4"',
    '[ -f "$__sp_fd4" ] || { exec 4<&-; return 1; }',
    '__sp_openSourceDevice="$(stat -L -c %d -- "$__sp_fd4")" || { exec 4<&-; return 1; }',
    '__sp_openSourceInode="$(stat -L -c %i -- "$__sp_fd4")" || { exec 4<&-; return 1; }',
    '__sp_openSourceSize="$(stat -L -c %s -- "$__sp_fd4")" || { exec 4<&-; return 1; }',
    '[ "$__sp_openSourceDevice" = "$__sp_sourceDevice" ] && [ "$__sp_openSourceInode" = "$__sp_sourceInode" ] || { exec 4<&-; return 1; }',
    '[ "$__sp_openSourceSize" = "$__sp_expectedSize" ] || { exec 4<&-; return 1; }',
    '__sp_entry_matches "./$__sp_boundName" "$__sp_openSourceDevice" "$__sp_openSourceInode" file || { exec 4<&-; return 1; }',
    '__sp_bind_root || { exec 4<&-; return 1; }',
    'umask 077',
    'set -C || return $?',
    'exec 3> "./$__sp_objectName" || { exec 4<&-; return 1; }',
    '__sp_fd3="/proc/$$/fd/3"',
    '__sp_objectDevice="$(stat -L -c %d -- "$__sp_fd3")" || { exec 3>&- 4<&-; return 1; }',
    '__sp_objectInode="$(stat -L -c %i -- "$__sp_fd3")" || { exec 3>&- 4<&-; return 1; }',
    '__sp_copyReport="$(LC_ALL=C dd bs=65536 iflag=skip_bytes,count_bytes skip="$__sp_offset" count="$__sp_windowSize" <&4 2>&1 >&3)"',
    '__sp_copyStatus=$?',
    '__sp_copyActualBytes="$(__sp_parse_dd_report_text "$__sp_copyReport")" || { __sp_cleanup_export; exec 3>&- 4<&-; return 1; }',
    '[ "$__sp_copyStatus" -eq 0 ] && [ "$__sp_copyActualBytes" = "$__sp_windowSize" ] || { __sp_cleanup_export; exec 3>&- 4<&-; return 1; }',
    '[ "$(stat -L -c %s -- "$__sp_fd4")" = "$__sp_expectedSize" ] || { __sp_cleanup_export; exec 3>&- 4<&-; return 1; }',
    '__sp_parent_path_matches "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || { __sp_cleanup_export; exec 3>&- 4<&-; return 1; }',
    '__sp_entry_matches "$__sp_sourcePath" "$__sp_sourceDevice" "$__sp_sourceInode" file || { __sp_cleanup_export; exec 3>&- 4<&-; return 1; }',
    'exec 4<&-',
    '__sp_digest="$(__sp_sha256_raw "$__sp_fd3")" || { __sp_cleanup_export; exec 3>&-; return 1; }',
    '__sp_size="$(stat -L -c %s -- "$__sp_fd3")" || { __sp_cleanup_export; exec 3>&-; return 1; }',
    '[ "$__sp_size" = "$__sp_windowSize" ] || { __sp_cleanup_export; exec 3>&-; return 1; }',
    'chown -- "$__sp_rootUid:$__sp_rootGid" "$__sp_fd3" || { __sp_cleanup_export; exec 3>&-; return 1; }',
    'chmod -- 600 "$__sp_fd3" || { __sp_cleanup_export; exec 3>&-; return 1; }',
    '__sp_path_matches_fd "./$__sp_objectName" "$__sp_objectDevice" "$__sp_objectInode" || { exec 3>&-; return 1; }',
    'exec 3>&-',
    '__sp_emit_digest "$__sp_digest" "$__sp_size"'
  ].join('; ')
}

const stageExportBody = createStageExportBody(false)
const stageExportRangeBody = createStageExportBody(true)

const stageImportBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_root || return $?',
  '[ ! -L "./$__sp_objectName" ] && [ -f "./$__sp_objectName" ] || return 1',
  'exec 5< "./$__sp_objectName" || return $?',
  '__sp_fd5="/proc/$$/fd/5"',
  '__sp_objectDevice="$(stat -L -c %d -- "$__sp_fd5")" || { exec 5<&-; return 1; }',
  '__sp_objectInode="$(stat -L -c %i -- "$__sp_fd5")" || { exec 5<&-; return 1; }',
  '[ "$(stat -c %d -- "./$__sp_objectName")" = "$__sp_objectDevice" ] || { exec 5<&-; return 1; }',
  '[ "$(stat -c %i -- "./$__sp_objectName")" = "$__sp_objectInode" ] || { exec 5<&-; return 1; }',
  '__sp_sourceSize="$(stat -L -c %s -- "$__sp_fd5")" || { exec 5<&-; return 1; }',
  '[ "$__sp_sourceSize" = "$__sp_expectedSize" ] || { exec 5<&-; return 1; }',
  'exec 3< "$__sp_fd5" || { exec 5<&-; return 1; }',
  '__sp_sourceDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&- 5<&-; return 1; }',
  'exec 3<&-',
  '[ "$__sp_sourceDigest" = "$__sp_expectedSha256" ] && [ "$(stat -L -c %s -- "$__sp_fd5")" = "$__sp_expectedSize" ] || { exec 5<&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_objectName" "$__sp_objectDevice" "$__sp_objectInode" || { exec 5<&-; return 1; }',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || { exec 5<&-; return 1; }',
  '__sp_targetName="$__sp_boundName"',
  '__sp_trusted_parent_fd . "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  '__sp_targetParentTrusted=1',
  '[ "$__sp_mustBeAbsent" = 1 ] || { exec 5<&-; return 1; }',
  '[ ! -e "./$__sp_targetName" ] && [ ! -L "./$__sp_targetName" ] || { exec 5<&-; return 1; }',
  '__sp_importTempName=".shellpilot-$__sp_objectName.tmp"',
  '__sp_valid_name "$__sp_importTempName" || { exec 5<&-; return 1; }',
  '[ ! -e "./$__sp_importTempName" ] && [ ! -L "./$__sp_importTempName" ] || { exec 5<&-; return 1; }',
  '__sp_importTempCreated=0',
  '__sp_importInstalled=0',
  '__sp_importMoving=0',
  '__sp_importClaimMayExist=0',
  '__sp_importTempClaimEmitted=0',
  '__sp_importTargetClaimEmitted=0',
  '__sp_tempDevice=',
  '__sp_tempInode=',
  '__sp_importMetadataKnown=0',
  '__sp_importMetadataUid=',
  '__sp_importMetadataGid=',
  '__sp_importMetadataMode=',
  '__sp_import_cleanup_exact_locations() { __sp_importExactCount=0; __sp_importExactPath=; for __sp_importCandidate in "./$__sp_importTempName" "./$__sp_targetName"; do if [ -e "$__sp_importCandidate" ] || [ -L "$__sp_importCandidate" ]; then if __sp_entry_matches "$__sp_importCandidate" "$__sp_tempDevice" "$__sp_tempInode" file; then __sp_importExactCount=$((__sp_importExactCount + 1)); __sp_importExactPath="$__sp_importCandidate"; fi; fi; done; }',
  '__sp_import_cleanup_candidate() { __sp_importCleanupPath="$1"; __sp_importCleanupUid="$2"; __sp_importCleanupGid="$3"; __sp_importCleanupMode="$4"; __sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1; [ ! -L "$__sp_importCleanupPath" ] && [ -f "$__sp_importCleanupPath" ] || return 1; exec 3< "$__sp_importCleanupPath" || return $?; __sp_fd3="/proc/$$/fd/3"; __sp_fd_entry_matches "$__sp_fd3" "$__sp_tempDevice" "$__sp_tempInode" file || { exec 3<&-; return 1; }; [ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }; __sp_importCleanupDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&-; return 1; }; __sp_importCleanupSize="$(stat -L -c %s -- "$__sp_fd3")" || { exec 3<&-; return 1; }; __sp_importCleanupActualUid="$(stat -L -c %u -- "$__sp_fd3")" || { exec 3<&-; return 1; }; __sp_importCleanupActualGid="$(stat -L -c %g -- "$__sp_fd3")" || { exec 3<&-; return 1; }; __sp_importCleanupActualMode="$(stat -L -c %a -- "$__sp_fd3")" || { exec 3<&-; return 1; }; [ "$__sp_importCleanupDigest" = "$__sp_expectedSha256" ] && [ "$__sp_importCleanupSize" = "$__sp_expectedSize" ] && [ "$__sp_importCleanupActualUid" = "$__sp_importCleanupUid" ] && [ "$__sp_importCleanupActualGid" = "$__sp_importCleanupGid" ] && [ "$__sp_importCleanupActualMode" = "$__sp_importCleanupMode" ] || { exec 3<&-; return 1; }; __sp_path_matches_fd "$__sp_importCleanupPath" "$__sp_tempDevice" "$__sp_tempInode" || { exec 3<&-; return 1; }; __sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 3<&-; return 1; }; __sp_import_cleanup_exact_locations; [ "$__sp_importExactCount" -eq 1 ] && [ "$__sp_importExactPath" = "$__sp_importCleanupPath" ] || { exec 3<&-; return 1; }; rm -f -- "$__sp_importCleanupPath"; __sp_importCleanupStatus=$?; if [ "$__sp_importCleanupStatus" -eq 0 ]; then __sp_import_cleanup_exact_locations; [ "$__sp_importExactCount" -eq 0 ] || __sp_importCleanupStatus=1; fi; exec 3<&-; return "$__sp_importCleanupStatus"; }',
  '__sp_import_cleanup() { exec 4>&- 2>/dev/null; if [ "$__sp_importTempCreated" = 0 ] && [ "$__sp_importInstalled" = 0 ] && [ "$__sp_importMoving" = 0 ] && [ "$__sp_importClaimMayExist" = 0 ]; then return 0; fi; [ -n "$__sp_tempDevice" ] && [ -n "$__sp_tempInode" ] && [ "$__sp_importMetadataKnown" = 1 ] || return 1; if [ "$__sp_importMoving" = 1 ]; then __sp_import_cleanup_exact_locations; [ "$__sp_importExactCount" -eq 1 ] || return 1; __sp_import_cleanup_candidate "$__sp_importExactPath" "$__sp_importMetadataUid" "$__sp_importMetadataGid" "$__sp_importMetadataMode"; return $?; fi; if [ -e "./$__sp_importTempName" ] || [ -L "./$__sp_importTempName" ]; then [ "$__sp_importTempCreated" = 1 ] || return 1; __sp_import_cleanup_candidate "./$__sp_importTempName" "$__sp_importMetadataUid" "$__sp_importMetadataGid" "$__sp_importMetadataMode"; return $?; fi; if [ -e "./$__sp_targetName" ] || [ -L "./$__sp_targetName" ]; then [ "$__sp_importInstalled" = 1 ] || return 1; __sp_import_cleanup_candidate "./$__sp_targetName" "$__sp_importMetadataUid" "$__sp_importMetadataGid" "$__sp_importMetadataMode"; return $?; fi; [ "$__sp_importTempCreated" = 0 ] && [ "$__sp_importInstalled" = 0 ]; }',
  '__sp_import_emit_residual() { if [ "$__sp_importInstalled" = 1 ] && [ "$__sp_importMetadataKnown" = 1 ] && [ -n "$__sp_tempDevice" ] && [ -n "$__sp_tempInode" ]; then if [ "$__sp_importTargetClaimEmitted" != 1 ]; then __sp_emit_install "$__sp_expectedSha256" "$__sp_expectedSize" "$__sp_tempDevice" "$__sp_tempInode" "$__sp_importMetadataMode" "$__sp_importMetadataUid" "$__sp_importMetadataGid" || return 1; __sp_importTargetClaimEmitted=1; fi; __sp_emit_import_cleanup 0 target; return $?; fi; if [ "$__sp_importMoving" = 1 ]; then __sp_emit_import_cleanup 0 moving; return $?; fi; if [ "$__sp_importTempCreated" = 1 ] && [ "$__sp_importTempClaimEmitted" = 1 ]; then __sp_emit_import_cleanup 0 temp; return $?; fi; __sp_emit_import_cleanup 0 unknown; }',
  '__sp_import_finalize() { __sp_importFinalizeStatus="$1"; [ "$__sp_importFinalizeStatus" -ne 0 ] || return 0; trap - 0 HUP INT TERM; exec 3<&- 4>&- 5<&- 2>/dev/null; __sp_import_cleanup >/dev/null 2>&1; __sp_importCleanupStatus=$?; if [ "$__sp_importCleanupStatus" -eq 0 ]; then __sp_emit_import_cleanup 1 none || :; else __sp_import_emit_residual || :; fi; return "$__sp_importFinalizeStatus"; }',
  '__sp_importSignalled=0',
  '__sp_importSignalPending=0',
  '__sp_import_defer_signal() { __sp_importSignalPending=1; }',
  '__sp_import_signal_trap() { __sp_importTrapStatus=$?; [ "$__sp_importTrapStatus" -ne 0 ] || __sp_importTrapStatus=1; __sp_importSignalled=1; trap - HUP INT TERM; exec 3<&- 4>&- 5<&- 2>/dev/null; if [ "$__sp_importTempCreated" = 0 ] && [ "$__sp_importInstalled" = 0 ] && [ "$__sp_importMoving" = 0 ] && [ "$__sp_importClaimMayExist" = 0 ]; then __sp_emit_import_cleanup 1 none || :; else __sp_import_emit_residual || :; fi; exit "$__sp_importTrapStatus"; }',
  '__sp_import_exit_trap() { __sp_importTrapStatus=$?; [ "$__sp_importTrapStatus" -ne 0 ] || __sp_importTrapStatus=1; trap - 0 HUP INT TERM; exec 3<&- 4>&- 5<&- 2>/dev/null; if [ "$__sp_importSignalled" -ne 1 ]; then __sp_import_cleanup >/dev/null 2>&1; fi; exit "$__sp_importTrapStatus"; }',
  'trap __sp_import_exit_trap 0',
  'trap __sp_import_signal_trap HUP INT TERM',
  'umask 077',
  'set -C || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  '__sp_importClaimMayExist=1',
  'exec 4> "./$__sp_importTempName" || { exec 5<&-; return 1; }',
  '__sp_fd4="/proc/$$/fd/4"',
  '__sp_tempDevice="$(stat -L -c %d -- "$__sp_fd4")" || { exec 4>&- 5<&-; return 1; }',
  '__sp_tempInode="$(stat -L -c %i -- "$__sp_fd4")" || { exec 4>&- 5<&-; return 1; }',
  '__sp_importTempCreated=1',
  '__sp_importInitialGid="$(stat -L -c %g -- "$__sp_fd4")" || { exec 4>&- 5<&-; return 1; }',
  '[ "$(stat -L -c %u -- "$__sp_fd4")" = 0 ] && [ "$(stat -L -c %a -- "$__sp_fd4")" = 600 ] || { exec 4>&- 5<&-; return 1; }',
  '__sp_importMetadataUid=0; __sp_importMetadataGid="$__sp_importInitialGid"; __sp_importMetadataMode=600; __sp_importMetadataKnown=1',
  '__sp_path_matches_fd "./$__sp_importTempName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&- 5<&-; return 1; }',
  '__sp_importClaimMayExist=0',
  '__sp_emit_temp_claim "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&- 5<&-; return 1; }',
  '__sp_importTempClaimEmitted=1',
  '__sp_copyReport="$(LC_ALL=C dd bs=65536 iflag=count_bytes count="$__sp_expectedSize" <&5 2>&1 >&4)"',
  '__sp_copyStatus=$?',
  '__sp_copyActualBytes="$(__sp_parse_dd_report_text "$__sp_copyReport")" || { exec 4>&- 5<&-; return 1; }',
  '[ "$__sp_copyStatus" -eq 0 ] && [ "$__sp_copyActualBytes" = "$__sp_expectedSize" ] || { exec 4>&- 5<&-; return 1; }',
  '[ "$(stat -L -c %s -- "$__sp_fd4")" = "$__sp_expectedSize" ] || { exec 4>&- 5<&-; return 1; }',
  'exec 3< "$__sp_fd5" || { exec 4>&- 5<&-; return 1; }',
  '__sp_afterSourceDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&- 4>&- 5<&-; return 1; }',
  'exec 3<&-',
  '__sp_afterSourceSize="$(stat -L -c %s -- "$__sp_fd5")" || { exec 4>&- 5<&-; return 1; }',
  '[ "$__sp_afterSourceDigest" = "$__sp_expectedSha256" ] && [ "$__sp_afterSourceSize" = "$__sp_expectedSize" ] && __sp_path_matches_fd "./$__sp_objectName" "$__sp_objectDevice" "$__sp_objectInode" || { exec 4>&- 5<&-; return 1; }',
  'exec 5<&-',
  'exec 3< "$__sp_fd4" || { exec 4>&-; return 1; }',
  '__sp_tempDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&- 4>&-; return 1; }',
  'exec 3<&-',
  '__sp_tempSize="$(stat -L -c %s -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '[ "$__sp_tempDigest" = "$__sp_expectedSha256" ] && [ "$__sp_tempSize" = "$__sp_expectedSize" ] || { exec 4>&-; return 1; }',
  'chmod -- 0 "$__sp_fd4" || { exec 4>&-; return 1; }',
  '__sp_importMetadataMode=0',
  '__sp_path_matches_fd "./$__sp_importTempName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 4>&-; return 1; }',
  '[ ! -e "./$__sp_targetName" ] && [ ! -L "./$__sp_targetName" ] || { exec 4>&-; return 1; }',
  '__sp_importSignalPending=0',
  'trap __sp_import_defer_signal HUP INT TERM',
  '__sp_emit_moving "$__sp_tempDevice" "$__sp_tempInode" "$__sp_importMetadataGid"',
  '__sp_emitMovingStatus=$?',
  'if [ "$__sp_emitMovingStatus" -eq 0 ]; then __sp_importMoving=1; fi',
  'trap __sp_import_signal_trap HUP INT TERM',
  'if [ "$__sp_importSignalPending" = 1 ]; then __sp_import_signal_trap; fi',
  '[ "$__sp_emitMovingStatus" -eq 0 ] || { exec 4>&-; return 1; }',
  'mv -nT -- "./$__sp_importTempName" "./$__sp_targetName" || { exec 4>&-; return 1; }',
  '[ ! -e "./$__sp_importTempName" ] && [ ! -L "./$__sp_importTempName" ] || { exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_targetName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 4>&-; return 1; }',
  'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4" || { exec 4>&-; return 1; }',
  '__sp_importMetadataUid="$__sp_targetUid"; __sp_importMetadataGid="$__sp_targetGid"',
  'chmod -- "$__sp_targetMode" "$__sp_fd4" || { exec 4>&-; return 1; }',
  '__sp_importMetadataMode="$__sp_targetMode"',
  '[ "$(stat -L -c %s -- "$__sp_fd4")" = "$__sp_expectedSize" ] || { exec 4>&-; return 1; }',
  'exec 3< "$__sp_fd4" || { exec 4>&-; return 1; }',
  '__sp_finalDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&- 4>&-; return 1; }',
  'exec 3<&-',
  '__sp_finalSize="$(stat -L -c %s -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalMode="$(stat -L -c %a -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalUid="$(stat -L -c %u -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalGid="$(stat -L -c %g -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '[ "$__sp_finalDigest" = "$__sp_expectedSha256" ] && [ "$__sp_finalSize" = "$__sp_expectedSize" ] && [ "$__sp_finalUid" = "$__sp_targetUid" ] && [ "$__sp_finalGid" = "$__sp_targetGid" ] && [ "$__sp_finalMode" = "$__sp_targetMode" ] || { exec 4>&-; return 1; }',
  '__sp_fd_entry_matches "$__sp_fd4" "$__sp_tempDevice" "$__sp_tempInode" file || { exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_targetName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 4>&-; return 1; }',
  '__sp_installedDevice="$__sp_tempDevice"',
  '__sp_installedInode="$__sp_tempInode"',
  '__sp_importTempCreated=0',
  '__sp_importInstalled=1',
  '__sp_importMoving=0',
  '__sp_emit_install "$__sp_finalDigest" "$__sp_finalSize" "$__sp_installedDevice" "$__sp_installedInode" "$__sp_finalMode" "$__sp_finalUid" "$__sp_finalGid" || { exec 4>&-; return 1; }',
  '__sp_importTargetClaimEmitted=1',
  '__sp_emit_import_cleanup 1 complete || { exec 4>&-; return 1; }',
  'trap - 0 HUP INT TERM',
  '__sp_importInstalled=0',
  'exec 4>&-'
].join('; ')

const stageCleanupBody = [
  '__sp_bind_root || return $?',
  'if [ ! -e "./$__sp_objectName" ] && [ ! -L "./$__sp_objectName" ]; then return 0; fi',
  '[ ! -L "./$__sp_objectName" ] && [ -f "./$__sp_objectName" ] || return 1',
  'exec 3< "./$__sp_objectName" || return $?',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_objectDevice="$(stat -L -c %d -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '__sp_objectInode="$(stat -L -c %i -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '[ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
  '__sp_digest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&-; return 1; }',
  '__sp_size="$(stat -L -c %s -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '[ "$__sp_digest" = "$__sp_expectedSha256" ] && [ "$__sp_size" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_objectName" "$__sp_objectDevice" "$__sp_objectInode" || { exec 3<&-; return 1; }',
  'rm -f -- "./$__sp_objectName" || { __sp_status=$?; exec 3<&-; return "$__sp_status"; }',
  'exec 3<&-'
].join('; ')

const stageImportCleanupBody = [
  '__sp_bind_root || return $?',
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_import_residual_parents_match() { __sp_trusted_parent_path_matches "$__sp_tempParentRealPath" "$__sp_tempParentDevice" "$__sp_tempParentInode" "$__sp_tempParentUid" "$__sp_tempParentMode" && __sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode"; }',
  '__sp_import_residual_exact_count() { __sp_importResidualExactCount=0; __sp_importResidualExactPath=; for __sp_importResidualCandidate in "$__sp_tempPath" "$__sp_targetPath"; do if [ -e "$__sp_importResidualCandidate" ] || [ -L "$__sp_importResidualCandidate" ]; then if __sp_entry_matches "$__sp_importResidualCandidate" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType"; then __sp_importResidualExactCount=$((__sp_importResidualExactCount + 1)); __sp_importResidualExactPath="$__sp_importResidualCandidate"; fi; fi; done; }',
  '__sp_import_residual_metadata_matches() { __sp_importResidualMode="$(stat -L -c %a -- "$__sp_fd3")" && __sp_importResidualUid="$(stat -L -c %u -- "$__sp_fd3")" && __sp_importResidualGid="$(stat -L -c %g -- "$__sp_fd3")" || return 1; { [ "$__sp_importResidualMode" = "$__sp_initialMode" ] && [ "$__sp_importResidualUid" = "$__sp_initialUid" ] && [ "$__sp_importResidualGid" = "$__sp_initialGid" ]; } || { [ "$__sp_importResidualMode" = "$__sp_initialMode" ] && [ "$__sp_importResidualUid" = "$__sp_targetUid" ] && [ "$__sp_importResidualGid" = "$__sp_targetGid" ]; } || { [ "$__sp_importResidualMode" = "$__sp_targetMode" ] && [ "$__sp_importResidualUid" = "$__sp_targetUid" ] && [ "$__sp_importResidualGid" = "$__sp_targetGid" ]; }; }',
  '__sp_import_residual_parents_match || return 1',
  '__sp_import_residual_exact_count',
  'if [ "$__sp_importResidualExactCount" -eq 0 ]; then __sp_emit_import_cleanup 1 none; return $?; fi',
  '[ "$__sp_importResidualExactCount" -eq 1 ] || return 1',
  '__sp_importResidualDeletePath="$__sp_importResidualExactPath"',
  '[ ! -L "$__sp_importResidualDeletePath" ] && [ -f "$__sp_importResidualDeletePath" ] || return 1',
  'exec 3< "$__sp_importResidualDeletePath" || return $?',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_fd_entry_matches "$__sp_fd3" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&-; return 1; }',
  '[ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
  '__sp_import_residual_metadata_matches || { exec 3<&-; return 1; }',
  '__sp_path_matches_fd "$__sp_importResidualDeletePath" "$__sp_targetDevice" "$__sp_targetInode" || { exec 3<&-; return 1; }',
  '__sp_import_residual_parents_match || { exec 3<&-; return 1; }',
  '__sp_importResidualDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&-; return 1; }',
  '[ "$__sp_importResidualDigest" = "$__sp_expectedSha256" ] && [ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
  '__sp_fd_entry_matches "$__sp_fd3" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&-; return 1; }',
  '__sp_import_residual_metadata_matches || { exec 3<&-; return 1; }',
  '__sp_path_matches_fd "$__sp_importResidualDeletePath" "$__sp_targetDevice" "$__sp_targetInode" || { exec 3<&-; return 1; }',
  '__sp_import_residual_parents_match || { exec 3<&-; return 1; }',
  '__sp_import_residual_exact_count',
  '[ "$__sp_importResidualExactCount" -eq 1 ] && [ "$__sp_importResidualExactPath" = "$__sp_importResidualDeletePath" ] || { exec 3<&-; return 1; }',
  'rm -f -- "$__sp_importResidualDeletePath" || { __sp_importResidualStatus=$?; exec 3<&-; return "$__sp_importResidualStatus"; }',
  '__sp_import_residual_parents_match || { exec 3<&-; return 1; }',
  '__sp_import_residual_exact_count',
  '[ "$__sp_importResidualExactCount" -eq 0 ] || { exec 3<&-; return 1; }',
  'exec 3<&-',
  '__sp_emit_import_cleanup 1 none'
].join('; ')

const digestCleanupBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_root || return $?',
  '__sp_digestScratch="/tmp/.shellpilot-digest-$__sp_rootDevice-$__sp_rootInode-$__sp_objectName"',
  'if [ ! -e "$__sp_digestScratch" ] && [ ! -L "$__sp_digestScratch" ]; then return 0; fi',
  '[ ! -L /tmp ] && [ -d /tmp ] || return 1',
  '__sp_digestTmpReal="$(realpath -- /tmp)" || return $?',
  '__sp_digestTmpReal="$' + '{__sp_digestTmpReal%?}"',
  '__sp_digestTmpReal="$' + '{__sp_digestTmpReal%?}"',
  '[ "$__sp_digestTmpReal" = /tmp ] || return 1',
  '[ "$(stat -c %u -- /tmp)" = 0 ] || return 1',
  '__sp_digestTmpMode="$(stat -c %a -- /tmp)" || return $?',
  'case "$__sp_digestTmpMode" in ""|*[!0-7]*) return 1 ;; esac',
  '[ "$((0$__sp_digestTmpMode & 01000))" -ne 0 ] || return 1',
  '[ ! -L "$__sp_digestScratch" ] && [ -d "$__sp_digestScratch" ] && [ "$(stat -c %u -- "$__sp_digestScratch")" = 0 ] && [ "$(stat -c %a -- "$__sp_digestScratch")" = 700 ] || return 1',
  'for __sp_digestEntry in input hash; do __sp_digestPath="$__sp_digestScratch/$__sp_digestEntry"; if [ -e "$__sp_digestPath" ] || [ -L "$__sp_digestPath" ]; then [ ! -L "$__sp_digestPath" ] && [ -p "$__sp_digestPath" ] && [ "$(stat -c %u -- "$__sp_digestPath")" = 0 ] && [ "$(stat -c %a -- "$__sp_digestPath")" = 600 ] || return 1; rm -f -- "$__sp_digestPath" || return $?; fi; done',
  'for __sp_digestEntry in producer.count consumer.count; do __sp_digestPath="$__sp_digestScratch/$__sp_digestEntry"; if [ -e "$__sp_digestPath" ] || [ -L "$__sp_digestPath" ]; then [ ! -L "$__sp_digestPath" ] && [ -f "$__sp_digestPath" ] && [ "$(stat -c %u -- "$__sp_digestPath")" = 0 ] && [ "$(stat -c %a -- "$__sp_digestPath")" = 600 ] || return 1; rm -f -- "$__sp_digestPath" || return $?; fi; done',
  'rmdir -- "$__sp_digestScratch"'
].join('; ')

const lstatBody = [
  'if [ "$__sp_path" = / ]; then __sp_lstatValue="$(stat -c "%f;%s;%X;%Y;%u;%g;%d;%i" -- /)" || return $?; __sp_lstatRootDevice="$(stat -c %d -- /)" || return $?; __sp_lstatRootInode="$(stat -c %i -- /)" || return $?; __sp_emit_data1 1 1 metadata "$(__sp_encode "$__sp_lstatValue;$__sp_lstatRootDevice;$__sp_lstatRootInode")"; return $?; fi;',
  '__sp_lstatParent="$' + '{__sp_path%/*}";',
  '[ -n "$__sp_lstatParent" ] || __sp_lstatParent=/;',
  '__sp_lstatName="$' + '{__sp_path##*/}";',
  '__sp_valid_name "$__sp_lstatName" || return 1;',
  '__sp_lstatParentReal="$(realpath -- "$__sp_lstatParent")" || return $?;',
  '__sp_lstatParentReal=$' + '{__sp_lstatParentReal%?};',
  '__sp_lstatParentReal=$' + '{__sp_lstatParentReal%?};',
  '[ "$__sp_lstatParentReal" = "$__sp_lstatParent" ] || return 1;',
  '[ ! -L "$__sp_lstatParent" ] && [ -d "$__sp_lstatParent" ] || return 1;',
  '__sp_lstatParentDevice="$(stat -c %d -- "$__sp_lstatParent")" || return $?;',
  '__sp_lstatParentInode="$(stat -c %i -- "$__sp_lstatParent")" || return $?;',
  'cd -- "$__sp_lstatParent" || return $?;',
  '[ "$(pwd -P)" = "$__sp_lstatParentReal" ] || return 1;',
  '[ "$(stat -c %d -- .)" = "$__sp_lstatParentDevice" ] || return 1;',
  '[ "$(stat -c %i -- .)" = "$__sp_lstatParentInode" ] || return 1;',
  'if [ -e "./$__sp_lstatName" ] || [ -L "./$__sp_lstatName" ]; then',
  '  __sp_lstatValue="$(stat -c "%f;%s;%X;%Y;%u;%g;%d;%i" -- "./$__sp_lstatName")" || return $?;',
  '  __sp_emit_data1 1 1 metadata "$(__sp_encode "$__sp_lstatValue;$__sp_lstatParentDevice;$__sp_lstatParentInode")";',
  'else',
  '  [ "$(stat -c %d -- .)" = "$__sp_lstatParentDevice" ] || return 1;',
  '  [ "$(stat -c %i -- .)" = "$__sp_lstatParentInode" ] || return 1;',
  '  [ "$(stat -c %d -- "$__sp_lstatParent")" = "$__sp_lstatParentDevice" ] || return 1;',
  '  [ "$(stat -c %i -- "$__sp_lstatParent")" = "$__sp_lstatParentInode" ] || return 1;',
  '  [ ! -e "./$__sp_lstatName" ] && [ ! -L "./$__sp_lstatName" ] || return 1;',
  '  __sp_emit_data1 1 1 missing "$(__sp_encode 1)";',
  'fi'
].join(' ')

const lstatBoundBody = [
  '__sp_bind_entry_parent "$__sp_path" "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || return $?;',
  'if [ -e "./$__sp_boundName" ] || [ -L "./$__sp_boundName" ]; then',
  '  __sp_lstatValue="$(stat -c "%f;%s;%X;%Y;%u;%g;%d;%i" -- "./$__sp_boundName")" || return $?;',
  '  [ "$(stat -c %d -- .)" = "$__sp_sourceParentDevice" ] || return 1;',
  '  [ "$(stat -c %i -- .)" = "$__sp_sourceParentInode" ] || return 1;',
  '  __sp_emit_data1 1 1 metadata "$(__sp_encode "$__sp_lstatValue;$__sp_sourceParentDevice;$__sp_sourceParentInode")";',
  'else',
  '  [ "$(stat -c %d -- .)" = "$__sp_sourceParentDevice" ] || return 1;',
  '  [ "$(stat -c %i -- .)" = "$__sp_sourceParentInode" ] || return 1;',
  '  [ ! -e "./$__sp_boundName" ] && [ ! -L "./$__sp_boundName" ] || return 1;',
  '  __sp_emit_data1 1 1 missing "$(__sp_encode 1)";',
  'fi'
].join(' ')

function createSha256BoundBody (range) {
  const sizeSetup = range
    ? [
        '[ "$__sp_offset" -le "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
        '__sp_windowSize=$((__sp_expectedSize - __sp_offset))',
        '[ "$__sp_windowSize" -le "$__sp_maxBytes" ] || __sp_windowSize="$__sp_maxBytes"'
      ]
    : ['__sp_offset=0', '__sp_windowSize="$__sp_expectedSize"']
  return [
    '[ "$__sp_expectedSize" -le "$__sp_maxSize" ] || return 1',
    '__sp_bind_entry_parent "$__sp_path" "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || return $?',
    '__sp_entry_matches "./$__sp_boundName" "$__sp_sourceDevice" "$__sp_sourceInode" file || return 1',
    'exec 3< "./$__sp_boundName" || return $?',
    '__sp_fd3="/proc/$$/fd/3"',
    '[ "$(stat -L -c %d -- "$__sp_fd3")" = "$__sp_sourceDevice" ] || { exec 3<&-; return 1; }',
    '[ "$(stat -L -c %i -- "$__sp_fd3")" = "$__sp_sourceInode" ] || { exec 3<&-; return 1; }',
    '__sp_openSourceSize="$(stat -L -c %s -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
    '[ "$__sp_openSourceSize" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
    ...sizeSetup,
    '__sp_bind_root || { exec 3<&-; return 1; }',
    '__sp_digest="$(__sp_bounded_digest "$__sp_offset" "$__sp_windowSize")" || { exec 3<&-; return 1; }',
    '[ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }',
    '[ "$(stat -L -c %d -- "$__sp_fd3")" = "$__sp_sourceDevice" ] || { exec 3<&-; return 1; }',
    '[ "$(stat -L -c %i -- "$__sp_fd3")" = "$__sp_sourceInode" ] || { exec 3<&-; return 1; }',
    '__sp_entry_matches "$__sp_path" "$__sp_sourceDevice" "$__sp_sourceInode" file || { exec 3<&-; return 1; }',
    '__sp_parent_path_matches "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || { exec 3<&-; return 1; }',
    '__sp_emit_digest "$__sp_digest" "$__sp_windowSize" || { exec 3<&-; return 1; }',
    'exec 3<&-'
  ].join('; ')
}

const sha256BoundBody = createSha256BoundBody(false)
const sha256RangeBoundBody = createSha256BoundBody(true)

const mkdirBoundBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return $?',
  '__sp_trusted_parent_fd . "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1',
  '[ ! -e "./$__sp_boundName" ] && [ ! -L "./$__sp_boundName" ] || return 1',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1',
  '__sp_createdDevice=',
  '__sp_createdInode=',
  '__sp_mkdirClaimed=0',
  '__sp_mkdir_cleanup() { [ "$__sp_mkdirClaimed" = 1 ] || return 1; [ -n "$__sp_createdDevice" ] && [ -n "$__sp_createdInode" ] || return 1; __sp_cleanup_created_directory; }',
  '__sp_mkdir_trap() { __sp_mkdirTrapStatus=$?; [ "$__sp_mkdirTrapStatus" -ne 0 ] || __sp_mkdirTrapStatus=1; trap - 0 HUP INT TERM; exec 5<&- 2>/dev/null; __sp_mkdir_cleanup >/dev/null 2>&1; exit "$__sp_mkdirTrapStatus"; }',
  'trap __sp_mkdir_trap 0 HUP INT TERM',
  'umask 077',
  'mkdir -- "./$__sp_boundName" || return $?',
  '__sp_mkdirClaimed=1',
  'exec 5< "./$__sp_boundName" || return $?',
  '__sp_fd5="/proc/$$/fd/5"',
  '[ -d "$__sp_fd5" ] || { exec 5<&-; return 1; }',
  '__sp_createdDevice="$(stat -L -c %d -- "$__sp_fd5")" || { exec 5<&-; return 1; }',
  '__sp_createdInode="$(stat -L -c %i -- "$__sp_fd5")" || { exec 5<&-; return 1; }',
  '[ "$(stat -L -c %a -- "$__sp_fd5")" = 700 ] || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_createdDevice" "$__sp_createdInode" directory || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd5" || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  'chmod -- "$__sp_targetMode" "$__sp_fd5" || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_createdDevice" "$__sp_createdInode" directory || { exec 5<&-; return 1; }',
  '[ "$(stat -L -c %u -- "$__sp_fd5")" = "$__sp_targetUid" ] || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '[ "$(stat -L -c %g -- "$__sp_fd5")" = "$__sp_targetGid" ] || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '[ "$(stat -L -c %a -- "$__sp_fd5")" = "$__sp_targetMode" ] || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_createdDevice" "$__sp_createdInode" directory || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  '__sp_emit_binding "$__sp_createdDevice" "$__sp_createdInode" || { __sp_cleanup_created_directory; exec 5<&-; return 1; }',
  'trap - 0 HUP INT TERM',
  'exec 5<&-'
].join('; ')

const metadataBoundBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return $?',
  '__sp_trusted_parent_fd . "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || return 1',
  'exec 5< "./$__sp_boundName" || return $?',
  '__sp_fd5="/proc/$$/fd/5"',
  '__sp_fd_entry_matches "$__sp_fd5" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd5" || { exec 5<&-; return 1; }',
  'chmod -- "$__sp_targetMode" "$__sp_fd5" || { exec 5<&-; return 1; }',
  '[ "$(stat -L -c %u -- "$__sp_fd5")" = "$__sp_targetUid" ] && [ "$(stat -L -c %g -- "$__sp_fd5")" = "$__sp_targetGid" ] && [ "$(stat -L -c %a -- "$__sp_fd5")" = "$__sp_targetMode" ] || { exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  'exec 5<&-'
].join('; ')

const touchBoundBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return $?',
  '__sp_trusted_parent_fd . "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || return 1',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || return 1',
  'exec 5< "./$__sp_boundName" || return $?',
  '__sp_fd5="/proc/$$/fd/5"',
  '__sp_fd_entry_matches "$__sp_fd5" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  'touch -c -- "$__sp_fd5" || { exec 5<&-; return 1; }',
  '__sp_fd_entry_matches "$__sp_fd5" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 5<&-; return 1; }',
  '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 5<&-; return 1; }',
  'exec 5<&-'
].join('; ')

const removeBoundBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return $?',
  '__sp_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return 1',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || return 1',
  'exec 3< "./$__sp_boundName" || return $?',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_fd_entry_matches "$__sp_fd3" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&-; return 1; }',
  '[ "$(stat -L -c %a -- "$__sp_fd3")" = "$__sp_targetMode" ] && [ "$(stat -L -c %u -- "$__sp_fd3")" = "$__sp_targetUid" ] && [ "$(stat -L -c %g -- "$__sp_fd3")" = "$__sp_targetGid" ] || { exec 3<&-; return 1; }',
  'if [ "$__sp_targetType" = file ]; then [ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }; __sp_rootDevice="$__sp_targetParentDevice"; __sp_rootInode="$__sp_targetParentInode"; __sp_objectName="$__sp_token-remove"; __sp_removeDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&-; return 1; }; __sp_removeSize="$(stat -L -c %s -- "$__sp_fd3")" || { exec 3<&-; return 1; }; [ "$__sp_removeDigest" = "$__sp_expectedSha256" ] && [ "$__sp_removeSize" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }; fi',
  '__sp_fd_entry_matches "$__sp_fd3" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&-; return 1; }',
  '__sp_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || { exec 3<&-; return 1; }',
  '__sp_entry_matches "./$__sp_boundName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&-; return 1; }',
  'if [ "$__sp_targetType" = file ]; then rm -- "./$__sp_boundName"; else rmdir -- "./$__sp_boundName"; fi',
  '__sp_removeStatus=$?',
  'exec 3<&-',
  'return "$__sp_removeStatus"'
].join('; ')

const removePeerBoundBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return $?',
  '__sp_targetName="$__sp_boundName"',
  '__sp_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || return 1',
  '__sp_entry_matches "./$__sp_targetName" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || return 1',
  'exec 3< "./$__sp_targetName" || return $?',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_fd_entry_matches "$__sp_fd3" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&-; return 1; }',
  '[ "$(stat -L -c %a -- "$__sp_fd3")" = "$__sp_targetMode" ] && [ "$(stat -L -c %u -- "$__sp_fd3")" = "$__sp_targetUid" ] && [ "$(stat -L -c %g -- "$__sp_fd3")" = "$__sp_targetGid" ] || { exec 3<&-; return 1; }',
  'if [ "$__sp_targetType" = file ]; then [ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }; __sp_rootDevice="$__sp_targetParentDevice"; __sp_rootInode="$__sp_targetParentInode"; __sp_objectName="$__sp_token-remove"; __sp_removeDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")" || { exec 3<&-; return 1; }; [ "$__sp_removeDigest" = "$__sp_expectedSha256" ] && [ "$(stat -L -c %s -- "$__sp_fd3")" = "$__sp_expectedSize" ] || { exec 3<&-; return 1; }; fi',
  'exec 8< . || { exec 3<&-; return $?; }',
  '__sp_fd8="/proc/$$/fd/8"',
  '__sp_fd_entry_matches "$__sp_fd8" "$__sp_targetParentDevice" "$__sp_targetParentInode" directory || { exec 3<&- 8<&-; return 1; }',
  '__sp_targetRef="$__sp_fd8/$__sp_targetName"',
  '__sp_bind_entry_parent "$__sp_peerPath" "$__sp_peerParentRealPath" "$__sp_peerParentDevice" "$__sp_peerParentInode" || { exec 3<&- 8<&-; return $?; }',
  '__sp_peerName="$__sp_boundName"',
  '__sp_parent_path_matches "$__sp_peerParentRealPath" "$__sp_peerParentDevice" "$__sp_peerParentInode" || { exec 3<&- 8<&-; return 1; }',
  '__sp_entry_matches "./$__sp_peerName" "$__sp_peerDevice" "$__sp_peerInode" "$__sp_peerType" || { exec 3<&- 8<&-; return 1; }',
  'exec 7< "./$__sp_peerName" || { exec 3<&- 8<&-; return $?; }',
  '__sp_fd7="/proc/$$/fd/7"',
  '__sp_fd_entry_matches "$__sp_fd7" "$__sp_peerDevice" "$__sp_peerInode" "$__sp_peerType" || { exec 3<&- 7<&- 8<&-; return 1; }',
  '[ "$(stat -L -c %a -- "$__sp_fd7")" = "$__sp_peerMode" ] && [ "$(stat -L -c %u -- "$__sp_fd7")" = "$__sp_peerUid" ] && [ "$(stat -L -c %g -- "$__sp_fd7")" = "$__sp_peerGid" ] || { exec 3<&- 7<&- 8<&-; return 1; }',
  'if [ "$__sp_peerType" = file ]; then [ "$(stat -L -c %s -- "$__sp_fd7")" = "$__sp_peerExpectedSize" ] || { exec 3<&- 7<&- 8<&-; return 1; }; __sp_rootDevice="$__sp_peerParentDevice"; __sp_rootInode="$__sp_peerParentInode"; __sp_objectName="$__sp_token-peer"; __sp_peerDigest="$(__sp_bounded_digest 0 "$__sp_peerExpectedSize" 7)" || { exec 3<&- 7<&- 8<&-; return 1; }; [ "$__sp_peerDigest" = "$__sp_peerExpectedSha256" ] && [ "$(stat -L -c %s -- "$__sp_fd7")" = "$__sp_peerExpectedSize" ] || { exec 3<&- 7<&- 8<&-; return 1; }; fi',
  '__sp_fd_entry_matches "$__sp_fd7" "$__sp_peerDevice" "$__sp_peerInode" "$__sp_peerType" || { exec 3<&- 7<&- 8<&-; return 1; }',
  '__sp_parent_path_matches "$__sp_peerParentRealPath" "$__sp_peerParentDevice" "$__sp_peerParentInode" || { exec 3<&- 7<&- 8<&-; return 1; }',
  '__sp_entry_matches "./$__sp_peerName" "$__sp_peerDevice" "$__sp_peerInode" "$__sp_peerType" || { exec 3<&- 7<&- 8<&-; return 1; }',
  '__sp_fd_entry_matches "$__sp_fd3" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&- 7<&- 8<&-; return 1; }',
  '__sp_fd_entry_matches "$__sp_fd8" "$__sp_targetParentDevice" "$__sp_targetParentInode" directory || { exec 3<&- 7<&- 8<&-; return 1; }',
  '__sp_entry_matches "$__sp_targetRef" "$__sp_targetDevice" "$__sp_targetInode" "$__sp_targetType" || { exec 3<&- 7<&- 8<&-; return 1; }',
  'if [ "$__sp_targetType" = file ]; then rm -- "$__sp_targetRef"; else rmdir -- "$__sp_targetRef"; fi',
  '__sp_removeStatus=$?',
  'exec 3<&- 7<&- 8<&-',
  'return "$__sp_removeStatus"'
].join('; ')

const renameBoundBody = [
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_entry_parent "$__sp_sourcePath" "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" || return $?',
  '__sp_sourceName="$__sp_boundName"',
  'exec 8< . || return $?',
  '__sp_fd8="/proc/$$/fd/8"',
  '__sp_trusted_parent_fd "$__sp_fd8" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" "$__sp_sourceParentUid" "$__sp_sourceParentMode" || { exec 8<&-; return 1; }',
  '__sp_sourceRef="$__sp_fd8/$__sp_sourceName"',
  '__sp_entry_matches "$__sp_sourceRef" "$__sp_sourceDevice" "$__sp_sourceInode" "$__sp_sourceType" || { exec 8<&-; return 1; }',
  'exec 7< "$__sp_sourceRef" || { exec 8<&-; return 1; }',
  '__sp_fd7="/proc/$$/fd/7"',
  '[ "$(stat -L -c %d -- "$__sp_fd7")" = "$__sp_sourceDevice" ] && [ "$(stat -L -c %i -- "$__sp_fd7")" = "$__sp_sourceInode" ] || { exec 7<&- 8<&-; return 1; }',
  '__sp_bind_entry_parent "$__sp_targetPath" "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" || { exec 7<&- 8<&-; return 1; }',
  '__sp_targetName="$__sp_boundName"',
  'exec 9< . || { exec 7<&- 8<&-; return 1; }',
  '__sp_fd9="/proc/$$/fd/9"',
  '__sp_trusted_parent_fd "$__sp_fd9" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" || { exec 7<&- 8<&- 9<&-; return 1; }',
  '__sp_targetRef="$__sp_fd9/$__sp_targetName"',
  '[ "$__sp_sourceDevice" = "$__sp_sourceParentDevice" ] && [ "$__sp_sourceDevice" = "$__sp_targetParentDevice" ] || { exec 7<&- 8<&- 9<&-; return 1; }',
  '__sp_rename_parents_match() { __sp_trusted_parent_fd "$__sp_fd8" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" "$__sp_sourceParentUid" "$__sp_sourceParentMode" && __sp_trusted_parent_fd "$__sp_fd9" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode" && __sp_trusted_parent_path_matches "$__sp_sourceParentRealPath" "$__sp_sourceParentDevice" "$__sp_sourceParentInode" "$__sp_sourceParentUid" "$__sp_sourceParentMode" && __sp_trusted_parent_path_matches "$__sp_targetParentRealPath" "$__sp_targetParentDevice" "$__sp_targetParentInode" "$__sp_targetParentUid" "$__sp_targetParentMode"; }',
  '__sp_rollback_rename() { [ ! -e "$__sp_sourceRef" ] && [ ! -L "$__sp_sourceRef" ] || return 0; __sp_entry_matches "$__sp_targetRef" "$__sp_sourceDevice" "$__sp_sourceInode" "$__sp_sourceType" || return 0; __sp_rename_parents_match || return 0; [ ! -e "$__sp_sourceRef" ] && [ ! -L "$__sp_sourceRef" ] || return 0; __sp_entry_matches "$__sp_targetRef" "$__sp_sourceDevice" "$__sp_sourceInode" "$__sp_sourceType" || return 0; mv -nT -- "$__sp_targetRef" "$__sp_sourceRef" >/dev/null 2>&1 || return 0; }',
  '__sp_rename_parents_match || { exec 7<&- 8<&- 9<&-; return 1; }',
  '__sp_entry_matches "$__sp_sourceRef" "$__sp_sourceDevice" "$__sp_sourceInode" "$__sp_sourceType" || { exec 7<&- 8<&- 9<&-; return 1; }',
  '[ ! -e "$__sp_targetRef" ] && [ ! -L "$__sp_targetRef" ] || { exec 7<&- 8<&- 9<&-; return 1; }',
  'mv -nT -- "$__sp_sourceRef" "$__sp_targetRef" || { exec 7<&- 8<&- 9<&-; return 1; }',
  'if [ ! -e "$__sp_sourceRef" ] && [ ! -L "$__sp_sourceRef" ] && __sp_entry_matches "$__sp_targetRef" "$__sp_sourceDevice" "$__sp_sourceInode" "$__sp_sourceType" && __sp_rename_parents_match; then __sp_status=0; else __sp_status=1; __sp_rollback_rename; fi',
  'exec 7<&- 8<&- 9<&-',
  'return "$__sp_status"'
].join('; ')

const operationBodies = Object.freeze({
  probe: ':',
  list: listBody,
  'list-bound': listBoundBody,
  lstat: lstatBody,
  'lstat-bound': lstatBoundBody,
  stat: '__sp_emit_stat "$__sp_path" stat',
  readlink: '__sp_emit_text "$(readlink -- "$__sp_path")"',
  realpath: '__sp_emit_text "$(realpath -- "$__sp_path")"',
  'mkdir-bound': mkdirBoundBody,
  'metadata-bound': metadataBoundBody,
  'touch-bound': touchBoundBody,
  'rename-bound': renameBoundBody,
  'remove-bound': removeBoundBody,
  'remove-peer-bound': removePeerBoundBody,
  'stage-handshake': stageHandshakeBody,
  'stage-export': stageExportBody,
  'stage-export-range': stageExportRangeBody,
  'stage-import': stageImportBody,
  'stage-import-cleanup': stageImportCleanupBody,
  'stage-cleanup': stageCleanupBody,
  'digest-cleanup': digestCleanupBody,
  // The legacy unbound digest request has no trusted size or inode contract.
  // Keep parsing compatibility but fail closed instead of reading to EOF.
  sha256: 'return 1',
  'sha256-bound': sha256BoundBody,
  'sha256-range-bound': sha256RangeBoundBody
})

export function createPrivilegedFileRequest ({ operation, args = {} } = {}) {
  if (!allowedOperations.has(operation)) {
    throw new Error(`不支持的 root 文件操作：${operation || '空'}`)
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('root 文件操作参数无效')
  }
  const normalized = {}
  for (const [key, value] of Object.entries(args)) {
    if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(key)) {
      throw new Error('root 文件操作参数名无效')
    }
    let text = String(value ?? '')
    if (text.includes('\u0000') || hasUnpairedSurrogate(text)) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
    if (text.length > 1024 * 1024) {
      throw new Error(`root 文件操作参数过长：${key}`)
    }
    if (['mode', 'rootMode', 'targetMode', 'sourceParentMode',
      'targetParentMode', 'tempParentMode', 'initialMode', 'peerMode']
      .includes(key) &&
      /^[0-7]{1,4}$/.test(text)) {
      text = text.replace(/^0+(?=[0-7])/, '')
    }
    if (['challenge', 'sha256', 'peerSha256'].includes(key) &&
      /^[a-fA-F0-9]{64}$/.test(text)) {
      text = text.toLowerCase()
    }
    normalized[key] = text
  }
  for (const [pathKey, parentKey] of [
    ['sourcePath', 'sourceParentRealPath'],
    ['path', 'sourceParentRealPath'],
    ['tempPath', 'tempParentRealPath'],
    ['targetPath', 'targetParentRealPath'],
    ['peerPath', 'peerParentRealPath']
  ]) {
    if (Object.hasOwn(normalized, pathKey) &&
      Object.hasOwn(normalized, parentKey) &&
      (!isCanonicalAbsoluteFilePath(normalized[pathKey]) ||
        !isCanonicalAbsoluteDirectoryPath(normalized[parentKey]) ||
        parentAbsolutePath(normalized[pathKey]) !== normalized[parentKey])) {
      throw new Error(`root 文件操作 ${parentKey} 绑定无效`)
    }
  }
  for (const key of [
    'size', 'peerSize', 'challengeSize', 'expectedSize', 'maxSize',
    'offset', 'maxBytes'
  ]) {
    if (Object.hasOwn(normalized, key) &&
      (!/^(?:0|[1-9]\d*)$/.test(normalized[key]) ||
        !Number.isSafeInteger(Number(normalized[key])))) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  if (Object.hasOwn(normalized, 'expectedSize') &&
    Number(normalized.expectedSize) > Number(normalized.maxSize)) {
    throw new Error('root 文件操作 expectedSize 超过 maxSize')
  }
  if (Object.hasOwn(normalized, 'maxBytes') &&
    (Number(normalized.maxBytes) < 1 || Number(normalized.maxBytes) > 65536)) {
    throw new Error('root 文件操作 maxBytes 超过 65536')
  }
  if (Object.hasOwn(normalized, 'challengeSize') &&
    (Number(normalized.challengeSize) < 1 ||
      Number(normalized.challengeSize) > 128)) {
    throw new Error('root 文件操作 challengeSize 超过 128')
  }
  if (Object.hasOwn(normalized, 'offset') &&
    Number(normalized.offset) > Number(normalized.expectedSize)) {
    throw new Error('root 文件操作 offset 超过 expectedSize')
  }
  if (['stage-import', 'stage-import-cleanup', 'stage-cleanup',
    'remove-bound', 'remove-peer-bound'].includes(operation) &&
    Number(normalized.size) > maxPrivilegedTransferBytes) {
    throw new Error('root 文件操作 size 超过传输上限')
  }
  if (operation === 'remove-peer-bound' &&
    Number(normalized.peerSize) > maxPrivilegedTransferBytes) {
    throw new Error('root 文件操作 peerSize 超过传输上限')
  }
  if (operation === 'stage-import-cleanup' && (
    Number(normalized.size) > Number(normalized.maxSize) ||
    Number(normalized.maxSize) > maxPrivilegedTransferBytes ||
    normalized.targetType !== 'file' ||
    normalized.tempPath === normalized.targetPath)) {
    throw new Error('root 文件操作 stage-import-cleanup proof 无效')
  }
  if (operation === 'stage-import-cleanup') {
    for (const key of [
      'rootDevice', 'rootInode', 'rootUid', 'rootGid',
      'tempParentDevice', 'tempParentInode', 'tempParentUid',
      'targetParentDevice', 'targetParentInode', 'targetParentUid',
      'targetDevice', 'targetInode', 'initialUid', 'initialGid',
      'targetUid', 'targetGid'
    ]) {
      if (!/^(?:0|[1-9]\d*)$/.test(normalized[key]) ||
        !Number.isSafeInteger(Number(normalized[key]))) {
        throw new Error(`root 文件操作参数值无效：${key}`)
      }
    }
    for (const key of [
      'rootMode', 'tempParentMode', 'targetParentMode',
      'initialMode', 'targetMode'
    ]) {
      if (!/^(?:0|[1-7][0-7]{0,3})$/.test(normalized[key])) {
        throw new Error(`root 文件操作参数值无效：${key}`)
      }
    }
  }
  if (operation === 'stage-export' &&
    Number(normalized.maxSize) > maxPrivilegedTransferBytes) {
    throw new Error('root 文件操作 maxSize 超过传输上限')
  }
  if (operation === 'stage-import' &&
    normalized.mustBeAbsent !== '1') {
    throw new Error('root 文件操作参数值无效：mustBeAbsent')
  }
  if (Object.keys(normalized).some(key =>
    !operationArguments[operation].includes(key))) {
    throw new Error('root 文件操作参数合同无效')
  }
  if ((operation.startsWith('stage-') ||
    ['sha256-bound', 'sha256-range-bound'].includes(operation)) &&
    Object.hasOwn(normalized, 'rootPath') &&
    !isCanonicalStageRootPath(normalized.rootPath)) {
    throw new Error('root 文件操作 rootPath 必须为规范绝对路径')
  }
  if ((operation.startsWith('stage-') ||
    ['sha256-bound', 'sha256-range-bound'].includes(operation)) &&
    Object.hasOwn(normalized, 'rootRealPath') &&
    (!isCanonicalStageRootPath(normalized.rootRealPath) ||
      normalized.rootRealPath !== normalized.rootPath)) {
    throw new Error('root 文件操作 rootRealPath 与 rootPath 不匹配')
  }
  if (['stage-import', 'stage-import-cleanup'].includes(operation) &&
    Object.hasOwn(normalized, 'targetPath') &&
    !isCanonicalAbsoluteFilePath(normalized.targetPath)) {
    throw new Error('root 文件操作 targetPath 必须为规范绝对路径')
  }
  return Object.freeze({
    operation,
    args: Object.freeze(normalized)
  })
}

const boundedDigestFunction = [
  '__sp_bounded_digest() { :',
  '__sp_digestOffset="$1"',
  '__sp_digestCount="$2"',
  '__sp_digestInputFd="$3"',
  'if [ -n "$__sp_digestInputFd" ]; then case "$__sp_digestInputFd" in [0-9]) : ;; *) return 1 ;; esac; exec 0<&"$__sp_digestInputFd" || return $?; __sp_digestFd=0; else __sp_digestFd=3; fi',
  '__sp_producerPid=',
  '__sp_consumerPid=',
  '__sp_digestCleanupReady=0',
  '__sp_digest_trap() { __sp_digestTrapStatus=$?; [ "$__sp_digestTrapStatus" -ne 0 ] || __sp_digestTrapStatus=1; trap - 0 HUP INT TERM; exec 4>&- 5>&- 6<&- 7>&- 8>&- 9<&- 2>/dev/null; if [ -n "$__sp_producerPid" ]; then kill "$__sp_producerPid" 2>/dev/null || :; wait "$__sp_producerPid" 2>/dev/null || :; fi; if [ -n "$__sp_consumerPid" ]; then kill "$__sp_consumerPid" 2>/dev/null || :; wait "$__sp_consumerPid" 2>/dev/null || :; fi; if [ "$__sp_digestCleanupReady" = 1 ]; then __sp_cleanup_digest >/dev/null 2>&1; fi; exit "$__sp_digestTrapStatus"; }',
  'trap __sp_digest_trap 0 HUP INT TERM',
  '__sp_scratchParent=/tmp',
  '[ ! -L "$__sp_scratchParent" ] && [ -d "$__sp_scratchParent" ] || return 1',
  '__sp_scratchParentReal="$(realpath -- "$__sp_scratchParent")" || return $?',
  '__sp_scratchParentReal="$' + '{__sp_scratchParentReal%?}"',
  '__sp_scratchParentReal="$' + '{__sp_scratchParentReal%?}"',
  '[ "$__sp_scratchParentReal" = "$__sp_scratchParent" ] || return 1',
  '[ "$(stat -c %u -- "$__sp_scratchParent")" = 0 ] || return 1',
  '__sp_scratchParentMode="$(stat -c %a -- "$__sp_scratchParent")" || return $?',
  'case "$__sp_scratchParentMode" in ""|*[!0-7]*) return 1 ;; esac',
  '[ "$((0$__sp_scratchParentMode & 01000))" -ne 0 ] || return 1',
  '__sp_scratch="$__sp_scratchParent/.shellpilot-digest-$__sp_rootDevice-$__sp_rootInode-$__sp_objectName"',
  '[ ! -e "$__sp_scratch" ] && [ ! -L "$__sp_scratch" ] || return 1',
  'umask 077',
  'mkdir -- "$__sp_scratch" || return $?',
  '__sp_scratchDevice="$(stat -c %d -- "$__sp_scratch")" || return 1',
  '__sp_scratchInode="$(stat -c %i -- "$__sp_scratch")" || return 1',
  '__sp_scratch_matches() { [ ! -L "$__sp_scratch" ] && [ -d "$__sp_scratch" ] && [ "$(stat -c %d -- "$__sp_scratch")" = "$__sp_scratchDevice" ] && [ "$(stat -c %i -- "$__sp_scratch")" = "$__sp_scratchInode" ] && [ "$(stat -c %u -- "$__sp_scratch")" = 0 ] && [ "$(stat -c %a -- "$__sp_scratch")" = 700 ]; }',
  '__sp_scratch_matches || return 1',
  '__sp_inputFifo="$__sp_scratch/input"',
  '__sp_hashFifo="$__sp_scratch/hash"',
  '__sp_producerReport="$__sp_scratch/producer.count"',
  '__sp_consumerReport="$__sp_scratch/consumer.count"',
  '__sp_fifo_matches() { [ ! -L "$1" ] && [ -p "$1" ] && [ "$(stat -c %d -- "$1")" = "$2" ] && [ "$(stat -c %i -- "$1")" = "$3" ] && [ "$(stat -c %u -- "$1")" = 0 ] && [ "$(stat -c %a -- "$1")" = 600 ]; }',
  '__sp_fifo_fd_matches() { [ -p "$1" ] && [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ] && [ "$(stat -L -c %u -- "$1")" = 0 ] && [ "$(stat -L -c %a -- "$1")" = 600 ]; }',
  '__sp_report_matches() { [ ! -L "$1" ] && [ -f "$1" ] && [ "$(stat -c %u -- "$1")" = 0 ] && [ "$(stat -c %a -- "$1")" = 600 ]; }',
  '__sp_cleanup_digest() { __sp_cleanupStatus=0; __sp_scratch_matches || return 1; if [ -n "$__sp_inputDevice" ] && __sp_fifo_matches "$__sp_inputFifo" "$__sp_inputDevice" "$__sp_inputInode"; then rm -f -- "$__sp_inputFifo" || __sp_cleanupStatus=1; elif [ -e "$__sp_inputFifo" ] || [ -L "$__sp_inputFifo" ]; then __sp_cleanupStatus=1; fi; if [ -n "$__sp_hashDevice" ] && __sp_fifo_matches "$__sp_hashFifo" "$__sp_hashDevice" "$__sp_hashInode"; then rm -f -- "$__sp_hashFifo" || __sp_cleanupStatus=1; elif [ -e "$__sp_hashFifo" ] || [ -L "$__sp_hashFifo" ]; then __sp_cleanupStatus=1; fi; for __sp_reportPath in "$__sp_producerReport" "$__sp_consumerReport"; do if __sp_report_matches "$__sp_reportPath"; then rm -f -- "$__sp_reportPath" || __sp_cleanupStatus=1; elif [ -e "$__sp_reportPath" ] || [ -L "$__sp_reportPath" ]; then __sp_cleanupStatus=1; fi; done; if [ "$__sp_cleanupStatus" -eq 0 ] && __sp_scratch_matches; then rmdir -- "$__sp_scratch" || __sp_cleanupStatus=1; fi; return "$__sp_cleanupStatus"; }',
  '__sp_fail_digest() { __sp_cleanup_digest >/dev/null 2>&1; return 1; }',
  '__sp_digestCleanupReady=1',
  'mkfifo -m 600 -- "$__sp_inputFifo" || { __sp_fail_digest; return 1; }',
  '__sp_inputDevice="$(stat -c %d -- "$__sp_inputFifo")" || { __sp_fail_digest; return 1; }',
  '__sp_inputInode="$(stat -c %i -- "$__sp_inputFifo")" || { __sp_fail_digest; return 1; }',
  '__sp_fifo_matches "$__sp_inputFifo" "$__sp_inputDevice" "$__sp_inputInode" || { __sp_fail_digest; return 1; }',
  'mkfifo -m 600 -- "$__sp_hashFifo" || { __sp_fail_digest; return 1; }',
  '__sp_hashDevice="$(stat -c %d -- "$__sp_hashFifo")" || { __sp_fail_digest; return 1; }',
  '__sp_hashInode="$(stat -c %i -- "$__sp_hashFifo")" || { __sp_fail_digest; return 1; }',
  '__sp_fifo_matches "$__sp_hashFifo" "$__sp_hashDevice" "$__sp_hashInode" || { __sp_fail_digest; return 1; }',
  'exec 4< "$__sp_scratch" || { __sp_fail_digest; return 1; }',
  '__sp_fd4="/dev/fd/4"',
  '[ -d "$__sp_fd4" ] && [ "$(stat -L -c %d -- "$__sp_fd4")" = "$__sp_scratchDevice" ] && [ "$(stat -L -c %i -- "$__sp_fd4")" = "$__sp_scratchInode" ] && [ "$(stat -L -c %u -- "$__sp_fd4")" = 0 ] && [ "$(stat -L -c %a -- "$__sp_fd4")" = 700 ] || { exec 4<&-; __sp_fail_digest; return 1; }',
  'exec 5<> "$__sp_inputFifo" || { exec 4<&-; __sp_fail_digest; return 1; }',
  'exec 6< "$__sp_inputFifo" || { exec 4<&- 5>&-; __sp_fail_digest; return 1; }',
  'exec 7> "$__sp_inputFifo" || { exec 4<&- 5>&- 6<&-; __sp_fail_digest; return 1; }',
  '__sp_fd5="/dev/fd/5"',
  '__sp_fd6="/dev/fd/6"',
  '__sp_fd7="/dev/fd/7"',
  '__sp_fifo_fd_matches "$__sp_fd5" "$__sp_inputDevice" "$__sp_inputInode" && __sp_fifo_fd_matches "$__sp_fd6" "$__sp_inputDevice" "$__sp_inputInode" && __sp_fifo_fd_matches "$__sp_fd7" "$__sp_inputDevice" "$__sp_inputInode" || { exec 4<&- 5>&- 6<&- 7>&-; __sp_fail_digest; return 1; }',
  'exec 8<> "$__sp_hashFifo" || { exec 4<&- 5>&- 6<&- 7>&-; __sp_fail_digest; return 1; }',
  'exec 9< "$__sp_hashFifo" || { exec 4<&- 5>&- 6<&- 7>&- 8>&-; __sp_fail_digest; return 1; }',
  '__sp_fd8="/dev/fd/8"',
  '__sp_fd9="/dev/fd/9"',
  '__sp_fifo_fd_matches "$__sp_fd8" "$__sp_hashDevice" "$__sp_hashInode" && __sp_fifo_fd_matches "$__sp_fd9" "$__sp_hashDevice" "$__sp_hashInode" || { exec 4<&- 5>&- 6<&- 7>&- 8>&- 9<&-; __sp_fail_digest; return 1; }',
  'exec 4<&-',
  'exec 4> "$__sp_hashFifo" || { exec 5>&- 6<&- 7>&- 8>&- 9<&-; __sp_fail_digest; return 1; }',
  '__sp_fd4="/dev/fd/4"',
  '__sp_fifo_fd_matches "$__sp_fd4" "$__sp_hashDevice" "$__sp_hashInode" || { exec 4>&- 5>&- 6<&- 7>&- 8>&- 9<&-; __sp_fail_digest; return 1; }',
  '__sp_scratch_matches && __sp_fifo_matches "$__sp_inputFifo" "$__sp_inputDevice" "$__sp_inputInode" && __sp_fifo_matches "$__sp_hashFifo" "$__sp_hashDevice" "$__sp_hashInode" || { exec 4>&- 5>&- 6<&- 7>&- 8>&- 9<&-; __sp_fail_digest; return 1; }',
  '( exec 4>&- 5>&- 6<&- 8>&- 9<&-; LC_ALL=C dd bs=65536 iflag=skip_bytes,count_bytes skip="$__sp_digestOffset" count="$__sp_digestCount" <&"$__sp_digestFd" >&7 2> "$__sp_producerReport" ) & __sp_producerPid=$!',
  '( exec 3<&- 5>&- 7>&- 8>&- 9<&-; LC_ALL=C dd bs=65536 iflag=count_bytes count="$__sp_digestCount" <&6 >&4 2> "$__sp_consumerReport" ) & __sp_consumerPid=$!',
  'exec 4>&- 5>&- 6<&- 7>&- 8>&-',
  '__sp_digestValue="$(__sp_sha256_stdin <&9)"',
  '__sp_hashStatus=$?',
  'exec 9<&-',
  'wait "$__sp_producerPid"',
  '__sp_producerStatus=$?',
  'wait "$__sp_consumerPid"',
  '__sp_consumerStatus=$?',
  '__sp_parse_dd_count() { __sp_ddReport="$(cat -- "$1")" || return $?; __sp_lineBreak="$(printf "\\nx")"; __sp_lineBreak="$' + '{__sp_lineBreak%x}"; __sp_ddLast="$' + '{__sp_ddReport##*"$__sp_lineBreak"}"; __sp_ddActual="$' + '{__sp_ddLast%% *}"; case "$__sp_ddActual" in ""|*[!0-9]*) return 1 ;; esac; printf %s "$__sp_ddActual"; }',
  '__sp_report_matches "$__sp_producerReport" && __sp_producerActualBytes="$(__sp_parse_dd_count "$__sp_producerReport")"',
  '__sp_producerReportStatus=$?',
  '__sp_report_matches "$__sp_consumerReport" && __sp_consumerActualBytes="$(__sp_parse_dd_count "$__sp_consumerReport")"',
  '__sp_consumerReportStatus=$?',
  '__sp_cleanup_digest',
  '__sp_cleanupStatus=$?',
  'trap - 0 HUP INT TERM',
  '[ "$__sp_hashStatus" -eq 0 ] && [ "$__sp_producerStatus" -eq 0 ] && [ "$__sp_consumerStatus" -eq 0 ] && [ "$__sp_producerReportStatus" -eq 0 ] && [ "$__sp_consumerReportStatus" -eq 0 ] && [ "$__sp_producerActualBytes" = "$__sp_digestCount" ] && [ "$__sp_consumerActualBytes" = "$__sp_digestCount" ] && [ "$__sp_cleanupStatus" -eq 0 ] || return 1',
  'printf %s "$__sp_digestValue"',
  '};'
].join('; ')

export function buildPrivilegedFileCommand ({ token: providedToken, request }) {
  const token = assertPtyTaskToken(providedToken)
  const normalized = assertRequestContract(createPrivilegedFileRequest(request))
  const decodeArguments = decodeCondition(normalized)
  const prepare = decodeArguments ? `${decodeArguments} && ` : ''
  const capabilityGuard = (requiredOperationCapabilities[normalized.operation] || [])
    .map(name => `[ "$${capabilityShellVariables[name]}" = 1 ]`)
    .join(' && ') || ':'
  const operationFinalizer = normalized.operation === 'stage-import'
    ? 'if command -v __sp_import_finalize >/dev/null 2>&1; then __sp_import_finalize "$__sp_status"; __sp_status=$?; else __sp_emit_import_cleanup 1 none || :; fi;'
    : ''
  const marker = '\\033]698;SHELLPILOT_FILE;%s'
  const functionalCapabilityProbe = [
    '__sp_clean_shell_cap=1;',
    '__sp_printf_cap=0; [ "$(printf %s shellpilot)" = shellpilot ] && __sp_printf_cap=1;',
    '__sp_id_cap=0; __sp_uid_effective="$(id -u 2>/dev/null)" && __sp_user_effective="$(id -un 2>/dev/null)" && __sp_gid_effective="$(id -g 2>/dev/null)" && case "$__sp_uid_effective:$__sp_gid_effective" in *[!0-9:]*|:*) : ;; *) [ -n "$__sp_user_effective" ] && __sp_id_cap=1 ;; esac;',
    '__sp_tr_cap=0; [ "$(printf x | tr x y 2>/dev/null)" = y ] && __sp_tr_cap=1;',
    '__sp_base64_cap=0; [ "$(printf shellpilot | base64 2>/dev/null | base64 -d 2>/dev/null)" = shellpilot ] && __sp_base64_cap=1;',
    '__sp_stat_cap=0; __sp_gnu_stat_cap=0; __sp_probe_stat="$(stat -c "%f;%s;%X;%Y;%u;%g" -- /dev/null 2>/dev/null)"; case "$__sp_probe_stat" in *";"*";"*";"*";"*";"*) __sp_stat_cap=1; __sp_gnu_stat_cap=1 ;; esac;',
    '__sp_sha256_cap=0; __sp_sha256_tool=none; __sp_probe_hash="$(printf x | sha256sum 2>/dev/null)"; case "$__sp_probe_hash" in 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881*) __sp_sha256_cap=1; __sp_sha256_tool=sha256sum ;; *) __sp_probe_hash="$(printf x | shasum -a 256 2>/dev/null)"; case "$__sp_probe_hash" in 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881*) __sp_sha256_cap=1; __sp_sha256_tool=shasum ;; esac ;; esac;',
    '__sp_realpath_cap=0; [ "$(realpath -- / 2>/dev/null)" = / ] && __sp_realpath_cap=1;',
    '__sp_find_cap=0; [ "$(find /dev/null -maxdepth 0 -printf x 2>/dev/null)" = x ] && __sp_find_cap=1;',
    '__sp_head_cap=0; [ "$(printf abc | head -c 1 2>/dev/null)" = a ] && __sp_head_cap=1;',
    '__sp_wc_cap=0; [ "$(printf x | wc -c 2>/dev/null | tr -d " \\r\\n")" = 1 ] && __sp_wc_cap=1;',
    '__sp_proc_fd_cap=0; __sp_readlink_cap=0; if exec 9</dev/null; then [ -r "/proc/$$/fd/9" ] && stat -L -c %i -- "/proc/$$/fd/9" >/dev/null 2>&1 && [ -r "/dev/fd/9" ] && stat -L -c %i -- "/dev/fd/9" >/dev/null 2>&1 && __sp_proc_fd_cap=1; [ -n "$(readlink -- "/proc/$$/fd/9" 2>/dev/null)" ] && __sp_readlink_cap=1; exec 9<&-; fi;',
    '__sp_noclobber_cap=0; __sp_cat_cap=0; __sp_gnu_mv_cap=0; __sp_chown_cap=0; __sp_chmod_cap=0; __sp_rm_cap=0; __sp_rmdir_cap=0; __sp_gnu_dd_cap=0; __sp_mkfifo_cap=0; __sp_touch_cap=0;',
    '__sp_probe_a="/tmp/.shellpilot-probe-$__sp_token-$$-a"; __sp_probe_b="/tmp/.shellpilot-probe-$__sp_token-$$-b"; __sp_probe_d="/tmp/.shellpilot-probe-$__sp_token-$$-d"; __sp_probe_f="/tmp/.shellpilot-probe-$__sp_token-$$-f";',
    'dd if=/dev/null of=/dev/null bs=1 iflag=skip_bytes,count_bytes skip=0 count=0 status=none 2>/dev/null && __sp_gnu_dd_cap=1;',
    'if [ ! -e "$__sp_probe_f" ] && [ ! -L "$__sp_probe_f" ] && mkfifo -m 600 -- "$__sp_probe_f" 2>/dev/null; then [ -p "$__sp_probe_f" ] && [ "$(stat -c %a -- "$__sp_probe_f" 2>/dev/null)" = 600 ] && __sp_mkfifo_cap=1; fi;',
    'rm -f -- "$__sp_probe_f" 2>/dev/null;',
    'if [ ! -e "$__sp_probe_a" ] && [ ! -L "$__sp_probe_a" ] && [ ! -e "$__sp_probe_b" ] && [ ! -L "$__sp_probe_b" ] && ( umask 077; set -C; printf x > "$__sp_probe_a" ) 2>/dev/null; then',
    '  if ! ( set -C; : > "$__sp_probe_a" ) 2>/dev/null; then __sp_noclobber_cap=1; fi;',
    '  [ "$(cat -- "$__sp_probe_a" 2>/dev/null)" = x ] && __sp_cat_cap=1;',
    '  touch -c -- "$__sp_probe_a" 2>/dev/null && __sp_touch_cap=1;',
    '  chmod -- 600 "$__sp_probe_a" 2>/dev/null && [ "$(stat -c %a -- "$__sp_probe_a" 2>/dev/null)" = 600 ] && __sp_chmod_cap=1;',
    '  chown -- "$__sp_uid_effective:$__sp_gid_effective" "$__sp_probe_a" 2>/dev/null && [ "$(stat -c %u:%g -- "$__sp_probe_a" 2>/dev/null)" = "$__sp_uid_effective:$__sp_gid_effective" ] && __sp_chown_cap=1;',
    '  if mv -T -- "$__sp_probe_a" "$__sp_probe_b" 2>/dev/null && [ -f "$__sp_probe_b" ] && ( umask 077; set -C; printf yy > "$__sp_probe_a" ) 2>/dev/null; then mv -nT -- "$__sp_probe_a" "$__sp_probe_b" 2>/dev/null && [ -f "$__sp_probe_a" ] && [ "$(stat -c %s -- "$__sp_probe_a" 2>/dev/null)" = 2 ] && [ "$(stat -c %s -- "$__sp_probe_b" 2>/dev/null)" = 1 ] && __sp_gnu_mv_cap=1; fi;',
    'fi;',
    'rm -f -- "$__sp_probe_a" "$__sp_probe_b" 2>/dev/null && [ ! -e "$__sp_probe_a" ] && [ ! -L "$__sp_probe_a" ] && [ ! -e "$__sp_probe_b" ] && [ ! -L "$__sp_probe_b" ] && __sp_rm_cap=1;',
    'if [ ! -e "$__sp_probe_d" ] && [ ! -L "$__sp_probe_d" ] && mkdir -- "$__sp_probe_d" 2>/dev/null; then rmdir -- "$__sp_probe_d" 2>/dev/null && [ ! -e "$__sp_probe_d" ] && [ ! -L "$__sp_probe_d" ] && __sp_rmdir_cap=1; fi;'
  ].join(' ')
  let innerScript
  if (normalized.operation === 'probe') {
    const compactCapabilityProbe = [
      'P=0; [ "$(printf %s x)" = x ] && P=1;',
      'I=0; U="$(id -u 2>/dev/null)" && N="$(id -un 2>/dev/null)" && G="$(id -g 2>/dev/null)" && case "$U:$G" in *[!0-9:]*|:*) : ;; *) [ -n "$N" ] && I=1 ;; esac;',
      'T=0; [ "$(printf x | tr x y 2>/dev/null)" = y ] && T=1;',
      'B=0; [ "$(printf x | base64 2>/dev/null | base64 -d 2>/dev/null)" = x ] && B=1;',
      'S=0; v="$(stat -c "%f;%s;%X;%Y;%u;%g" -- /dev/null 2>/dev/null)"; case "$v" in *";"*";"*";"*";"*";"*) S=1 ;; esac;',
      'A=0; v="$(printf x | sha256sum 2>/dev/null)"; case "$v" in 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881*) A=1 ;; *) v="$(printf x | shasum -a 256 2>/dev/null)"; case "$v" in 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881*) A=1 ;; esac ;; esac;',
      'R=0; [ "$(realpath -- / 2>/dev/null)" = / ] && R=1;',
      'F=0; [ "$(find /dev/null -maxdepth 0 -printf x 2>/dev/null)" = x ] && F=1;',
      'J=0; [ "$(printf abc | head -c 1 2>/dev/null)" = a ] && J=1;',
      'W=0; [ "$(printf x | wc -c 2>/dev/null | tr -d " \\r\\n")" = 1 ] && W=1;',
      'D=0; L=0; if exec 9</dev/null; then [ -r "/proc/$$/fd/9" ] && stat -L -c %i -- "/proc/$$/fd/9" >/dev/null 2>&1 && [ -r "/dev/fd/9" ] && stat -L -c %i -- "/dev/fd/9" >/dev/null 2>&1 && D=1; [ -n "$(readlink -- "/proc/$$/fd/9" 2>/dev/null)" ] && L=1; exec 9<&-; fi;',
      'O=0; C=0; V=0; H=0; M=0; X=0; Y=0; Q=0; K=0; Z=0;',
      'q="$SHELLPILOT_TOKEN"; a="/tmp/.sp-$q-$$-a"; b="/tmp/.sp-$q-$$-b"; d="/tmp/.sp-$q-$$-d"; f="/tmp/.sp-$q-$$-f";',
      'dd if=/dev/null of=/dev/null bs=1 iflag=skip_bytes,count_bytes skip=0 count=0 status=none 2>/dev/null && Q=1;',
      'if [ ! -e "$f" ] && [ ! -L "$f" ] && mkfifo -m 600 -- "$f" 2>/dev/null; then [ -p "$f" ] && [ "$(stat -c %a -- "$f" 2>/dev/null)" = 600 ] && K=1; fi; rm -f -- "$f" 2>/dev/null;',
      'if [ ! -e "$a" ] && [ ! -L "$a" ] && [ ! -e "$b" ] && [ ! -L "$b" ] && ( umask 077; set -C; printf x > "$a" ) 2>/dev/null; then',
      '  if ! ( set -C; : > "$a" ) 2>/dev/null; then O=1; fi; [ "$(cat -- "$a" 2>/dev/null)" = x ] && C=1; touch -c -- "$a" 2>/dev/null && Z=1; chmod -- 600 "$a" 2>/dev/null && [ "$(stat -c %a -- "$a" 2>/dev/null)" = 600 ] && M=1; chown -- "$U:$G" "$a" 2>/dev/null && [ "$(stat -c %u:%g -- "$a" 2>/dev/null)" = "$U:$G" ] && H=1;',
      '  if mv -T -- "$a" "$b" 2>/dev/null && [ -f "$b" ] && ( umask 077; set -C; printf yy > "$a" ) 2>/dev/null; then mv -nT -- "$a" "$b" 2>/dev/null && [ -f "$a" ] && [ "$(stat -c %s -- "$a" 2>/dev/null)" = 2 ] && [ "$(stat -c %s -- "$b" 2>/dev/null)" = 1 ] && V=1; fi;',
      'fi; rm -f -- "$a" "$b" 2>/dev/null && [ ! -e "$a" ] && [ ! -L "$a" ] && [ ! -e "$b" ] && [ ! -L "$b" ] && X=1; if [ ! -e "$d" ] && [ ! -L "$d" ] && mkdir -- "$d" 2>/dev/null; then rmdir -- "$d" 2>/dev/null && [ ! -e "$d" ] && [ ! -L "$d" ] && Y=1; fi;'
    ].join(' ')
    innerScript = [
      compactCapabilityProbe,
      'e() { printf %s "$1" | base64 | tr -d "\\r\\n"; };',
      'c="sh=1,cleanShell=1,printf=$P,id=$I,tr=$T,stat=$S,base64=$B,sha256=$A,procFd=$D,noclobber=$O,cat=$C,gnuStat=$S,gnuMv=$V,realpath=$R,readlink=$L,chown=$H,chmod=$M,rm=$X,rmdir=$Y,find=$F,head=$J,wc=$W,gnuDd=$Q,mkfifo=$K,touch=$Z";',
      's=125; if [ "$P$I$T$B" = 1111 ]; then',
      `  printf '${marker};start;%s;%s;%s\\007' "$q" "$(e "$U")" "$(e "$N")" "$(e "$c")";`,
      '  s=0;',
      `  printf '${marker};end;%s\\007' "$q" "$s";`,
      'else printf "root 文件操作参数或有效身份无效\\n"; fi; exit "$s"'
    ].join(' ')
  } else if (normalized.operation === 'list' || normalized.operation === 'list-bound') {
    const compactEnumerationBody = [
      'find . -mindepth 1 -maxdepth 1 -print >/dev/null 2>&1 || return $?;',
      'x="$( ( find . -mindepth 1 -maxdepth 1 -printf x 2>/dev/null; y=$?; [ "$y" -eq 0 ] && printf 0 || printf 1 ) | head -c 20001 )" || return $?;',
      'case "$x" in *0) x=$' + '{x%?} ;; *) return 1 ;; esac; case "$x" in *[!x]*) return 1 ;; esac; [ "$' + '{#x}" -le 20000 ] || return 1;',
      't=0; for e in ./.[!.]* ./..?* ./*; do [ -e "$e" ] || [ -L "$e" ] || continue; t=$((t + 1)); [ "$t" -le 20000 ] || return 1; done;',
      'j=0; b=0; for e in ./.[!.]* ./..?* ./*; do [ -e "$e" ] || [ -L "$e" ] || continue; j=$((j + 1)); [ "$j" -le "$t" ] && [ "$j" -le 20000 ] || return 1; n=$' + '{e##*/}; v="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$e")" || return $?; E "$j" "$t" "$n" "$v" || return $?; done'
    ].join(' ')
    const compactListBody = [
      'p="$__sp_path";',
      'r="$(realpath -- "$p")" || return $?; r=$' + '{r%?}; r=$' + '{r%?};',
      '[ "$r" = "$p" ] && [ ! -L "$p" ] && [ -d "$p" ] || return 1;',
      'd="$(stat -c %d -- "$p")" || return $?; i="$(stat -c %i -- "$p")" || return $?;',
      'cd -- "$p" || return $?;',
      'w="$(pwd -P && printf .)" || return $?; z="$(printf "\\n.")" || return $?;',
      'case "$w" in *"$z") w=$' + '{w%"$z"} ;; *) return 1 ;; esac;',
      'r="$(realpath -- .)" || return $?; r=$' + '{r%?}; r=$' + '{r%?}; [ "$r" = "$w" ] || return 1;',
      '[ "$(stat -c %d -- .)" = "$d" ] && [ "$(stat -c %i -- .)" = "$i" ] || return 1;',
      '[ "$(stat -c %d -- "$p")" = "$d" ] && [ "$(stat -c %i -- "$p")" = "$i" ] || return 1;',
      compactEnumerationBody
    ].join(' ')
    const compactBoundListBody = [
      'a=$' + '{p%/*}; [ -n "$a" ] || a=/; n=$' + '{p##*/};',
      'case "$n" in ""|"."|".."|*/*) return 1 ;; esac;',
      '[ "$a" = "$u" ] || return 1;',
      'r="$(realpath -- "$a")" || return $?; r=$' + '{r%?}; r=$' + '{r%?}; [ "$r" = "$a" ] || return 1;',
      '[ ! -L "$a" ] && [ -d "$a" ] || return 1; cd -- "$a" || return $?;',
      '[ "$(pwd -P)" = "$a" ] && [ "$(stat -c %d -- .)" = "$d" ] && [ "$(stat -c %i -- .)" = "$i" ] || return 1;',
      '[ ! -L "./$n" ] && [ -d "./$n" ] && [ "$(stat -c %d -- "./$n")" = "$o" ] && [ "$(stat -c %i -- "./$n")" = "$k" ] || return 1;',
      'cd -- "./$n" || return $?; [ "$(pwd -P)" = "$p" ] || return 1;',
      '[ "$(stat -c %d -- .)" = "$o" ] && [ "$(stat -c %i -- .)" = "$k" ] || return 1;',
      compactEnumerationBody
    ].join(' ')
    const browseCapabilityProbe = [
      'P=0; [ "$(printf %s x)" = x ] && P=1;',
      'I=0; U="$(id -u 2>/dev/null)" && N="$(id -un 2>/dev/null)" && G="$(id -g 2>/dev/null)" && case "$U:$G" in *[!0-9:]*|:*) : ;; *) [ -n "$N" ] && I=1 ;; esac;',
      'T=0; [ "$(printf x | tr x y 2>/dev/null)" = y ] && T=1;',
      'B=0; [ "$(printf x | base64 2>/dev/null | base64 -d 2>/dev/null)" = x ] && B=1;',
      'S=0; v="$(stat -c "%f;%s;%X;%Y;%u;%g" -- /dev/null 2>/dev/null)"; case "$v" in *";"*";"*";"*";"*";"*) S=1 ;; esac;',
      'R=0; [ "$(realpath -- / 2>/dev/null)" = / ] && R=1;',
      'F=0; [ "$(find /dev/null -maxdepth 0 -printf x 2>/dev/null)" = x ] && F=1;',
      'J=0; [ "$(printf abc | head -c 1 2>/dev/null)" = a ] && J=1;',
      'W=0; [ "$(printf x | wc -c 2>/dev/null | tr -d " \\r\\n")" = 1 ] && W=1;'
    ].join(' ')
    const selectedListBody = normalized.operation === 'list-bound'
      ? compactBoundListBody
      : compactListBody
    const selectedPrepare = normalized.operation === 'list-bound'
      ? [
          'p="$(__sp_decode "$A0")" && p=$' + '{p%?}',
          'u="$(__sp_decode "$A1")" && u=$' + '{u%?}',
          'd="$(__sp_decode "$A2")" && d=$' + '{d%?}',
          'i="$(__sp_decode "$A3")" && i=$' + '{i%?}',
          'o="$(__sp_decode "$A4")" && o=$' + '{o%?}',
          'k="$(__sp_decode "$A5")" && k=$' + '{k%?}'
        ].join(' && ')
      : decodeArguments
    innerScript = [
      'q="$SHELLPILOT_TOKEN";',
      browseCapabilityProbe,
      '__sp_decode() { printf %s "$1" | base64 -d || return $?; printf .; };',
      'e() { printf %s "$1" | base64 | tr -d "\\r\\n"; };',
      'realpath() { command realpath "$@" || return $?; printf .; };',
      `D() { printf '${marker};data;%s;%s;%s;%s;%s\\007' "$q" "$1" "$2" "$3" "$4" "$5"; };`,
      'E() { n="$(e "$3")" || return $?; v="$(e "$4")" || return $?; b=$((b + $' + '{#n} + $' + '{#v} + 128)); [ "$b" -le 4194304 ] || return 1; D "$1" "$2" entry "$n" "$v"; };',
      `L() { ${selectedListBody}; };`,
      `s=125; if [ "$P$I$T$B$S$R$F$J$W" = 111111111 ] && ${selectedPrepare} && :; then`,
      '  c="sh=1,cleanShell=1,printf=$P,id=$I,tr=$T,stat=$S,base64=$B,gnuStat=$S,realpath=$R,find=$F,head=$J,wc=$W";',
      `  printf '${marker};start;%s;%s;%s\\007' "$q" "$(e "$U")" "$(e "$N")" "$(e "$c")";`,
      '  L; s=$?;',
      `  printf '${marker};end;%s\\007' "$q" "$s";`,
      'else printf "root 文件操作参数或有效身份无效\\n"; fi; exit "$s"'
    ].join(' ')
  } else {
    innerScript = [
      '__sp_token="$SHELLPILOT_TOKEN";',
      functionalCapabilityProbe,
      '__sp_decode() { printf %s "$1" | base64 -d || return $?; printf .; };',
      '__sp_encode() { printf %s "$1" | base64 | tr -d "\\r\\n"; };',
      'readlink() { command readlink "$@" || return $?; printf .; };',
      'realpath() { command realpath "$@" || return $?; printf .; };',
      '__sp_sha256_raw() { case "$__sp_sha256_tool" in sha256sum) __sp_hash="$(sha256sum -- "$1")" || return $? ;; shasum) __sp_hash="$(shasum -a 256 -- "$1")" || return $? ;; *) return 1 ;; esac; printf %s "$' + '{__sp_hash%% *}"; };',
      '__sp_sha256_text() { case "$__sp_sha256_tool" in sha256sum) __sp_hash="$(printf %s "$1" | sha256sum)" || return $? ;; shasum) __sp_hash="$(printf %s "$1" | shasum -a 256)" || return $? ;; *) return 1 ;; esac; printf %s "$' + '{__sp_hash%% *}"; };',
      '__sp_sha256_stdin() { case "$__sp_sha256_tool" in sha256sum) __sp_hash="$(sha256sum)" || return $? ;; shasum) __sp_hash="$(shasum -a 256)" || return $? ;; *) return 1 ;; esac; printf %s "$' + '{__sp_hash%% *}"; };',
      '__sp_parse_dd_report_text() { __sp_ddReport="$1"; __sp_lineBreak="$(printf "\\nx")"; __sp_lineBreak="$' + '{__sp_lineBreak%x}"; __sp_ddLast="$' + '{__sp_ddReport##*"$__sp_lineBreak"}"; __sp_ddActual="$' + '{__sp_ddLast%% *}"; case "$__sp_ddActual" in ""|*[!0-9]*) return 1 ;; esac; printf %s "$__sp_ddActual"; };',
      boundedDigestFunction,
      '__sp_valid_name() { case "$1" in ""|"."|".."|*/*) return 1 ;; *) return 0 ;; esac; };',
      '__sp_bind_entry_parent() { __sp_boundPath="$1"; __sp_boundExpectedParent="$2"; __sp_boundExpectedDevice="$3"; __sp_boundExpectedInode="$4"; __sp_boundParent="$' + '{__sp_boundPath%/*}"; [ -n "$__sp_boundParent" ] || __sp_boundParent=/; __sp_boundName="$' + '{__sp_boundPath##*/}"; __sp_valid_name "$__sp_boundName" || return 1; [ "$__sp_boundParent" = "$__sp_boundExpectedParent" ] || return 1; __sp_boundActualReal="$(realpath -- "$__sp_boundParent")" || return $?; __sp_boundActualReal=$' + '{__sp_boundActualReal%?}; __sp_boundActualReal=$' + '{__sp_boundActualReal%?}; [ "$__sp_boundActualReal" = "$__sp_boundExpectedParent" ] || return 1; [ ! -L "$__sp_boundParent" ] && [ -d "$__sp_boundParent" ] || return 1; cd -- "$__sp_boundParent" || return $?; [ "$(pwd -P)" = "$__sp_boundExpectedParent" ] || return 1; [ "$(stat -c %d -- .)" = "$__sp_boundExpectedDevice" ] || return 1; [ "$(stat -c %i -- .)" = "$__sp_boundExpectedInode" ] || return 1; };',
      '__sp_entry_matches() { [ ! -L "$1" ] || return 1; case "$4" in file) [ -f "$1" ] ;; directory) [ -d "$1" ] ;; *) return 1 ;; esac && [ "$(stat -c %d -- "$1")" = "$2" ] && [ "$(stat -c %i -- "$1")" = "$3" ]; };',
      '__sp_fd_entry_matches() { case "$4" in file) [ -f "$1" ] ;; directory) [ -d "$1" ] ;; *) return 1 ;; esac && [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ]; };',
      '__sp_parent_path_matches() { [ ! -L "$1" ] && [ -d "$1" ] || return 1; __sp_parentActualReal="$(realpath -- "$1")" || return $?; __sp_parentActualReal=$' + '{__sp_parentActualReal%?}; __sp_parentActualReal=$' + '{__sp_parentActualReal%?}; [ "$__sp_parentActualReal" = "$1" ] && [ "$(stat -c %d -- "$1")" = "$2" ] && [ "$(stat -c %i -- "$1")" = "$3" ]; };',
      '__sp_trusted_parent_fd() { case "$5" in ""|*[!0-7]*) return 1 ;; esac; [ "$4" = 0 ] && [ "$((0$5 & 022))" -eq 0 ] && [ -d "$1" ] && [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ] && [ "$(stat -L -c %u -- "$1")" = "$4" ] && [ "$(stat -L -c %a -- "$1")" = "$5" ]; };',
      '__sp_trusted_parent_path_matches() { __sp_parent_path_matches "$1" "$2" "$3" && __sp_trusted_parent_fd "$1" "$2" "$3" "$4" "$5"; };',
      '__sp_cleanup_created_directory() { __sp_entry_matches "./$__sp_boundName" "$__sp_createdDevice" "$__sp_createdInode" directory || return 1; rmdir -- "./$__sp_boundName"; };',
      '__sp_bind_root() { __sp_valid_name "$__sp_objectName" || return 1; [ -d "/proc/$$/fd" ] || return 1; __sp_boundRealPath="$(realpath -- "$__sp_rootPath")" || return $?; __sp_boundRealPath=$' + '{__sp_boundRealPath%?}; __sp_boundRealPath=$' + '{__sp_boundRealPath%?}; [ "$__sp_boundRealPath" = "$__sp_rootPath" ] || return 1; [ "$__sp_boundRealPath" = "$__sp_rootRealPath" ] || return 1; [ ! -L "$__sp_rootPath" ] && [ -d "$__sp_rootPath" ] || return 1; cd -- "$__sp_rootPath" || return $?; [ "$(pwd -P)" = "$__sp_boundRealPath" ] || return 1; [ "$(stat -c %d -- .)" = "$__sp_rootDevice" ] || return 1; [ "$(stat -c %i -- .)" = "$__sp_rootInode" ] || return 1; [ "$(stat -c %a -- .)" = "$__sp_rootMode" ] || return 1; [ "$(stat -c %u -- .)" = "$__sp_rootUid" ] || return 1; [ "$(stat -c %g -- .)" = "$__sp_rootGid" ] || return 1; };',
      '__sp_path_matches_fd() { [ ! -L "$1" ] && [ -f "$1" ] && [ "$(stat -c %d -- "$1")" = "$2" ] && [ "$(stat -c %i -- "$1")" = "$3" ]; };',
      '__sp_cleanup_export() { if __sp_path_matches_fd "./$__sp_objectName" "$__sp_objectDevice" "$__sp_objectInode"; then rm -f -- "./$__sp_objectName"; fi; };',
    `__sp_emit_data1() { printf '${marker};data;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4"; };`,
    `__sp_emit_data2() { printf '${marker};data;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5"; };`,
    `__sp_emit_data3() { printf '${marker};data;%s;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5" "$6"; };`,
    `__sp_emit_data4() { printf '${marker};data;%s;%s;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5" "$6" "$7"; };`,
    `__sp_emit_data7() { printf '${marker};data;1;1;%s;%s;%s;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"; };`,
    '__sp_emit_entry() { __sp_name64="$(__sp_encode "$3")" || return $?; __sp_stat64="$(__sp_encode "$4")" || return $?; __sp_metadataBytes=$((__sp_metadataBytes + $' + '{#__sp_name64} + $' + '{#__sp_stat64} + 128)); [ "$__sp_metadataBytes" -le 4194304 ] || return 1; __sp_emit_data2 "$1" "$2" entry "$__sp_name64" "$__sp_stat64"; };',
    '__sp_emit_stat() { if [ "$2" = stat ]; then __sp_value="$(stat -L -c "%f;%s;%X;%Y;%u;%g" -- "$1")" || return $?; else __sp_value="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$1")" || return $?; fi; __sp_emit_data1 1 1 metadata "$(__sp_encode "$__sp_value")"; };',
    '__sp_emit_text() { __sp_value=$' + '{1%?}; __sp_value=$' + '{__sp_value%?}; [ -n "$__sp_value" ] || return 1; __sp_emit_data1 1 1 text "$(__sp_encode "$__sp_value")"; };',
    '__sp_emit_digest() { __sp_emit_data2 1 1 digest "$(__sp_encode "$1")" "$(__sp_encode "$2")"; };',
    '__sp_emit_temp_claim() { __sp_emit_data2 1 1 temp-claim "$(__sp_encode "$1")" "$(__sp_encode "$2")"; };',
    '__sp_emit_moving() { __sp_emit_data3 1 1 moving "$(__sp_encode "$1")" "$(__sp_encode "$2")" "$(__sp_encode "$3")"; };',
    '__sp_emit_install() { __sp_emit_data7 installed "$(__sp_encode "$1")" "$(__sp_encode "$2")" "$(__sp_encode "$3")" "$(__sp_encode "$4")" "$(__sp_encode "$5")" "$(__sp_encode "$6")" "$(__sp_encode "$7")"; };',
    '__sp_emit_import_cleanup() { __sp_emit_data2 1 1 import-cleanup "$(__sp_encode "$1")" "$(__sp_encode "$2")"; };',
    '__sp_emit_binding() { __sp_emit_data2 1 1 binding "$(__sp_encode "$1")" "$(__sp_encode "$2")"; };',
    '__sp_emit_handshake() { __sp_emit_data7 handshake "$(__sp_encode "$1")" "$(__sp_encode "$2")" "$(__sp_encode "$3")" "$(__sp_encode "$4")" "$(__sp_encode "$5")" "$(__sp_encode "$6")" "$(__sp_encode "$7")"; };',
    `__sp_run_operation() { ${operationBodies[normalized.operation]}; };`,
    '__sp_status=125;',
    `if [ "$__sp_printf_cap" = 1 ] && [ "$__sp_id_cap" = 1 ] && [ "$__sp_tr_cap" = 1 ] && [ "$__sp_base64_cap" = 1 ] && ${prepare}:; then`,
    '  __sp_caps="sh=1,cleanShell=$__sp_clean_shell_cap,printf=$__sp_printf_cap,id=$__sp_id_cap,tr=$__sp_tr_cap,stat=$__sp_stat_cap,base64=$__sp_base64_cap,sha256=$__sp_sha256_cap,procFd=$__sp_proc_fd_cap,noclobber=$__sp_noclobber_cap,cat=$__sp_cat_cap,gnuStat=$__sp_gnu_stat_cap,gnuMv=$__sp_gnu_mv_cap,realpath=$__sp_realpath_cap,readlink=$__sp_readlink_cap,chown=$__sp_chown_cap,chmod=$__sp_chmod_cap,rm=$__sp_rm_cap,rmdir=$__sp_rmdir_cap,find=$__sp_find_cap,head=$__sp_head_cap,wc=$__sp_wc_cap,gnuDd=$__sp_gnu_dd_cap,mkfifo=$__sp_mkfifo_cap,touch=$__sp_touch_cap";',
    `  printf '${marker};start;%s;%s;%s\\007' "$__sp_token" "$(__sp_encode "$__sp_uid_effective")" "$(__sp_encode "$__sp_user_effective")" "$(__sp_encode "$__sp_caps")";`,
    `  if ${capabilityGuard}; then __sp_run_operation; __sp_status=$?; ${operationFinalizer} else __sp_status=126; fi;`,
    `  printf '${marker};end;%s\\007' "$__sp_token" "$__sp_status";`,
    'else printf "root 文件操作参数或有效身份无效\\n"; fi;',
    'exit "$__sp_status"'
    ].join(' ')
  }
  const argumentEnvironment = normalized.operation === 'list-bound'
    ? operationArguments[normalized.operation].map((key, index) =>
        `A${index}=${shellQuote(
          encodeUtf8Base64(normalized.args[key])
        )}`)
    : operationArguments[normalized.operation].map(key =>
        `${argumentEnvironmentVariables[key]}=${shellQuote(
          encodeUtf8Base64(normalized.args[key])
        )}`)
  // `command` bypasses a shell function named /usr/bin/env. An effective-root
  // shell that replaces `command` or forges OSC is outside this PTY trust model.
  return [
    'command',
    '/usr/bin/env',
    '-i',
    'PATH=/usr/bin:/bin',
    `SHELLPILOT_TOKEN=${shellQuote(token)}`,
    ...argumentEnvironment,
    '/bin/sh',
    '-c',
    shellQuote(innerScript)
  ].join(' ')
}

function privilegedFilePlanError (message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function sha256HexUtf8 (value) {
  return createStreamingSha256()
    .update(new TextEncoder().encode(value))
    .digestHex()
}

function fileFrameAcknowledgement (
  token,
  sequence,
  total,
  digest,
  status = 'ok'
) {
  return `\u001b]698;SHELLPILOT_FILE_FRAME;${token};${sequence};${total};${digest};${status}\u0007`
}

function fileFrameAcknowledgementCommand (
  token,
  sequence,
  total,
  digest,
  status = 'ok'
) {
  return `printf '\\033]698;SHELLPILOT_FILE_FRAME;${token};${sequence};${total};${digest};${status}\\007'`
}

function freezePrivilegedFileFrame ({
  token,
  sequence,
  total,
  digest,
  command,
  executesOperation = false
}) {
  if (utf8ByteLength(command) > privilegedFilePtyFrameByteLimit) {
    throw privilegedFilePlanError(
      'root 文件协议 PTY 帧超过安全上限',
      'PRIVILEGED_FILE_PTY_FRAME_LIMIT'
    )
  }
  return Object.freeze({
    sequence,
    command,
    acknowledgement: fileFrameAcknowledgement(
      token,
      sequence,
      total,
      digest
    ),
    executesOperation
  })
}

function frameStateCleanupCommand () {
  return [
    'unset __sp_pf_t __sp_pf_h __sp_pf_n __sp_pf_i',
    '__sp_pf_z __sp_pf_b __sp_pf_c __sp_pf_v'
  ].join(' ')
}

export function buildPrivilegedFileExecutionPlan ({
  token: providedToken,
  request
}) {
  const token = assertPtyTaskToken(providedToken)
  const command = buildPrivilegedFileCommand({ token, request })
  const encodedCommand = encodeUtf8Base64(command)
  const digest = sha256HexUtf8(encodedCommand)
  if (utf8ByteLength(command) <= privilegedFilePtyFrameByteLimit) {
    return Object.freeze({
      kind: 'managed-pty-command-plan',
      version: 1,
      token,
      digest,
      commandBytes: utf8ByteLength(command),
      frames: Object.freeze([Object.freeze({
        sequence: 0,
        command,
        acknowledgement: null,
        executesOperation: true
      })]),
      cleanup: null
    })
  }
  if (encodedCommand.length > maxPrivilegedFilePlanEncodedBytes) {
    throw privilegedFilePlanError(
      'root 文件协议执行计划超过安全上限',
      'PRIVILEGED_FILE_PLAN_LIMIT'
    )
  }
  const chunks = []
  for (let offset = 0; offset < encodedCommand.length;
    offset += privilegedFilePlanChunkCharacters) {
    chunks.push(encodedCommand.slice(
      offset,
      offset + privilegedFilePlanChunkCharacters
    ))
  }
  if (chunks.length + 2 > maxPrivilegedFilePlanFrames) {
    throw privilegedFilePlanError(
      'root 文件协议执行计划超过安全上限',
      'PRIVILEGED_FILE_PLAN_LIMIT'
    )
  }
  const cleanupState = frameStateCleanupCommand()
  const frames = []
  const totalFrames = chunks.length + 2
  frames.push(freezePrivilegedFileFrame({
    token,
    sequence: 0,
    total: totalFrames,
    digest,
    command: [
      cleanupState + ';',
      `__sp_pf_t=${shellQuote(token)};`,
      `__sp_pf_h=${shellQuote(digest)};`,
      `__sp_pf_n=${chunks.length};`,
      '__sp_pf_i=0;',
      `__sp_pf_z=${encodedCommand.length};`,
      "__sp_pf_b='';",
      fileFrameAcknowledgementCommand(token, 0, totalFrames, digest)
    ].join(' ')
  }))
  for (const [index, chunk] of chunks.entries()) {
    const sequence = index + 1
    frames.push(freezePrivilegedFileFrame({
      token,
      sequence,
      total: totalFrames,
      digest,
      command: [
        `if [ "$__sp_pf_t" = ${shellQuote(token)} ] &&`,
        `[ "$__sp_pf_h" = ${shellQuote(digest)} ] &&`,
        `[ "$__sp_pf_n" -eq ${chunks.length} ] &&`,
        `[ "$__sp_pf_i" -eq ${index} ]; then`,
        '__sp_pf_b="$' + '{__sp_pf_b}' + chunk + '";',
        `__sp_pf_i=${sequence};`,
        fileFrameAcknowledgementCommand(
          token,
          sequence,
          totalFrames,
          digest
        ) + ';',
        'else',
        cleanupState + ';',
        fileFrameAcknowledgementCommand(
          token,
          sequence,
          totalFrames,
          digest,
          'error'
        ) + ';',
        'fi'
      ].join(' ')
    }))
  }
  const finalSequence = chunks.length + 1
  frames.push(freezePrivilegedFileFrame({
    token,
    sequence: finalSequence,
    total: totalFrames,
    digest,
    executesOperation: true,
    command: [
      `if [ "$__sp_pf_t" = ${shellQuote(token)} ] &&`,
      `[ "$__sp_pf_h" = ${shellQuote(digest)} ] &&`,
      `[ "$__sp_pf_i" -eq ${chunks.length} ] &&`,
      '[ "$__sp_pf_z" -eq "$' + '{#__sp_pf_b}" ]; then',
      '__sp_pf_v="$(printf %s "$__sp_pf_b" | sha256sum 2>/dev/null)" ||',
      '__sp_pf_v="$(printf %s "$__sp_pf_b" | shasum -a 256 2>/dev/null)";',
      '__sp_pf_v=$' + '{__sp_pf_v%% *};',
      `if [ "$__sp_pf_v" = ${shellQuote(digest)} ] &&`,
      '__sp_pf_c="$(printf %s "$__sp_pf_b" | base64 -d)"; then',
      cleanupState.replace(' __sp_pf_c', '') + ';',
      fileFrameAcknowledgementCommand(
        token,
        finalSequence,
        totalFrames,
        digest
      ) + ';',
      'eval "$__sp_pf_c"; __sp_pf_s=$?; unset __sp_pf_c; (exit "$__sp_pf_s");',
      'else',
      cleanupState + ';',
      fileFrameAcknowledgementCommand(
        token,
        finalSequence,
        totalFrames,
        digest,
        'error'
      ) + ';',
      'fi; else',
      cleanupState + ';',
      fileFrameAcknowledgementCommand(
        token,
        finalSequence,
        totalFrames,
        digest,
        'error'
      ) + ';',
      'fi'
    ].join(' ')
  }))
  const cleanupSequence = finalSequence + 1
  const cleanup = freezePrivilegedFileFrame({
    token,
    sequence: cleanupSequence,
    total: totalFrames,
    digest,
    command: [
      'if [ "$' + '{__sp_pf_t-}" = ' + shellQuote(token) + ' ]; then',
      cleanupState + ';',
      'fi;',
      fileFrameAcknowledgementCommand(
        token,
        cleanupSequence,
        totalFrames,
        digest
      )
    ].join(' ')
  })
  return Object.freeze({
    kind: 'managed-pty-command-plan',
    version: 1,
    token,
    digest,
    commandBytes: utf8ByteLength(command),
    frames: Object.freeze(frames),
    cleanup
  })
}

function parseUnsignedInteger (value, label) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`root 文件协议 ${label} 无效`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`root 文件协议 ${label} 无效`)
  }
  return parsed
}

function parseSignedInteger (value, label) {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`root 文件协议 ${label} 无效`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`root 文件协议 ${label} 无效`)
  }
  return parsed
}

function assertUnsignedIdentifier (value, label) {
  if (!/^(?:0|[1-9]\d{0,19})$/.test(value) ||
    (value.length === 20 && value > '18446744073709551615')) {
    throw new Error(`root 文件协议 ${label} 无效`)
  }
}

function parseCapabilities (value) {
  const text = decodeUtf8Base64(value, '能力')
  if (!text) throw new Error('root 文件协议能力无效')
  const result = {}
  for (const item of text.split(',')) {
    const match = /^([a-z][a-zA-Z0-9]{0,31})=([01])$/.exec(item)
    if (!match || Object.hasOwn(result, match[1])) {
      throw new Error('root 文件协议能力无效')
    }
    result[match[1]] = match[2] === '1'
  }
  return Object.freeze(result)
}

function modeType (mode) {
  switch (mode & 0xF000) {
    case 0x8000: return 'file'
    case 0x4000: return 'directory'
    case 0xA000: return 'symlink'
    case 0x1000: return 'fifo'
    case 0x2000: return 'character-device'
    case 0x6000: return 'block-device'
    case 0xC000: return 'socket'
    default: return 'other'
  }
}

function parseMetadata (encoded, path) {
  const fields = decodeUtf8Base64(encoded, '元数据').split(';')
  if (![6, 10].includes(fields.length) ||
    !/^[0-9a-fA-F]{1,4}$/.test(fields[0])) {
    throw new Error('root 文件协议 mode 无效')
  }
  const mode = Number.parseInt(fields[0], 16)
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0xFFFF) {
    throw new Error('root 文件协议 mode 无效')
  }
  const result = {
    mode,
    type: modeType(mode),
    size: parseUnsignedInteger(fields[1], 'size'),
    atime: parseSignedInteger(fields[2], 'atime'),
    mtime: parseSignedInteger(fields[3], 'mtime'),
    uid: parseUnsignedInteger(fields[4], 'uid'),
    gid: parseUnsignedInteger(fields[5], 'gid')
  }
  if (fields.length === 10) {
    for (const [value, label] of [
      [fields[6], 'device'], [fields[7], 'inode'],
      [fields[8], 'parent device'], [fields[9], 'parent inode']
    ]) assertUnsignedIdentifier(value, label)
    result.device = fields[6]
    result.inode = fields[7]
    result.parentRealPath = parentAbsolutePath(path)
    result.parentDevice = fields[8]
    result.parentInode = fields[9]
  }
  return Object.freeze(result)
}

export function createPrivilegedFileParser ({ token: providedToken, request }) {
  const token = assertPtyTaskToken(providedToken)
  const normalized = createPrivilegedFileRequest(request)
  const namespacePrefix = '\u001b]698;SHELLPILOT_FILE;'
  let pending = ''
  let hasStarted = false
  let hasEnded = false
  let effectiveIdentity = null
  let completedExitCode = null
  let capabilities = null
  let expectedTotal = null
  let nextSequence = 1
  const entries = []
  let structuredData = null
  let importTempClaim = null
  let importMovingClaim = null
  let importTargetClaim = null
  let importCleanupStatus = null
  let trustedMetadataBytes = 0

  const mutationOperations = new Set([
    'probe', 'remove-bound', 'remove-peer-bound',
    'rename-bound', 'metadata-bound', 'touch-bound',
    'stage-cleanup', 'digest-cleanup'
  ])

  function consumeStart (fields) {
    if (hasStarted || hasEnded || fields.length !== 4) {
      throw new Error('root 文件协议开始边界无效')
    }
    const uid = decodeUtf8Base64(fields[1], '身份 uid')
    const username = decodeUtf8Base64(fields[2], '身份用户名')
    if (!/^(?:0|[1-9]\d*)$/.test(uid) || !Number.isSafeInteger(Number(uid)) ||
      !username || username.length > 256 ||
      Array.from(username).some(char => {
        const code = char.codePointAt(0)
        return code <= 0x1F || code === 0x7F
      })) {
      throw new Error('root 文件协议有效身份无效')
    }
    capabilities = parseCapabilities(fields[3])
    effectiveIdentity = Object.freeze({ uid, username })
    hasStarted = true
  }

  function consumeData (fields) {
    if (!hasStarted || hasEnded || fields.length < 5) {
      throw new Error('root 文件协议数据边界无效')
    }
    const sequence = parseUnsignedInteger(fields[1], '数据序号')
    const total = parseUnsignedInteger(fields[2], '数据总数')
    const importStateMarker = normalized.operation === 'stage-import'
    if (importStateMarker) {
      if (sequence !== 1 || total !== 1 || importCleanupStatus) {
        throw new Error('root 文件协议 stage-import 状态顺序无效')
      }
    } else {
      if (sequence !== nextSequence || sequence < 1 || total < 1 ||
        sequence > total || (expectedTotal !== null && total !== expectedTotal)) {
        throw new Error('root 文件协议数据顺序无效')
      }
      expectedTotal = total
      nextSequence += 1
    }
    const kind = fields[3]
    const payload = fields.slice(4)
    if (['list', 'list-bound'].includes(normalized.operation)) {
      if (kind !== 'entry' || payload.length !== 2 || total > 20000) {
        throw new Error('root 文件协议数据类型无效')
      }
      const name = decodeUtf8Base64(payload[0], '文件名')
      if (!name || name === '.' || name === '..' ||
        name.includes('/') || name.includes('\u0000')) {
        throw new Error('root 文件协议文件名无效')
      }
      entries.push(Object.freeze({ name, ...parseMetadata(payload[1]) }))
      return
    }
    if (normalized.operation === 'stage-import-cleanup') {
      if (kind !== 'import-cleanup' || payload.length !== 2 ||
        decodeUtf8Base64(payload[0], 'cleanup status') !== '1' ||
        decodeUtf8Base64(payload[1], 'residual location') !== 'none') {
        throw new Error('root 文件协议 stage-import-cleanup status 无效')
      }
      structuredData = Object.freeze({
        cleanupSucceeded: true,
        residualLocation: 'none'
      })
      return
    }
    if (normalized.operation === 'stage-import') {
      if (kind === 'temp-claim') {
        if (payload.length !== 2 || importTempClaim || importMovingClaim ||
          importTargetClaim) {
          throw new Error('root 文件协议 stage-import temp claim 无效')
        }
        const tempDevice = decodeUtf8Base64(payload[0], 'temp device')
        const tempInode = decodeUtf8Base64(payload[1], 'temp inode')
        assertUnsignedIdentifier(tempDevice, 'temp device')
        assertUnsignedIdentifier(tempInode, 'temp inode')
        const parent = normalized.args.targetParentRealPath
        importTempClaim = Object.freeze({
          tempPath: `${parent === '/' ? '' : parent}/.shellpilot-${normalized.args.objectName}.tmp`,
          tempDevice,
          tempInode,
          tempType: 'file',
          tempParentRealPath: parent,
          tempParentDevice: normalized.args.targetParentDevice,
          tempParentInode: normalized.args.targetParentInode
        })
      } else if (kind === 'moving') {
        if (payload.length !== 3 || !importTempClaim || importMovingClaim ||
          importTargetClaim) {
          throw new Error('root 文件协议 stage-import moving claim 无效')
        }
        const tempDevice = decodeUtf8Base64(payload[0], 'moving temp device')
        const tempInode = decodeUtf8Base64(payload[1], 'moving temp inode')
        const initialGid = decodeUtf8Base64(payload[2], 'moving initial gid')
        assertUnsignedIdentifier(tempDevice, 'moving temp device')
        assertUnsignedIdentifier(tempInode, 'moving temp inode')
        const parsedInitialGid = parseUnsignedInteger(initialGid, 'moving initial gid')
        if (tempDevice !== importTempClaim.tempDevice ||
          tempInode !== importTempClaim.tempInode) {
          throw new Error('root 文件协议 stage-import moving inode 无效')
        }
        const parent = normalized.args.targetParentRealPath
        const parentMode = Number.parseInt(normalized.args.targetParentMode, 8)
        const parentUid = parseUnsignedInteger(
          normalized.args.targetParentUid,
          'moving parent uid'
        )
        importMovingClaim = Object.freeze({
          tempPath: importTempClaim.tempPath,
          targetPath: normalized.args.targetPath,
          tempDevice,
          tempInode,
          tempType: 'file',
          tempParentRealPath: parent,
          tempParentDevice: normalized.args.targetParentDevice,
          tempParentInode: normalized.args.targetParentInode,
          tempParentUid: parentUid,
          tempParentMode: parentMode,
          targetParentRealPath: parent,
          targetParentDevice: normalized.args.targetParentDevice,
          targetParentInode: normalized.args.targetParentInode,
          targetParentUid: parentUid,
          targetParentMode: parentMode,
          sha256: normalized.args.sha256,
          size: parseUnsignedInteger(normalized.args.size, 'moving size'),
          initialMode: 0,
          initialUid: 0,
          initialGid: parsedInitialGid,
          targetMode: Number.parseInt(normalized.args.targetMode, 8),
          targetUid: parseUnsignedInteger(normalized.args.targetUid, 'moving target uid'),
          targetGid: parseUnsignedInteger(normalized.args.targetGid, 'moving target gid')
        })
      } else if (kind === 'installed') {
        if (payload.length !== 7 || importTargetClaim || !importTempClaim ||
          !importMovingClaim) {
          throw new Error('root 文件协议 stage-import installed temp claim 无效')
        }
        const sha256 = decodeUtf8Base64(payload[0], 'SHA-256')
        const size = decodeUtf8Base64(payload[1], 'size')
        const targetDevice = decodeUtf8Base64(payload[2], 'target device')
        const targetInode = decodeUtf8Base64(payload[3], 'target inode')
        const mode = decodeUtf8Base64(payload[4], 'target mode')
        const uid = decodeUtf8Base64(payload[5], 'target uid')
        const gid = decodeUtf8Base64(payload[6], 'target gid')
        if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
          throw new Error('root 文件协议 SHA-256 无效')
        }
        assertUnsignedIdentifier(targetDevice, 'target device')
        assertUnsignedIdentifier(targetInode, 'target inode')
        if (!/^(?:0|[1-7][0-7]{0,3})$/.test(mode)) {
          throw new Error('root 文件协议 target mode 无效')
        }
        const parsedSize = parseUnsignedInteger(size, 'size')
        const parsedUid = parseUnsignedInteger(uid, 'uid')
        const parsedGid = parseUnsignedInteger(gid, 'gid')
        if (targetDevice !== importMovingClaim.tempDevice ||
          targetInode !== importMovingClaim.tempInode ||
          sha256.toLowerCase() !== importMovingClaim.sha256 ||
          parsedSize !== importMovingClaim.size ||
          Number.parseInt(mode, 8) !== importMovingClaim.targetMode ||
          parsedUid !== importMovingClaim.targetUid ||
          parsedGid !== importMovingClaim.targetGid) {
          throw new Error('root 文件协议 stage-import installed moving claim 无效')
        }
        importTargetClaim = Object.freeze({
          targetPath: normalized.args.targetPath,
          targetDevice,
          targetInode,
          targetType: 'file',
          targetParentRealPath: normalized.args.targetParentRealPath,
          targetParentDevice: normalized.args.targetParentDevice,
          targetParentInode: normalized.args.targetParentInode,
          sha256: sha256.toLowerCase(),
          size: parsedSize,
          mode: Number.parseInt(mode, 8),
          uid: parsedUid,
          gid: parsedGid
        })
      } else if (kind === 'import-cleanup') {
        if (payload.length !== 2) {
          throw new Error('root 文件协议 stage-import cleanup 无效')
        }
        const succeeded = decodeUtf8Base64(payload[0], 'cleanup status')
        const residualLocation = decodeUtf8Base64(payload[1], 'residual location')
        if (!['0', '1'].includes(succeeded) ||
          (succeeded === '1' && !['none', 'complete'].includes(residualLocation)) ||
          (succeeded === '0' && !['temp', 'moving', 'target', 'unknown'].includes(residualLocation)) ||
          (residualLocation === 'temp' &&
            (!importTempClaim || importMovingClaim)) ||
          (residualLocation === 'moving' &&
            (!importMovingClaim || importTargetClaim)) ||
          (residualLocation === 'target' && !importTargetClaim) ||
          (residualLocation === 'complete' && !importTargetClaim)) {
          throw new Error('root 文件协议 stage-import cleanup 状态无效')
        }
        importCleanupStatus = Object.freeze({
          cleanupSucceeded: succeeded === '1',
          residualLocation
        })
      } else {
        throw new Error('root 文件协议数据类型无效')
      }
      structuredData = Object.freeze({
        ...(importTempClaim ? { tempClaim: importTempClaim } : {}),
        ...(importMovingClaim ? { movingClaim: importMovingClaim } : {}),
        ...(importTargetClaim
          ? {
              sha256: importTargetClaim.sha256,
              size: importTargetClaim.size,
              targetDevice: importTargetClaim.targetDevice,
              targetInode: importTargetClaim.targetInode,
              targetClaim: importTargetClaim
            }
          : {}),
        ...(importCleanupStatus || {})
      })
      return
    }
    if (total !== 1 || sequence !== 1 || structuredData !== null) {
      throw new Error('root 文件协议数据数量无效')
    }
    if (['lstat', 'lstat-bound', 'stat'].includes(normalized.operation)) {
      if (['lstat', 'lstat-bound'].includes(normalized.operation) &&
        kind === 'missing' &&
        payload.length === 1 && decodeUtf8Base64(payload[0], '缺失标记') === '1') {
        structuredData = Object.freeze({ missing: true })
        return
      }
      if (kind !== 'metadata' || payload.length !== 1) {
        throw new Error('root 文件协议数据类型无效')
      }
      structuredData = Object.freeze({
        metadata: parseMetadata(payload[0], normalized.args.path)
      })
      return
    }
    if (normalized.operation === 'readlink' || normalized.operation === 'realpath') {
      if (kind !== 'text' || payload.length !== 1) {
        throw new Error('root 文件协议数据类型无效')
      }
      const text = decodeUtf8Base64(payload[0], '文本')
      if (!text || text.includes('\u0000')) {
        throw new Error('root 文件协议文本无效')
      }
      structuredData = Object.freeze({ text })
      return
    }
    if (normalized.operation === 'stage-handshake') {
      if (kind !== 'handshake' || payload.length !== 7) {
        throw new Error('root 文件协议数据类型无效')
      }
      const response = decodeUtf8Base64(payload[0], '握手响应')
      const uid = decodeUtf8Base64(payload[1], '握手 uid')
      const gid = decodeUtf8Base64(payload[2], '握手 gid')
      const mode = decodeUtf8Base64(payload[3], '握手 mode')
      const rootRealPath = decodeUtf8Base64(payload[4], '握手真实路径')
      const rootDevice = decodeUtf8Base64(payload[5], '握手 device')
      const rootInode = decodeUtf8Base64(payload[6], '握手 inode')
      if (!/^[a-fA-F0-9]{64}$/.test(response) ||
        mode !== '700' || !rootRealPath.startsWith('/') ||
        rootRealPath.includes('\u0000')) {
        throw new Error('root 文件协议握手数据无效')
      }
      parseUnsignedInteger(uid, 'uid')
      parseUnsignedInteger(gid, 'gid')
      assertUnsignedIdentifier(rootDevice, 'device')
      assertUnsignedIdentifier(rootInode, 'inode')
      structuredData = Object.freeze({
        response: response.toLowerCase(),
        uid,
        gid,
        mode,
        rootRealPath,
        rootDevice,
        rootInode
      })
      return
    }
    if (['stage-export', 'stage-export-range', 'sha256', 'sha256-bound',
      'sha256-range-bound'].includes(normalized.operation)) {
      if (kind !== 'digest' || payload.length !== 2) {
        throw new Error('root 文件协议数据类型无效')
      }
      const sha256 = decodeUtf8Base64(payload[0], 'SHA-256')
      const size = decodeUtf8Base64(payload[1], 'size')
      if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
        throw new Error('root 文件协议 SHA-256 无效')
      }
      structuredData = Object.freeze({
        sha256: sha256.toLowerCase(),
        size: parseUnsignedInteger(size, 'size')
      })
      return
    }
    if (normalized.operation === 'mkdir-bound') {
      if (kind !== 'binding' || payload.length !== 2) {
        throw new Error('root 文件协议数据类型无效')
      }
      const device = decodeUtf8Base64(payload[0], 'device')
      const inode = decodeUtf8Base64(payload[1], 'inode')
      assertUnsignedIdentifier(device, 'device')
      assertUnsignedIdentifier(inode, 'inode')
      structuredData = Object.freeze({ device, inode })
      return
    }
    throw new Error('root 文件协议数据类型无效')
  }

  function consumeEnd (fields) {
    if (!hasStarted || hasEnded || fields.length !== 2 ||
      !/^(?:0|[1-9]\d*)$/.test(fields[1])) {
      throw new Error('root 文件协议结束边界无效')
    }
    const exitCode = Number(fields[1])
    const requiresData = !mutationOperations.has(normalized.operation) &&
      !['list', 'list-bound'].includes(normalized.operation)
    const requiredCapabilities = requiredOperationCapabilities[normalized.operation] || []
    const missingCapability = requiredCapabilities.some(name =>
      capabilities[name] !== true)
    if (exitCode === 0 && missingCapability) {
      throw new Error('root 文件协议缺少必要能力')
    }
    const invalidImportState = normalized.operation === 'stage-import' && (
      !importCleanupStatus ||
      (exitCode === 0 && (
        importCleanupStatus.cleanupSucceeded !== true ||
        importCleanupStatus.residualLocation !== 'complete' ||
        !importTargetClaim || !importMovingClaim)) ||
      (exitCode !== 0 && importCleanupStatus.cleanupSucceeded === true &&
        importCleanupStatus.residualLocation !== 'none'))
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255 ||
      (expectedTotal !== null && nextSequence !== expectedTotal + 1) ||
      (exitCode === 0 && requiresData && structuredData === null) ||
      invalidImportState) {
      throw new Error('root 文件协议结束边界无效')
    }
    completedExitCode = exitCode
    hasEnded = true
  }

  function consumeMarker (value) {
    const fields = value.split(';')
    if (fields[0] === 'start') return consumeStart(fields)
    if (fields[0] === 'data') return consumeData(fields)
    if (fields[0] === 'end') return consumeEnd(fields)
    throw new Error('root 文件协议边界阶段无效')
  }

  function consumePending () {
    while (pending) {
      const markerStart = pending.indexOf(namespacePrefix)
      if (markerStart < 0) {
        pending = pending.slice(
          Math.max(0, pending.length - namespacePrefix.length + 1)
        )
        break
      }
      pending = pending.slice(markerStart)
      const markerEnd = pending.indexOf('\u0007')
      if (markerEnd < 0) {
        if (utf8ByteLength(pending) > 2048) {
          throw new Error('root 文件协议边界过长')
        }
        break
      }
      const markerBytes = utf8ByteLength(pending.slice(0, markerEnd + 1))
      if (markerBytes > 2048) {
        throw new Error('root 文件协议边界过长')
      }
      const markerPayload = pending.slice(namespacePrefix.length, markerEnd)
      pending = pending.slice(markerEnd + 1)
      const tokenEnd = markerPayload.indexOf(';')
      if (tokenEnd < 0 || markerPayload.slice(0, tokenEnd) !== token) {
        throw new Error('root 文件协议 token 不匹配')
      }
      const marker = markerPayload.slice(tokenEnd + 1)
      trustedMetadataBytes += markerBytes
      if (trustedMetadataBytes > 4 * 1024 * 1024) {
        throw new Error('root 文件协议累计元数据过大')
      }
      consumeMarker(marker)
    }
  }

  function push (chunk) {
    const input = String(chunk || '')
    for (let offset = 0; offset < input.length; offset += 1024) {
      pending = pending + input.slice(offset, offset + 1024)
      consumePending()
    }
    return { output: [] }
  }

  function result () {
    if (!hasStarted || !hasEnded || !capabilities) {
      throw new Error('root 文件协议结果尚未完整')
    }
    const base = { kind: normalized.operation, capabilities }
    if (completedExitCode !== 0) {
      const failureData = normalized.operation === 'stage-import' &&
        typeof structuredData?.cleanupSucceeded === 'boolean'
        ? structuredData
        : null
      return Object.freeze({ ...base, ...(failureData || {}), ok: false })
    }
    if (['list', 'list-bound'].includes(normalized.operation)) {
      return Object.freeze({
        ...base,
        entries: Object.freeze([...entries])
      })
    }
    if (mutationOperations.has(normalized.operation)) {
      return Object.freeze({ ...base, ok: true })
    }
    return Object.freeze({ ...base, ...structuredData })
  }

  return Object.freeze({
    push,
    identity: () => effectiveIdentity,
    started: () => hasStarted,
    ended: () => hasEnded,
    exitCode: () => completedExitCode,
    result
  })
}

export function createPrivilegedFileProtocol () {
  return Object.freeze({
    createToken: createPtyTaskToken,
    buildCommand: buildPrivilegedFileCommand,
    buildExecutionPlan: buildPrivilegedFileExecutionPlan,
    createParser: createPrivilegedFileParser,
    readResult: parser => parser.result()
  })
}
