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
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'gnuStat', 'realpath', 'chown'
  ]),
  'stage-export': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'cat', 'gnuStat', 'realpath', 'chown', 'chmod', 'rm'
  ]),
  'stage-import': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
    'noclobber', 'cat', 'gnuStat', 'gnuMv', 'realpath', 'chown', 'chmod', 'rm'
  ]),
  'stage-cleanup': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'procFd',
    'noclobber', 'gnuStat', 'realpath', 'rm'
  ])
})

const requiredOperationCapabilities = Object.freeze({
  ...requiredStageCapabilities,
  lstat: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat'
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
  rename: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'gnuMv'
  ]),
  rm: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'rm'
  ]),
  rmdir: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'rm'
  ]),
  chmod: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'chmod'
  ]),
  chown: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'chown'
  ]),
  'remove-entry': Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'rm'
  ]),
  sha256: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'sha256', 'stat', 'gnuStat'
  ]),
  list: Object.freeze([
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'find', 'head', 'wc'
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
  find: '__sp_find_cap',
  head: '__sp_head_cap',
  wc: '__sp_wc_cap'
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
      !/^(?:0|[1-7][0-7]{0,3})$/.test(request.args[key])) {
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
  '__sp_preflightCount="$(find "$__sp_path" -mindepth 1 -maxdepth 1 -printf x 2>/dev/null | head -c 20001 | wc -c | tr -d " \\r\\n")" || return $?;',
  'case "$__sp_preflightCount" in ""|*[!0-9]*) return 1 ;; esac;',
  '[ "$__sp_preflightCount" -le 20000 ] || return 1;',
  'set +f || return $?;',
  '__sp_total=0;',
  'for __sp_entry in "$__sp_path"/.[!.]* "$__sp_path"/..?* "$__sp_path"/*; do',
  '  [ -e "$__sp_entry" ] || [ -L "$__sp_entry" ] || continue;',
  '  __sp_total=$((__sp_total + 1));',
  '  [ "$__sp_total" -le 20000 ] || return 1;',
  'done;',
  '__sp_seq=0;',
  '__sp_metadataBytes=0;',
  'for __sp_entry in "$__sp_path"/.[!.]* "$__sp_path"/..?* "$__sp_path"/*; do',
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
  '[ "$__sp_uid_effective" = 0 ] || return 1',
  '__sp_bind_root || return $?',
  '[ ! -L "./$__sp_objectName" ] && [ -f "./$__sp_objectName" ] || return 1',
  'exec 3< "./$__sp_objectName" || return $?',
  '__sp_fd3="/proc/$$/fd/3"',
  '__sp_objectDevice="$(stat -L -c %d -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '__sp_objectInode="$(stat -L -c %i -- "$__sp_fd3")" || { exec 3<&-; return 1; }',
  '[ "$(stat -c %d -- "./$__sp_objectName")" = "$__sp_objectDevice" ] || { exec 3<&-; return 1; }',
  '[ "$(stat -c %i -- "./$__sp_objectName")" = "$__sp_objectInode" ] || { exec 3<&-; return 1; }',
  '__sp_targetParent="$' + '{__sp_targetPath%/*}"',
  '[ -n "$__sp_targetParent" ] || __sp_targetParent=/',
  '__sp_targetName="$' + '{__sp_targetPath##*/}"',
  '__sp_valid_name "$__sp_targetName" || { exec 3<&-; return 1; }',
  '__sp_targetParentReal="$(realpath -- "$__sp_targetParent")" || { exec 3<&-; return 1; }',
  '__sp_targetParentReal=$' + '{__sp_targetParentReal%?}',
  '__sp_targetParentReal=$' + '{__sp_targetParentReal%?}',
  '[ "$__sp_targetParentReal" = "$__sp_targetParent" ] || { exec 3<&-; return 1; }',
  '[ ! -L "$__sp_targetParent" ] && [ -d "$__sp_targetParent" ] || { exec 3<&-; return 1; }',
  'cd -- "$__sp_targetParent" || { exec 3<&-; return 1; }',
  '[ "$(pwd -P)" = "$__sp_targetParentReal" ] || { exec 3<&-; return 1; }',
  '__sp_targetParentDevice="$(stat -c %d -- .)" || { exec 3<&-; return 1; }',
  '__sp_targetParentInode="$(stat -c %i -- .)" || { exec 3<&-; return 1; }',
  '__sp_targetParentTrusted=0',
  '__sp_targetParentUid="$(stat -c %u -- .)" || { exec 3<&-; return 1; }',
  '__sp_targetParentMode="$(stat -c %a -- .)" || { exec 3<&-; return 1; }',
  'case "$__sp_targetParentMode" in ""|*[!0-7]*) exec 3<&-; return 1 ;; esac',
  'if [ "$__sp_targetParentUid" = 0 ] && [ "$((0$__sp_targetParentMode & 022))" -eq 0 ]; then __sp_targetParentTrusted=1; fi',
  'if [ -e "./$__sp_targetName" ] || [ -L "./$__sp_targetName" ]; then [ ! -L "./$__sp_targetName" ] && [ -f "./$__sp_targetName" ] || { exec 3<&-; return 1; }; fi',
  '__sp_tempName=".shellpilot-$__sp_token.tmp"',
  '[ ! -e "./$__sp_tempName" ] && [ ! -L "./$__sp_tempName" ] || { exec 3<&-; return 1; }',
  'umask 077',
  'set -C || { exec 3<&-; return 1; }',
  'exec 4> "./$__sp_tempName" || { exec 3<&-; return 1; }',
  '__sp_fd4="/proc/$$/fd/4"',
  '__sp_tempDevice="$(stat -L -c %d -- "$__sp_fd4")" || { exec 3<&- 4>&-; return 1; }',
  '__sp_tempInode="$(stat -L -c %i -- "$__sp_fd4")" || { exec 3<&- 4>&-; return 1; }',
  '[ "$(stat -L -c %a -- "$__sp_fd4")" = 600 ] || { __sp_cleanup_temp; exec 3<&- 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_tempName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 3<&- 4>&-; return 1; }',
  'if ! cat <&3 >&4; then __sp_cleanup_temp; exec 3<&- 4>&-; return 1; fi',
  'exec 3<&-',
  '__sp_installedDigest="$(__sp_sha256_raw "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_installedSize="$(stat -L -c %s -- "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '[ "$__sp_installedDigest" = "$__sp_expectedSha256" ] && [ "$__sp_installedSize" = "$__sp_expectedSize" ] || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '[ "$(stat -c %d -- .)" = "$__sp_targetParentDevice" ] && [ "$(stat -c %i -- .)" = "$__sp_targetParentInode" ] || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_tempName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  'chmod -- "$__sp_targetMode" "$__sp_fd4" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_tempName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  '__sp_readyDigest="$(__sp_sha256_raw "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_readySize="$(stat -L -c %s -- "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_readyUid="$(stat -L -c %u -- "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_readyGid="$(stat -L -c %g -- "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_readyMode="$(stat -L -c %a -- "$__sp_fd4")" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '[ "$__sp_readyDigest" = "$__sp_expectedSha256" ] && [ "$__sp_readySize" = "$__sp_expectedSize" ] && [ "$__sp_readyUid" = "$__sp_targetUid" ] && [ "$__sp_readyGid" = "$__sp_targetGid" ] && [ "$__sp_readyMode" = "$__sp_targetMode" ] || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '[ "$(stat -c %d -- .)" = "$__sp_targetParentDevice" ] && [ "$(stat -c %i -- .)" = "$__sp_targetParentInode" ] || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_tempName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  'mv -fT -- "./$__sp_tempName" "./$__sp_targetName" || { __sp_cleanup_temp; exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_targetName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  '__sp_finalDigest="$(__sp_sha256_raw "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalSize="$(stat -L -c %s -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalUid="$(stat -L -c %u -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalGid="$(stat -L -c %g -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '__sp_finalMode="$(stat -L -c %a -- "$__sp_fd4")" || { exec 4>&-; return 1; }',
  '[ "$__sp_finalDigest" = "$__sp_expectedSha256" ] && [ "$__sp_finalSize" = "$__sp_expectedSize" ] && [ "$__sp_finalUid" = "$__sp_targetUid" ] && [ "$__sp_finalGid" = "$__sp_targetGid" ] && [ "$__sp_finalMode" = "$__sp_targetMode" ] || { exec 4>&-; return 1; }',
  '__sp_path_matches_fd "./$__sp_targetName" "$__sp_tempDevice" "$__sp_tempInode" || { exec 4>&-; return 1; }',
  '__sp_emit_digest "$__sp_finalDigest" "$__sp_finalSize" || { exec 4>&-; return 1; }',
  'exec 4>&-'
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
    let text = String(value ?? '')
    if (text.includes('\u0000') || hasUnpairedSurrogate(text)) {
      throw new Error(`root 文件操作参数值无效：${key}`)
    }
    if (text.length > 1024 * 1024) {
      throw new Error(`root 文件操作参数过长：${key}`)
    }
    if (['mode', 'rootMode', 'targetMode'].includes(key) &&
      /^[0-7]{1,4}$/.test(text)) {
      text = text.replace(/^0+(?=[0-7])/, '')
    }
    if (['challenge', 'sha256'].includes(key) &&
      /^[a-fA-F0-9]{64}$/.test(text)) {
      text = text.toLowerCase()
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
  if (operation === 'stage-import' &&
    Object.hasOwn(normalized, 'targetPath') &&
    !isCanonicalAbsoluteFilePath(normalized.targetPath)) {
    throw new Error('root 文件操作 targetPath 必须为规范绝对路径')
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
  const capabilityGuard = (requiredOperationCapabilities[normalized.operation] || [])
    .map(name => `[ "$${capabilityShellVariables[name]}" = 1 ]`)
    .join(' && ') || ':'
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
    '__sp_proc_fd_cap=0; __sp_readlink_cap=0; if exec 9</dev/null; then [ -r "/proc/$$/fd/9" ] && stat -L -c %i -- "/proc/$$/fd/9" >/dev/null 2>&1 && __sp_proc_fd_cap=1; [ -n "$(readlink -- "/proc/$$/fd/9" 2>/dev/null)" ] && __sp_readlink_cap=1; exec 9<&-; fi;',
    '__sp_noclobber_cap=0; __sp_cat_cap=0; __sp_gnu_mv_cap=0; __sp_chown_cap=0; __sp_chmod_cap=0; __sp_rm_cap=0;',
    '__sp_probe_a="/tmp/.shellpilot-probe-$__sp_token-$$-a"; __sp_probe_b="/tmp/.shellpilot-probe-$__sp_token-$$-b";',
    'if [ ! -e "$__sp_probe_a" ] && [ ! -L "$__sp_probe_a" ] && [ ! -e "$__sp_probe_b" ] && [ ! -L "$__sp_probe_b" ] && ( umask 077; set -C; printf x > "$__sp_probe_a" ) 2>/dev/null; then',
    '  if ! ( set -C; : > "$__sp_probe_a" ) 2>/dev/null; then __sp_noclobber_cap=1; fi;',
    '  [ "$(cat -- "$__sp_probe_a" 2>/dev/null)" = x ] && __sp_cat_cap=1;',
    '  chmod -- 600 "$__sp_probe_a" 2>/dev/null && [ "$(stat -c %a -- "$__sp_probe_a" 2>/dev/null)" = 600 ] && __sp_chmod_cap=1;',
    '  chown -- "$__sp_uid_effective:$__sp_gid_effective" "$__sp_probe_a" 2>/dev/null && [ "$(stat -c %u:%g -- "$__sp_probe_a" 2>/dev/null)" = "$__sp_uid_effective:$__sp_gid_effective" ] && __sp_chown_cap=1;',
    '  mv -T -- "$__sp_probe_a" "$__sp_probe_b" 2>/dev/null && [ -f "$__sp_probe_b" ] && __sp_gnu_mv_cap=1;',
    'fi;',
    'rm -f -- "$__sp_probe_a" "$__sp_probe_b" 2>/dev/null && [ ! -e "$__sp_probe_a" ] && [ ! -L "$__sp_probe_a" ] && [ ! -e "$__sp_probe_b" ] && [ ! -L "$__sp_probe_b" ] && __sp_rm_cap=1;'
  ].join(' ')
  const innerScript = [
    '__sp_token="$SHELLPILOT_TOKEN";',
    functionalCapabilityProbe,
    '__sp_decode() { printf %s "$1" | base64 -d || return $?; printf .; };',
    '__sp_encode() { printf %s "$1" | base64 | tr -d "\\r\\n"; };',
    'readlink() { command readlink "$@" || return $?; printf .; };',
    'realpath() { command realpath "$@" || return $?; printf .; };',
    '__sp_sha256_raw() { case "$__sp_sha256_tool" in sha256sum) __sp_hash="$(sha256sum -- "$1")" || return $? ;; shasum) __sp_hash="$(shasum -a 256 -- "$1")" || return $? ;; *) return 1 ;; esac; printf %s "$' + '{__sp_hash%% *}"; };',
    '__sp_sha256_text() { case "$__sp_sha256_tool" in sha256sum) __sp_hash="$(printf %s "$1" | sha256sum)" || return $? ;; shasum) __sp_hash="$(printf %s "$1" | shasum -a 256)" || return $? ;; *) return 1 ;; esac; printf %s "$' + '{__sp_hash%% *}"; };',
    '__sp_valid_name() { case "$1" in ""|"."|".."|*/*) return 1 ;; *) return 0 ;; esac; };',
    '__sp_bind_root() { __sp_valid_name "$__sp_objectName" || return 1; [ -d "/proc/$$/fd" ] || return 1; __sp_boundRealPath="$(realpath -- "$__sp_rootPath")" || return $?; __sp_boundRealPath=$' + '{__sp_boundRealPath%?}; __sp_boundRealPath=$' + '{__sp_boundRealPath%?}; [ "$__sp_boundRealPath" = "$__sp_rootPath" ] || return 1; [ "$__sp_boundRealPath" = "$__sp_rootRealPath" ] || return 1; [ ! -L "$__sp_rootPath" ] && [ -d "$__sp_rootPath" ] || return 1; cd -- "$__sp_rootPath" || return $?; [ "$(pwd -P)" = "$__sp_boundRealPath" ] || return 1; [ "$(stat -c %d -- .)" = "$__sp_rootDevice" ] || return 1; [ "$(stat -c %i -- .)" = "$__sp_rootInode" ] || return 1; [ "$(stat -c %a -- .)" = "$__sp_rootMode" ] || return 1; [ "$(stat -c %u -- .)" = "$__sp_rootUid" ] || return 1; [ "$(stat -c %g -- .)" = "$__sp_rootGid" ] || return 1; };',
    '__sp_path_matches_fd() { [ ! -L "$1" ] && [ -f "$1" ] && [ "$(stat -c %d -- "$1")" = "$2" ] && [ "$(stat -c %i -- "$1")" = "$3" ]; };',
    '__sp_cleanup_temp() { [ "$__sp_targetParentTrusted" = 1 ] || return 0; if __sp_path_matches_fd "./$__sp_tempName" "$__sp_tempDevice" "$__sp_tempInode"; then rm -f -- "./$__sp_tempName"; fi; };',
    `__sp_emit_data1() { printf '${marker};data;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4"; };`,
    `__sp_emit_data2() { printf '${marker};data;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5"; };`,
    `__sp_emit_data7() { printf '${marker};data;1;1;%s;%s;%s;%s;%s;%s;%s;%s\\007' "$__sp_token" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"; };`,
    '__sp_emit_entry() { __sp_name64="$(__sp_encode "$3")" || return $?; __sp_stat64="$(__sp_encode "$4")" || return $?; __sp_metadataBytes=$((__sp_metadataBytes + $' + '{#__sp_name64} + $' + '{#__sp_stat64} + 128)); [ "$__sp_metadataBytes" -le 4194304 ] || return 1; __sp_emit_data2 "$1" "$2" entry "$__sp_name64" "$__sp_stat64"; };',
    '__sp_emit_stat() { if [ "$2" = stat ]; then __sp_value="$(stat -L -c "%f;%s;%X;%Y;%u;%g" -- "$1")" || return $?; else __sp_value="$(stat -c "%f;%s;%X;%Y;%u;%g" -- "$1")" || return $?; fi; __sp_emit_data1 1 1 metadata "$(__sp_encode "$__sp_value")"; };',
    '__sp_emit_text() { __sp_value=$' + '{1%?}; __sp_value=$' + '{__sp_value%?}; [ -n "$__sp_value" ] || return 1; __sp_emit_data1 1 1 text "$(__sp_encode "$__sp_value")"; };',
    '__sp_emit_digest() { __sp_emit_data2 1 1 digest "$(__sp_encode "$1")" "$(__sp_encode "$2")"; };',
    '__sp_emit_handshake() { __sp_emit_data7 handshake "$(__sp_encode "$1")" "$(__sp_encode "$2")" "$(__sp_encode "$3")" "$(__sp_encode "$4")" "$(__sp_encode "$5")" "$(__sp_encode "$6")" "$(__sp_encode "$7")"; };',
    '__sp_emit_sha256() { __sp_digest="$(__sp_sha256_raw "$1")" || return $?; __sp_size="$(stat -c %s -- "$1")" || return $?; __sp_emit_digest "$__sp_digest" "$__sp_size"; };',
    `__sp_run_operation() { ${operationBodies[normalized.operation]}; };`,
    '__sp_status=125;',
    `if [ "$__sp_printf_cap" = 1 ] && [ "$__sp_id_cap" = 1 ] && [ "$__sp_tr_cap" = 1 ] && [ "$__sp_base64_cap" = 1 ] && ${prepare}:; then`,
    '  __sp_caps="sh=1,cleanShell=$__sp_clean_shell_cap,printf=$__sp_printf_cap,id=$__sp_id_cap,tr=$__sp_tr_cap,stat=$__sp_stat_cap,base64=$__sp_base64_cap,sha256=$__sp_sha256_cap,procFd=$__sp_proc_fd_cap,noclobber=$__sp_noclobber_cap,cat=$__sp_cat_cap,gnuStat=$__sp_gnu_stat_cap,gnuMv=$__sp_gnu_mv_cap,realpath=$__sp_realpath_cap,readlink=$__sp_readlink_cap,chown=$__sp_chown_cap,chmod=$__sp_chmod_cap,rm=$__sp_rm_cap,find=$__sp_find_cap,head=$__sp_head_cap,wc=$__sp_wc_cap";',
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
    const requiredCapabilities = requiredOperationCapabilities[normalized.operation] || []
    const missingCapability = requiredCapabilities.some(name =>
      capabilities[name] !== true)
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
