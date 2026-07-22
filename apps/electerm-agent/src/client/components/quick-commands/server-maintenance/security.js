import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, selectParam } from './shared/definition.js'
import { withRollback } from './shared/safety-metadata.js'
import { ufwGlobalAllowAwk } from './shared/command-builders.js'

const verifyUfwRule = `if [ "$VERIFY_ACTION" = "allow" ] && [ "$VERIFY_SOURCE_CIDR" = "0.0.0.0/0" ]; then $VERIFY_AS ufw status | awk -v rule="{{\u7aef\u53e3}}/{{\u534f\u8bae}}" ${ufwGlobalAllowAwk}; else $VERIFY_AS ufw status | awk -v rule="$VERIFY_RULE" -v verdict="$VERIFY_UFW_ACTION" -v source="$VERIFY_UFW_SOURCE" '$1 == rule && $2 == verdict && $3 == source { found=1 } END { exit found ? 0 : 1 }'; fi`
const verifyFirewalldRule = '$VERIFY_AS firewall-cmd $VERIFY_PERMANENT_ARG --query-rich-rule="$VERIFY_RICH_RULE" >/dev/null'
const verifyIptablesRule = '$VERIFY_AS iptables -C INPUT -p "$VERIFY_PROTO" -s "$VERIFY_SOURCE_CIDR" --dport "$VERIFY_PORT" -j "$VERIFY_TARGET"'
const verifyNftablesRule = '$VERIFY_AS nft list chain inet shellpilot input | grep -F -- "$VERIFY_MARKER" >/dev/null'
const firewallVerificationCommand = [
  'VERIFY_AS=""; [ "$(id -u)" = "0" ] || VERIFY_AS="sudo";',
  'VERIFY_FIREWALL_KIND="{{\u9632\u706b\u5899\u7c7b\u578b}}"; VERIFY_ACTION="{{\u64cd\u4f5c}}"; VERIFY_SOURCE_CIDR="{{\u6765\u6e90CIDR}}"; VERIFY_PORT="{{\u7aef\u53e3}}"; VERIFY_PROTO="{{\u534f\u8bae}}"; VERIFY_RULE="{{\u7aef\u53e3}}/{{\u534f\u8bae}}";',
  'if [ "$VERIFY_FIREWALL_KIND" = "auto" ]; then VERIFY_BACKEND_FILE="$OPERATION_ROLLBACK_DIR/firewall.backend"; if [ -L "$VERIFY_BACKEND_FILE" ] || [ ! -f "$VERIFY_BACKEND_FILE" ]; then exit 1; fi; VERIFY_BACKEND_OWNER="$(stat -c %u -- "$VERIFY_BACKEND_FILE" 2>/dev/null)" || exit 1; VERIFY_BACKEND_MODE="$(stat -c %a -- "$VERIFY_BACKEND_FILE" 2>/dev/null)" || exit 1; if [ "$VERIFY_BACKEND_OWNER" != "$CURRENT_UID" ] || [ "$VERIFY_BACKEND_MODE" != "600" ]; then exit 1; fi; VERIFY_BACKEND_LINES="$(wc -l < "$VERIFY_BACKEND_FILE" 2>/dev/null)" || exit 1; [ "$VERIFY_BACKEND_LINES" = "1" ] || exit 1; IFS= read -r VERIFY_FIREWALL_KIND < "$VERIFY_BACKEND_FILE" || exit 1; case "$VERIFY_FIREWALL_KIND" in firewalld|ufw|iptables|nftables) ;; *) exit 1;; esac; fi;',
  'VERIFY_PERMANENT_ARG=""; [ "{{\u751f\u6548\u65b9\u5f0f}}" = "permanent" ] && VERIFY_PERMANENT_ARG="--permanent"; VERIFY_RICH_ACTION="accept"; VERIFY_TARGET="ACCEPT"; VERIFY_UFW_ACTION="ALLOW"; [ "$VERIFY_ACTION" = "deny" ] && { VERIFY_RICH_ACTION="drop"; VERIFY_TARGET="DROP"; VERIFY_UFW_ACTION="DENY"; };',
  'VERIFY_RICH_RULE="rule family=ipv4 source address=$VERIFY_SOURCE_CIDR port port=$VERIFY_PORT protocol=$VERIFY_PROTO $VERIFY_RICH_ACTION"; VERIFY_UFW_SOURCE="$VERIFY_SOURCE_CIDR"; [ "$VERIFY_SOURCE_CIDR" = "0.0.0.0/0" ] && VERIFY_UFW_SOURCE="Anywhere"; VERIFY_MARKER="shellpilot-{{\u64cd\u4f5c}}-{{\u6765\u6e90CIDR}}-{{\u7aef\u53e3}}-{{\u534f\u8bae}}";',
  `case "$VERIFY_FIREWALL_KIND" in firewalld) command -v firewall-cmd >/dev/null 2>&1 && ${verifyFirewalldRule} ;; ufw) command -v ufw >/dev/null 2>&1 || exit 1; ${verifyUfwRule} ;; iptables) command -v iptables >/dev/null 2>&1 && ${verifyIptablesRule} ;; nftables) command -v nft >/dev/null 2>&1 && ${verifyNftablesRule} ;; *) exit 1 ;; esac`
].join(' ')

