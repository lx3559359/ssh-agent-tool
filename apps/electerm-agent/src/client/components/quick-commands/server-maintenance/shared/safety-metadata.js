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
  if (!Number.isSafeInteger(metadata.minFreeKb) || metadata.minFreeKb < 1) {
    throw new Error('回滚目录最小可用空间配置不正确')
  }
  return {
    ...metadata,
    title,
    backupTargets: cloneStringArray(metadata.backupTargets, '备份目标'),
    verifyCommands: cloneStringArray(metadata.verifyCommands, '验证命令', { required: true })
  }
}

export function createMutationSafetyMetadata ({
  title,
  backupTargets,
  verifyCommands
} = {}) {
  const metadata = {
    title: assertSafeString(title, '修改标题'),
    minFreeKb: minimumFreeKilobytes,
    backupTargets: cloneStringArray(backupTargets, '备份目标', { allowUndefined: true }),
    verifyCommands: cloneStringArray(verifyCommands, '验证命令', { required: true }),
    rollbackDirectory,
    requireConfirmation: true
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
