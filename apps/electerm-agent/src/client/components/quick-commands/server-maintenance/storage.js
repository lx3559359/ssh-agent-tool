import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam } from './shared/definition.js'

export const storageCommands = [
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
  })
]
