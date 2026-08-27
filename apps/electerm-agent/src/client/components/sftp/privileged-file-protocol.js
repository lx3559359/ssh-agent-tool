import {
  assertPtyTaskToken,
  createPtyTaskToken
} from '../operations-toolkit/runtime/pty-task-protocol.js'

const allowedOperations = new Set([
  'probe',
  'list',
  'lstat',
  'stat',
  'readlink',
  'realpath',
  'mkdir',
  'touch',
  'rename',
  'rm',
  'rmdir',
  'chmod',
  'chown',
  'copy-entry',
  'remove-entry',
  'stage-handshake',
  'stage-export',
  'stage-import',
  'stage-cleanup',
  'sha256'
])

const requiredStageCapabilities = Object.freeze({
  'stage-handshake': Object.freeze([
    'cleanShell', 'stat', 'base64', 'sha256', 'procFd', 'noclobber', 'gnuStat',
    'realpath', 'chown'
  ]),
  'stage-export': Object.freeze([
    'cleanShell', 'stat', 'base64', 'sha256', 'procFd', 'noclobber', 'cat',
    'gnuStat', 'realpath', 'chown', 'chmod', 'rm'
  ]),
  'stage-import': Object.freeze([
    'cleanShell', 'stat', 'base64', 'sha256', 'procFd', 'noclobber', 'cat',
    'gnuStat', 'gnuMv', 'realpath', 'chown', 'chmod', 'rm'
  ]),
  'stage-cleanup': Object.freeze([
    'cleanShell', 'stat', 'base64', 'procFd', 'noclobber', 'gnuStat',
    'realpath', 'rm'
  ])
})

const capabilityShellVariables = Object.freeze({
  cleanShell: '__sp_clean_shell_cap',
  stat: '__sp_stat_cap',
  base64: '__sp_base64_cap',
  sha256: '__sp_sha256_cap',
  procFd: '__sp_proc_fd_cap',
  noclobber: '__sp_noclobber_cap',
  cat: '__sp_cat_cap',
  gnuStat: '__sp_gnu_stat_cap',
  gnuMv: '__sp_gnu_mv_cap',
  realpath: '__sp_realpath_cap',
  chown: '__sp_chown_cap',
  chmod: '__sp_chmod_cap',
  rm: '__sp_rm_cap'
})

function encodeUtf8Base64 (value) {
  const bytes = new TextEncoder().encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
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

const operationArguments = Object.freeze({
  probe: [],
  list: ['path'],
  lstat: ['path'],
  stat: ['path'],
  readlink: ['path'],
  realpath: ['path'],
  mkdir: ['path'],
  touch: ['path'],
  rename: ['source', 'target'],
  rm: ['path'],
  rmdir: ['path'],
  chmod: ['path', 'mode'],
  chown: ['path', 'uid', 'gid'],
  'copy-entry': ['source', 'target'],
  'remove-entry': ['path'],
  'stage-handshake': [
    'rootPath', 'challengeName', 'responseName', 'challenge',
    'rootUid', 'rootGid', 'rootMode'
  ],
  'stage-export': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'sourcePath'
  ],
  'stage-import': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName', 'targetPath',
    'sha256', 'size', 'targetMode', 'targetUid', 'targetGid'
  ],
  'stage-cleanup': [
    'rootPath', 'rootRealPath', 'rootDevice', 'rootInode',
    'rootUid', 'rootGid', 'rootMode', 'objectName'
  ],
  sha256: ['path']
})

const argumentVariables = Object.freeze({
  path: '__sp_path',
  source: '__sp_source',
  target: '__sp_target',
  mode: '__sp_mode',
  uid: '__sp_uid',
  gid: '__sp_gid',
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
  objectName: '__sp_objectName',
  sourcePath: '__sp_sourcePath',
  targetPath: '__sp_targetPath',
  sha256: '__sp_expectedSha256',
  size: '__sp_expectedSize',
  targetMode: '__sp_targetMode',
  targetUid: '__sp_targetUid',
  targetGid: '__sp_targetGid'
})

