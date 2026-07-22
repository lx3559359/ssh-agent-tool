import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam, selectParam } from './shared/definition.js'
import { withRollback } from './shared/safety-metadata.js'

function buildBoundedStorageDiagnosticCommand (primaryCommand, fallbackCommand) {
  return `(
  run_storage_primary () {
    "$@" &
    primary_pid=$!
    (
      sleep 15
      kill -KILL "$primary_pid" 2>/dev/null
    ) >/dev/null 2>&1 &
    timer_pid=$!
    wait "$primary_pid"
    primary_status=$?
    kill -KILL "$timer_pid" 2>/dev/null || true
    wait "$timer_pid" 2>/dev/null || true
    return "$primary_status"
  }

  if {
    run_storage_primary ${primaryCommand}
    printf '\\036SHELLPILOT_STORAGE_STATUS=%s\\n' "$?"
  } | awk '
    BEGIN {
      limit = 200
      marker = sprintf("%c", 30) "SHELLPILOT_STORAGE_STATUS="
    }
    {
      marker_position = index($0, marker)
      if (marker_position > 0) {
        prefix = substr($0, 1, marker_position - 1)
        if (length(prefix) > 0 && emitted < limit) {
          print prefix
          emitted++
        }
        primary_status = substr($0, marker_position + length(marker))
        status_seen = 1
        next
      }
      if (emitted < limit) {
        print
        emitted++
        next
      }
      truncated = 1
      exit
    }
    END {
      if (truncated || (status_seen && primary_status == 0)) {
        exit 0
      }
      exit 1
    }
  '; then
    true
  else
${fallbackCommand}
  fi
)
true`
}

const diskIoDiagnosticCommand = buildBoundedStorageDiagnosticCommand(
  'iostat -xz 1 3 2>/dev/null',
  '    vmstat 1 4 2>/dev/null | head -n 20 || true\n' +
    '    head -n 200 /proc/diskstats 2>/dev/null || true'
)

const inodeMountDiagnosticCommand = buildBoundedStorageDiagnosticCommand(
  'findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null',
  '    head -n 200 /proc/mounts 2>/dev/null || true'
)

const deletedOpenFilesDiagnosticCommand = buildBoundedStorageDiagnosticCommand(
  'lsof +L1 2>/dev/null',
  "    find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200 || true"
)

