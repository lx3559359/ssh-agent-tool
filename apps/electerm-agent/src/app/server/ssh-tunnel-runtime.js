function tunnelError (code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function serializableState (entry) {
  return {
    id: entry.definition.id,
    state: entry.state,
    definition: { ...entry.definition },
    startedAt: entry.startedAt,
    lastTestAt: entry.lastTestAt || null,
    lastTest: entry.lastTest ? { ...entry.lastTest } : null
  }
}

function createSshTunnelRuntime ({
  startController,
  probe = async () => ({ ok: true })
}) {
  if (typeof startController !== 'function') {
    throw new TypeError('startController is required')
  }
  const controllers = new Map()

  async function start (definition = {}) {
    const id = String(definition.id || '').trim()
    if (!id) {
      throw tunnelError('SSH_TUNNEL_INVALID', 'SSH 隧道缺少唯一标识')
    }
    if (controllers.has(id)) {
      throw tunnelError('SSH_TUNNEL_EXISTS', '该 SSH 隧道已经在运行')
    }
    let controller
    try {
      controller = await startController({ ...definition, id })
    } catch (cause) {
      throw tunnelError(
        String(cause?.code || 'SSH_TUNNEL_START_FAILED'),
        String(cause?.message || 'SSH 隧道启动失败'),
        cause
      )
    }
    if (!controller || typeof controller.close !== 'function') {
      throw tunnelError(
        'SSH_TUNNEL_CONTROLLER_INVALID',
        'SSH 隧道控制器无效'
      )
    }
    const entry = {
      controller,
      definition: {
        ...definition,
        ...(controller.descriptor || {}),
        id
      },
      state: 'running',
      startedAt: Date.now(),
      lastTestAt: null,
      lastTest: null
    }
    controllers.set(id, entry)
    return serializableState(entry)
  }

  async function stop (id) {
    const key = String(id || '')
    const entry = controllers.get(key)
    if (!entry) {
      return { id: key, state: 'stopped', notFound: true }
    }
    controllers.delete(key)
    try {
      await entry.controller.close()
    } catch (cause) {
      throw tunnelError(
        String(cause?.code || 'SSH_TUNNEL_STOP_FAILED'),
        String(cause?.message || 'SSH 隧道停止失败'),
        cause
      )
    }
    return { id: key, state: 'stopped' }
  }

  function list () {
    return Array.from(controllers.values(), serializableState)
  }

  async function testTunnel (id) {
    const key = String(id || '')
    const entry = controllers.get(key)
    if (!entry) {
      throw tunnelError('SSH_TUNNEL_NOT_FOUND', '未找到正在运行的 SSH 隧道')
    }
    let result
    try {
      result = await probe({ ...entry.definition })
    } catch (cause) {
      result = {
        ok: false,
        code: String(cause?.code || 'SSH_TUNNEL_TEST_FAILED'),
        message: String(cause?.message || 'SSH 隧道连通性检测失败')
      }
    }
    entry.lastTestAt = Date.now()
    entry.lastTest = { ...result }
    return {
      id: key,
      ...result
    }
  }

  async function closeAll (reason = 'closed') {
    const entries = Array.from(controllers.entries())
    controllers.clear()
    let closed = 0
    let failed = 0
    await Promise.all(entries.map(async ([, entry]) => {
      try {
        await entry.controller.close()
        closed += 1
      } catch {
        failed += 1
      }
    }))
    return { reason, closed, failed }
  }

  return {
    start,
    stop,
    list,
    test: testTunnel,
    closeAll
  }
}

function serializeTunnelError (error) {
  return {
    code: String(error?.code || 'SSH_TUNNEL_ERROR'),
    message: String(error?.message || 'SSH 隧道操作失败')
  }
}

exports.createSshTunnelRuntime = createSshTunnelRuntime
exports.serializeTunnelError = serializeTunnelError
