import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam } from './shared/definition.js'

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
      commands: [
        step('iostat -xz 1 3 | head -n 200 || true'),
        step('vmstat 1 4 | head -n 20 || true'),
        step('head -n 200 /proc/diskstats || true')
      ]
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
        step('findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS | head -n 200 || true'),
        step('head -n 200 /proc/mounts || true')
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
      commands: [
        step('lsof +L1 | head -n 200 || true'),
        step("find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200 || true")
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
}
