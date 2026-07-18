const assert = require('node:assert/strict')
const { describe, test } = require('node:test')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const { join } = require('path')

const {
  appendKnownHost,
  buildHostMismatchError,
  buildHostMismatchPrompt,
  buildUnknownHostPrompt,
  checkKnownHosts,
  createHostVerifier,
  getHostKeyMeta,
  matchesKnownHostField,
  removeKnownHost,
  replaceKnownHost
} = require('../../src/app/server/ssh-known-hosts')

const hostKeySamples = [
  'AAAAC3NzaC1lZDI1NTE5AAAAICMLNUG2N34NUkoM8sZUoCcn9RnoGTOEyG763QC1Ab66',
  'AAAAC3NzaC1lZDI1NTE5AAAAIOdiS9Q5OGFBgXTLLKRSNYf4LCpS9PG4CEGNpqcn0ik7',
  'AAAAC3NzaC1lZDI1NTE5AAAAINNOAdF+zokRpZiPBW+nC3pEH0aeCBTIDy7IKY1waVrO'
]

function createHostKey (label) {
  const index = Math.abs(
    [...label].reduce((total, char) => total + char.charCodeAt(0), 0)
  ) % hostKeySamples.length
  return Buffer.from(hostKeySamples[index], 'base64')
}

describe('ssh known_hosts verification', () => {
  test('reports the exact accepted host key metadata once', async () => {
    const tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'electerm-known-hosts-'))
    try {
      const accepted = []
      const hostKey = createHostKey('takeover-endpoint')
      const verifier = createHostVerifier({
        host: 'example.test',
        port: 22,
        knownHostsPath: join(tempDir, 'known_hosts'),
        confirm: async () => true,
        onVerified: meta => accepted.push(meta)
      })
      const verify = () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('host verifier timed out'))
        }, 1000)
        verifier(hostKey, result => {
          clearTimeout(timeout)
          resolve(result)
        })
      })
      const verified = await verify()
      const verifiedAgain = await verify()

      assert.equal(verified, true)
      assert.equal(verifiedAgain, true)
      assert.equal(accepted.length, 1)
      assert.deepEqual(Object.keys(accepted[0]).sort(), ['fingerprint', 'keyType'])
      assert.match(accepted[0].fingerprint, /^SHA256:/)
      assert.equal(accepted[0].keyType, 'ssh-ed25519')
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('matches hashed host entries', () => {
    const salt = crypto.randomBytes(20)
    const host = 'example.test'
    const digest = crypto.createHmac('sha1', salt).update(host).digest('base64')
    const token = `|1|${salt.toString('base64')}|${digest}`
    assert.equal(matchesKnownHostField(token, host, 22), true)
    assert.equal(matchesKnownHostField(token, 'other.test', 22), false)
  })

  test('treats same-type key changes as mismatches', async () => {
    const tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'electerm-known-hosts-'))
    try {
      const knownHostsPath = join(tempDir, 'known_hosts')
      const originalKey = createHostKey('original')
      const changedKey = createHostKey('changed')
      await appendKnownHost({
        host: 'example.test',
        port: 22,
        hostKey: originalKey,
        knownHostsPath
      })
      const result = await checkKnownHosts({
        host: 'example.test',
        port: 22,
        hostKey: changedKey,
        knownHostsPath
      })
      assert.equal(result.status, 'mismatch')
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('writes and re-reads a non-default port entry', async () => {
    const tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'electerm-known-hosts-'))
    try {
      const knownHostsPath = join(tempDir, 'known_hosts')
      const hostKey = createHostKey('port-2222')
      const meta = getHostKeyMeta(hostKey)
      await appendKnownHost({
        host: '127.0.0.1',
        port: 2222,
        hostKey,
        knownHostsPath
      })
      const content = await fs.promises.readFile(knownHostsPath, 'utf8')
      assert.match(content, /^\[127\.0\.0\.1\]:2222 ssh-ed25519 /)
      const result = await checkKnownHosts({
        host: '127.0.0.1',
        port: 2222,
        hostKey,
        knownHostsPath
      })
      assert.equal(result.status, 'match')
      assert.equal(result.meta.sha256, meta.sha256)
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('removeKnownHost removes matching entry', async () => {
    const tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'electerm-known-hosts-'))
    try {
      const knownHostsPath = join(tempDir, 'known_hosts')
      const key1 = createHostKey('host1')
      const key2 = createHostKey('host2')
      await appendKnownHost({
        host: 'host1.test',
        port: 22,
        hostKey: key1,
        knownHostsPath
      })
      await appendKnownHost({
        host: 'host2.test',
        port: 22,
        hostKey: key2,
        knownHostsPath
      })
      await removeKnownHost({
        host: 'host1.test',
        port: 22,
        keyType: 'ssh-ed25519',
        knownHostsPath
      })
      const result1 = await checkKnownHosts({
        host: 'host1.test',
        port: 22,
        hostKey: key1,
        knownHostsPath
      })
      assert.equal(result1.status, 'not-found')
      const result2 = await checkKnownHosts({
        host: 'host2.test',
        port: 22,
        hostKey: key2,
        knownHostsPath
      })
      assert.equal(result2.status, 'match')
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('replaceKnownHost updates a changed key', async () => {
    const tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'electerm-known-hosts-'))
    try {
      const knownHostsPath = join(tempDir, 'known_hosts')
      const originalKey = createHostKey('original')
      const newKey = createHostKey('new')
      await appendKnownHost({
        host: 'router.test',
        port: 22,
        hostKey: originalKey,
        knownHostsPath
      })
      await replaceKnownHost({
        host: 'router.test',
        port: 22,
        hostKey: newKey,
        knownHostsPath
      })
      const oldResult = await checkKnownHosts({
        host: 'router.test',
        port: 22,
        hostKey: originalKey,
        knownHostsPath
      })
      assert.equal(oldResult.status, 'mismatch')
      const newResult = await checkKnownHosts({
        host: 'router.test',
        port: 22,
        hostKey: newKey,
        knownHostsPath
      })
      assert.equal(newResult.status, 'match')
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('buildHostMismatchPrompt returns a Chinese confirm prompt with warning', () => {
    const meta = {
      keyType: 'ssh-ed25519',
      sha256: 'AAABBBCCC123'
    }
    const prompt = buildHostMismatchPrompt({
      host: 'router.test',
      port: 22,
      meta,
      knownHostsPath: '/home/user/.ssh/known_hosts'
    })
    assert.equal(prompt.mode, 'confirm')
    assert.equal(prompt.submitText, '更新指纹')
    assert.equal(prompt.cancelText, '拒绝连接')
    assert.ok(prompt.instructions.some(i => i.includes('警告')))
    assert.ok(prompt.instructions.some(i => i.includes('router.test')))
  })

  test('host key prompts and errors use Chinese copy', () => {
    const meta = {
      keyType: 'ssh-ed25519',
      sha256: 'AAABBBCCC123'
    }
    const unknownPrompt = buildUnknownHostPrompt({
      host: 'new-host.test',
      port: 22,
      meta,
      knownHostsPath: 'C:\\Users\\test\\.ssh\\known_hosts'
    })
    assert.equal(unknownPrompt.submitText, '信任并保存')
    assert.equal(unknownPrompt.cancelText, '拒绝连接')
    assert.match(unknownPrompt.name, /信任 SSH 主机指纹/)
    assert.ok(unknownPrompt.instructions.some(i => i.includes('首次连接')))
    assert.ok(unknownPrompt.instructions.some(i => i.includes('SHA256:AAABBBCCC123')))

    const mismatchPrompt = buildHostMismatchPrompt({
      host: 'router.test',
      port: 2222,
      meta,
      knownHostsPath: 'C:\\Users\\test\\.ssh\\known_hosts'
    })
    assert.equal(mismatchPrompt.submitText, '更新指纹')
    assert.equal(mismatchPrompt.cancelText, '拒绝连接')
    assert.match(mismatchPrompt.name, /SSH 主机指纹已变化/)
    assert.ok(mismatchPrompt.instructions.some(i => i.includes('中间人攻击')))

    const mismatchError = buildHostMismatchError({
      host: 'router.test',
      port: 2222,
      meta,
      knownHostsPath: 'C:\\Users\\test\\.ssh\\known_hosts'
    })
    assert.match(mismatchError.message, /SSH 主机指纹校验失败/)
    assert.match(mismatchError.message, /如果你确认服务器已重装或指纹已更换/)
  })
})
