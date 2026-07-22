import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam, selectParam } from './shared/definition.js'
import { withRollback } from './shared/safety-metadata.js'

export function getServicesCommands () {
  return [
    defineCommand({
      id: 'builtin-server-service-logs',
      name: '失败服务与日志',
      description: '查看失败的 systemd 服务和最近 warning 以上日志。',
      usage: '适合定位服务启动失败、系统告警和近期异常。',
      labels: [READ_ONLY, '日志'],
      advancedUsage: [
        '查看更多日志：journalctl -p warning -n 300 --no-pager',
        '按服务查看：journalctl -u {{服务名}} -n 100 --no-pager'
      ],
      commands: [
        step('systemctl --failed --no-pager'),
        step('journalctl -p warning -n 120 --no-pager')
      ]
    }),
    defineCommand({
      id: 'builtin-server-scheduled-tasks',
      name: '\u5b9a\u65f6\u4efb\u52a1\u6e05\u5355',
      description: '\u67e5\u770b systemd \u5b9a\u65f6\u5668\u3001\u5f53\u524d\u7528\u6237 crontab \u548c\u7cfb\u7edf cron \u76ee\u5f55\u6e05\u5355\u3002',
      usage: '\u7528\u4e8e\u6392\u67e5\u5b9a\u65f6\u4efb\u52a1\u7684\u89e6\u53d1\u8ba1\u5212\u3001\u9057\u6f0f\u6267\u884c\u548c\u4efb\u52a1\u6765\u6e90\u3002',
      labels: [READ_ONLY, '\u8ba1\u5212\u4efb\u52a1'],
      advancedUsage: [
        '\u7cfb\u7edf\u7ea7 crontab \u53ef\u80fd\u9700\u8981\u4f7f\u7528\u5bf9\u5e94\u8d26\u53f7\u6216\u63d0\u5347\u6743\u9650\u540e\u67e5\u770b\u3002'
      ],
      commands: [
        step('systemctl list-timers --all --no-pager | head -n 200 || true'),
        step('crontab -l | head -n 200 || true'),
        step('ls -la /etc/cron.* | head -n 200 || true')
      ]
    }),
    defineCommand({
      id: 'builtin-server-service-status',
      name: '服务状态查询',
      description: '自动识别当前服务器上的 systemd 服务，可多选查看运行状态和日志。',
      usage: '连接 SSH 后从列表选择服务；未识别到时也可以手动输入完整服务名。',
      labels: [NEED_EDIT, '服务'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '服务名',
          label: '服务名',
          type: 'service-target',
          targetType: 'service',
          sources: ['systemd'],
          multiple: true,
          defaultValue: '',
          placeholder: '自动识别后选择一个或多个服务',
          help: '支持多选；也可以输入完整的 systemd 服务名后按回车。'
        },
        {
          name: '日志行数',
          label: '日志行数',
          type: 'number',
          defaultValue: '100',
          min: 10,
          max: 1000,
          help: '建议 50-200，行数过大可能刷屏。'
        },
        {
          name: '查看日志',
          label: '查看日志',
          type: 'select',
          defaultValue: 'yes',
          help: '选择“是”会同时读取 journalctl 最近日志。',
          options: [
            { label: '是', value: 'yes' },
            { label: '否，只看状态', value: 'no' }
          ]
        }
      ],
      advancedUsage: [
        '需要启动、停止或重启服务时，请使用“服务控制”，修改前会生成回滚脚本。',
        '服务列表来自当前连接的服务器，不会在后台持续扫描。'
      ],
      commands: [
        step(`SERVICES="{{服务名}}"
LOG_LINES="{{日志行数}}"
SHOW_LOG="{{查看日志}}"
if [ -z "$SERVICES" ]; then echo "请选择或填写服务名"; exit 1; fi
OLD_IFS="$IFS"
IFS=','
for SERVICE in $SERVICES; do
  case "$SERVICE" in *[!a-zA-Z0-9_.@-]*|"") echo "服务名称不合法: $SERVICE"; continue;; esac
  echo "===== $SERVICE ====="
  systemctl status "$SERVICE" --no-pager || true
  if [ "$SHOW_LOG" = "yes" ]; then
    journalctl -u "$SERVICE" -n "$LOG_LINES" --no-pager || true
  fi
done
IFS="$OLD_IFS"`)
      ]
    }),
    defineCommand({
      id: 'builtin-server-log-search',
      name: '日志关键词搜索',
      description: '按路径和关键词搜索日志文件，限制输出避免刷屏。',
      usage: '默认搜索 /var/log 里的 error，可改成 timeout、failed 或业务关键词。',
      labels: [NEED_EDIT, '日志'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '日志路径',
          label: '日志路径',
          type: 'input',
          defaultValue: '{{日志路径}}',
          placeholder: '例如 /var/log 或 /var/log/nginx',
          help: '填写目录或文件路径；目录会递归搜索。'
        },
        {
          name: '关键词',
          label: '关键词',
          type: 'input',
          defaultValue: '{{关键词}}',
          placeholder: '例如 error、timeout、failed',
          help: '支持普通关键词；复杂正则请在命令预览里手动微调。'
        },
        {
          name: '输出行数',
          label: '输出行数',
          type: 'number',
          defaultValue: '200',
          min: 20,
          max: 5000,
          help: '限制输出避免刷屏；需要更多结果可以调大。'
        },
        {
          name: '包含压缩日志',
          label: '包含压缩日志',
          type: 'select',
          defaultValue: 'no',
          help: '选择“是”会额外搜索 .gz 压缩日志；zip 日志建议用 AI 附件分析。',
          options: [
            { label: '否', value: 'no' },
            { label: '是，包含 .gz', value: 'yes' }
          ]
        }
      ],
      advancedUsage: [
        '搜索压缩日志：zgrep -R "{{关键词}}" {{日志路径}}/*.gz 2>/dev/null | head -n 200',
        '只看最近日志：find {{日志路径}} -type f -mtime -2 -name "*.log" -print'
      ],
      commands: [
        step('LOG_PATH="{{日志路径}}"\nKEYWORD="{{关键词}}"\nLIMIT="{{输出行数}}"\nINCLUDE_GZ="{{包含压缩日志}}"\nif [ -z "$LOG_PATH" ] || [ -z "$KEYWORD" ]; then echo "请填写日志路径和关键词"; exit 1; fi\ngrep -RIn --binary-files=without-match "$KEYWORD" "$LOG_PATH" 2>/dev/null | head -n "$LIMIT"\nif [ "$INCLUDE_GZ" = "yes" ]; then\n  find "$LOG_PATH" -type f -name "*.gz" -print0 2>/dev/null | xargs -0 zgrep -In "$KEYWORD" 2>/dev/null | head -n "$LIMIT"\nfi')
      ]
    }),
    defineCommand({
      id: 'builtin-server-nginx',
      name: 'Nginx 排查',
      description: '检查 Nginx 配置、服务状态和最近错误日志。',
      usage: '适合排查 502、配置错误、端口监听和反向代理问题。',
      labels: [READ_ONLY, 'Nginx'],
      advancedUsage: [
        '查看站点配置：nginx -T 2>/dev/null | head -n 200',
        '按关键词看错误：tail -n 300 /var/log/nginx/error.log | grep -i "{{关键词}}"'
      ],
      commands: [
        step('nginx -t'),
        step('systemctl status nginx --no-pager'),
        step('tail -n 120 /var/log/nginx/error.log')
      ]
    }),
    defineCommand({
      id: 'builtin-server-service-action',
      name: '服务控制',
      description: '按服务名查询、启动、停止、重启或重载 systemd 服务。',
      usage: '默认只查询状态；修改操作会记录原状态并生成快捷回滚脚本。',
      labels: [NEED_EDIT, '服务', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: 'systemd 服务操作',
        pathParam: '回滚脚本',
        actionParam: '操作',
        mutatingValues: ['start', 'stop', 'restart', 'reload', 'enable', 'disable'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '服务名称',
          label: '服务名称',
          type: 'service-target',
          targetType: 'service',
          sources: ['systemd'],
          multiple: false,
          defaultValue: '',
          placeholder: '自动识别后选择服务',
          help: '列表来自当前 SSH 服务器；也可以手动输入完整 systemd 服务名。'
        },
        selectParam('操作', '操作', 'status', '默认查询状态；启动、停止、重启、重载和开机自启属于修改操作。', [
          { label: '查询状态', value: 'status' },
          { label: '启动', value: 'start' },
          { label: '停止', value: 'stop' },
          { label: '重启', value: 'restart' },
          { label: '重载配置', value: 'reload' },
          { label: '设置开机自启', value: 'enable' },
          { label: '取消开机自启', value: 'disable' }
        ]),
        numberParam('日志行数', '日志行数', '80', '操作后显示最近日志，建议 50-200 行。', 10, 1000)
      ],
      advancedUsage: [
        '执行前记录服务运行和开机自启状态，回滚时恢复到原状态。',
        '重启产生的短暂中断无法撤销，但回滚会恢复服务原先的运行状态。'
      ],
      commands: [
        step(`SERVICE="{{服务名称}}"
ACTION="{{操作}}"
LOG_LINES="{{日志行数}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi
case "$SERVICE" in *[!a-zA-Z0-9_.@-]*|"") echo "服务名称不合法"; exit 1;; esac
if [ "$ACTION" = "status" ]; then systemctl status "$SERVICE" --no-pager; journalctl -u "$SERVICE" -n "$LOG_LINES" --no-pager; exit $?; fi
if [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改服务。"; exit 0; fi
OLD_ACTIVE="$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
OLD_ENABLED="$(systemctl is-enabled "$SERVICE" 2>/dev/null || true)"
$RUN_AS mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-service-rollback-$$.sh"
{
  echo '#!/bin/sh'
  if [ "$OLD_ACTIVE" = "active" ]; then echo "$RUN_AS systemctl start '$SERVICE'"; else echo "$RUN_AS systemctl stop '$SERVICE'"; fi
  if [ "$OLD_ENABLED" = "enabled" ]; then echo "$RUN_AS systemctl enable '$SERVICE'"; else echo "$RUN_AS systemctl disable '$SERVICE'"; fi
} > "$TMP_ROLLBACK"
$RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
$RUN_AS systemctl "$ACTION" "$SERVICE"
systemctl status "$SERVICE" --no-pager || true
journalctl -u "$SERVICE" -n "$LOG_LINES" --no-pager || true
echo "回滚脚本: $ROLLBACK_SCRIPT"`)
      ]
    }),
    defineCommand(withRollback({
      id: 'builtin-server-service-boot-policy',
      name: '\u670d\u52a1\u5f00\u673a\u7b56\u7565',
      description: '\u81ea\u52a8\u8bc6\u522b systemd \u670d\u52a1\uff0c\u652f\u6301\u591a\u9009\u67e5\u8be2\u3001\u542f\u7528\u6216\u7981\u7528\u5f00\u673a\u81ea\u542f\u3002',
      usage: '\u9ed8\u8ba4\u53ea\u67e5\u8be2\u5df2\u9009\u670d\u52a1\u7684\u5f00\u673a\u72b6\u6001\uff1b\u4fee\u6539\u524d\u8bb0\u5f55\u6bcf\u4e2a\u670d\u52a1\u7684\u539f is-enabled \u72b6\u6001\u3002',
      labels: [NEED_EDIT, '\u670d\u52a1', '\u9ad8\u98ce\u9669'],
      params: [
        {
          name: '\u670d\u52a1\u540d\u79f0',
          label: '\u670d\u52a1\u540d\u79f0',
          type: 'service-target',
          targetType: 'service',
          sources: ['systemd'],
          multiple: true,
          required: true,
          defaultValue: '',
          placeholder: '\u81ea\u52a8\u8bc6\u522b\u540e\u591a\u9009 systemd \u670d\u52a1',
          help: '\u5217\u8868\u6765\u81ea\u5f53\u524d SSH \u670d\u52a1\u5668\uff0c\u53ef\u4e00\u6b21\u9009\u62e9\u591a\u4e2a\u670d\u52a1\u3002'
        },
        selectParam('\u64cd\u4f5c', '\u64cd\u4f5c', 'status', '\u9ed8\u8ba4\u67e5\u8be2\uff1b\u542f\u7528\u548c\u7981\u7528\u5747\u9700\u8981\u4e8c\u6b21\u786e\u8ba4\u3002', [
          { label: '\u67e5\u8be2\u5f00\u673a\u72b6\u6001', value: 'status' },
          { label: '\u542f\u7528\u5f00\u673a\u81ea\u542f', value: 'enable' },
          { label: '\u7981\u7528\u5f00\u673a\u81ea\u542f', value: 'disable' }
        ], { validationType: 'enum', required: true })
      ],
      advancedUsage: [
        '\u6267\u884c\u524d\u4f1a\u5148\u6821\u9a8c\u5168\u90e8\u670d\u52a1\uff0c\u907f\u514d\u591a\u9009\u65f6\u53ea\u4fee\u6539\u4e00\u90e8\u5206\u3002',
        '\u5feb\u6377\u56de\u6eda\u6309\u670d\u52a1\u9010\u4e2a\u6062\u590d\u539f enabled \u6216 disabled \u72b6\u6001\u3002'
      ],
      commands: [
        step(`SERVICES="{{\u670d\u52a1\u540d\u79f0}}"
ACTION="{{\u64cd\u4f5c}}"
APPLY_CHANGE="{{\u786e\u8ba4\u6267\u884c}}"
ROLLBACK_SCRIPT="{{\u56de\u6eda\u811a\u672c}}"
RUN_AS=""
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "\u5f53\u524d\u8d26\u53f7\u65e0\u6cd5\u4fee\u6539 systemd \u7b56\u7565"; exit 1; fi
fi
if [ -z "$SERVICES" ]; then echo "\u8bf7\u9009\u62e9\u81f3\u5c11\u4e00\u4e2a systemd \u670d\u52a1"; exit 1; fi
show_boot_policy () {
  OLD_IFS="$IFS"; IFS=','
  for SERVICE in $SERVICES; do
    case "$SERVICE" in *[!a-zA-Z0-9_.@:-]*|"") echo "\u670d\u52a1\u540d\u79f0\u4e0d\u5408\u6cd5: $SERVICE"; continue;; esac
    printf '%s: active=%s, enabled=%s\\n' "$SERVICE" "$(systemctl is-active "$SERVICE" 2>/dev/null || true)" "$(systemctl is-enabled "$SERVICE" 2>/dev/null || true)"
  done
  IFS="$OLD_IFS"
}
if [ "$ACTION" = "status" ]; then show_boot_policy; exit 0; fi
echo "\u9884\u89c8: $ACTION $SERVICES"
if [ "$APPLY_CHANGE" != "yes" ]; then echo "\u5f53\u524d\u4e3a\u53ea\u8bfb\u9884\u89c8\uff0c\u672a\u4fee\u6539\u670d\u52a1"; exit 0; fi
STATE_FILE="$OPERATION_ROLLBACK_DIR/service-boot.before"
: > "$STATE_FILE"
OLD_IFS="$IFS"; IFS=','
for SERVICE in $SERVICES; do
  case "$SERVICE" in *[!a-zA-Z0-9_.@:-]*|"") echo "\u670d\u52a1\u540d\u79f0\u4e0d\u5408\u6cd5: $SERVICE"; exit 1;; esac
  LOAD_STATE=$(systemctl show -p LoadState --value "$SERVICE" 2>/dev/null || true)
  if [ -z "$LOAD_STATE" ] || [ "$LOAD_STATE" = "not-found" ]; then echo "\u670d\u52a1\u4e0d\u5b58\u5728: $SERVICE"; exit 1; fi
  OLD_ENABLED=$(systemctl is-enabled "$SERVICE" 2>/dev/null || true)
  case "$OLD_ENABLED" in enabled|enabled-runtime|disabled) ;; *) echo "\u4e0d\u652f\u6301\u4fee\u6539\u8be5\u670d\u52a1\u7684\u5f00\u673a\u72b6\u6001: $SERVICE ($OLD_ENABLED)"; exit 1;; esac
  printf '%s\\t%s\\n' "$SERVICE" "$OLD_ENABLED" >> "$STATE_FILE"
done
IFS="$OLD_IFS"
TMP_ROLLBACK="$OPERATION_ROLLBACK_DIR/service-boot-rollback.sh"
{
  echo '#!/bin/sh'
  echo 'set -e'
  echo "STATE_FILE='$STATE_FILE'"
  cat <<'SHELLPILOT_SERVICE_BOOT_ROLLBACK'
RUN_AS=""
if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi
TAB=$(printf '\\t')
while IFS="$TAB" read -r SERVICE OLD_ENABLED; do
  [ -n "$SERVICE" ] || continue
  case "$OLD_ENABLED" in
    enabled|enabled-runtime) $RUN_AS systemctl enable "$SERVICE" ;;
    disabled) $RUN_AS systemctl disable "$SERVICE" ;;
    *) echo "\u65e0\u6cd5\u6062\u590d $SERVICE \u7684\u672a\u77e5\u72b6\u6001: $OLD_ENABLED"; exit 1;;
  esac
done < "$STATE_FILE"
SHELLPILOT_SERVICE_BOOT_ROLLBACK
} > "$TMP_ROLLBACK"
$RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
IFS=','
for SERVICE in $SERVICES; do $RUN_AS systemctl "$ACTION" "$SERVICE"; done
IFS="$OLD_IFS"
show_boot_policy
echo "\u56de\u6eda\u811a\u672c: $ROLLBACK_SCRIPT"`)
      ]
    }, {
      title: '\u670d\u52a1\u5f00\u673a\u7b56\u7565',
      actionParam: '\u64cd\u4f5c',
      mutatingValues: ['enable', 'disable'],
      backupTargets: [],
      verifyCommands: [
        'test -s "{{\u56de\u6eda\u811a\u672c}}" && { SERVICES="{{\u670d\u52a1\u540d\u79f0}}"; OLD_IFS="$IFS"; IFS=,; for SERVICE in $SERVICES; do case "{{\u64cd\u4f5c}}" in enable) systemctl is-enabled --quiet "$SERVICE" ;; disable) ! systemctl is-enabled --quiet "$SERVICE" ;; *) exit 1 ;; esac || exit 1; done; IFS="$OLD_IFS"; }'
      ]
    })),
    defineCommand(withRollback({
      id: 'builtin-server-cron-manage',
      name: '\u7ba1\u7406 Cron \u4efb\u52a1',
      description: '\u67e5\u770b\u5f53\u524d\u7528\u6237 crontab\uff0c\u6216\u6309 ShellPilot \u6807\u8bc6\u65b0\u589e\u3001\u505c\u7528\u548c\u79fb\u9664\u4efb\u52a1\u3002',
      usage: '\u9ed8\u8ba4\u53ea\u5217\u51fa\u4efb\u52a1\uff1b\u4fee\u6539\u524d\u4fdd\u5b58\u5b8c\u6574 crontab \u5feb\u7167\uff0c\u5e76\u751f\u6210\u5feb\u6377\u56de\u6eda\u3002',
      labels: [NEED_EDIT, '\u8ba1\u5212\u4efb\u52a1', '\u9ad8\u98ce\u9669'],
      params: [
        selectParam('\u64cd\u4f5c', '\u64cd\u4f5c', 'list', '\u9ed8\u8ba4\u5217\u51fa\uff1b\u65b0\u589e\u3001\u505c\u7528\u548c\u79fb\u9664\u9700\u8981\u786e\u8ba4\u3002', [
          { label: '\u5217\u51fa\u4efb\u52a1', value: 'list' },
          { label: '\u65b0\u589e\u4efb\u52a1', value: 'add' },
          { label: '\u505c\u7528\u5339\u914d\u4efb\u52a1', value: 'disable' },
          { label: '\u79fb\u9664\u5339\u914d\u4efb\u52a1', value: 'remove' }
        ], { validationType: 'enum', required: true }),
        inputParam('\u8ba1\u5212\u8868\u8fbe\u5f0f', '\u8ba1\u5212\u8868\u8fbe\u5f0f', '0 2 * * *', '\u4f7f\u7528\u6807\u51c6 5 \u6bb5 Cron \u8868\u8fbe\u5f0f\u3002', '\u4f8b\u5982 0 2 * * *', {
          validationType: 'cron',
          required: true
        }),
        inputParam('\u4efb\u52a1\u547d\u4ee4', '\u4efb\u52a1\u547d\u4ee4', '/usr/local/bin/backup.sh', '\u4e3a\u907f\u514d Shell \u6ce8\u5165\uff0c\u4e0d\u5141\u8bb8\u7ba1\u9053\u3001\u91cd\u5b9a\u5411\u548c\u547d\u4ee4\u66ff\u6362\u8bed\u6cd5\u3002', '\u4f8b\u5982 /usr/local/bin/backup.sh', {
          validationType: 'text',
          required: true
        }),
        inputParam('\u5339\u914d\u6807\u8bc6', '\u5339\u914d\u6807\u8bc6', 'daily-backup', '\u7528\u4e8e\u7cbe\u786e\u627e\u5230 ShellPilot \u521b\u5efa\u7684\u4efb\u52a1\uff0c\u4ec5\u5141\u8bb8\u5b57\u6bcd\u3001\u6570\u5b57\u3001\u70b9\u3001\u4e0b\u5212\u7ebf\u548c\u77ed\u6a2a\u7ebf\u3002', '\u4f8b\u5982 daily-backup', {
          validationType: 'text',
          required: true
        })
      ],
      advancedUsage: [
        '\u65b0\u589e\u4efb\u52a1\u4f1a\u81ea\u52a8\u9644\u52a0 # shellpilot:<\u6807\u8bc6>\uff0c\u505c\u7528\u548c\u79fb\u9664\u53ea\u5f71\u54cd\u8be5\u6807\u8bc6\u7684\u884c\u3002',
        '\u5feb\u6377\u56de\u6eda\u4f1a\u6062\u590d\u4fee\u6539\u524d\u7684\u5b8c\u6574\u7528\u6237 crontab\u3002'
      ],
      commands: [
        step(`ACTION="{{\u64cd\u4f5c}}"
SCHEDULE="{{\u8ba1\u5212\u8868\u8fbe\u5f0f}}"
TASK_COMMAND="{{\u4efb\u52a1\u547d\u4ee4}}"
MARKER="{{\u5339\u914d\u6807\u8bc6}}"
APPLY_CHANGE="{{\u786e\u8ba4\u6267\u884c}}"
ROLLBACK_SCRIPT="{{\u56de\u6eda\u811a\u672c}}"
if [ "$ACTION" = "list" ]; then crontab -l 2>/dev/null || echo "\u5f53\u524d\u7528\u6237\u6ca1\u6709 crontab"; exit 0; fi
echo "\u9884\u89c8: $ACTION # shellpilot:$MARKER"
if [ "$APPLY_CHANGE" != "yes" ]; then echo "\u5f53\u524d\u4e3a\u53ea\u8bfb\u9884\u89c8\uff0c\u672a\u4fee\u6539 crontab"; exit 0; fi
case "$MARKER" in *[!a-zA-Z0-9_.-]*|"") echo "\u5339\u914d\u6807\u8bc6\u4e0d\u5408\u6cd5"; exit 1;; esac
SNAPSHOT="$OPERATION_ROLLBACK_DIR/cron.before"
HAD_CRONTAB=no
if crontab -l > "$SNAPSHOT" 2>/dev/null; then HAD_CRONTAB=yes; else : > "$SNAPSHOT"; fi
TMP_ROLLBACK="$OPERATION_ROLLBACK_DIR/cron-rollback.sh"
{
  echo '#!/bin/sh'
  echo 'set -e'
  echo "HAD_CRONTAB='$HAD_CRONTAB'"
  echo "SNAPSHOT='$SNAPSHOT'"
  cat <<'SHELLPILOT_CRON_ROLLBACK'
if [ "$HAD_CRONTAB" = "yes" ]; then
  crontab "$SNAPSHOT"
else
  crontab -r 2>/dev/null || true
fi
SHELLPILOT_CRON_ROLLBACK
} > "$TMP_ROLLBACK"
install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
CURRENT="$OPERATION_ROLLBACK_DIR/cron.current"
NEXT="$OPERATION_ROLLBACK_DIR/cron.next"
crontab -l > "$CURRENT" 2>/dev/null || : > "$CURRENT"
MARKER_TEXT="# shellpilot:$MARKER"
case "$ACTION" in
  add)
    awk -v marker="$MARKER_TEXT" 'index($0, marker) == 0 { print }' "$CURRENT" > "$NEXT"
    printf '%s %s # shellpilot:%s\\n' "$SCHEDULE" "$TASK_COMMAND" "$MARKER" >> "$NEXT"
    ;;
  disable)
    awk -v marker="$MARKER_TEXT" 'index($0, marker) > 0 { if (index($0, "# shellpilot-disabled ") == 1) print; else print "# shellpilot-disabled " $0; next } { print }' "$CURRENT" > "$NEXT"
    ;;
  remove)
    awk -v marker="$MARKER_TEXT" 'index($0, marker) == 0 { print }' "$CURRENT" > "$NEXT"
    ;;
  *) echo "\u4e0d\u652f\u6301\u7684 Cron \u64cd\u4f5c"; exit 1;;
esac
crontab "$NEXT"
crontab -l 2>/dev/null || true
echo "\u56de\u6eda\u811a\u672c: $ROLLBACK_SCRIPT"`)
      ]
    }, {
      title: '\u7ba1\u7406 Cron \u4efb\u52a1',
      actionParam: '\u64cd\u4f5c',
      mutatingValues: ['add', 'disable', 'remove'],
      backupTargets: [],
      verifyCommands: [
        'test -s "{{\u56de\u6eda\u811a\u672c}}" && case "{{\u64cd\u4f5c}}" in add) crontab -l | grep -F -- "# shellpilot:{{\u5339\u914d\u6807\u8bc6}}" >/dev/null ;; disable) crontab -l | awk -v marker="# shellpilot:{{\u5339\u914d\u6807\u8bc6}}" \'index($0, marker) > 0 && index($0, "# shellpilot-disabled ") == 1 { found = 1 } END { exit found ? 0 : 1 }\' ;; remove) ! crontab -l 2>/dev/null | grep -F -- "# shellpilot:{{\u5339\u914d\u6807\u8bc6}}" >/dev/null ;; *) exit 1 ;; esac'
      ]
    }))
  ]
}
