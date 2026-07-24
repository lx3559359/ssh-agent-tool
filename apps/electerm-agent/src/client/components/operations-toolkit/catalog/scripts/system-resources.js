import { defineReadOnlyRunbook, readOnlyStep } from './helpers.js'

export const systemResourceRunbooks = Object.freeze([
  defineReadOnlyRunbook({
    id: 'runbook.health.baseline',
    title: '服务器综合健康巡检',
    description: '一次采集系统、资源、存储、网络和失败服务，适合日常巡检与故障初判。',
    category: '综合巡检',
    steps: [
      readOnlyStep(
        'system',
        '识别系统与运行时间',
        'uptime; uname -a; test -r /etc/os-release && cat /etc/os-release || true; who -b 2>/dev/null || true'
      ),
      readOnlyStep(
        'resources',
        '采集 CPU 与内存',
        'printf "## load\\n"; uptime; printf "## memory\\n"; free -h 2>/dev/null || true; printf "## processes\\n"; ps -eo pid,user,stat,%cpu,%mem,etime,comm --sort=-%cpu | head -n 31'
      ),
      readOnlyStep(
        'storage',
        '检查容量与 inode',
        'df -hT -x tmpfs -x devtmpfs; printf "## inode\\n"; df -ih -x tmpfs -x devtmpfs'
      ),
      readOnlyStep(
        'network',
        '检查网卡、路由与监听',
        'ip -brief address 2>/dev/null || true; ip route 2>/dev/null || true; ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null || true'
      ),
      readOnlyStep(
        'services',
        '检查失败服务与告警',
        'systemctl --failed --no-pager 2>/dev/null || service --status-all 2>&1 | head -n 100; printf "## warnings\\n"; journalctl -p warning -n 100 --no-pager 2>/dev/null || true'
      )
    ]
  }),
  defineReadOnlyRunbook({
    id: 'runbook.cpu.incident',
    title: 'CPU 高负载现场采集',
    description: '保留负载、CPU 分布、热点进程与调度信息，适合定位突发高负载。',
    category: '资源故障',
    steps: [
      readOnlyStep(
        'load',
        '读取负载与 CPU 数量',
        'uptime; command -v nproc >/dev/null 2>&1 && nproc || grep -c "^processor" /proc/cpuinfo'
      ),
      readOnlyStep(
        'sampling',
        '短时采样 CPU',
        'if command -v mpstat >/dev/null 2>&1; then mpstat -P ALL 1 3; else vmstat 1 5; fi',
        undefined,
        30000
      ),
      readOnlyStep(
        'processes',
        '列出热点进程与线程',
        'ps -eo pid,ppid,user,stat,psr,%cpu,%mem,etime,comm --sort=-%cpu | head -n 50; printf "## threads\\n"; ps -eLo pid,tid,psr,stat,%cpu,%mem,comm --sort=-%cpu | head -n 50'
      ),
      readOnlyStep(
        'scheduler',
        '读取调度与压力指标',
        'cat /proc/pressure/cpu 2>/dev/null || true; cat /proc/loadavg; cat /proc/stat | head -n 12'
      )
    ]
  }),
  defineReadOnlyRunbook({
    id: 'runbook.memory.oom',
    title: '内存、Swap 与 OOM 排查',
    description: '采集内存压力、热点进程、OOM 记录和内核内存摘要。',
    category: '资源故障',
    steps: [
      readOnlyStep(
        'overview',
        '读取内存与 Swap',
        'free -h; printf "## vmstat\\n"; vmstat 1 3',
        undefined,
        30000
      ),
      readOnlyStep(
        'processes',
        '列出内存热点进程',
        'ps -eo pid,ppid,user,stat,rss,vsz,%mem,%cpu,etime,comm --sort=-rss | head -n 50'
      ),
      readOnlyStep(
        'oom',
        '搜索 OOM 与进程终止记录',
        '(journalctl -k --since "-48 hours" --no-pager 2>/dev/null || dmesg 2>/dev/null) | grep -Ei "out of memory|oom-killer|killed process" | tail -n 160 || true'
      ),
      readOnlyStep(
        'kernel',
        '读取内核内存摘要',
        'grep -E "^(Mem|Swap|Slab|SReclaimable|PageTables|Committed_AS|CommitLimit|HugePages)" /proc/meminfo; cat /proc/pressure/memory 2>/dev/null || true'
      )
    ]
  }),
  defineReadOnlyRunbook({
    id: 'runbook.storage.capacity-io',
    title: '磁盘空间与 I/O 故障排查',
    description: '检查容量、inode、目录增长、I/O 延迟和删除后仍占用的文件。',
    category: '存储故障',
    steps: [
      readOnlyStep(
        'capacity',
        '检查容量与 inode',
        'df -hT -x tmpfs -x devtmpfs; printf "## inode\\n"; df -ih -x tmpfs -x devtmpfs'
      ),
      readOnlyStep(
        'growth',
        '定位大目录',
        'du -x -h --max-depth=2 /var 2>/dev/null | sort -h | tail -n 60',
        undefined,
        120000
      ),
      readOnlyStep(
        'latency',
        '采样 I/O 延迟',
        'if command -v iostat >/dev/null 2>&1; then iostat -xz 1 3; else vmstat 1 5; printf "iostat 未安装，已使用 vmstat 代替\\n"; fi',
        undefined,
        30000
      ),
      readOnlyStep(
        'open-deleted',
        '查找删除后仍占用文件',
        'if command -v lsof >/dev/null 2>&1; then lsof -nP +L1 2>/dev/null | head -n 200; else printf "lsof 未安装，无法检查删除后仍占用的文件\\n"; fi'
      )
    ]
  })
])
