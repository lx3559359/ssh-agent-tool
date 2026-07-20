import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam, selectParam } from './shared/definition.js'

export function getSystemCommands () {
  return [
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
      id: 'builtin-server-cpu-pressure',
      name: 'CPU \u538b\u529b\u8bca\u65ad',
      description: '\u67e5\u770b\u7cfb\u7edf\u8d1f\u8f7d\u3001\u9010\u6838 CPU \u4f7f\u7528\u7387\u4ee5\u53ca CPU\u3001I/O \u548c\u5185\u5b58\u538b\u529b\u6307\u6807\u3002',
      usage: '\u7528\u4e8e\u5b9a\u4f4d CPU \u9971\u548c\u3001\u8fd0\u884c\u961f\u5217\u5806\u79ef\u548c\u8d44\u6e90\u4e89\u7528\u5bfc\u81f4\u7684\u54cd\u5e94\u53d8\u6162\u3002',
      labels: [READ_ONLY, 'CPU'],
      advancedUsage: [
        'mpstat \u4e0d\u53ef\u7528\u65f6\u4f1a\u81ea\u52a8\u6539\u7528 vmstat \u91c7\u6837\u3002',
        '\u538b\u529b\u6307\u6807\u4f9d\u8d56 Linux PSI\uff0c\u65e7\u5185\u6838\u53ef\u80fd\u6ca1\u6709\u5bf9\u5e94\u6587\u4ef6\u3002'
      ],
      commands: [
        step('uptime || true'),
        step('mpstat -P ALL 1 3 || vmstat 1 4 || true'),
        step('cat /proc/pressure/cpu || true'),
        step('cat /proc/pressure/io || true'),
        step('cat /proc/pressure/memory || true')
      ]
    }),
    defineCommand({
      id: 'builtin-server-kernel-errors',
      name: '\u5185\u6838\u544a\u8b66\u4e0e\u9519\u8bef',
      description: '\u67e5\u770b\u6700\u8fd1 24 \u5c0f\u65f6\u7684\u5185\u6838\u544a\u8b66\u548c\u9519\u8bef\uff0c\u5e76\u517c\u5bb9\u6ca1\u6709 journalctl \u7684\u7cfb\u7edf\u3002',
      usage: '\u7528\u4e8e\u6392\u67e5\u9a71\u52a8\u3001\u786c\u4ef6\u3001\u6587\u4ef6\u7cfb\u7edf\u548c\u5185\u6838\u5b50\u7cfb\u7edf\u7684\u8fd1\u671f\u5f02\u5e38\u3002',
      labels: [READ_ONLY, '\u5185\u6838'],
      advancedUsage: [
        'journalctl \u67e5\u8be2\u5931\u8d25\u65f6\u4f1a\u56de\u9000\u5230\u5e26\u65f6\u95f4\u6233\u7684 dmesg \u8f93\u51fa\u3002'
      ],
      commands: [
        step("journalctl -k -p warning..alert --since '-24 hours' -n 200 --no-pager || dmesg -T | tail -n 200 || true")
      ]
    }),
    defineCommand({
      id: 'builtin-server-boot-history',
      name: '\u542f\u52a8\u4e0e\u5173\u673a\u5386\u53f2',
      description: '\u67e5\u770b\u6700\u8fd1\u7684\u542f\u52a8\u3001\u5173\u673a\u3001\u91cd\u542f\u8bb0\u5f55\u4ee5\u53ca systemd \u542f\u52a8\u4f1a\u8bdd\u5217\u8868\u3002',
      usage: '\u7528\u4e8e\u786e\u8ba4\u670d\u52a1\u5668\u91cd\u542f\u65f6\u95f4\u3001\u5f02\u5e38\u5173\u673a\u8bb0\u5f55\u548c\u53ef\u67e5\u8be2\u7684\u5386\u53f2\u542f\u52a8\u6279\u6b21\u3002',
      labels: [READ_ONLY, '\u542f\u52a8'],
      advancedUsage: [
        '\u53ef\u7ed3\u5408 journalctl -b -1 \u67e5\u770b\u4e0a\u4e00\u6b21\u542f\u52a8\u4f1a\u8bdd\u7684\u65e5\u5fd7\u3002'
      ],
      commands: [
        step('last -x -n 30 || true'),
        step('journalctl --list-boots --no-pager | tail -n 30 || true')
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
}
