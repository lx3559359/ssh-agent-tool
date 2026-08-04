import { defineOperationsTool } from '../../shared/definition.js'
import { assertPid } from '../../shared/validation.js'

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
      title: '采集有界只读信息',
      command,
      buildCommand: extra.buildCommand,
      timeoutMs: extra.timeoutMs || 60000
    }]
  })
}

export function normalizeProcessParameters (params = {}) {
  return { pid: assertPid(params.pid) }
}

export function buildProcessAbnormalStateCommand (params = {}) {
  const { pid } = normalizeProcessParameters(params)
  const overview = [
    'printf "## CPU 资源热点\\n"',
    'ps -eo pid,ppid,user,stat,psr,%cpu,%mem,etime,wchan:32,comm --sort=-%cpu | head -n 61',
    'printf "## 内存资源热点\\n"',
    'ps -eo pid,ppid,user,stat,psr,%cpu,%mem,etime,wchan:32,comm --sort=-%mem | head -n 61',
    'printf "## 僵尸与不可中断进程\\n"',
    'ps -eo pid,ppid,user,stat,etime,wchan:32,comm | awk \'NR == 1 || $4 ~ /^[ZD]/\' | head -n 100',
    'printf "## 调度压力\\n"',
    'cat /proc/pressure/cpu /proc/pressure/io /proc/pressure/memory 2>/dev/null || true'
  ]
  if (!pid) return overview.join('; ')
  return overview.concat([
    'printf "## PID ' + pid + '\\n"',
    'test -r /proc/' + pid + '/status || { echo "进程不存在或无权读取"; exit 1; }',
    'sed -n "1,80p" /proc/' + pid + '/status',
    'ps -L -p ' + pid + ' -o pid,tid,psr,stat,%cpu,%mem,wchan:32,comm | head -n 200',
    'printf "wchan="; cat /proc/' + pid + '/wchan 2>/dev/null || true',
    'sed -n "1,80p" /proc/' + pid + '/limits 2>/dev/null || true',
    'printf "fd_count="; find /proc/' + pid + '/fd -maxdepth 1 -type l 2>/dev/null | head -n 10001 | wc -l'
  ]).join('; ')
}

const fdPressureCommand = [
  'printf "## system file handles\\n"',
  'cat /proc/sys/fs/file-nr /proc/sys/fs/file-max 2>/dev/null',
  'printf "## current limit\\n"; ulimit -n',
  'printf "## socket summary\\n"; if command -v ss >/dev/null 2>&1; then ss -s; elif command -v netstat >/dev/null 2>&1; then netstat -s 2>/dev/null | head -n 120; else printf "socket_summary=unsupported; install iproute2 or net-tools with apt/yum\\n"; fi',
  'printf "## top process fd counts\\n"',
  'SCANNED=0; for PROC in /proc/[0-9]*; do [ "$SCANNED" -lt 2048 ] || break; SCANNED=$((SCANNED + 1)); PID=$(basename "$PROC"); COUNT=$(find "$PROC/fd" -maxdepth 1 -type l 2>/dev/null | head -n 10001 | wc -l); COMM=$(cat "$PROC/comm" 2>/dev/null); printf "%s %s %s\\n" "$COUNT" "$PID" "$COMM"; done | sort -nr | head -n 40',
  'printf "## lsof summary\\n"; if command -v lsof >/dev/null 2>&1; then timeout 10 lsof -nP 2>/dev/null | awk \'NR > 1 { LSOF_COUNTS[$1]++ } END { for (NAME in LSOF_COUNTS) printf "%d %s\\n", LSOF_COUNTS[NAME], NAME }\' | sort -nr | head -n 40; else printf "lsof=unsupported; install lsof with apt/yum\\n"; fi'
].join('; ')

const mountHealthCommand = [
  'printf "## mounts\\n"; if command -v findmnt >/dev/null 2>&1; then findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS | head -n 300; else printf "findmnt=unsupported; install util-linux with apt/yum\\n"; fi',
  'printf "## local capacity\\n"; timeout 10 df -l -hT -x nfs -x nfs4 -x cifs 2>&1 | head -n 200',
  'printf "## read-only mounts\\n"; command -v findmnt >/dev/null 2>&1 && findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS | awk \'$4 ~ /(^|,)ro(,|$)/\' | head -n 100 || true',
  'printf "## remote mounts\\n"; grep -E "[[:space:]](nfs|nfs4|cifs)[[:space:]]" /proc/mounts 2>/dev/null | head -n 100 || true',
  'if command -v nfsstat >/dev/null 2>&1; then timeout 10 nfsstat -m 2>&1 | head -n 160; else printf "nfsstat=unsupported; install nfs-common/nfs-utils with apt/yum\\n"; fi',
  'printf "## mountstats\\n"; sed -n "1,400p" /proc/self/mountstats 2>/dev/null',
  '(journalctl -k --since "-24 hours" --no-pager 2>/dev/null || dmesg 2>/dev/null) | grep -Ei "nfs|cifs|stale|read-only|I/O error" | tail -n 160 || true'
].join('; ')