export function getStorageCommands () {
  return [
    defineCommand({
      id: 'builtin-server-disk',
      name: '磁盘空间',
      description: '查看磁盘分区、文件系统类型和根目录占用排行。',
      usage: '适合排查磁盘满、日志占用过高、挂载异常等问题。',
      labels: [READ_ONLY, '磁盘'],
      advancedUsage: [
        '查看指定目录：du -xh --max-depth=1 /var/log | sort -h',
        '查大文件：find / -xdev -type f -size +500M -print 2>/dev/null | head -n 50'
      ],
      commands: [
        step('df -hT'),
        step('du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -n 20')
      ]
    }),
    defineCommand({
      id: 'builtin-server-disk-io',
      name: '\u78c1\u76d8 I/O \u72b6\u6001',
      description: '\u67e5\u770b\u78c1\u76d8\u5ef6\u8fdf\u3001\u7e41\u5fd9\u5ea6\u3001\u961f\u5217\u548c\u541e\u5410\u53d8\u5316\uff0c\u5e76\u8865\u5145\u5185\u6838\u78c1\u76d8\u8ba1\u6570\u5668\u3002',
      usage: '\u7528\u4e8e\u6392\u67e5 I/O \u7b49\u5f85\u5347\u9ad8\u3001\u78c1\u76d8\u54cd\u5e94\u6162\u548c\u5b58\u50a8\u541e\u5410\u74f6\u9888\u3002',
      labels: [READ_ONLY, '\u5b58\u50a8'],
      advancedUsage: [
        'iostat \u4e0d\u53ef\u7528\u65f6\uff0c\u540e\u7eed vmstat \u4e0e /proc/diskstats \u4ecd\u4f1a\u63d0\u4f9b\u964d\u7ea7\u4fe1\u606f\u3002',
        '\u6240\u6709\u91c7\u6837\u548c\u8f93\u51fa\u5747\u6709\u56fa\u5b9a\u8fb9\u754c\uff0c\u4e0d\u4f1a\u8fdb\u5165\u6301\u7eed\u5237\u65b0\u6a21\u5f0f\u3002'
      ],
      commands: [step(diskIoDiagnosticCommand)]
    }),
    defineCommand({
      id: 'builtin-server-inode-mount',
      name: 'Inode \u4e0e\u6302\u8f7d\u72b6\u6001',
      description: '\u67e5\u770b\u6587\u4ef6\u7cfb\u7edf inode \u4f7f\u7528\u7387\u3001\u6302\u8f7d\u6765\u6e90\u3001\u7c7b\u578b\u548c\u6302\u8f7d\u9009\u9879\u3002',
      usage: '\u7528\u4e8e\u6392\u67e5 inode \u8017\u5c3d\u3001\u53ea\u8bfb\u6302\u8f7d\u3001\u6302\u8f7d\u6765\u6e90\u9519\u8bef\u548c\u6587\u4ef6\u7cfb\u7edf\u5f02\u5e38\u3002',
      labels: [READ_ONLY, '\u5b58\u50a8'],
      advancedUsage: [
        'findmnt \u4e0d\u53ef\u7528\u6216\u6743\u9650\u53d7\u9650\u65f6\uff0c\u540e\u7eed /proc/mounts \u5feb\u7167\u4ecd\u53ef\u63d0\u4f9b\u6302\u8f7d\u4fe1\u606f\u3002'
      ],
      commands: [
        step('df -iP | head -n 200 || true'),
        step(inodeMountDiagnosticCommand)
      ]
    }),
    defineCommand({
      id: 'builtin-server-deleted-open-files',
      name: '\u5df2\u5220\u9664\u6587\u4ef6\u5360\u7528',
      description: '\u67e5\u627e\u5df2\u4ece\u76ee\u5f55\u5220\u9664\u4f46\u4ecd\u88ab\u8fdb\u7a0b\u6253\u5f00\u3001\u7ee7\u7eed\u5360\u7528\u78c1\u76d8\u7a7a\u95f4\u7684\u6587\u4ef6\u3002',
      usage: '\u7528\u4e8e\u6392\u67e5\u6587\u4ef6\u5df2\u5220\u9664\u4f46\u78c1\u76d8\u7a7a\u95f4\u672a\u91ca\u653e\uff0c\u4ee5\u53ca\u5b9a\u4f4d\u6301\u6709\u6587\u4ef6\u53e5\u67c4\u7684\u8fdb\u7a0b\u3002',
      labels: [READ_ONLY, '\u5b58\u50a8'],
      advancedUsage: [
        'lsof \u4e0d\u53ef\u7528\u6216\u6743\u9650\u4e0d\u8db3\u65f6\uff0c\u540e\u7eed /proc \u6587\u4ef6\u63cf\u8ff0\u7b26\u626b\u63cf\u4f1a\u7ee7\u7eed\u6267\u884c\u3002',
        '\u666e\u901a\u7528\u6237\u53ea\u80fd\u770b\u5230\u6709\u6743\u9650\u8bbf\u95ee\u7684\u8fdb\u7a0b\uff0c\u7ed3\u679c\u6700\u591a\u663e\u793a 200 \u884c\u3002'
      ],
      commands: [step(deletedOpenFilesDiagnosticCommand)]
    }),
    defineCommand({
      id: 'builtin-server-directory-analysis',
      name: '目录占用分析',
      description: '按目录、深度和数量列出占用空间最大的文件与子目录。',
      usage: '用于快速定位日志暴涨、缓存堆积、备份文件或大目录占满磁盘。',
      labels: [NEED_EDIT, '磁盘', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        inputParam('分析目录', '分析目录', '/var/log', '填写要分析的绝对路径，默认查看日志目录。', '例如 /var/log'),
        numberParam('目录深度', '目录深度', '1', '子目录统计深度，建议 1-3，过大会增加扫描时间。', 1, 8),
        numberParam('显示数量', '显示数量', '20', '显示占用最大的前 N 项。', 5, 200)
      ],
      advancedUsage: [
        '跨挂载点可能很慢；只查当前文件系统可在 find 中增加 -xdev。',
        '大目录扫描期间可按 Ctrl+C 停止，不会修改任何文件。'
      ],
      commands: [
        step(`TARGET_DIR="{{分析目录}}"
DEPTH="{{目录深度}}"
TOP="{{显示数量}}"
if [ ! -d "$TARGET_DIR" ]; then echo "目录不存在: $TARGET_DIR"; exit 1; fi
echo "目录占用排行:"; du -xh --max-depth="$DEPTH" -- "$TARGET_DIR" 2>/dev/null | sort -h | tail -n "$TOP"
echo "大文件排行:"; find "$TARGET_DIR" -type f -printf '%s %p\n' 2>/dev/null | sort -n | tail -n "$TOP" | numfmt --field=1 --to=iec 2>/dev/null || true`)
      ]
    }),
    defineCommand(withRollback({
      id: 'builtin-server-swap-manage',
      name: '\u7ba1\u7406 Swap',
      description: '\u67e5\u8be2 Swap \u72b6\u6001\uff0c\u6216\u5b89\u5168\u521b\u5efa\u3001\u542f\u7528\u3001\u505c\u7528\u548c\u79fb\u9664 Swap \u914d\u7f6e\u3002',
      usage: '\u9ed8\u8ba4\u53ea\u67e5\u8be2\uff1b\u4fee\u6539\u524d\u5907\u4efd /etc/fstab \u5e76\u4fdd\u5b58\u539f Swap \u6fc0\u6d3b\u72b6\u6001\u3002',
      labels: [NEED_EDIT, '\u5b58\u50a8', '\u9ad8\u98ce\u9669'],
      params: [
        selectParam('\u64cd\u4f5c', '\u64cd\u4f5c', 'status', '\u9ed8\u8ba4\u67e5\u8be2\uff1b\u53ea\u6709\u786e\u8ba4\u540e\u624d\u4f1a\u6267\u884c\u4fee\u6539\u3002', [
          { label: '\u67e5\u8be2\u72b6\u6001', value: 'status' },
          { label: '\u521b\u5efa\u5e76\u542f\u7528', value: 'create' },
          { label: '\u542f\u7528\u5df2\u6709 Swap', value: 'enable' },
          { label: '\u4e34\u65f6\u505c\u7528', value: 'disable' },
          { label: '\u79fb\u9664\u914d\u7f6e\uff08\u4fdd\u7559\u6587\u4ef6\uff09', value: 'remove' }
        ], { validationType: 'enum', required: true }),
        inputParam('Swap\u8def\u5f84', 'Swap \u8def\u5f84', '/swapfile', '\u5fc5\u987b\u662f\u5b89\u5168\u7684\u7edd\u5bf9\u8def\u5f84\u3002', '\u4f8b\u5982 /swapfile', {
          validationType: 'path',
          required: true
        }),
        numberParam('\u5927\u5c0fMB', '\u5927\u5c0f\uff08MB\uff09', '2048', '\u4ec5\u521b\u5efa\u65f6\u4f7f\u7528\uff0c\u6267\u884c\u524d\u4f1a\u68c0\u67e5\u53ef\u7528\u7a7a\u95f4\u3002', 64, 1048576, {
          validationType: 'integer',
          required: true
        })
      ],
      advancedUsage: [
        '\u79fb\u9664\u914d\u7f6e\u4f1a\u505c\u7528 Swap \u5e76\u4ece /etc/fstab \u5220\u9664\u5bf9\u5e94\u9879\uff0c\u4f46\u4e0d\u5220\u9664\u5927\u578b Swap \u6587\u4ef6\u3002',
        '\u5feb\u6377\u56de\u6eda\u4f1a\u6062\u590d /etc/fstab\u3001\u539f\u6fc0\u6d3b\u72b6\u6001\uff0c\u5e76\u5220\u9664\u672c\u6b21\u65b0\u521b\u5efa\u7684 Swap \u6587\u4ef6\u3002'
      ],
      commands: [
        step(`SWAP_PATH="{{Swap\u8def\u5f84}}"
SIZE_MB="{{\u5927\u5c0fMB}}"
ACTION="{{\u64cd\u4f5c}}"
APPLY_CHANGE="{{\u786e\u8ba4\u6267\u884c}}"
ROLLBACK_SCRIPT="{{\u56de\u6eda\u811a\u672c}}"
is_swap_active () {
  awk -v target="$SWAP_PATH" 'NR > 1 && $1 == target { found = 1 } END { exit found ? 0 : 1 }' /proc/swaps
}
show_swap_status () {
  echo "===== Swap \u72b6\u6001 ====="
  swapon --show 2>/dev/null || cat /proc/swaps
  echo "===== /etc/fstab \u914d\u7f6e ====="
  awk -v target="$SWAP_PATH" '$1 == target { print }' /etc/fstab 2>/dev/null || true
}
if [ "$ACTION" = "status" ]; then show_swap_status; exit 0; fi
echo "\u9884\u89c8: $ACTION $SWAP_PATH\uff0c\u5927\u5c0f $SIZE_MB MB"
if [ "$APPLY_CHANGE" != "yes" ]; then echo "\u5f53\u524d\u4e3a\u53ea\u8bfb\u9884\u89c8\uff0c\u672a\u4fee\u6539 Swap"; exit 0; fi
RUN_AS=""
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "\u5f53\u524d\u8d26\u53f7\u65e0\u6cd5\u4fee\u6539 Swap"; exit 1; fi
fi
SWAPON_SNAPSHOT="$OPERATION_ROLLBACK_DIR/swapon.before"
if command -v swapon >/dev/null 2>&1 && swapon --show --noheadings --raw --output NAME,TYPE,SIZE,USED,PRIO > "$SWAPON_SNAPSHOT" 2>/dev/null; then
  :
else
  cat /proc/swaps > "$SWAPON_SNAPSHOT" || { echo "\u65e0\u6cd5\u4fdd\u5b58 Swap \u6fc0\u6d3b\u72b6\u6001"; exit 1; }
fi
OLD_ACTIVE=no
if is_swap_active; then OLD_ACTIVE=yes; fi
SWAP_FILE_EXISTED=no
if [ -e "$SWAP_PATH" ]; then SWAP_FILE_EXISTED=yes; fi
TMP_ROLLBACK="$OPERATION_ROLLBACK_DIR/swap-rollback.sh"
{
  echo '#!/bin/sh'
  echo 'set -e'
  echo "SWAP_PATH='$SWAP_PATH'"
  echo "OLD_ACTIVE='$OLD_ACTIVE'"
  echo "SWAP_FILE_EXISTED='$SWAP_FILE_EXISTED'"
  echo "OPERATION_DIR='$OPERATION_ROLLBACK_DIR'"
  echo "SWAPON_SNAPSHOT='$SWAPON_SNAPSHOT'"
  cat <<'SHELLPILOT_SWAP_ROLLBACK'
RUN_AS=""
if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi
test -f "$SWAPON_SNAPSHOT" || { echo "Swap \u6fc0\u6d3b\u72b6\u6001\u5feb\u7167\u4e0d\u5b58\u5728: $SWAPON_SNAPSHOT"; exit 1; }
echo "Swap \u6fc0\u6d3b\u72b6\u6001\u5feb\u7167: $SWAPON_SNAPSHOT"
if awk -v target="$SWAP_PATH" 'NR > 1 && $1 == target { found = 1 } END { exit found ? 0 : 1 }' /proc/swaps; then
  $RUN_AS swapoff "$SWAP_PATH"
fi
if [ -f "$OPERATION_DIR/target-1" ]; then
  $RUN_AS cp -a -- "$OPERATION_DIR/target-1" /etc/fstab
fi
if [ "$SWAP_FILE_EXISTED" = "no" ] && [ -e "$SWAP_PATH" ]; then
  $RUN_AS rm -f -- "$SWAP_PATH"
fi
if [ "$OLD_ACTIVE" = "yes" ] && [ -e "$SWAP_PATH" ]; then
  $RUN_AS swapon "$SWAP_PATH"
fi
SHELLPILOT_SWAP_ROLLBACK
} > "$TMP_ROLLBACK"
$RUN_AS install -m 700 -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"
echo "Swap \u6fc0\u6d3b\u72b6\u6001\u5feb\u7167: $SWAPON_SNAPSHOT"
ensure_fstab_entry () {
  if ! awk -v target="$SWAP_PATH" '$1 == target { found = 1 } END { exit found ? 0 : 1 }' /etc/fstab 2>/dev/null; then
    echo "$SWAP_PATH none swap sw 0 0" | $RUN_AS tee -a /etc/fstab >/dev/null
  fi
}
remove_fstab_entry () {
  if [ -f /etc/fstab ]; then
    NEXT_FSTAB="$OPERATION_ROLLBACK_DIR/fstab.next"
    awk -v target="$SWAP_PATH" '$1 != target { print }' /etc/fstab > "$NEXT_FSTAB"
    $RUN_AS install -m 644 -- "$NEXT_FSTAB" /etc/fstab
  fi
}
case "$ACTION" in
  create)
    if [ -e "$SWAP_PATH" ]; then echo "Swap \u8def\u5f84\u5df2\u5b58\u5728"; exit 1; fi
    PARENT_DIR=$(dirname -- "$SWAP_PATH")
    if [ ! -d "$PARENT_DIR" ]; then echo "Swap \u7236\u76ee\u5f55\u4e0d\u5b58\u5728"; exit 1; fi
    AVAILABLE_KB=$(df -Pk "$PARENT_DIR" | awk 'NR == 2 { print $4 }')
    REQUIRED_KB=$((SIZE_MB * 1024))
    if [ "$AVAILABLE_KB" -le "$REQUIRED_KB" ]; then echo "\u53ef\u7528\u7a7a\u95f4\u4e0d\u8db3"; exit 1; fi
    if command -v fallocate >/dev/null 2>&1; then
      $RUN_AS fallocate -l "$SIZE_MB"M "$SWAP_PATH"
    else
      $RUN_AS dd if=/dev/zero of="$SWAP_PATH" bs=1M count="$SIZE_MB" status=none
    fi
    $RUN_AS chmod 600 "$SWAP_PATH"
    $RUN_AS mkswap "$SWAP_PATH"
    $RUN_AS swapon "$SWAP_PATH"
    ensure_fstab_entry
    ;;
  enable)
    if [ ! -f "$SWAP_PATH" ]; then echo "Swap \u6587\u4ef6\u4e0d\u5b58\u5728"; exit 1; fi
    if ! is_swap_active; then $RUN_AS swapon "$SWAP_PATH"; fi
    ensure_fstab_entry
    ;;
  disable)
    if is_swap_active; then $RUN_AS swapoff "$SWAP_PATH"; fi
    ;;
  remove)
    if is_swap_active; then $RUN_AS swapoff "$SWAP_PATH"; fi
    remove_fstab_entry
    ;;
  *) echo "\u4e0d\u652f\u6301\u7684 Swap \u64cd\u4f5c"; exit 1;;
esac
show_swap_status
echo "\u56de\u6eda\u811a\u672c: $ROLLBACK_SCRIPT"`)
      ]
    }, {
      title: '\u7ba1\u7406 Swap',
      actionParam: '\u64cd\u4f5c',
      mutatingValues: ['create', 'enable', 'disable', 'remove'],
      backupTargets: ['/etc/fstab'],
      verifyCommands: [
        'test -s "{{\u56de\u6eda\u811a\u672c}}" && case "{{\u64cd\u4f5c}}" in create|enable) awk -v target="{{Swap\u8def\u5f84}}" \'NR > 1 && $1 == target { found = 1 } END { exit found ? 0 : 1 }\' /proc/swaps && awk -v target="{{Swap\u8def\u5f84}}" \'$1 == target { found = 1 } END { exit found ? 0 : 1 }\' /etc/fstab ;; disable) ! awk -v target="{{Swap\u8def\u5f84}}" \'NR > 1 && $1 == target { found = 1 } END { exit found ? 0 : 1 }\' /proc/swaps ;; remove) ! awk -v target="{{Swap\u8def\u5f84}}" \'NR > 1 && $1 == target { found = 1 } END { exit found ? 0 : 1 }\' /proc/swaps && ! awk -v target="{{Swap\u8def\u5f84}}" \'$1 == target { found = 1 } END { exit found ? 0 : 1 }\' /etc/fstab ;; *) exit 1 ;; esac'
      ]
    }))
  ]
}
