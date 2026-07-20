const minimumFreeKilobytes = 10240
const rollbackDirectory = '/tmp/shellpilot-rollback'

function assertSafeString (value, label) {
  if (typeof value !== 'string') throw new Error(`${label}必须是非空字符串`)
  if (/[\r\n\0]/.test(value)) throw new Error(`${label}不能包含换行或 NUL 字符`)
  if (!value.trim()) throw new Error(`${label}不能为空`)
  return value
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

function validateMutationSafetyMetadata (metadata) {
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
  const validated = {
    ...metadata,
    title,
    backupTargets: cloneStringArray(metadata.backupTargets, '备份目标'),
    verifyCommands: cloneStringArray(metadata.verifyCommands, '验证命令', { required: true })
  }
  if (metadata.rollbackScript !== undefined) {
    validated.rollbackScript = assertSafeString(metadata.rollbackScript, '回滚脚本')
  }
  return validated
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
    backupTargets: cloneStringArray(backupTargets, '备份目标', { allowUndefined: true }),
    verifyCommands: cloneStringArray(verifyCommands, '验证命令', { required: true }),
    rollbackDirectory,
    requireConfirmation: true
  }
  if (rollbackScript !== undefined) {
    metadata.rollbackScript = assertSafeString(rollbackScript, '回滚脚本')
  }
  return validateMutationSafetyMetadata(metadata)
}

export function buildMutationPreflight (metadata) {
  const validated = validateMutationSafetyMetadata(metadata)
  return [
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
    'if [ "$OPERATION_OWNER" != "$CURRENT_UID" ] || [ "$OPERATION_MODE" != "700" ]; then echo "操作回滚目录所有者或权限不安全"; exit 1; fi',
    'export OPERATION_ROLLBACK_DIR'
  ].join('\n')
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
    'if ! : > "$SHELLPILOT_BACKUP_MANIFEST"; then echo "无法创建备份清单"; exit 1; fi'
  ]
  if (validated.rollbackScript) {
    lines.push(
      `SHELLPILOT_ROLLBACK_SCRIPT=${quoteShellLiteral(validated.rollbackScript)}`,
      'if ! printf \'rollback-script\\t%s\\n\' "$SHELLPILOT_ROLLBACK_SCRIPT" >> "$SHELLPILOT_BACKUP_MANIFEST"; then echo "无法关联回滚脚本"; exit 1; fi',
      'export SHELLPILOT_ROLLBACK_SCRIPT'
    )
  }

  validated.backupTargets.forEach((target, index) => {
    const number = index + 1
    const variable = `SHELLPILOT_BACKUP_TARGET_${number}`
    const destination = `$OPERATION_ROLLBACK_DIR/target-${number}`
    lines.push(
      `${variable}=${quoteShellLiteral(target)}`,
      `if [ -e "$${variable}" ] || [ -L "$${variable}" ]; then`,
      `  if ! cp -a -- "$${variable}" "${destination}"; then rm -rf -- "${destination}"; echo "备份目标失败: $${variable}"; exit 1; fi`,
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
