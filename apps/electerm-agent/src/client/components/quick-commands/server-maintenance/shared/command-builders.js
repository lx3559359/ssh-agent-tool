import { quoteShellValue, validateAndNormalizeValue } from './validation.js'

const shellVariablePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function buildShellAssignment (shellName, value, validationType, options = {}) {
  if (!shellVariablePattern.test(String(shellName || ''))) {
    throw new Error(`Shell 变量名不合法: ${shellName || ''}`)
  }
  if (!validationType) {
    throw new Error(`${options.label || shellName}缺少校验类型，已拒绝生成 Shell 赋值`)
  }
  const validated = validateAndNormalizeValue(validationType, value, options)
  if (validated.error) throw new Error(validated.error)
  return `${shellName}=${quoteShellValue(validated.value)}`
}

export function buildShellAssignments (fields = [], values = {}) {
  if (!Array.isArray(fields)) {
    throw new Error('Shell 赋值字段必须是数组')
  }
  return fields.map(field => {
    if (!field || typeof field !== 'object') {
      throw new Error('Shell 赋值字段定义不完整')
    }
    return buildShellAssignment(
      field.shellName,
      values?.[field.name],
      field.validationType,
      field
    )
  }).join('\n')
}

export const buildValidatedShellAssignments = buildShellAssignments

const firewallMutationId = 'builtin-server-firewall-open-port'
const rollbackMutationIds = new Set([
  'builtin-server-network-change-ip',
  firewallMutationId,
  'builtin-server-service-action',
  'builtin-server-docker-action',
  'builtin-server-file-permission'
])
export const ufwGlobalAllowAwk = '\'($1 == rule && $2 == "ALLOW" && $3 == "Anywhere") || ($1 == rule && $2 == "(v6)" && $3 == "ALLOW" && $4 == "Anywhere" && $5 == "(v6)") { found=1 } END { exit found ? 0 : 1 }\''
const rollbackTempPattern = /TMP_ROLLBACK=(?:"\/tmp\/[^"\n]*rollback[^"\n]*\$\$\.sh"|"\$OPERATION_ROLLBACK_DIR\/firewall-rollback\.sh")/

export function buildPacketFilterArguments (value) {
  const validated = validateAndNormalizeValue('packet-filter', value, {
    label: '抓包过滤器',
    required: true,
    rejectTemplateTokens: true
  })
  if (validated.error) throw new Error(validated.error)
  const tokens = validated.value.match(/\(|\)|[^\s()]+/g) || []
  return tokens.map(quoteShellValue).join(' ')
}

function replaceRequired (text, search, replacement, label) {
  const found = typeof search === 'string' ? text.includes(search) : search.test(text)
  if (!found) {
    throw new Error(`无法安全构建${label}`)
  }
  return text.replace(search, () => replacement)
}

function replaceAllRequired (text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`\u65e0\u6cd5\u5b89\u5168\u6784\u5efa${label}`)
  }
  return text.split(search).join(replacement)
}

