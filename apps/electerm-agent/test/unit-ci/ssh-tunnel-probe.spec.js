const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createProbeResult,
  createProbeStage,
  probeStagesForError,
  withProbeTimeout
} = require('../../src/app/server/ssh-tunnel-probe')

test('probe result only passes when every required stage passed', () => {
  const result = createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常', 1),
    createProbeStage('ssh-forwarding', 'limited', 'SSH_TUNNEL_FORWARDING_PROHIBITED', 'SSH 服务器禁止端口转发'),
    createProbeStage('target-service', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', '尚未检测目标服务')
  ], { checkedAt: 123 })

  assert.equal(result.verdict, 'limited')
  assert.equal(result.checkedAt, 123)
  assert.equal(result.ok, false)
  assert.equal(result.stages[1].status, 'limited')
})

test('probe result passes only when all stages passed', () => {
  const stages = [
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
    createProbeStage('ssh-forwarding', 'passed', 'SSH_TUNNEL_FORWARDING_READY', 'SSH 转发通道已建立'),
    createProbeStage('target-service', 'passed', 'SSH_TUNNEL_TARGET_READY', '目标服务可连接')
  ]

  const result = createProbeResult(stages, { checkedAt: 456 })

  assert.equal(result.verdict, 'passed')
  assert.equal(result.ok, true)
  assert.equal(result.checkedAt, 456)
})

test('probe result rebuilds malformed stages and drops external fields', () => {
  const nested = { secret: 'must not escape' }
  const stages = [
    {
      id: 'local-listener',
      status: 'passed',
      code: 'READY',
      message: 'ok',
      latencyMs: -10,
      sensitive: 'drop me',
      nested
    },
    null,
    {},
    { id: 'unknown', status: 'bogus', code: 'BAD', message: 'bad' }
  ]

  const result = createProbeResult(stages, { checkedAt: 789 })

  assert.equal(result.verdict, 'failed')
  assert.equal(result.ok, false)
  assert.deepEqual(result.stages, [
    {
      id: 'local-listener',
      status: 'passed',
      code: 'READY',
      message: 'ok',
      latencyMs: 0
    },
    {
      id: 'unknown',
      status: 'failed',
      code: 'SSH_TUNNEL_PROBE_STAGE',
      message: 'failed'
    },
    {
      id: 'unknown',
      status: 'failed',
      code: 'SSH_TUNNEL_PROBE_STAGE',
      message: 'failed'
    },
    {
      id: 'unknown',
      status: 'failed',
      code: 'BAD',
      message: 'bad'
    }
  ])
  assert.equal(Object.prototype.hasOwnProperty.call(result.stages[0], 'sensitive'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result.stages[0], 'nested'), false)

  stages[0].message = 'mutated after result'
  assert.equal(result.stages[0].message, 'ok')
  assert.notEqual(result.stages[0], stages[0])
  assert.notEqual(nested, result.stages[0].nested)
})

test('forwarding prohibition leaves the target stage unverified', () => {
  const error = Object.assign(new Error('administratively prohibited\nstack details'), {
    code: 'SSH_TUNNEL_FORWARDING_PROHIBITED'
  })

  assert.deepEqual(
    probeStagesForError('forwardLocalToRemote', error),
    [
      createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
      createProbeStage('ssh-forwarding', 'limited', 'SSH_TUNNEL_FORWARDING_PROHIBITED', 'SSH 服务器禁止端口转发'),
      createProbeStage('target-service', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', 'SSH 转发失败，尚未检测目标服务')
    ]
  )
})

test('destination refusal proves forwarding but fails the target stage', () => {
  const stages = probeStagesForError('forwardLocalToRemote', Object.assign(
    new Error('目标服务拒绝连接'),
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' }
  ))

  assert.deepEqual(stages.map(stage => stage.status), ['passed', 'passed', 'failed'])
  assert.equal(stages[1].code, 'SSH_TUNNEL_FORWARDING_READY')
  assert.equal(stages[2].code, 'SSH_TUNNEL_DESTINATION_REFUSED')
})

test('connection loss does not claim forwarding was accepted', () => {
  const stages = probeStagesForError('forwardLocalToRemote', Object.assign(
    new Error('SSH session closed'),
    { code: 'SSH_CONNECTION_CLOSED' }
  ))

  assert.deepEqual(stages.map(stage => stage.status), ['passed', 'failed', 'unverified'])
  assert.equal(stages[1].code, 'SSH_CONNECTION_CLOSED')
  assert.equal(stages[2].code, 'SSH_TUNNEL_STAGE_NOT_REACHED')
})

test('probe timeout does not claim forwarding was accepted', () => {
  const stages = probeStagesForError('forwardLocalToRemote', Object.assign(
    new Error('SSH 隧道连通性检测超时'),
    { code: 'SSH_TUNNEL_TEST_TIMEOUT' }
  ))

  assert.deepEqual(stages.map(stage => stage.status), ['passed', 'failed', 'unverified'])
  assert.equal(stages[1].code, 'SSH_TUNNEL_TEST_TIMEOUT')
  assert.equal(stages[2].code, 'SSH_TUNNEL_STAGE_NOT_REACHED')
})

test('probe timeout rejects with a stable code and stage', async () => {
  await assert.rejects(
    withProbeTimeout(new Promise(() => {}), 5, 'target-service'),
    error => error.code === 'SSH_TUNNEL_TEST_TIMEOUT' && error.stage === 'target-service'
  )
})

test('probe timeout disposes a late resource once and ignores disposer errors', async () => {
  let resolveProbe
  const promise = new Promise(resolve => {
    resolveProbe = resolve
  })
  const resource = { kind: 'socket' }
  let disposeCount = 0

  await assert.rejects(
    withProbeTimeout(promise, 5, 'ssh-forwarding', value => {
      disposeCount += 1
      assert.equal(value, resource)
      throw new Error('cleanup failed')
    }),
    error => error.code === 'SSH_TUNNEL_TEST_TIMEOUT' && error.stage === 'ssh-forwarding'
  )

  resolveProbe(resource)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposeCount, 1)
})
