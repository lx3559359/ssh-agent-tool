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

test('probe timeout rejects with a stable code and stage', async () => {
  await assert.rejects(
    withProbeTimeout(new Promise(() => {}), 5, 'target-service'),
    error => error.code === 'SSH_TUNNEL_TEST_TIMEOUT' && error.stage === 'target-service'
  )
})