function hardenFirewallMutationCommand (commandText) {
  const templateRollbackMarker = 'TMP_ROLLBACK="$OPERATION_ROLLBACK_DIR/firewall-rollback.sh"'
  const stateCapture = `${templateRollbackMarker}
RULE_WAS_PRESENT="no"
FIREWALL_RUNTIME_WAS_PRESENT="no"
FIREWALL_PERMANENT_WAS_PRESENT="no"
if [ "$FIREWALL_KIND" = "firewalld" ]; then
  RICH_ACTION=accept; [ "$ACTION" = "deny" ] && RICH_ACTION=drop
  RICH_RULE="rule family=ipv4 source address=$SOURCE_CIDR port port=$PORT protocol=$PROTO $RICH_ACTION"
  if $RUN_AS firewall-cmd --query-rich-rule="$RICH_RULE" >/dev/null 2>&1; then
    FIREWALL_RUNTIME_WAS_PRESENT="yes"
  else
    FIREWALL_QUERY_STATUS=$?
    [ "$FIREWALL_QUERY_STATUS" = "1" ] || { echo "firewalld runtime rule query failed"; exit "$FIREWALL_QUERY_STATUS"; }
  fi
  if $RUN_AS firewall-cmd --permanent --query-rich-rule="$RICH_RULE" >/dev/null 2>&1; then
    FIREWALL_PERMANENT_WAS_PRESENT="yes"
  else
    FIREWALL_QUERY_STATUS=$?
    [ "$FIREWALL_QUERY_STATUS" = "1" ] || { echo "firewalld permanent rule query failed"; exit "$FIREWALL_QUERY_STATUS"; }
  fi
  if [ "$APPLY_MODE" = "permanent" ]; then RULE_WAS_PRESENT="$FIREWALL_PERMANENT_WAS_PRESENT"; else RULE_WAS_PRESENT="$FIREWALL_RUNTIME_WAS_PRESENT"; fi
elif [ "$FIREWALL_KIND" = "ufw" ]; then
  if [ "$ACTION" = "allow" ] && [ "$SOURCE_CIDR" = "0.0.0.0/0" ]; then
    if $RUN_AS ufw status | awk -v rule="$PORT/$PROTO" ${ufwGlobalAllowAwk}; then RULE_WAS_PRESENT="yes"; fi
  else
    UFW_EXPECTED_ACTION=ALLOW; [ "$ACTION" = "deny" ] && UFW_EXPECTED_ACTION=DENY
    UFW_EXPECTED_SOURCE="$SOURCE_CIDR"; [ "$SOURCE_CIDR" = "0.0.0.0/0" ] && UFW_EXPECTED_SOURCE=Anywhere
    if $RUN_AS ufw status | awk -v rule="$PORT/$PROTO" -v verdict="$UFW_EXPECTED_ACTION" -v source="$UFW_EXPECTED_SOURCE" '$1 == rule && $2 == verdict && $3 == source { found=1 } END { exit found ? 0 : 1 }'; then RULE_WAS_PRESENT="yes"; fi
  fi
fi`
  const firewalldRollback = `  {
    echo '#!/bin/sh'
    echo 'set -e'
    printf '# ShellPilot backup directory: %s\\n' "$OPERATION_ROLLBACK_DIR"
    echo 'query_firewalld_rule () {'
    echo '  if "$@"; then return 0; else FIREWALL_QUERY_STATUS=$?; fi'
    echo '  if [ "$FIREWALL_QUERY_STATUS" = "1" ]; then return 1; fi'
    echo '  exit "$FIREWALL_QUERY_STATUS"'
    echo '}'
    if [ "$RULE_WAS_PRESENT" = "yes" ]; then
      if [ "$APPLY_MODE" != "permanent" ]; then echo ':'; fi
    fi
    if [ "$APPLY_MODE" = "permanent" ]; then
      if [ "$FIREWALL_PERMANENT_WAS_PRESENT" != "yes" ]; then
        echo "$RUN_AS firewall-cmd --permanent --remove-rich-rule='$RICH_RULE'"
        echo "$RUN_AS firewall-cmd --reload"
      fi
      if [ "$FIREWALL_RUNTIME_WAS_PRESENT" = "yes" ]; then
        echo "if ! query_firewalld_rule $RUN_AS firewall-cmd --query-rich-rule='$RICH_RULE' >/dev/null 2>&1; then $RUN_AS firewall-cmd --add-rich-rule='$RICH_RULE'; fi"
      else
        echo "if query_firewalld_rule $RUN_AS firewall-cmd --query-rich-rule='$RICH_RULE' >/dev/null 2>&1; then $RUN_AS firewall-cmd --remove-rich-rule='$RICH_RULE'; fi"
      fi
    elif [ "$RULE_WAS_PRESENT" != "yes" ]; then
      echo "$RUN_AS firewall-cmd --remove-rich-rule='$RICH_RULE'"
    fi
  } > "$TMP_ROLLBACK"`
  const originalFirewalldRollback = `    {
      echo '#!/bin/sh'
      echo 'set -e'
      echo 'RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi'
      echo "$RUN_AS firewall-cmd $PERMANENT_ARG --remove-rich-rule='$RICH_RULE'"
      if [ "$APPLY_MODE" = "permanent" ]; then echo "$RUN_AS firewall-cmd --reload"; fi
    } > "$TMP_ROLLBACK"`
  const ufwRollback = `  {
    echo '#!/bin/sh'
    echo 'set -e'
    printf '# ShellPilot backup directory: %s\\n' "$OPERATION_ROLLBACK_DIR"
    if [ -e "$OPERATION_ROLLBACK_DIR/target-1" ]; then
      echo "$RUN_AS cp -a -- '$OPERATION_ROLLBACK_DIR/target-1' '/etc/ufw/user.rules'"
    else
      echo "$RUN_AS rm -f -- '/etc/ufw/user.rules'"
    fi
    if [ -e "$OPERATION_ROLLBACK_DIR/target-2" ]; then
      echo "$RUN_AS cp -a -- '$OPERATION_ROLLBACK_DIR/target-2' '/etc/ufw/user6.rules'"
    else
      echo "$RUN_AS rm -f -- '/etc/ufw/user6.rules'"
    fi
    echo "$RUN_AS ufw reload"
  } > "$TMP_ROLLBACK"`
  const originalUfwRollback = `    {
      echo '#!/bin/sh'
      echo 'set -e'
      echo 'RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi'
      echo "$RUN_AS ufw --force delete $ACTION proto $PROTO from $SOURCE_CIDR to any port $PORT"
    } > "$TMP_ROLLBACK"`

  let hardened = replaceRequired(
    commandText,
    templateRollbackMarker,
    stateCapture,
    '防火墙规则状态备份'
  )
  hardened = replaceRequired(
    hardened,
    originalFirewalldRollback,
    firewalldRollback,
    'firewalld 回滚脚本'
  )
  return replaceRequired(
    hardened,
    originalUfwRollback,
    ufwRollback,
    'ufw 回滚脚本'
  )
}