const argumentEnvironmentVariables = Object.freeze({
  path: 'SHELLPILOT_ARG_PATH',
  source: 'SHELLPILOT_ARG_SOURCE',
  target: 'SHELLPILOT_ARG_TARGET',
  mode: 'SHELLPILOT_ARG_MODE',
  uid: 'SHELLPILOT_ARG_UID',
  gid: 'SHELLPILOT_ARG_GID',
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
  objectName: 'SHELLPILOT_ARG_OBJECT_NAME',
  sourcePath: 'SHELLPILOT_ARG_SOURCE_PATH',
  targetPath: 'SHELLPILOT_ARG_TARGET_PATH',
  sha256: 'SHELLPILOT_ARG_SHA256',
  size: 'SHELLPILOT_ARG_SIZE',
  targetMode: 'SHELLPILOT_ARG_TARGET_MODE',
  targetUid: 'SHELLPILOT_ARG_TARGET_UID',
  targetGid: 'SHELLPILOT_ARG_TARGET_GID'
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
    'uid', 'gid', 'rootDevice', 'rootInode', 'rootUid', 'rootGid',
    'size', 'targetUid', 'targetGid'
  ]) {
    if (Object.hasOwn(request.args, key) &&
      !/^(?:0|[1-9]\d*)$/.test(request.args[key])) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  for (const key of ['mode', 'rootMode', 'targetMode']) {
    if (Object.hasOwn(request.args, key) &&
      !/^[0-7]{3,4}$/.test(request.args[key])) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
  }
  if (request.operation.startsWith('stage-') && request.args.rootMode !== '700') {
    throw new Error('root 文件操作握手 mode 必须为 700')
  }
  for (const key of ['challenge', 'sha256']) {
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
      `${variable}=$` + `{${variable}%?}`
  }).join(' && ')
}

const listBody = [
  'set +f || return $?;',
  '__sp_total=0;',
  'for __sp_entry in "$__sp_path"/.[!.]* "$__sp_path"/..?* "$__sp_path"/*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_total=$((__sp_total + 1));',
  'done;',
  '__sp_seq=0;',
  'for __sp_entry in "$__sp_path"/.[!.]* "$__sp_path"/..?* "$__sp_path"/*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_seq=$((__sp_seq + 1));',
  '  __sp_name=$' + '{__sp_entry##*/};',
  '  __sp_stat="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$__sp_entry")" || return $?;',
  '  __sp_emit_entry "$__sp_seq" "$__sp_total" "$__sp_name" "$__sp_stat";',
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
  '__sp_actualChallenge="$(__sp_sha256_raw "./$__sp_challengeName")"',
  '[ "$__sp_actualChallenge" = "$__sp_challenge" ]',
  '__sp_response="$(__sp_sha256_text "$__sp_challenge:root")"',
  '( umask 077; set -C || exit $?; printf %s "$__sp_response" > "./$__sp_responseName" )',
  'chown -h -- "$__sp_rootUid:$__sp_rootGid" "./$__sp_responseName"',
  '[ ! -L "./$__sp_responseName" ] && [ -f "./$__sp_responseName" ]',
  '[ "$(stat -c %u -- "./$__sp_responseName")" = "$__sp_rootUid" ]',
  '[ "$(stat -c %g -- "./$__sp_responseName")" = "$__sp_rootGid" ]',
  '[ "$(stat -c %a -- "./$__sp_responseName")" = 600 ]',
  '[ "$(__sp_sha256_raw "./$__sp_responseName")" = "$__sp_response" ]',
  '__sp_emit_handshake "$__sp_response" "$__sp_rootUid" "$__sp_rootGid" "$__sp_actualMode" "$__sp_actualRealPath" "$__sp_actualDevice" "$__sp_actualInode"'
].join(' && ')

