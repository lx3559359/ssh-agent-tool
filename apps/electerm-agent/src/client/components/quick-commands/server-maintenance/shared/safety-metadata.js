import {
  containsControlCharacters,
  rollbackScriptDirectory,
  validateAndNormalizeValue
} from './validation.js'

const minimumFreeKilobytes = 10240
const maximumBackupKilobytes = 8192
const rollbackDirectory = rollbackScriptDirectory
const rollbackPathParam = '回滚脚本'
const confirmationParam = '确认执行'

function assertSafeString (value, label) {
  if (typeof value !== 'string') throw new Error(`${label}必须是非空字符串`)
  if (containsControlCharacters(value)) throw new Error(`${label}不能包含控制字符`)
  if (!value.trim()) throw new Error(`${label}不能为空`)
  return value
}

function assertSafeRollbackScript (value) {
  const safeValue = assertSafeString(value, '回滚脚本')
  const result = validateAndNormalizeValue('rollback-path', safeValue, {
    label: '回滚脚本',
    required: true
  })
  if (result.error) throw new Error(result.error)
  if (result.value !== safeValue) throw new Error('回滚脚本必须使用规范路径')
  return result.value
}

function cloneStringArray (value, label, options = {}) {
  if (value === undefined && options.allowUndefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  const result = []
  for (let index = 0; index < value.length; index++) {
    result.push(assertSafeString(value[index], label))
  }
  if (options.required && !result.length) {
    throw new Error(`修改命令必须提供至少一个${label}`)
  }
  return result
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function freezeStringArray (value, label, options = {}) {
  return Object.freeze(cloneStringArray(value, label, options))
}

function lockedConfirmationParam () {
  return Object.freeze({
    name: confirmationParam,
    label: confirmationParam,
    type: 'select',
    validationType: 'enum',
    required: true,
    defaultValue: 'no',
    help: '默认不修改服务器；只有选择“是”才会执行变更并创建回滚点。',
    options: Object.freeze([
      Object.freeze({ label: '否，只预览', value: 'no' }),
      Object.freeze({ label: '是，执行修改', value: 'yes' })
    ])
  })
}

function lockedRollbackPathParam () {
  return Object.freeze({
    name: rollbackPathParam,
    label: rollbackPathParam,
    type: 'hidden',
    validationType: 'rollback-path',
    required: true,
    defaultValue: '{{回滚脚本}}',
    help: '由 ShellPilot 自动生成并保存在服务器 /tmp/shellpilot-rollback 目录。'
  })
}

export function withRollback (item, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('修改命令定义不完整')
  }
  const title = assertSafeString(options.title || item.name || item.id, '修改标题')
  const actionParam = assertSafeString(options.actionParam, '修改动作参数')
  const mutatingValues = freezeStringArray(
    options.mutatingValues,
    '修改动作值',
    { required: true }
  )
  const backupTargets = freezeStringArray(
    options.backupTargets,
    '备份目标',
    { allowUndefined: true }
  )
  const verifyCommands = freezeStringArray(
    options.verifyCommands,
    '验证命令',
    { required: true }
  )
  const params = Array.isArray(item.params)
    ? item.params.filter(param => (
      param?.name !== confirmationParam && param?.name !== rollbackPathParam
    ))
    : []
  const {
    rollback: ignoredRollback,
    mutationSafety: ignoredMutationSafety,
    safetyMetadata: ignoredSafetyMetadata,
    verification: ignoredVerification,
    ...safeItem
  } = item
  const rollback = Object.freeze({
    title,
    pathParam: rollbackPathParam,
    actionParam,
    mutatingValues,
    confirmParam: confirmationParam,
    confirmValue: 'yes'
  })
  const mutationSafety = Object.freeze({
    title,
    backupTargets,
    verifyCommands
  })

  return {
    ...safeItem,
    editBeforeRun: true,
    mutatesServer: true,
    confirmRequired: true,
    params: [
      ...params,
      lockedConfirmationParam(),
      lockedRollbackPathParam()
    ],
    rollback,
    mutationSafety,
    verification: verifyCommands
  }
}

export function validateMutationSafetyMetadata (metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('修改命令安全元数据不完整')
  }
  if (metadata.requireConfirmation !== true) throw new Error('修改命令必须要求确认')
  const title = assertSafeString(metadata.title, '修改标题')
  if (metadata.rollbackDirectory !== rollbackDirectory) {
    throw new Error('回滚目录必须是 /tmp/shellpilot-rollback')
  }
  if (!Number.isSafeInteger(metadata.minFreeKb) || metadata.minFreeKb < minimumFreeKilobytes) {
    throw new Error(`回滚目录最低可用空间不能小于 ${minimumFreeKilobytes} KB`)
  }
  if (metadata.maxBackupKb !== maximumBackupKilobytes) {
    throw new Error(`备份大小上限必须固定为 ${maximumBackupKilobytes} KB`)
  }
  const validated = {
    ...metadata,
    title,
    backupTargets: cloneStringArray(metadata.backupTargets, '备份目标'),
    verifyCommands: cloneStringArray(metadata.verifyCommands, '验证命令', { required: true })
  }
  if (metadata.rollbackScript !== undefined) {
    validated.rollbackScript = assertSafeRollbackScript(metadata.rollbackScript)
  }
  return deepFreeze(validated)
}

