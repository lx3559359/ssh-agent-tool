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

function replaceRequired (text, search, replacement, label) {
  const found = typeof search === 'string' ? text.includes(search) : search.test(text)
  if (!found) {
    throw new Error(`无法安全构建${label}`)
  }
  return text.replace(search, () => replacement)
}

function hardenFirewallMutationCommand (commandText) {
  const rollbackMarker = 'TMP_ROLLBACK="/tmp/shellpilot-firewall-rollback-$$.sh"'
  const stateCapture = `${rollbackMarker}
RULE_WAS_PRESENT="no"
if [ "$FIREWALL_KIND" = "firewalld" ] || { [ "$FIREWALL_KIND" = "auto" ] && command -v firewall-cmd >/dev/null 2>&1; }; then
  QUERY_PERMANENT=""
  if [ "$APPLY_MODE" = "permanent" ]; then QUERY_PERMANENT="--permanent"; fi
  if $RUN_AS firewall-cmd $QUERY_PERMANENT --query-port="$PORT/$PROTO" >/dev/null 2>&1; then RULE_WAS_PRESENT="yes"; fi
elif [ "$FIREWALL_KIND" = "ufw" ] || { [ "$FIREWALL_KIND" = "auto" ] && command -v ufw >/dev/null 2>&1; }; then
  if $RUN_AS ufw status | grep -F -- "$PORT/$PROTO" >/dev/null 2>&1; then RULE_WAS_PRESENT="yes"; fi
fi`
  const firewalldRollback = `  {
    echo '#!/bin/sh'
    printf '# ShellPilot backup directory: %s\\n' "$OPERATION_ROLLBACK_DIR"
    if [ "$RULE_WAS_PRESENT" = "yes" ]; then
      if [ "$APPLY_MODE" = "permanent" ]; then
        echo "$RUN_AS firewall-cmd --add-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
      else
        echo "$RUN_AS firewall-cmd --add-port=$PORT/$PROTO"
      fi
    elif [ "$APPLY_MODE" = "permanent" ]; then
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
    else
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO"
    fi
  } > "$TMP_ROLLBACK"`
  const originalFirewalldRollback = `  {
    echo '#!/bin/sh'
    if [ "$APPLY_MODE" = "permanent" ]; then
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
    else
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO"
    fi
  } > "$TMP_ROLLBACK"`
  const ufwRollback = `  {
    echo '#!/bin/sh'
    printf '# ShellPilot backup directory: %s\\n' "$OPERATION_ROLLBACK_DIR"
    if [ "$RULE_WAS_PRESENT" = "yes" ]; then
      echo "$RUN_AS ufw allow $PORT/$PROTO"
    else
      echo "$RUN_AS ufw delete allow $PORT/$PROTO"
    fi
  } > "$TMP_ROLLBACK"`
  const originalUfwRollback = / {2}printf '%s\n' '#!\/bin\/sh' "\$RUN_AS ufw delete allow \$PORT\/\$PROTO" > "\$TMP_ROLLBACK"/

  let hardened = replaceRequired(
    commandText,
    rollbackMarker,
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

export function hardenMutationCommand (commandId, commandText) {
  if (commandId !== firewallMutationId) return commandText
  return hardenFirewallMutationCommand(commandText)
}