const stageExportBody = [
  '__sp_bind_root || return $?',
  '[ ! -e "./$__sp_objectName" ] && [ ! -L "./$__sp_objectName" ] || return 1',
  'exec 4< "$__sp_sourcePath" || return $?',
  '__sp_fd4="/proc/$$/fd/4"',
  '[ -f "$__sp_fd4" ] || { exec 4<&-; return 1; }',
  '__sp_sourceDevice="$(stat -L -c %d -- "$__sp_fd4")" || { exec 4<&-; return 1; }',
  '__sp_sourceInode="$(stat -L -c %i -- "$__sp_fd4")" || { exec 4<&-; return 1; }',
  '[ ! -L "$__sp_sourcePath" ] && [ -f "$__sp_sourcePath" ] || { exec 4<&-; return 1; }',
  '[ "$(stat -c %d -- "$__sp_sourcePath")" = "$__sp_sourceDevice" ] || { exec 4<&-; return 1; }',
  '[ "$(stat -c %i -- "$__sp_sourcePath")" = "$__sp_sourceInode" ] || { exec 4<&-; return 1; }',
  'umask 077',
  'set -C || return $?',
  'exec 3> "./$__sp_objectName" || { exec 4<&-; return 1; }',
  '__sp_fd3="/proc/$$/fd/3"',
  'if ! cat <&4 >&3; then exec 3>&- 4<&-; rm -f -- "./$__sp_objectName"; return 1; fi',
  'exec 4<&-',
  '__sp_objectDevice="$(stat -L -c %d -- "$__sp_fd3")" || { exec 3>&-; rm -f -- "./$__sp_objectName"; return 1; }',
  '__sp_objectInode="$(stat -L -c %i -- "$__sp_fd3")" || { exec 3>&-; rm -f -- "./$__sp_objectName"; return 1; }',
  '__sp_digest="$(__sp_sha256_raw "$__sp_fd3")" || { exec 3>&-; rm -f -- "./$__sp_objectName"; return 1; }',
  '__sp_size="$(stat -L -c %s -- "$__sp_fd3")" || { exec 3>&-; rm -f -- "./$__sp_objectName"; return 1; }',
  'chown -- "$__sp_rootUid:$__sp_rootGid" "$__sp_fd3" || { exec 3>&-; rm -f -- "./$__sp_objectName"; return 1; }',
  'chmod -- 600 "$__sp_fd3" || { exec 3>&-; rm -f -- "./$__sp_objectName"; return 1; }',
  '[ ! -L "./$__sp_objectName" ] && [ -f "./$__sp_objectName" ] || { exec 3>&-; return 1; }',
  '[ "$(stat -c %d -- "./$__sp_objectName")" = "$__sp_objectDevice" ] || { exec 3>&-; return 1; }',
  '[ "$(stat -c %i -- "./$__sp_objectName")" = "$__sp_objectInode" ] || { exec 3>&-; return 1; }',
  'exec 3>&-',
  '__sp_emit_digest "$__sp_digest" "$__sp_size"'
].join('; ')

