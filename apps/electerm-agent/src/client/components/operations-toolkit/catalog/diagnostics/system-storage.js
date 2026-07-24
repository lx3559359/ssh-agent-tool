import { defineOperationsTool } from '../../shared/definition.js'
import {
  assertAbsolutePath,
  assertIntegerRange,
  shellQuote
} from '../../shared/validation.js'

function tool (id, title, category, command, extra = {}) {
  return defineOperationsTool({
    id,
    title,
    description: extra.description || title,
    category,
    type: 'diagnostic',
    risk: 'read-only',
    parameters: extra.parameters,
    steps: [{
      id: 'collect',
      title: '采集只读信息',
      command,
      buildCommand: extra.buildCommand,
      timeoutMs: extra.timeoutMs || 60000
    }]
  })
}

export const systemStorageTools = Object.freeze([
  tool(
    'system.overview',
    '系统运行概览',
    '系统',
    'printf "## 系统\\n"; uptime; uname -a; test -r /etc/os-release && cat /etc/os-release; printf "## 登录用户\\n"; who'
  ),
  tool(
    'system.cpu-pressure',
    'CPU 压力与高占用进程',
    '系统',
    'printf "## 负载\\n"; uptime; command -v nproc >/dev/null && nproc; printf "## 高占用进程\\n"; ps -eo pid,ppid,user,stat,%cpu,%mem,etime,comm --sort=-%cpu | head -n 31'
  ),
  tool(
    'system.memory-oom',
    '内存、Swap 与 OOM 检查',
    '系统',
    'free -h; printf "## vmstat\\n"; vmstat 1 3; printf "## OOM 记录\\n"; (journalctl -k --since "-24 hours" --no-pager 2>/dev/null || dmesg 2>/dev/null) | grep -Ei "out of memory|oom-killer|killed process" | tail -n 80'
  ),
  tool(
    'system.boot-events',
    '启动、重启与内核异常',
    '系统',
    'who -b 2>/dev/null; uptime -s 2>/dev/null; last -x reboot shutdown 2>/dev/null | head -n 30; (journalctl -b -p warning --no-pager 2>/dev/null || dmesg 2>/dev/null) | tail -n 120'
  ),
  tool(
    'storage.capacity-inode',
    '磁盘容量与 inode',
    '存储',
    'df -hT -x tmpfs -x devtmpfs; printf "## inode\\n"; df -ih -x tmpfs -x devtmpfs'
  ),
  tool(
    'storage.io-latency',
    '磁盘 I/O 延迟',
    '存储',
    'if command -v iostat >/dev/null 2>&1; then iostat -xz 1 3; elif command -v vmstat >/dev/null 2>&1; then vmstat 1 5; printf "## diskstats\\n"; cat /proc/diskstats; else cat /proc/diskstats; fi'
  ),
  tool(
    'storage.deleted-open-files',
    '已删除但仍占用空间的文件',
    '存储',
    'if command -v lsof >/dev/null 2>&1; then lsof -nP +L1 2>/dev/null | head -n 200; else printf "unsupported: lsof 未安装\\n"; fi'
  ),
  tool(
    'storage.large-directory-growth',
    '大目录占用分析',
    '存储',
    'du -x -h --max-depth=2 /var 2>/dev/null | sort -h | tail -n 50',
    {
      timeoutMs: 120000,
      parameters: [
        { id: 'path', label: '扫描路径', type: 'path', defaultValue: '/var' },
        { id: 'depth', label: '目录深度', type: 'number', defaultValue: 2 },
        { id: 'limit', label: '结果数量', type: 'number', defaultValue: 50 }
      ],
      buildCommand: params => {
        const path = assertAbsolutePath(params.path || '/var', '扫描路径')
        const depth = assertIntegerRange(params.depth || 2, 1, 5, '深度')
        const limit = assertIntegerRange(params.limit || 50, 10, 200, '结果数量')
        return `du -x -h --max-depth=${depth} ${shellQuote(path)} 2>/dev/null | sort -h | tail -n ${limit}`
      }
    }
  )
])