const blockHealthCommand = [
  'printf "## block devices\\n"; if command -v lsblk >/dev/null 2>&1; then lsblk -e 7 -o NAME,KNAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,ROTA,RO,MODEL,SERIAL | head -n 160; else printf "lsblk=unsupported; install util-linux with apt/yum\\n"; fi',
  'printf "## software raid\\n"; cat /proc/mdstat 2>/dev/null || true',
  'if command -v mdadm >/dev/null 2>&1; then timeout 10 mdadm --detail --scan 2>&1 | head -n 100; else printf "mdadm=unsupported; install mdadm with apt/yum\\n"; fi',
  'printf "## kernel storage warnings\\n"; (journalctl -k --since "-24 hours" --no-pager 2>/dev/null || dmesg 2>/dev/null) | grep -Ei "I/O error|medium error|critical medium|blk_update|nvme.*error|ata.*error|resetting link|md.*degrad" | tail -n 200 || true',
  'if command -v smartctl >/dev/null 2>&1; then DEVICES="$(smartctl --scan-open 2>/dev/null | awk \'{print $1}\' | head -n 8)"; if [ -z "$DEVICES" ]; then printf "smart_status=unconfirmed; no readable supported devices\\n"; else printf "%s\\n" "$DEVICES" | while IFS= read -r DEVICE; do case "$DEVICE" in /dev/*) printf "## SMART %s\\n" "$DEVICE"; SMART_OUTPUT="$(timeout 10 smartctl -H -A "$DEVICE" 2>&1)"; SMART_STATUS=$?; printf "%s\\n" "$SMART_OUTPUT" | grep -Ei "SMART overall-health|SMART Health Status|PASSED|FAILED|Reallocated|Pending|Offline_Uncorrectable|Media_Wearout|Percentage Used|Critical Warning" | head -n 80 || true; [ "$SMART_STATUS" -eq 0 ] || printf "smart_status=unconfirmed device=%s exit=%s; check read permissions\\n" "$DEVICE" "$SMART_STATUS"; ;; esac; done; fi; else printf "smartctl=unsupported; install smartmontools with apt/yum\\n"; fi'
].join('; ')

const timeSyncCommand = [
  'printf "## local time\\n"; date -Ins; date -u -Ins',
  'command -v timedatectl >/dev/null 2>&1 && { timedatectl status 2>&1; timedatectl show -p NTPSynchronized -p TimeUSec -p Timezone 2>&1; } || true',
  'if command -v chronyc >/dev/null 2>&1; then printf "## chrony tracking\\n"; timeout 10 chronyc tracking 2>&1 || printf "chronyc_tracking=unconfirmed\\n"; printf "## chrony sources\\n"; timeout 10 chronyc sources -v 2>&1 | head -n 80; else printf "chronyc=unsupported; install chrony with apt/yum\\n"; fi',
  'if command -v ntpq >/dev/null 2>&1; then printf "## ntpq\\n"; timeout 10 ntpq -pn 2>&1 | head -n 80; else printf "ntpq=unsupported; install ntpsec-ntpdate/ntp with apt/yum\\n"; fi',
  'command -v systemctl >/dev/null 2>&1 && systemctl show systemd-timesyncd chronyd ntpd --no-pager --property=Id,LoadState,ActiveState,SubState 2>/dev/null || true'
].join('; ')

export const advancedSystemTools = Object.freeze([
  tool(
    'process.abnormal-state',
    '异常进程与阻塞状态排查',
    '系统',
    buildProcessAbnormalStateCommand(),
    {
      description: '有界查看资源热点、僵尸和不可中断进程，可选 PID 只读取状态与限制。',
      parameters: [
        { id: 'pid', label: 'PID（可选）', type: 'number', defaultValue: '' }
      ],
      buildCommand: params => buildProcessAbnormalStateCommand(params)
    }
  ),
  tool(
    'system.file-descriptor-pressure',
    '文件描述符与 Socket 压力',
    '系统',
    fdPressureCommand,
    {
      description: '检查系统文件句柄、Socket 汇总和有界进程 FD 排名。',
      timeoutMs: 90000
    }
  ),
  tool(
    'storage.mount-filesystem-health',
    '挂载点与远程文件系统健康',
    '存储',
    mountHealthCommand,
    {
      description: '检查只读挂载、NFS/CIFS 状态和相关内核告警，不主动访问远程挂载点。',
      timeoutMs: 90000
    }
  ),
  tool(
    'storage.block-device-health',
    '磁盘、SMART 与 RAID 健康',
    '存储',
    blockHealthCommand,
    {
      description: '读取块设备、软 RAID、SMART 摘要和内核 I/O 告警，不运行磁盘测试。',
      timeoutMs: 120000
    }
  ),
  tool(
    'system.time-synchronization',
    '系统时间与同步状态',
    '系统',
    timeSyncCommand,
    { description: '读取本机时间、同步源和服务状态，不主动校时或访问新服务器。' }
  )
])