const stageImportBody = [
  '__sp_bind_root || return $?',
  '[ ! -L "./$__sp_objectName" ] && [ -f "./$__sp_objectName" ] || return 1',
  'exec 3< "./$__sp_objectName" || return $?',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_objectDevice="$(stat -L -c %d -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '__sp_objectInode="$(stat -L -c %i -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '[ "$(stat -c %d -- "./$__sp_objectName")" = "$__sp_objectDevice" ] || { exec 3<&-; return 1; }',
  '[ "$(stat -c %i -- "./$__sp_objectName")" = "$__sp_objectInode" ] || { exec 3<&-; return 1; }',
  '__sp_tempPath="$__sp_targetPath.shellpilot-$__sp_token"',
  '[ ! -e "$__sp_tempPath" ] && [ ! -L "$__sp_tempPath" ] || { exec 3<&-; return 1; }',
  'set -C || return $?',
  'exec 4> "$__sp_tempPath" || { exec 3<&-; return 1; }',
  '__sp_fd4="/proc/$$/fd/4"',
  'if ! cat <&3 >&4; then exec 3<&- 4>&-; rm -f -- "$__sp_tempPath"; return 1; fi',
  'exec 3<&-',
  '__sp_installedDigest="$(__sp_sha256_raw "$__sp_fd4")" || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '__sp_installedSize="$(stat -L -c %s -- "$__sp_fd4")" || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '[ "$__sp_installedDigest" = "$__sp_expectedSha256" ] && [ "$__sp_installedSize" = "$__sp_expectedSize" ] || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4" || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  'chmod -- "$__sp_targetMode" "$__sp_fd4" || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '__sp_tempDevice="$(stat -L -c %d -- "$__sp_fd4")" || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '__sp_tempInode="$(stat -L -c %i -- "$__sp_fd4")" || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '[ ! -L "$__sp_tempPath" ] && [ -f "$__sp_tempPath" ] || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '[ "$(stat -c %d -- "$__sp_tempPath")" = "$__sp_tempDevice" ] || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  '[ "$(stat -c %i -- "$__sp_tempPath")" = "$__sp_tempInode" ] || { exec 4>&-; rm -f -- "$__sp_tempPath"; return 1; }',
  'exec 4>&-',
  'mv -fT -- "$__sp_tempPath" "$__sp_targetPath" || { rm -f -- "$__sp_tempPath"; return 1; }',
  '__sp_emit_digest "$__sp_installedDigest" "$__sp_installedSize"'
].join('; ')

const stageCleanupBody = [
  '__sp_bind_root || return $?;',
  'if [ -e "./$__sp_objectName" ] || [ -L "./$__sp_objectName" ]; then',
  '  [ -L "./$__sp_objectName" ] || [ -f "./$__sp_objectName" ] || return 1;',
  '  rm -f -- "./$__sp_objectName" || return $?;',
  'fi'
].join(' ')

const operationBodies = Object.freeze({
  probe: ':',
  list: listBody,
  lstat: '__sp_emit_stat "$__sp_path" lstat',
  stat: '__sp_emit_stat "$__sp_path" stat',
  readlink: '__sp_emit_text "$(readlink -- "$__sp_path")"',
  realpath: '__sp_emit_text "$(realpath -- "$__sp_path")"',
  mkdir: 'mkdir -- "$__sp_path"',
  touch: '( umask 077; : > "$__sp_path" )',
  rename: 'mv -- "$__sp_source" "$__sp_target"',
  rm: 'rm -- "$__sp_path"',
  rmdir: 'rm -rf -- "$__sp_path"',
  chmod: 'chmod -- "$__sp_mode" "$__sp_path"',
  chown: 'chown -- "$__sp_uid:$__sp_gid" "$__sp_path"',
  'copy-entry': 'cp -a -- "$__sp_source" "$__sp_target"',
  'remove-entry': 'rm -rf -- "$__sp_path"',
  'stage-handshake': stageHandshakeBody,
  'stage-export': stageExportBody,
  'stage-import': stageImportBody,
  'stage-cleanup': stageCleanupBody,
  sha256: '__sp_emit_sha256 "$__sp_path"'
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
    const text = String(value ?? '')
    if (text.includes('\u0000') || hasUnpairedSurrogate(text)) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
    if (text.length > 1024 * 1024) {
      throw new Error(`root 文件操作参数过长：${key}`)
    }
    normalized[key] = text
  }
  if (Object.keys(normalized).some(key =>
    !operationArguments[operation].includes(key))) {
    throw new Error('root 文件操作参数合同无效')
  }
  if (operation.startsWith('stage-') &&
    Object.hasOwn(normalized, 'rootPath') &&
    !isCanonicalStageRootPath(normalized.rootPath)) {
    throw new Error('root 文件操作 rootPath 必须为规范绝对路径')
  }
  if (operation.startsWith('stage-') &&
    Object.hasOwn(normalized, 'rootRealPath') &&
    (!isCanonicalStageRootPath(normalized.rootRealPath) ||
      normalized.rootRealPath !== normalized.rootPath)) {
    throw new Error('root 文件操作 rootRealPath 与 rootPath 不匹配')
  }
  return Object.freeze({
    operation,
    args: Object.freeze(normalized)
  })
}

export function buildPrivilegedFileCommand ({ token: providedToken, request }) {
  const token = assertPtyTaskToken(providedToken)
  const normalized = assertRequestContract(createPrivilegedFileRequest(request))
  const decodeArguments = decodeCondition(normalized)
  const prepare = decodeArguments ? `${decodeArguments} && ` : ''
  const capabilityGuard = (requiredStageCapabilities[normalized.operation] || [])
    .map(name => `[ "$${capabilityShellVariables[name]}" = 1 ]`)
    .join(' && ') || ':'
  const marker = '\\033]698;SHELLPILOT_FILE;%s'
  const innerScript = [
    '__sp_token="$SHELLPILOT_TOKEN";',
    '__sp_decode() { printf %s "$1" | base64 -d || return $?; printf .; };',
    '__sp_encode() { printf %s "$1" | base64 | tr -d "\\r\\n"; };',
    'readlink() { command readlink "$@" || return $?; printf .; };',
    'realpath() { command realpath "$@" || return $?; printf .; };',
    '__sp_sha256_raw() { if command -v sha256sum >/dev/null 2>&1; then __sp_hash="$(sha256sum -- "$1")" || return $?; else __sp_hash="$(shasum -a 256 -- "$1")" || return $?; fi; printf %s "$' + '{__sp_hash%% *}"; };',
    '__sp_sha256_text() { if command -v sha256sum >/dev/null 2>&1; then __sp_hash="$(printf %s "$1" | sha256sum)" || return $?; else __sp_hash="$(printf %s "$1" | shasum -a 256)" || return $?; fi; printf %s "$' + '{__sp_hash%% *}"; };',
    '__sp_valid_name() { case "$1" in ""|"."|".."|*/*) return 1 ;; *) return 0 ;; esac; };',
    '__sp_bind_root() { __sp_valid_name "$__sp_objectName" || return 1; [ -d "/proc/$$/fd" ] || return 1; __sp_boundRealPath="$(realpath -- "$__sp_rootPath")" || return $?; __sp_boundRealPath=$' + '{__sp_boundRealPath%?}; __sp_boundRealPath=$' + '{__sp_boundRealPath%?}; [ "$__sp_boundRealPath" = "$__sp_rootPath" ] || return 1; [ "$__sp_boundRealPath" = "$__sp_rootRealPath" ] || return 1; [ ! -L "$__sp_rootPath" ] && [ -d "$__sp_rootPath" ] || return 1; cd -- "$__sp_rootPath" || return $?; [ "$(pwd -P)" = "$__sp_boundRealPath" ] || return 1; [ "$(stat -c %d -- .)" = "$__sp_rootDevice" ] || return 1; [ "$(stat -c %i -- .)" = "$__sp_rootInode" ] || return 1; [ "$(stat -c %a -- .)" = "$__sp_rootMode" ] || return 1; [ "$(stat -c %u -- .)" = "$__sp_rootUid" ] || return 1; [ "$(stat -c %g -- .)" = "$__sp_rootGid" ] || return 1; };',
    `__sp_emit_data1() { printf '${marker};data;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4"; };`,
    `__sp_emit_data2() { printf '${marker};data;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5"; };`,
    `__sp_emit_data7() { printf '${marker};data;1;1;%s;%s;%s;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"; };`,
    '__sp_emit_entry() { __sp_emit_data2 "$1" "$2" entry "$(__sp_encode "$3")" "$(__sp_encode "$4")"; };',
    '__sp_emit_stat() { if [ "$2" = stat ]; then __sp_value="$(stat -L -c "%f;%s;%X;%Y;%u;%g" -- "$1")" || return $?; else __sp_value="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$1")" || return $?; fi; __sp_emit_data1 1 1 metadata "$(__sp_encode "$__sp_value")"; };',
    '__sp_emit_text() { __sp_value=$' + '{1%?}; __sp_value=$' + '{__sp_value%?}; [ -n "$__sp_value" ] || return 1; __sp_emit_data1 1 1 text "$(__sp_encode "$__sp_value")"; };',
    '__sp_emit_digest() { __sp_emit_data2 1 1 digest "$(__sp_encode "$1")" "$(__sp_encode "$2")"; };',
    '__sp_emit_handshake() { __sp_emit_data7 handshake "$(__sp_encode "$1")" "$(__sp_encode "$2")" "$(__sp_encode "$3")" "$(__sp_encode "$4")" "$(__sp_encode "$5")" "$(__sp_encode "$6")" "$(__sp_encode "$7")"; };',
    '__sp_emit_sha256() { __sp_digest="$(__sp_sha256_raw "$1")" || return $?; __sp_size="$(stat -c %s -- "$1")" || return $?; __sp_emit_digest "$__sp_digest" "$__sp_size"; };',
    `__sp_run_operation() { ${operationBodies[normalized.operation]}; };`,
    '__sp_status=125;',
    `if ${prepare}__sp_uid_effective="$(id -u 2>/dev/null)" && __sp_user_effective="$(id -un 2>/dev/null)" && [ -n "$__sp_uid_effective" ] && [ -n "$__sp_user_effective" ]; then`,
    '  __sp_clean_shell_cap=1;',
    '  __sp_stat_cap=0; command -v stat >/dev/null 2>&1 && __sp_stat_cap=1;',
    '  __sp_base64_cap=0; command -v base64 >/dev/null 2>&1 && __sp_base64_cap=1;',
    '  __sp_sha256_cap=0; { command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; } && __sp_sha256_cap=1;',
    '  __sp_proc_fd_cap=0; [ -d "/proc/$$/fd" ] && __sp_proc_fd_cap=1;',
    '  __sp_noclobber_cap=0; ( set -C ) 2>/dev/null && __sp_noclobber_cap=1;',
    '  __sp_cat_cap=0; command -v cat >/dev/null 2>&1 && __sp_cat_cap=1;',
    '  __sp_gnu_stat_cap=0; stat --version >/dev/null 2>&1 && __sp_gnu_stat_cap=1;',
    '  __sp_gnu_mv_cap=0; mv --version >/dev/null 2>&1 && __sp_gnu_mv_cap=1;',
    '  __sp_realpath_cap=0; command -v realpath >/dev/null 2>&1 && __sp_realpath_cap=1;',
    '  __sp_chown_cap=0; command -v chown >/dev/null 2>&1 && __sp_chown_cap=1;',
    '  __sp_chmod_cap=0; command -v chmod >/dev/null 2>&1 && __sp_chmod_cap=1;',
    '  __sp_rm_cap=0; command -v rm >/dev/null 2>&1 && __sp_rm_cap=1;',
    '  __sp_caps="sh=1,cleanShell=$__sp_clean_shell_cap,stat=$__sp_stat_cap,base64=$__sp_base64_cap,sha256=$__sp_sha256_cap,procFd=$__sp_proc_fd_cap,noclobber=$__sp_noclobber_cap,cat=$__sp_cat_cap,gnuStat=$__sp_gnu_stat_cap,gnuMv=$__sp_gnu_mv_cap,realpath=$__sp_realpath_cap,chown=$__sp_chown_cap,chmod=$__sp_chmod_cap,rm=$__sp_rm_cap";',
    `  printf '${marker};start;%s;%s;%s\\007' "$__sp_token" "$(__sp_encode "$__sp_uid_effective")" "$(__sp_encode "$__sp_user_effective")" "$(__sp_encode "$__sp_caps")";`,
    `  if ${capabilityGuard}; then __sp_run_operation; __sp_status=$?; else __sp_status=126; fi;`,
    `  printf '${marker};end;%s\\007' "$__sp_token" "$__sp_status";`,
    'else printf "root 文件操作参数或有效身份无效\\n"; fi;',
    'exit "$__sp_status"'
  ].join(' ')
  const argumentEnvironment = operationArguments[normalized.operation].map(key =>
    `${argumentEnvironmentVariables[key]}=${shellQuote(
      encodeUtf8Base64(normalized.args[key])
    )}`)
  return [
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

function parseMetadata (encoded) {
  const fields = decodeUtf8Base64(encoded, '元数据').split(';')
  if (fields.length !== 6 || !/^[0-9a-fA-F]{1,4}$/.test(fields[0])) {
    throw new Error('root 文件协议 mode 无效')
  }
  const mode = Number.parseInt(fields[0], 16)
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0xFFFF) {
    throw new Error('root 文件协议 mode 无效')
  }
  return Object.freeze({
    mode,
    type: modeType(mode),
    size: parseUnsignedInteger(fields[1], 'size'),
    atime: parseSignedInteger(fields[2], 'atime'),
    mtime: parseSignedInteger(fields[3], 'mtime'),
    uid: parseUnsignedInteger(fields[4], 'uid'),
    gid: parseUnsignedInteger(fields[5], 'gid')
  })
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
  let trustedMetadataBytes = 0

  const mutationOperations = new Set([
    'probe', 'mkdir', 'touch', 'rename', 'rm', 'rmdir', 'chmod', 'chown',
    'copy-entry', 'remove-entry', 'stage-cleanup'
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
    if (sequence !== nextSequence || sequence < 1 || total < 1 ||
      sequence > total || (expectedTotal !== null && total !== expectedTotal)) {
      throw new Error('root 文件协议数据顺序无效')
    }
    expectedTotal = total
    nextSequence += 1
    const kind = fields[3]
    const payload = fields.slice(4)
    if (normalized.operation === 'list') {
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
    if (total !== 1 || sequence !== 1 || structuredData !== null) {
      throw new Error('root 文件协议数据数量无效')
    }
    if (normalized.operation === 'lstat' || normalized.operation === 'stat') {
      if (kind !== 'metadata' || payload.length !== 1) {
        throw new Error('root 文件协议数据类型无效')
      }
      structuredData = Object.freeze({ metadata: parseMetadata(payload[0]) })
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
    if (['stage-export', 'stage-import', 'sha256'].includes(normalized.operation)) {
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
    throw new Error('root 文件协议数据类型无效')
  }

  function consumeEnd (fields) {
    if (!hasStarted || hasEnded || fields.length !== 2 ||
      !/^(?:0|[1-9]\d*)$/.test(fields[1])) {
      throw new Error('root 文件协议结束边界无效')
    }
    const exitCode = Number(fields[1])
    const requiresData = !mutationOperations.has(normalized.operation) &&
      normalized.operation !== 'list'
    const missingCapability = (requiredStageCapabilities[normalized.operation] || [])
      .some(name => capabilities[name] !== true)
    if (exitCode === 0 && missingCapability) {
      throw new Error('root 文件协议缺少必要能力')
    }
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255 ||
      (expectedTotal !== null && nextSequence !== expectedTotal + 1) ||
      (exitCode === 0 && requiresData && structuredData === null)) {
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

  function push (chunk) {
    pending += String(chunk || '')
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
        if (pending.length > 2048) {
          throw new Error('root 文件协议边界过长')
        }
        break
      }
      if (markerEnd + 1 > 2048) {
        throw new Error('root 文件协议边界过长')
      }
      const markerPayload = pending.slice(namespacePrefix.length, markerEnd)
      pending = pending.slice(markerEnd + 1)
      const tokenEnd = markerPayload.indexOf(';')
      if (tokenEnd < 0 || markerPayload.slice(0, tokenEnd) !== token) {
        throw new Error('root 文件协议 token 不匹配')
      }
      const marker = markerPayload.slice(tokenEnd + 1)
      trustedMetadataBytes += namespacePrefix.length + markerPayload.length + 1
      if (trustedMetadataBytes > 4 * 1024 * 1024) {
        throw new Error('root 文件协议累计元数据过大')
      }
      consumeMarker(marker)
    }
    return { output: [] }
  }

  function result () {
    if (!hasStarted || !hasEnded || !capabilities) {
      throw new Error('root 文件协议结果尚未完整')
    }
    const base = { kind: normalized.operation, capabilities }
    if (completedExitCode !== 0) return Object.freeze({ ...base, ok: false })
    if (normalized.operation === 'list') {
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
    createParser: createPrivilegedFileParser,
    readResult: parser => parser.result()
  })
}