export function createMutationSafetyMetadata ({
  title,
  backupTargets,
  verifyCommands,
  rollbackScript
} = {}) {
  const metadata = {
    title: assertSafeString(title, '修改标题'),
    minFreeKb: minimumFreeKilobytes,
    maxBackupKb: maximumBackupKilobytes,
    backupTargets: cloneStringArray(backupTargets, '备份目标', { allowUndefined: true }),
    verifyCommands: cloneStringArray(verifyCommands, '验证命令', { required: true }),
    rollbackDirectory,
    requireConfirmation: true
  }
  if (rollbackScript !== undefined) {
    metadata.rollbackScript = assertSafeRollbackScript(rollbackScript)
  }
  return validateMutationSafetyMetadata(metadata)
}

export function buildMutationPreflight (metadata) {
  const validated = validateMutationSafetyMetadata(metadata)
  const lines = [
    'set -u',
    'umask 077',
    `ROLLBACK_DIR='${rollbackDirectory}'`,
    `MIN_FREE_KB=${validated.minFreeKb}`,
    'FREE_KB=$(df -Pk /tmp 2>/dev/null | awk \'NR == 2 { print $4 }\')',
    'case "$FREE_KB" in ""|*[!0-9]*) echo "无法确认 /tmp 可用空间"; exit 1;; esac',
    'if [ "$FREE_KB" -lt "$MIN_FREE_KB" ]; then echo "回滚目录可用空间不足"; exit 1; fi',
    'if [ -L "$ROLLBACK_DIR" ]; then echo "回滚目录不能是符号链接"; exit 1; fi',
    'if ! mkdir -p -m 700 -- "$ROLLBACK_DIR"; then echo "无法创建回滚目录"; exit 1; fi',
    'if [ -L "$ROLLBACK_DIR" ] || [ ! -d "$ROLLBACK_DIR" ]; then echo "回滚目录类型不安全"; exit 1; fi',
    'CURRENT_UID=$(id -u 2>/dev/null) || { echo "无法确认当前用户"; exit 1; }',
    'ROLLBACK_OWNER=$(stat -c %u -- "$ROLLBACK_DIR" 2>/dev/null) || { echo "无法确认回滚目录所有者"; exit 1; }',
    'ROLLBACK_MODE=$(stat -c %a -- "$ROLLBACK_DIR" 2>/dev/null) || { echo "无法确认回滚目录权限"; exit 1; }',
    'if [ "$ROLLBACK_OWNER" != "$CURRENT_UID" ] || [ "$ROLLBACK_MODE" != "700" ]; then echo "回滚目录所有者或权限不安全"; exit 1; fi',
    'OPERATION_ROLLBACK_DIR=$(mktemp -d "$ROLLBACK_DIR/operation.XXXXXX") || { echo "无法创建操作回滚目录"; exit 1; }',
    'if [ -L "$OPERATION_ROLLBACK_DIR" ] || [ ! -d "$OPERATION_ROLLBACK_DIR" ]; then echo "操作回滚目录类型不安全"; exit 1; fi',
    'OPERATION_OWNER=$(stat -c %u -- "$OPERATION_ROLLBACK_DIR" 2>/dev/null) || { echo "无法确认操作回滚目录所有者"; exit 1; }',
    'OPERATION_MODE=$(stat -c %a -- "$OPERATION_ROLLBACK_DIR" 2>/dev/null) || { echo "无法确认操作回滚目录权限"; exit 1; }',
    'if [ "$OPERATION_OWNER" != "$CURRENT_UID" ] || [ "$OPERATION_MODE" != "700" ]; then echo "操作回滚目录所有者或权限不安全"; exit 1; fi'
  ]
  if (validated.backupTargets.length) {
    lines.push(
      'BACKUP_AS=""',
      'if [ "$CURRENT_UID" != "0" ]; then',
      '  if ! command -v sudo >/dev/null 2>&1; then echo "当前不是 root 且没有 sudo，无法安全备份"; exit 1; fi',
      '  if ! sudo -v; then echo "sudo 授权失败，未执行修改"; exit 1; fi',
      '  BACKUP_AS="sudo"',
      'fi'
    )
  } else {
    lines.push('BACKUP_AS=""')
  }
  lines.push('export OPERATION_ROLLBACK_DIR BACKUP_AS')
  return lines.join('\n')
}

function quoteShellLiteral (value) {
  const singleQuote = String.fromCharCode(39)
  const escapedSingleQuote = `${singleQuote}\\${singleQuote}${singleQuote}`
  return `${singleQuote}${String(value).split(singleQuote).join(escapedSingleQuote)}${singleQuote}`
}