function buildRollbackFinalize (runAs) {
  return `if [ -L "$TMP_ROLLBACK" ] || [ ! -f "$TMP_ROLLBACK" ]; then echo "回滚临时文件类型不安全"; exit 1; fi
TMP_ROLLBACK_WRITTEN_INODE="$(stat -c %d:%i -- "$TMP_ROLLBACK" 2>/dev/null)" || { echo "无法复验回滚临时文件"; exit 1; }
if [ "$TMP_ROLLBACK_WRITTEN_INODE" != "$TMP_ROLLBACK_INODE" ]; then echo "回滚临时文件已被替换"; exit 1; fi
${runAs}mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT" || { echo "无法移动回滚脚本"; exit 1; }
${runAs}chmod 700 "$ROLLBACK_SCRIPT" || { echo "无法设置回滚脚本权限"; exit 1; }
if [ -L "$ROLLBACK_SCRIPT" ] || [ ! -f "$ROLLBACK_SCRIPT" ]; then echo "回滚脚本类型不安全"; exit 1; fi
ROLLBACK_FINAL_INODE="$(stat -c %d:%i -- "$ROLLBACK_SCRIPT" 2>/dev/null)" || { echo "无法确认回滚脚本 inode"; exit 1; }
ROLLBACK_FINAL_OWNER="$(stat -c %u -- "$ROLLBACK_SCRIPT" 2>/dev/null)" || { echo "无法确认回滚脚本所有者"; exit 1; }
ROLLBACK_FINAL_MODE="$(stat -c %a -- "$ROLLBACK_SCRIPT" 2>/dev/null)" || { echo "无法确认回滚脚本权限"; exit 1; }
if [ "$ROLLBACK_FINAL_INODE" != "$TMP_ROLLBACK_INODE" ] || [ "$ROLLBACK_FINAL_OWNER" != "$CURRENT_UID" ] || [ "$ROLLBACK_FINAL_MODE" != "700" ]; then echo "回滚脚本复验失败"; exit 1; fi`
}

