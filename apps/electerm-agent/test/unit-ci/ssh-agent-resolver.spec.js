const test = require('node:test')
const assert = require('node:assert/strict')

const {
  WINDOWS_OPENSSH_AGENT_PIPE,
  resolveSshAgent
} = require('../../src/app/server/ssh-agent-resolver')

test('does not use an SSH agent when disabled', () => {
  assert.equal(
    resolveSshAgent({ useSshAgent: false }, {
      env: { SSH_AUTH_SOCK: '/tmp/agent.sock' },
      platform: 'win32'
    }),
    undefined
  )
})

test('prefers explicit SSH agent setting over environment defaults', () => {
  assert.equal(
    resolveSshAgent({ useSshAgent: true, sshAgent: '/custom/agent.sock' }, {
      env: { SSH_AUTH_SOCK: '/tmp/agent.sock' },
      platform: 'win32'
    }),
    '/custom/agent.sock'
  )
})

test('uses SSH_AUTH_SOCK when no explicit SSH agent is configured', () => {
  assert.equal(
    resolveSshAgent({ useSshAgent: true }, {
      env: { SSH_AUTH_SOCK: '/tmp/agent.sock' },
      platform: 'linux'
    }),
    '/tmp/agent.sock'
  )
})

test('falls back to the Windows OpenSSH agent named pipe', () => {
  assert.equal(
    resolveSshAgent({ useSshAgent: true }, {
      env: {},
      platform: 'win32'
    }),
    WINDOWS_OPENSSH_AGENT_PIPE
  )
})

test('does not invent an SSH agent path on non-Windows platforms', () => {
  assert.equal(
    resolveSshAgent({ useSshAgent: true }, {
      env: {},
      platform: 'linux'
    }),
    undefined
  )
})
