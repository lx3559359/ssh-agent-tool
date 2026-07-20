import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, selectParam } from './shared/definition.js'

export function getSecurityCommands () {
  return [
    defineCommand({
      id: 'builtin-server-ssh-security-events',
      name: 'SSH 安全事件',
      description: '筛选最近 24 小时的 SSH 失败、无效用户、成功登录和断开事件。',
      usage: '用于排查暴力尝试、异常登录来源、认证成功记录和频繁断连。',
      labels: [READ_ONLY, '安全'],
      advancedUsage: [
        '优先读取 ssh 与 sshd 的 systemd 日志，失败时回退到 auth.log 或 secure。',
        '只输出匹配的最近诊断流，最多 200 行，不启动 pager 或持续跟随。'
      ],
      commands: [
        step(String.raw`(
  run_journal_security_events () {
    {
      journalctl -u ssh -u sshd --since "-24 hours" --no-pager 2>/dev/null
      printf '\\036SHELLPILOT_SSH_STATUS=%s\\n' "$?"
    } | awk '
      BEGIN {
        limit = 200
        marker = sprintf("%c", 30) "SHELLPILOT_SSH_STATUS="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          if (length(prefix) > 0 && tolower(prefix) ~ /(failed|invalid|accepted|disconnect)/) {
            if (emitted < limit) {
              print prefix
              emitted++
            } else {
              truncated = 1
            }
          }
          command_status = substr($0, marker_position + length(marker))
          status_seen = 1
          next
        }
        if (tolower($0) ~ /(failed|invalid|accepted|disconnect)/) {
          if (emitted < limit) {
            print
            emitted++
            next
          }
          truncated = 1
          exit
        }
      }
      END {
        if (truncated || (status_seen && command_status == 0)) {
          exit 0
        }
        exit 1
      }
    '
  }

  run_log_security_events () {
    {
      if [ -r /var/log/auth.log ]; then
        awk 'tolower($0) ~ /(failed|invalid|accepted|disconnect)/ { print }' /var/log/auth.log
      fi
      if [ -r /var/log/secure ]; then
        awk 'tolower($0) ~ /(failed|invalid|accepted|disconnect)/ { print }' /var/log/secure
      fi
    } | awk '
      NR <= 200 {
        print
        next
      }
      {
        exit
      }
    '
  }

  if command -v journalctl >/dev/null 2>&1 && run_journal_security_events; then
    true
  elif [ -r /var/log/auth.log ] || [ -r /var/log/secure ]; then
    run_log_security_events
  else
    printf '未找到可读的 SSH 安全日志（/var/log/auth.log 或 /var/log/secure）。\\n'
  fi
)
true`)
      ]
    }),
    defineCommand({
      id: 'builtin-server-firewall-status',
      name: '防火墙状态',
      description: '查看 firewalld、ufw、iptables/nftables 当前规则。',
      usage: '用于确认端口不通是否被防火墙或安全策略拦截。',
      labels: [READ_ONLY, '防火墙'],
      advancedUsage: [
        '只看 firewalld：firewall-cmd --list-all',
        '只看 iptables：iptables -S'
      ],
      commands: [
        step('systemctl status firewalld --no-pager 2>/dev/null || true'),
        step('firewall-cmd --list-all 2>/dev/null || ufw status verbose 2>/dev/null || true'),
        step('iptables -S 2>/dev/null || nft list ruleset 2>/dev/null || true')
      ]
    }),
    defineCommand({
      id: 'builtin-server-firewall-open-port',
      name: '放行防火墙端口',
      description: '按当前连接端口生成 firewalld/ufw 放行命令。',
      usage: '默认端口来自当前连接，执行前请确认不是误放行敏感端口。',
      labels: [NEED_EDIT, '防火墙', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: '防火墙端口放行',
        pathParam: '回滚脚本',
        actionParam: '生效方式',
        mutatingValues: ['permanent', 'runtime'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '端口',
          label: '端口',
          type: 'input',
          defaultValue: '{{端口}}',
          placeholder: '例如 80、443、3306',
          help: '默认取当前 SSH 端口；开放业务服务时请改成实际业务端口。'
        },
        {
          name: '协议',
          label: '协议',
          type: 'select',
          defaultValue: 'tcp',
          help: 'Web、SSH、数据库多数是 tcp；DNS、部分游戏服务可能是 udp。',
          options: [
            { label: 'TCP', value: 'tcp' },
            { label: 'UDP', value: 'udp' }
          ]
        },
        {
          name: '防火墙类型',
          label: '防火墙类型',
          type: 'select',
          defaultValue: 'auto',
          help: '自动模式会优先使用 firewalld，其次 ufw；不确定时保持自动。',
          options: [
            { label: '自动识别', value: 'auto' },
            { label: 'firewalld', value: 'firewalld' },
            { label: 'ufw', value: 'ufw' }
          ]
        },
        {
          name: '生效方式',
          label: '生效方式',
          type: 'select',
          defaultValue: 'permanent',
          help: '永久生效会写入配置并 reload；临时生效重启后可能失效。',
          options: [
            { label: '永久生效', value: 'permanent' },
            { label: '临时生效', value: 'runtime' }
          ]
        }
      ],
      advancedUsage: [
        'firewalld 永久放行：sudo firewall-cmd --add-port={{端口}}/{{协议}} --permanent && sudo firewall-cmd --reload',
        'ufw 放行：sudo ufw allow {{端口}}/{{协议}}',
        'firewalld 回滚：sudo firewall-cmd --remove-port={{端口}}/{{协议}} --permanent && sudo firewall-cmd --reload',
        'ufw 回滚：sudo ufw delete allow {{端口}}/{{协议}}'
      ],
      commands: [
        step(`PORT="{{端口}}"
PROTO="{{协议}}"
FIREWALL_KIND="{{防火墙类型}}"
APPLY_MODE="{{生效方式}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
RUN_AS=""
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "当前不是 root 且没有 sudo，无法修改防火墙"; exit 1; fi
fi
case "$PORT" in *[!0-9]*|"") echo "端口必须是数字"; exit 1;; esac
echo "准备放行: $PORT/$PROTO，类型=$FIREWALL_KIND，方式=$APPLY_MODE"
echo "回滚参考 firewalld: $RUN_AS firewall-cmd --remove-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
echo "回滚参考 ufw: $RUN_AS ufw delete allow $PORT/$PROTO"
if [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改防火墙。"; exit 0; fi
$RUN_AS mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-firewall-rollback-$$.sh"
if [ "$FIREWALL_KIND" = "firewalld" ] || { [ "$FIREWALL_KIND" = "auto" ] && command -v firewall-cmd >/dev/null 2>&1; }; then
  {
    echo '#!/bin/sh'
    if [ "$APPLY_MODE" = "permanent" ]; then
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
    else
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO"
    fi
  } > "$TMP_ROLLBACK"
  $RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
  if [ "$APPLY_MODE" = "permanent" ]; then
    $RUN_AS firewall-cmd --add-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload
  else
    $RUN_AS firewall-cmd --add-port=$PORT/$PROTO
  fi
  echo "回滚脚本: $ROLLBACK_SCRIPT"; exit $?
fi
if [ "$FIREWALL_KIND" = "ufw" ] || { [ "$FIREWALL_KIND" = "auto" ] && command -v ufw >/dev/null 2>&1; }; then
  printf '%s\n' '#!/bin/sh' "$RUN_AS ufw delete allow $PORT/$PROTO" > "$TMP_ROLLBACK"
  $RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
  $RUN_AS ufw allow $PORT/$PROTO
  echo "回滚脚本: $ROLLBACK_SCRIPT"; exit $?
fi
echo "未检测到 firewalld 或 ufw，请手动确认 iptables/nftables 规则"; exit 1`)
      ]
    }),
    defineCommand({
      id: 'builtin-server-file-permission',
      name: '文件权限与归属',
      description: '按路径预览或修改文件权限、所有者和所属组。',
      usage: '默认只预览；执行修改前记录原权限和归属并生成快捷回滚。',
      labels: [NEED_EDIT, '文件', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: '文件权限与归属修改',
        pathParam: '回滚脚本',
        actionParam: '操作',
        mutatingValues: ['apply'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        inputParam('目标路径', '目标路径', '/var/www', '填写单个文件或目录的绝对路径，本操作默认不递归。', '例如 /var/www/app'),
        inputParam('权限模式', '权限模式', '755', '填写 3 或 4 位八进制权限，例如 644、755、0750。', '例如 755'),
        inputParam('所有者', '所有者', '', '可留空表示不修改；例如 root、www-data。', '例如 www-data'),
        inputParam('所属组', '所属组', '', '可留空表示不修改；例如 root、www-data。', '例如 www-data'),
        selectParam('操作', '操作', 'preview', '预览会显示 stat 和路径权限；应用才会修改。', [
          { label: '只预览', value: 'preview' },
          { label: '应用修改', value: 'apply' }
        ])
      ],
      advancedUsage: [
        '本功能默认不递归，避免一次改坏整个目录树。',
        '回滚脚本会恢复目标当前的权限、所有者和所属组。'
      ],
      commands: [
        step(`TARGET="{{目标路径}}"
MODE="{{权限模式}}"
OWNER="{{所有者}}"
GROUP="{{所属组}}"
ACTION="{{操作}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi
if [ ! -e "$TARGET" ]; then echo "路径不存在: $TARGET"; exit 1; fi
echo "当前信息:"; stat -c '路径=%n 权限=%a 所有者=%U 所属组=%G' "$TARGET"; namei -l "$TARGET" 2>/dev/null || true
if [ "$ACTION" != "apply" ] || [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改文件。"; exit 0; fi
case "$MODE" in [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) ;; *) echo "权限模式必须是 3 或 4 位八进制数"; exit 1;; esac
OLD_MODE="$(stat -c %a "$TARGET")"; OLD_OWNER="$(stat -c %U "$TARGET")"; OLD_GROUP="$(stat -c %G "$TARGET")"
$RUN_AS mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-file-rollback-$$.sh"
printf '%s\n' '#!/bin/sh' "$RUN_AS chmod '$OLD_MODE' '$TARGET'" "$RUN_AS chown '$OLD_OWNER:$OLD_GROUP' '$TARGET'" > "$TMP_ROLLBACK"
$RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
$RUN_AS chmod "$MODE" "$TARGET"
if [ -n "$OWNER$GROUP" ]; then $RUN_AS chown "\${OWNER:-$OLD_OWNER}:\${GROUP:-$OLD_GROUP}" "$TARGET"; fi
stat -c '修改后: 路径=%n 权限=%a 所有者=%U 所属组=%G' "$TARGET"
echo "回滚脚本: $ROLLBACK_SCRIPT"`)
      ]
    })
  ]
}

const fixedSecurityDiagnosticCommands = getSecurityCommands()

export const SSH_SECURITY_EVENTS_DIAGNOSTIC_COMMAND = fixedSecurityDiagnosticCommands
  .find(command => command.id === 'builtin-server-ssh-security-events').commands[0].command