function hardenRollbackScriptCommand (commandText) {
  const secureTemporaryFile = `case "$ROLLBACK_SCRIPT" in "$ROLLBACK_DIR"/*) ;; *) echo "回滚脚本路径不在固定目录"; exit 1;; esac
ROLLBACK_NAME="\${ROLLBACK_SCRIPT#"$ROLLBACK_DIR"/}"
case "$ROLLBACK_NAME" in ""|[!a-zA-Z0-9]*|*/*|*..*|*[!a-zA-Z0-9._-]*) echo "回滚脚本文件名不安全"; exit 1;; esac
if [ -L "$ROLLBACK_SCRIPT" ] || { [ -e "$ROLLBACK_SCRIPT" ] && [ ! -f "$ROLLBACK_SCRIPT" ]; }; then echo "回滚脚本目标类型不安全"; exit 1; fi
TMP_ROLLBACK="$(mktemp "$OPERATION_ROLLBACK_DIR/rollback.XXXXXX")" || { echo "无法创建私有回滚临时文件"; exit 1; }
if [ -L "$TMP_ROLLBACK" ] || [ ! -f "$TMP_ROLLBACK" ]; then echo "回滚临时文件类型不安全"; exit 1; fi
TMP_ROLLBACK_INODE="$(stat -c %d:%i -- "$TMP_ROLLBACK" 2>/dev/null)" || { echo "无法确认回滚临时文件 inode"; exit 1; }
TMP_ROLLBACK_OWNER="$(stat -c %u -- "$TMP_ROLLBACK" 2>/dev/null)" || { echo "无法确认回滚临时文件所有者"; exit 1; }
TMP_ROLLBACK_MODE="$(stat -c %a -- "$TMP_ROLLBACK" 2>/dev/null)" || { echo "无法确认回滚临时文件权限"; exit 1; }
if [ "$TMP_ROLLBACK_OWNER" != "$CURRENT_UID" ] || [ "$TMP_ROLLBACK_MODE" != "600" ]; then echo "回滚临时文件所有者或权限不安全"; exit 1; fi`
  let hardened = replaceRequired(
    commandText,
    rollbackTempPattern,
    secureTemporaryFile,
    '私有回滚临时文件'
  )
  const privilegedFinalize = '$RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"'
  const privilegedInstallFinalize = '$RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"'
  const localFinalize = 'mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; chmod 700 "$ROLLBACK_SCRIPT"'

  if (hardened.includes(privilegedInstallFinalize)) {
    hardened = replaceAllRequired(
      hardened,
      privilegedInstallFinalize,
      buildRollbackFinalize('$RUN_AS '),
      '\u9632\u706b\u5899\u56de\u6eda\u811a\u672c\u843d\u76d8\u590d\u9a8c'
    )
  } else if (hardened.includes(privilegedFinalize)) {
    hardened = replaceRequired(
      hardened,
      privilegedFinalize,
      buildRollbackFinalize('$RUN_AS '),
      '回滚脚本落盘复验'
    )
  } else {
    hardened = replaceRequired(
      hardened,
      localFinalize,
      buildRollbackFinalize(''),
      '回滚脚本落盘复验'
    )
  }
  return hardened
}

export function hardenMutationCommand (commandId, commandText) {
  let hardened = commandText
  if (commandId === firewallMutationId) {
    hardened = hardenFirewallMutationCommand(hardened)
  }
  if (!rollbackMutationIds.has(commandId)) return hardened
  return hardenRollbackScriptCommand(hardened)
}
