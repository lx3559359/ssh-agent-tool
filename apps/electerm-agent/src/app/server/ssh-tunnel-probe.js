const verdictOrder = ['passed', 'unverified', 'limited', 'failed']
const probeStageStatuses = new Set(verdictOrder)

function safeText (value, fallback = '') {
  const source = value === undefined || value === null || value === '' ? fallback : value
  return String(source)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

function createProbeStage (id, status, code, message, latencyMs) {
  const stage = {
    id: safeText(id, 'unknown'),
    status: probeStageStatuses.has(status) ? status : 'failed',
    code: safeText(code, 'SSH_TUNNEL_PROBE_STAGE'),
    message: safeText(message, status)
  }
  if (Number.isFinite(latencyMs)) stage.latencyMs = Math.max(0, latencyMs)
  return stage
}

function createProbeResult (stages, options = {}) {
  const safeStages = Array.isArray(stages) ? stages.map(stage => ({ ...stage })) : []
  const verdict = safeStages.length
    ? safeStages.reduce((current, stage) => (
        verdictOrder.indexOf(stage.status) > verdictOrder.indexOf(current)
          ? stage.status
          : current
      ), 'passed')
    : 'unverified'
  const decisive = safeStages.find(stage => stage.status === verdict)
  return {
    ok: verdict === 'passed',
    verdict,
    summary: safeText(options.summary || decisive?.message, verdict),
    checkedAt: Number.isFinite(options.checkedAt) ? options.checkedAt : Date.now(),
    ...(Number.isFinite(options.latencyMs) ? { latencyMs: options.latencyMs } : {}),
    stages: safeStages
  }
}

function probeStagesForError (type, error = {}) {
  const code = String(error.code || 'SSH_TUNNEL_TEST_FAILED')
  const message = safeText(error.message, 'SSH 隧道检测失败')
  if (type === 'forwardLocalToRemote') {
    const prohibited = code === 'SSH_TUNNEL_FORWARDING_PROHIBITED'
    return [
      createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
      createProbeStage(
        'ssh-forwarding',
        prohibited ? 'limited' : 'passed',
        prohibited ? code : 'SSH_TUNNEL_FORWARDING_READY',
        prohibited ? 'SSH 服务器禁止端口转发' : 'SSH 转发通道已建立'
      ),
      createProbeStage(
        'target-service',
        prohibited ? 'unverified' : 'failed',
        prohibited ? 'SSH_TUNNEL_STAGE_NOT_REACHED' : code,
        prohibited ? 'SSH 转发失败，尚未检测目标服务' : message
      )
    ]
  }
  return [createProbeStage(
    'tunnel',
    code === 'SSH_TUNNEL_FORWARDING_PROHIBITED' ? 'limited' : 'failed',
    code,
    message
  )]
}

function withProbeTimeout (promise, timeoutMs, stage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('SSH 隧道连通性检测超时')
      error.code = 'SSH_TUNNEL_TEST_TIMEOUT'
      error.stage = stage
      reject(error)
    }, timeoutMs)
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) }
    )
  })
}

exports.createProbeResult = createProbeResult
exports.createProbeStage = createProbeStage
exports.probeStagesForError = probeStagesForError
exports.safeText = safeText
exports.withProbeTimeout = withProbeTimeout
