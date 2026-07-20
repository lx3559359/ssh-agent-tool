import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam, selectParam } from './shared/definition.js'

export const systemCommands = [
  defineCommand({
    id: 'builtin-server-overview',
    name: '系统概览',
    description: '查看运行时间、系统版本和当前登录用户。',
    usage: '用于快速判断服务器是否重启、系统类型和当前登录会话。',
    labels: [READ_ONLY, '系统'],
    advancedUsage: [
      '进一步看内核：uname -a',
      '进一步看登录来源：last -n 20'
    ],
    commands: [
      step('uptime'),
      step('hostnamectl 2>/dev/null || uname -a'),
      step('who -u')
    ]
  }),
  defineCommand({
    id: 'builtin-server-memory',
    name: '内存与 Swap',
    description: '查看内存、Swap 和占用内存最高的进程。',
    usage: '适合排查内存不足、Swap 过高、进程异常占用。',
    labels: [READ_ONLY, '内存'],
    advancedUsage: [
      '实时观察：vmstat 1 10',
      '按内存查看更多进程：ps aux --sort=-%mem | head -n 30'
    ],
    commands: [
      step('free -h'),
      step('ps aux --sort=-%mem | head -n 15')
    ]
  }),
  defineCommand({
    id: 'builtin-server-process-top',
    name: '进程资源排行',
    description: '按 CPU 和内存查看当前资源占用最高的进程。',
    usage: '用于初步定位高负载、高 CPU、高内存进程。',
    labels: [READ_ONLY, '进程'],
    advancedUsage: [
      '看进程树：pstree -ap 2>/dev/null | head -n 80',
      '查看指定 PID：ps -fp <PID>'
    ],
    commands: [
      step('ps aux --sort=-%cpu | head -n 15'),
      step('ps aux --sort=-%mem | head -n 15')
    ]
  }),
  defineCommand({
    id: 'builtin-server-time-query',
    name: '时间与时区',
    description: '查看系统时间、时区、NTP 同步状态和硬件时间。',
    usage: '适合排查证书过期、日志时间错乱、定时任务异常。',
    labels: [READ_ONLY, '时间'],
    advancedUsage: [
      '查看定时任务：systemctl list-timers --all --no-pager',
      '校验时间同步：timedatectl timesync-status 2>/dev/null'
    ],
    commands: [
      step('date -R'),
      step('timedatectl 2>/dev/null || true'),
      step('hwclock -r 2>/dev/null || true')
    ]
  }),
  defineCommand({
    id: 'builtin-server-process-detail',
    name: '进程详情查询',
    description: '按 PID 或进程名查看命令行、资源、端口、文件和线程信息。',
    usage: '适合排查进程占用过高、启动参数错误、端口冲突或文件句柄异常。',
    labels: [NEED_EDIT, '进程', READ_ONLY],
    editBeforeRun: true,
    confirmRequired: true,
    params: [
      selectParam('查询方式', '查询方式', 'name', '知道 PID 时更精确；不知道时可按进程名搜索。', [
        { label: '按进程名', value: 'name' },
        { label: '按 PID', value: 'pid' }
      ]),
      inputParam('进程关键字', '进程名或 PID', 'nginx', '进程名可填写 nginx、java、mysqld；PID 只填写数字。', '例如 nginx 或 1234'),
      numberParam('输出行数', '输出行数', '100', '限制 lsof 和线程输出行数，避免刷屏。', 20, 1000)
    ],
    advancedUsage: [
      '持续观察某 PID：top -H -p PID。',
      '查看系统调用：strace -p PID，生产环境使用前请评估性能影响。'
    ],
    commands: [
      step(`QUERY_MODE="{{查询方式}}"
QUERY="{{进程关键字}}"
LIMIT="{{输出行数}}"
if [ -z "$QUERY" ]; then echo "请填写进程名或 PID"; exit 1; fi
if [ "$QUERY_MODE" = "pid" ]; then PIDS="$QUERY"; else PIDS="$(pgrep -d ' ' -f -- "$QUERY")"; fi
if [ -z "$PIDS" ]; then echo "未找到匹配进程"; exit 1; fi
for PID in $PIDS; do
  echo "===== PID $PID ====="
  ps -fp "$PID"
  cat "/proc/$PID/status" 2>/dev/null | head -n 40
  ss -tunlp 2>/dev/null | grep "pid=$PID," || true
  lsof -p "$PID" 2>/dev/null | head -n "$LIMIT" || true
done`)
    ]
  })
]