const firewallPolicyCommand = `PORT="{{\u7aef\u53e3}}"
ACTION="{{\u64cd\u4f5c}}"
SOURCE_CIDR="{{\u6765\u6e90CIDR}}"
PROTO="{{\u534f\u8bae}}"
FIREWALL_KIND="{{\u9632\u706b\u5899\u7c7b\u578b}}"
APPLY_MODE="{{\u751f\u6548\u65b9\u5f0f}}"
APPLY_CHANGE="{{\u786e\u8ba4\u6267\u884c}}"
ROLLBACK_SCRIPT="{{\u56de\u6eda\u811a\u672c}}"
echo "\u9884\u89c8: $ACTION $SOURCE_CIDR -> $PORT/$PROTO\uff0c\u7c7b\u578b $FIREWALL_KIND\uff0c\u65b9\u5f0f $APPLY_MODE"
if [ "$APPLY_CHANGE" != "yes" ]; then echo "\u5f53\u524d\u4e3a\u53ea\u8bfb\u9884\u89c8\uff0c\u672a\u4fee\u6539\u9632\u706b\u5899"; exit 0; fi
RUN_AS=""
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "\u5f53\u524d\u8d26\u53f7\u65e0\u6cd5\u4fee\u6539\u9632\u706b\u5899"; exit 1; fi
fi
if [ "$FIREWALL_KIND" = "auto" ]; then
  if command -v firewall-cmd >/dev/null 2>&1; then FIREWALL_KIND=firewalld
  elif command -v ufw >/dev/null 2>&1; then FIREWALL_KIND=ufw
  elif command -v iptables >/dev/null 2>&1; then FIREWALL_KIND=iptables
  elif command -v nft >/dev/null 2>&1; then FIREWALL_KIND=nftables
  else echo "\u672a\u68c0\u6d4b\u5230\u53ef\u7528\u7684\u9632\u706b\u5899\u5de5\u5177"; exit 1; fi
fi
case "$FIREWALL_KIND" in firewalld|ufw|iptables|nftables) ;; *) echo "\u4e0d\u652f\u6301\u7684\u9632\u706b\u5899\u7c7b\u578b: $FIREWALL_KIND"; exit 1;; esac
FIREWALL_BACKEND_FILE="$OPERATION_ROLLBACK_DIR/firewall.backend"
if [ -L "$FIREWALL_BACKEND_FILE" ] || { [ -e "$FIREWALL_BACKEND_FILE" ] && [ ! -f "$FIREWALL_BACKEND_FILE" ]; }; then echo "\u9632\u706b\u5899\u7c7b\u578b\u8bb0\u5f55\u6587\u4ef6\u4e0d\u5b89\u5168"; exit 1; fi
(umask 077; printf '%s\\n' "$FIREWALL_KIND" > "$FIREWALL_BACKEND_FILE") || { echo "\u65e0\u6cd5\u8bb0\u5f55\u9632\u706b\u5899\u7c7b\u578b"; exit 1; }
chmod 600 "$FIREWALL_BACKEND_FILE" || { echo "\u65e0\u6cd5\u4fdd\u62a4\u9632\u706b\u5899\u7c7b\u578b\u8bb0\u5f55"; exit 1; }
FIREWALL_BACKEND_OWNER="$(stat -c %u -- "$FIREWALL_BACKEND_FILE" 2>/dev/null)" || { echo "\u65e0\u6cd5\u786e\u8ba4\u9632\u706b\u5899\u7c7b\u578b\u8bb0\u5f55\u6240\u6709\u8005"; exit 1; }
FIREWALL_BACKEND_MODE="$(stat -c %a -- "$FIREWALL_BACKEND_FILE" 2>/dev/null)" || { echo "\u65e0\u6cd5\u786e\u8ba4\u9632\u706b\u5899\u7c7b\u578b\u8bb0\u5f55\u6743\u9650"; exit 1; }
if [ -L "$FIREWALL_BACKEND_FILE" ] || [ ! -f "$FIREWALL_BACKEND_FILE" ] || [ "$FIREWALL_BACKEND_OWNER" != "$CURRENT_UID" ] || [ "$FIREWALL_BACKEND_MODE" != "600" ]; then echo "\u9632\u706b\u5899\u7c7b\u578b\u8bb0\u5f55\u590d\u9a8c\u5931\u8d25"; exit 1; fi
TMP_ROLLBACK="$OPERATION_ROLLBACK_DIR/firewall-rollback.sh"
case "$FIREWALL_KIND" in
  firewalld)
    command -v firewall-cmd >/dev/null 2>&1 || { echo "firewall-cmd \u4e0d\u53ef\u7528"; exit 1; }
    $RUN_AS firewall-cmd --list-all-zones > "$OPERATION_ROLLBACK_DIR/firewalld.before"
    RICH_ACTION=accept; [ "$ACTION" = "deny" ] && RICH_ACTION=drop
    RICH_RULE="rule family=ipv4 source address=$SOURCE_CIDR port port=$PORT protocol=$PROTO $RICH_ACTION"
    PERMANENT_ARG=""; [ "$APPLY_MODE" = "permanent" ] && PERMANENT_ARG="--permanent"
    {
      echo '#!/bin/sh'
      echo 'set -e'
      echo 'RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi'
      echo "$RUN_AS firewall-cmd $PERMANENT_ARG --remove-rich-rule='$RICH_RULE'"
      if [ "$APPLY_MODE" = "permanent" ]; then echo "$RUN_AS firewall-cmd --reload"; fi
    } > "$TMP_ROLLBACK"
    $RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
    $RUN_AS firewall-cmd $PERMANENT_ARG --add-rich-rule="$RICH_RULE"
    if [ "$APPLY_MODE" = "permanent" ]; then $RUN_AS firewall-cmd --reload; fi
    $RUN_AS firewall-cmd $PERMANENT_ARG --query-rich-rule="$RICH_RULE" >/dev/null
    ;;
  ufw)
    command -v ufw >/dev/null 2>&1 || { echo "ufw \u4e0d\u53ef\u7528"; exit 1; }
    $RUN_AS ufw status numbered > "$OPERATION_ROLLBACK_DIR/ufw.before"
    {
      echo '#!/bin/sh'
      echo 'set -e'
      echo 'RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi'
      echo "$RUN_AS ufw --force delete $ACTION proto $PROTO from $SOURCE_CIDR to any port $PORT"
    } > "$TMP_ROLLBACK"
    $RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
    if [ "$ACTION" = "allow" ] && [ "$SOURCE_CIDR" = "0.0.0.0/0" ]; then
      $RUN_AS ufw allow $PORT/$PROTO
    else
      $RUN_AS ufw --force "$ACTION" proto "$PROTO" from "$SOURCE_CIDR" to any port "$PORT"
    fi
    EXPECTED_RULE=ALLOW; [ "$ACTION" = "deny" ] && EXPECTED_RULE=DENY
    EXPECTED_SOURCE="$SOURCE_CIDR"; [ "$SOURCE_CIDR" = "0.0.0.0/0" ] && EXPECTED_SOURCE=Anywhere
    if [ "$ACTION" = "allow" ] && [ "$SOURCE_CIDR" = "0.0.0.0/0" ]; then
      $RUN_AS ufw status | awk -v rule="$PORT/$PROTO" ${ufwGlobalAllowAwk}
    else
      $RUN_AS ufw status | awk -v rule="$PORT/$PROTO" -v verdict="$EXPECTED_RULE" -v source="$EXPECTED_SOURCE" '$1 == rule && $2 == verdict && $3 == source { found=1 } END { exit found ? 0 : 1 }'
    fi
    ;;
  iptables)
    command -v iptables >/dev/null 2>&1 || { echo "iptables \u4e0d\u53ef\u7528"; exit 1; }
    if [ "$APPLY_MODE" = "permanent" ]; then echo "iptables \u5c06\u6309\u8fd0\u884c\u65f6\u89c4\u5219\u5904\u7406\uff0c\u6301\u4e45\u5316\u65b9\u5f0f\u53d6\u51b3\u4e8e\u53d1\u884c\u7248"; fi
    IPTABLES_SNAPSHOT="$OPERATION_ROLLBACK_DIR/iptables.before"
    $RUN_AS iptables-save > "$IPTABLES_SNAPSHOT"
    {
      echo '#!/bin/sh'
      echo 'set -e'
      echo "SNAPSHOT='$IPTABLES_SNAPSHOT'"
      echo 'RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi'
      echo '$RUN_AS iptables-restore < "$SNAPSHOT"'
    } > "$TMP_ROLLBACK"
    $RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
    TARGET=ACCEPT; [ "$ACTION" = "deny" ] && TARGET=DROP
    if ! $RUN_AS iptables -C INPUT -p "$PROTO" -s "$SOURCE_CIDR" --dport "$PORT" -j "$TARGET" 2>/dev/null; then
      $RUN_AS iptables -A INPUT -p "$PROTO" -s "$SOURCE_CIDR" --dport "$PORT" -j "$TARGET"
    fi
    $RUN_AS iptables -C INPUT -p "$PROTO" -s "$SOURCE_CIDR" --dport "$PORT" -j "$TARGET"
    ;;
  nftables)
    command -v nft >/dev/null 2>&1 || { echo "nft \u4e0d\u53ef\u7528"; exit 1; }
    if [ "$APPLY_MODE" = "permanent" ]; then echo "nftables \u5c06\u6309\u8fd0\u884c\u65f6\u89c4\u5219\u5904\u7406\uff0c\u6301\u4e45\u5316\u65b9\u5f0f\u53d6\u51b3\u4e8e\u53d1\u884c\u7248"; fi
    NFT_SNAPSHOT="$OPERATION_ROLLBACK_DIR/nftables.before"
    $RUN_AS nft list ruleset > "$NFT_SNAPSHOT"
    {
      echo '#!/bin/sh'
      echo 'set -e'
      echo "SNAPSHOT='$NFT_SNAPSHOT'"
      echo 'RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi'
      echo '$RUN_AS nft flush ruleset'
      echo '$RUN_AS nft -f "$SNAPSHOT"'
    } > "$TMP_ROLLBACK"
    $RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
    $RUN_AS nft list table inet shellpilot >/dev/null 2>&1 || $RUN_AS nft add table inet shellpilot
    $RUN_AS nft list chain inet shellpilot input >/dev/null 2>&1 || $RUN_AS nft 'add chain inet shellpilot input { type filter hook input priority 0; policy accept; }'
    NFT_ACTION=accept; [ "$ACTION" = "deny" ] && NFT_ACTION=drop
    RULE_MARKER="shellpilot-$ACTION-$SOURCE_CIDR-$PORT-$PROTO"
    $RUN_AS nft add rule inet shellpilot input ip saddr "$SOURCE_CIDR" "$PROTO" dport "$PORT" "$NFT_ACTION" comment "$RULE_MARKER"
    $RUN_AS nft list chain inet shellpilot input | grep -F -- "$RULE_MARKER" >/dev/null
    ;;
  *) echo "\u4e0d\u652f\u6301\u7684\u9632\u706b\u5899\u7c7b\u578b: $FIREWALL_KIND"; exit 1;;
esac
printf 'verified\\n' > "$ROLLBACK_SCRIPT.verified"
echo "\u9632\u706b\u5899\u89c4\u5219\u5df2\u9a8c\u8bc1\uff0c\u56de\u6eda\u811a\u672c: $ROLLBACK_SCRIPT"`

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
      journal_control="$(
        {
          journalctl -r -n 5000 -u ssh -u sshd --since '-24 hours' --no-pager 2>&1 1>&3
          printf '\\036SHELLPILOT_SSH_STATUS=%s\\n' "$?"
        } | awk '
          BEGIN {
            marker = sprintf("%c", 30) "SHELLPILOT_SSH_STATUS="
          }
          {
            marker_position = index($0, marker)
            if (marker_position > 0) {
              prefix = substr($0, 1, marker_position - 1)
              if (length(prefix) > 0) stderr_seen = 1
              command_status = substr($0, marker_position + length(marker))
              status_seen = 1
              next
            }
            stderr_seen = 1
          }
          END {
            if (!status_seen) command_status = 1
            printf "%s %d\\n", command_status, stderr_seen
          }
        '
      )"
      printf '\\036SHELLPILOT_SSH_CONTROL=%s\\n' "$journal_control"
    } 3>&1 | awk '
      BEGIN {
        limit = 200
        marker = sprintf("%c", 30) "SHELLPILOT_SSH_CONTROL="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          if (length(prefix) > 0 && emitted < limit && tolower(prefix) ~ /(failed|invalid|accepted|disconnect)/) {
            print prefix
            emitted++
          }
          control = substr($0, marker_position + length(marker))
          split(control, control_fields, " ")
          command_status = control_fields[1]
          stderr_seen = control_fields[2]
          status_seen = 1
          next
        }
        if (emitted < limit && tolower($0) ~ /(failed|invalid|accepted|disconnect)/) {
          print
          emitted++
        }
      }
      END {
        if (status_seen && command_status == 0 && stderr_seen == 0) {
          if (emitted == 0) {
            print "最近 24 小时无相关 SSH 安全事件。"
          }
          exit 0
        }
        exit 1
      }
    '
  }

  run_log_security_events () {
    auth_log=
    secure_log=

    if [ -r /var/log/auth.log ] && [ -n "$(find /var/log/auth.log -mtime -1 -print 2>/dev/null)" ]; then
      auth_log=/var/log/auth.log
    fi
    if [ -r /var/log/secure ] && [ -n "$(find /var/log/secure -mtime -1 -print 2>/dev/null)" ]; then
      secure_log=/var/log/secure
    fi

    printf '说明：传统日志时间格式无法可靠严格解析 24 小时，仅显示最近日志尾部近似范围。\\n'
    if [ -z "$auth_log$secure_log" ]; then
      printf '未找到最近 24 小时内更新的可读 SSH 安全日志；可能权限不足或日志不可用，且未展示可能陈旧的历史事件。\\n'
      return 0
    fi

    {
      if [ -n "$auth_log" ]; then
        tail -n 5000 "$auth_log" 2>/dev/null
      fi
      if [ -n "$secure_log" ]; then
        tail -n 5000 "$secure_log" 2>/dev/null
      fi
    } | awk '
      BEGIN {
        limit = 200
      }
      tolower($0) ~ /(failed|invalid|accepted|disconnect)/ {
        slot = matched % limit
        events[slot] = $0
        matched++
      }
      END {
        start = matched > limit ? matched - limit : 0
        for (event_index = start; event_index < matched; event_index++) {
          print events[event_index % limit]
        }
      }
    '
  }

  if command -v journalctl >/dev/null 2>&1 && run_journal_security_events; then
    true
  elif [ -r /var/log/auth.log ] || [ -r /var/log/secure ]; then
    run_log_security_events
  else
    printf '未找到可读的 SSH 安全日志（/var/log/auth.log 或 /var/log/secure）：权限不足或日志不可用。\\n'
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
    defineCommand(withRollback({
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
        selectParam('\u64cd\u4f5c', '\u64cd\u4f5c', 'allow', '\u5141\u8bb8\u4f1a\u653e\u884c\u5339\u914d\u6d41\u91cf\uff0c\u62d2\u7edd\u4f1a\u589e\u52a0\u663e\u5f0f\u62e6\u622a\u89c4\u5219\u3002', [
          { label: '\u5141\u8bb8\u8bbf\u95ee', value: 'allow' },
          { label: '\u62d2\u7edd\u8bbf\u95ee', value: 'deny' }
        ], { validationType: 'enum', required: true }),
        inputParam('\u6765\u6e90CIDR', '\u6765\u6e90 CIDR', '0.0.0.0/0', '\u9650\u5236\u5141\u8bb8\u6216\u62d2\u7edd\u7684 IPv4 \u6765\u6e90\uff1b0.0.0.0/0 \u8868\u793a\u4efb\u610f\u6765\u6e90\u3002', '\u4f8b\u5982 192.0.2.0/24', {
          validationType: 'cidr',
          required: true
        }),
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
            { label: 'ufw', value: 'ufw' },
            { label: 'iptables', value: 'iptables' },
            { label: 'nftables', value: 'nftables' }
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
        step(firewallPolicyCommand)
      ]
    }, {
      title: '\u9632\u706b\u5899\u8bbf\u95ee\u7b56\u7565',
      actionParam: '\u64cd\u4f5c',
      mutatingValues: ['allow', 'deny'],
      backupTargets: ['/etc/ufw/user.rules', '/etc/ufw/user6.rules', '/etc/firewalld/zones'],
      verifyCommands: [
        firewallVerificationCommand,
        'test -s "{{\u56de\u6eda\u811a\u672c}}" && test -s "{{\u56de\u6eda\u811a\u672c}}.verified"'
      ]
    })),
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
