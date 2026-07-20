import { READ_ONLY, NEED_EDIT, step, defineCommand, numberParam, selectParam } from './shared/definition.js'

export function getContainersCommands () {
  return [
    defineCommand({
      id: 'builtin-server-docker-health-storage',
      name: 'Docker 健康与存储',
      description: '查看容器状态、有限容器集合的健康与重启摘要以及 Docker 存储占用。',
      usage: '用于排查容器不健康、反复重启和镜像、卷或构建缓存占用过高。',
      labels: [READ_ONLY, 'Docker'],
      advancedUsage: [
        '最多列出 100 行容器、检查前 20 个容器并显示 50 行存储统计。',
        '未安装 Docker 时会给出中文提示并正常结束。'
      ],
      commands: [
        step(String.raw`(
  run_bounded_docker_output () {
    limit="$1"
    shift
    {
      "$@" 2>/dev/null
      printf '\\036SHELLPILOT_DOCKER_STATUS=%s\\n' "$?"
    } | awk -v limit="$limit" '
      BEGIN {
        marker = sprintf("%c", 30) "SHELLPILOT_DOCKER_STATUS="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          if (length(prefix) > 0 && emitted < limit) {
            print prefix
            emitted++
          }
          command_status = substr($0, marker_position + length(marker))
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
        if (truncated || (status_seen && command_status == 0)) {
          exit 0
        }
        exit 1
      }
    '
  }

  if ! command -v docker >/dev/null 2>&1; then
    printf '未检测到 Docker，已跳过容器健康与存储诊断。\\n'
  else
    printf '===== Docker 容器 =====\\n'
    run_bounded_docker_output 100 docker ps -a --format 'table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}' ||
      printf '无法读取 Docker 容器列表。\\n'

    printf '===== 容器健康与重启摘要（最多 20 个） =====\\n'
    docker ps -a --format '{{.ID}}' 2>/dev/null |
      awk '
        NR <= 20 {
          print
          next
        }
        {
          exit
        }
      ' |
      while IFS= read -r container_id; do
        [ -n "$container_id" ] || continue
        docker inspect --format '名称={{.Name}} 健康={{if .State.Health}}{{.State.Health.Status}}{{else}}未配置{{end}} 重启次数={{.RestartCount}}' "$container_id" 2>/dev/null || true
      done

    printf '===== Docker 存储占用 =====\\n'
    run_bounded_docker_output 50 docker system df || printf '无法读取 Docker 存储统计。\\n'
  fi
)
true`)
      ]
    }),
    defineCommand({
      id: 'builtin-server-docker',
      name: 'Docker 排查',
      description: '查看容器、资源占用、镜像和 Docker 服务状态。',
      usage: '适合排查容器未启动、端口映射、资源占用和镜像问题。',
      labels: [READ_ONLY, 'Docker'],
      advancedUsage: [
        '查看容器日志：docker logs <container-id> --tail 200',
        '查看端口映射：docker ps --format "table {{.Names}}\\t{{.Ports}}"'
      ],
      commands: [
        step('docker ps -a'),
        step('docker stats --no-stream'),
        step('docker images'),
        step('systemctl status docker --no-pager 2>/dev/null || true')
      ]
    }),
    defineCommand({
      id: 'builtin-server-docker-action',
      name: 'Docker 容器操作',
      description: '按容器名查看日志、配置、资源，或启动、停止和重启容器。',
      usage: '默认只看日志；修改操作会保存容器原运行状态并提供快捷回滚。',
      labels: [NEED_EDIT, 'Docker', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: 'Docker 容器操作',
        pathParam: '回滚脚本',
        actionParam: '操作',
        mutatingValues: ['start', 'stop', 'restart'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '容器名称',
          label: '容器名称或 ID',
          type: 'service-target',
          targetType: 'container',
          sources: ['docker', 'compose'],
          multiple: false,
          defaultValue: '',
          placeholder: '自动识别后选择容器',
          help: '列表来自当前 SSH 服务器；留空执行时会列出全部容器。'
        },
        selectParam('操作', '操作', 'logs', '日志、配置和资源为只读；启动、停止和重启会修改容器状态。', [
          { label: '查看日志', value: 'logs' },
          { label: '查看配置', value: 'inspect' },
          { label: '查看资源', value: 'stats' },
          { label: '启动', value: 'start' },
          { label: '停止', value: 'stop' },
          { label: '重启', value: 'restart' }
        ]),
        numberParam('日志行数', '日志行数', '100', '查看日志时读取末尾行数。', 10, 5000)
      ],
      advancedUsage: [
        '修改前记录容器是否正在运行，回滚时恢复原运行状态。',
        '容器重启后的内存状态无法恢复；重要业务先确认副本和健康检查。'
      ],
      commands: [
        step(`CONTAINER="{{容器名称}}"
ACTION="{{操作}}"
LOG_LINES="{{日志行数}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
if [ -z "$CONTAINER" ]; then docker ps -a; exit 0; fi
case "$ACTION" in
  logs) docker logs "$CONTAINER" --tail "$LOG_LINES"; exit $? ;;
  inspect) docker inspect "$CONTAINER"; exit $? ;;
  stats) docker stats --no-stream "$CONTAINER"; exit $? ;;
esac
if [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改容器。"; exit 0; fi
OLD_RUNNING="$(docker inspect "$CONTAINER" 2>/dev/null | sed -n 's/.*"Running": \\(true\\|false\\).*/\\1/p' | head -n 1)"
if [ -z "$OLD_RUNNING" ]; then echo "未找到容器: $CONTAINER"; exit 1; fi
mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-docker-rollback-$$.sh"
{
  echo '#!/bin/sh'
  if [ "$OLD_RUNNING" = "true" ]; then echo "docker start '$CONTAINER'"; else echo "docker stop '$CONTAINER'"; fi
} > "$TMP_ROLLBACK"
mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; chmod 700 "$ROLLBACK_SCRIPT"
docker "$ACTION" "$CONTAINER"
docker ps -a --filter "id=$CONTAINER" --filter "name=$CONTAINER"
echo "回滚脚本: $ROLLBACK_SCRIPT"`)
      ]
    })
  ]
}

const fixedContainerDiagnosticCommands = getContainersCommands()

export const DOCKER_HEALTH_STORAGE_DIAGNOSTIC_COMMAND = fixedContainerDiagnosticCommands
  .find(command => command.id === 'builtin-server-docker-health-storage').commands[0].command