export function buildMutationBackup (metadata) {
  const validated = validateMutationSafetyMetadata(metadata)
  const lines = [
    '# __SHELLPILOT_MUTATION_BACKUP__',
    'SHELLPILOT_BACKUP_MANIFEST="$OPERATION_ROLLBACK_DIR/manifest"',
    'if ! : > "$SHELLPILOT_BACKUP_MANIFEST"; then echo "无法创建备份清单"; exit 1; fi',
    `MAX_BACKUP_KB=${validated.maxBackupKb}`,
    'SHELLPILOT_BACKUP_TOTAL_KB=0'
  ]
  if (validated.rollbackScript) {
    lines.push(
      `SHELLPILOT_ROLLBACK_SCRIPT=${quoteShellLiteral(validated.rollbackScript)}`,
      'if [ -L "$SHELLPILOT_ROLLBACK_SCRIPT" ]; then echo "回滚脚本不能是符号链接"; exit 1; fi',
      'if ! printf \'rollback-script\\t%s\\n\' "$SHELLPILOT_ROLLBACK_SCRIPT" >> "$SHELLPILOT_BACKUP_MANIFEST"; then echo "无法关联回滚脚本"; exit 1; fi',
      'export SHELLPILOT_ROLLBACK_SCRIPT'
    )
  }

  validated.backupTargets.forEach((target, index) => {
    const number = index + 1
    const variable = `SHELLPILOT_BACKUP_TARGET_${number}`
    const sizeVariable = `SHELLPILOT_BACKUP_SIZE_${number}`
    const destination = `$OPERATION_ROLLBACK_DIR/target-${number}`
    lines.push(
      `${variable}=${quoteShellLiteral(target)}`,
      `if $BACKUP_AS test -e "$${variable}" || $BACKUP_AS test -L "$${variable}"; then`,
      `  ${sizeVariable}="$($BACKUP_AS du -sk -- "$${variable}" 2>/dev/null | awk 'NR == 1 { print $1 }')"`,
      `  case "$${sizeVariable}" in ""|*[!0-9]*) echo "无法计算备份大小: $${variable}"; exit 1;; esac`,
      `  SHELLPILOT_BACKUP_TOTAL_KB=$((SHELLPILOT_BACKUP_TOTAL_KB + ${sizeVariable}))`,
      '  if [ "$SHELLPILOT_BACKUP_TOTAL_KB" -gt "$MAX_BACKUP_KB" ]; then echo "备份目标总大小超过安全上限"; exit 1; fi',
      '  if [ "$SHELLPILOT_BACKUP_TOTAL_KB" -gt "$FREE_KB" ]; then echo "备份所需空间超过 /tmp 可用空间"; exit 1; fi',
      `  if ! $BACKUP_AS cp -a -- "$${variable}" "${destination}"; then $BACKUP_AS rm -rf -- "${destination}"; echo "备份目标失败: $${variable}"; exit 1; fi`,
      `  if ! $BACKUP_AS test -e "${destination}" && ! $BACKUP_AS test -L "${destination}"; then echo "备份结果不存在: $${variable}"; exit 1; fi`,
      `  if ! printf 'saved\\t%s\\n' "$${variable}" >> "$SHELLPILOT_BACKUP_MANIFEST"; then echo "无法记录备份结果"; exit 1; fi`,
      'else',
      `  if ! printf 'missing\\t%s\\n' "$${variable}" >> "$SHELLPILOT_BACKUP_MANIFEST"; then echo "无法记录缺失目标"; exit 1; fi`,
      'fi'
    )
  })

  lines.push(
    'if ! printf \'ready\\n\' > "$OPERATION_ROLLBACK_DIR/BACKUP_COMPLETE"; then echo "无法确认备份完成"; exit 1; fi',
    'if [ ! -s "$OPERATION_ROLLBACK_DIR/BACKUP_COMPLETE" ]; then echo "备份完成标记无效"; exit 1; fi'
  )
  return lines.join('\n')
}

export function buildMutationVerification (metadata) {
  const validated = validateMutationSafetyMetadata(metadata)
  const lines = ['# __SHELLPILOT_MUTATION_VERIFY__']
  validated.verifyCommands.forEach((command, index) => {
    lines.push(
      `if ! ( ${command} ); then`,
      `  echo "修改后验证失败: ${index + 1}"`,
      '  exit 1',
      'fi'
    )
  })
  return lines.join('\n')
}

export function buildMutationSafetyCommand (metadata, mutationCommand) {
  if (typeof mutationCommand !== 'string' || !mutationCommand.trim()) {
    throw new Error('修改命令不能为空')
  }
  if (/\0/.test(mutationCommand)) {
    throw new Error('修改命令不能包含 NUL 字符')
  }
  return [
    '# __SHELLPILOT_MUTATION_PREFLIGHT__',
    buildMutationPreflight(metadata),
    buildMutationBackup(metadata),
    '# __SHELLPILOT_MUTATION_EXECUTE__',
    '(',
    'set -e',
    mutationCommand,
    ')',
    'SHELLPILOT_MUTATION_STATUS=$?',
    'if [ "$SHELLPILOT_MUTATION_STATUS" -ne 0 ]; then echo "修改命令执行失败"; exit "$SHELLPILOT_MUTATION_STATUS"; fi',
    buildMutationVerification(metadata)
  ].join('\n')
}
