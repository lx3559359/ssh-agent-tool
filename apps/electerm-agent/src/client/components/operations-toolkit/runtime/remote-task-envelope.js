import { assertTrustedOperationId } from '../../../common/safety-transactions/operation-id.js'

const taskRoot = '$HOME/.shellpilot/tasks'
const pollChunkBytes = 192 * 1024

function encodeUtf8Base64 (value) {
  const bytes = new TextEncoder().encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function taskDirectory (taskId) {
  return `${taskRoot}/${assertTrustedOperationId(taskId)}`
}

export function buildPrepareRemoteTaskCommand (taskId, script) {
  const directory = taskDirectory(taskId)
  const encoded = encodeUtf8Base64(script)
  return [
    'umask 077',
    `mkdir -p "${directory}"`,
    `printf '%s' '${encoded}' | base64 -d > "${directory}/run.sh"`,
    `chmod 700 "${directory}/run.sh"`,
    `: > "${directory}/output.log"`,
    `rm -f "${directory}/pid" "${directory}/exit"`
  ].join(' && ')
}

export function buildStartRemoteTaskCommand (taskId) {
  const directory = taskDirectory(taskId)
  return [
    `task_dir="${directory}"`,
    'cd "$task_dir" || exit 1',
    'setsid sh -c \'sh ./run.sh > output.log 2>&1; printf "%s" "$?" > exit\' </dev/null >/dev/null 2>&1 &',
    'printf \'%s\' "$!" > "$task_dir/pid"'
  ].join('\n')
}

export function buildPollRemoteTaskCommand (taskId, byteOffset = 0) {
  const directory = taskDirectory(taskId)
  const start = Math.max(0, Math.floor(Number(byteOffset) || 0)) + 1
  return [
    `task_dir="${directory}"`,
    'size=$(wc -c < "$task_dir/output.log" 2>/dev/null || printf 0)',
    'exit_code=$(cat "$task_dir/exit" 2>/dev/null || true)',
    `next=$(( ${Math.max(0, Math.floor(Number(byteOffset) || 0))} + ${pollChunkBytes} ))`,
    'if [ "$next" -gt "$size" ]; then next="$size"; fi',
    `data=$(tail -c +${start} "$task_dir/output.log" 2>/dev/null | head -c ${pollChunkBytes} | base64 | tr -d '\\n')`,
    'printf \'__OPS_SIZE__=%s\\n__OPS_NEXT__=%s\\n__OPS_EXIT__=%s\\n__OPS_DATA__=%s\\n\' "$size" "$next" "$exit_code" "$data"'
  ].join('; ')
}

export function buildCancelRemoteTaskCommand (taskId) {
  const directory = taskDirectory(taskId)
  return [
    `task_dir="${directory}"`,
    'pid=$(cat "$task_dir/pid" 2>/dev/null || true)',
    'if [ -n "$pid" ]; then',
    'kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true',
    'sleep 2',
    'kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true',
    'fi'
  ].join('; ')
}

export function buildCleanupRemoteTaskCommand (taskId) {
  return `rm -rf "${taskDirectory(taskId)}"`
}

export function parseRemoteTaskPoll (value) {
  const text = String(value || '')
  const size = text.match(/^__OPS_SIZE__=(\d+)$/m)
  const next = text.match(/^__OPS_NEXT__=(\d+)$/m)
  const exit = text.match(/^__OPS_EXIT__=(-?\d*)$/m)
  const data = text.match(/^__OPS_DATA__=([A-Za-z0-9+/=]*)$/m)
  if (!size || !next || !exit || !data) {
    throw new Error('远程运维任务状态响应无效')
  }
  return {
    size: Number(size[1]),
    nextOffset: Number(next[1]),
    exitCode: exit[1] === '' ? null : Number(exit[1]),
    data: data[1]
  }
}
