const minimumFreeKilobytes = 10240
const rollbackDirectory = '/tmp/shellpilot-rollback'

function cloneStringArray (value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map(item => String(item)).filter(item => item.trim())
}

export function createMutationSafetyMetadata ({
  title,
  backupTargets,
  verifyCommands
} = {}) {
  const normalizedVerifyCommands = cloneStringArray(verifyCommands, '验证命令')
  if (!normalizedVerifyCommands.length) {
    throw new Error('修改命令必须提供至少一个验证命令')
  }
  return {
    title,
    minFreeKb: minimumFreeKilobytes,
    backupTargets: cloneStringArray(backupTargets, '备份目标'),
    verifyCommands: normalizedVerifyCommands,
    rollbackDirectory,
    requireConfirmation: true
  }
}

export function buildMutationPreflight (metadata = {}) {
  const minFreeKb = metadata.minFreeKb ?? minimumFreeKilobytes
  const directory = metadata.rollbackDirectory ?? rollbackDirectory
  if (!Number.isSafeInteger(Number(minFreeKb)) || Number(minFreeKb) < 1) {
    throw new Error('回滚目录最小可用空间配置不正确')
  }
  if (directory !== rollbackDirectory) {
    throw new Error('回滚目录必须是 /tmp/shellpilot-rollback')
  }
  return [
    'set -u',
    `ROLLBACK_DIR='${rollbackDirectory}'`,
    `MIN_FREE_KB=${Number(minFreeKb)}`,
    'FREE_KB=$(df -Pk /tmp 2>/dev/null | awk \'NR == 2 { print $4 }\')',
    'case "$FREE_KB" in ""|*[!0-9]*) echo "无法确认 /tmp 可用空间"; exit 1;; esac',
    'if [ "$FREE_KB" -lt "$MIN_FREE_KB" ]; then echo "回滚目录可用空间不足"; exit 1; fi',
    'if ! mkdir -p -- "$ROLLBACK_DIR"; then echo "无法创建回滚目录"; exit 1; fi',
    'if [ ! -d "$ROLLBACK_DIR" ] || [ ! -w "$ROLLBACK_DIR" ]; then echo "回滚目录不可用"; exit 1; fi'
  ].join('\n')
}
