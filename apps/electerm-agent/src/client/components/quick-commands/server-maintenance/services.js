import { READ_ONLY, NEED_EDIT, step, defineCommand, numberParam, selectParam } from './shared/definition.js'

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
        step('systemctl list-timers --all --no-pager'),
        step('crontab -l 2>/dev/null || true'),
        step('ls -la /etc/cron.* 2>/dev/null || true')
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
    })
  ]
}
