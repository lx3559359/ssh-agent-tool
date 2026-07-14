const test = require('node:test')
const assert = require('node:assert/strict')

const {
  assertSftpCopyTargetOutsideSource,
  consumeSftpCopyBudget,
  createSftpCopyBudget
} = require('../../src/app/server/sftp-copy-budget')

test('SFTP copy rejects a target equal to or nested below its source', () => {
  for (const [source, target] of [
    ['/srv/data', '/srv/data'],
    ['/srv/data', '/srv/data/snapshot'],
    ['/srv/data/', '/srv/data/nested/../snapshot'],
    ['\\srv\\data', '\\srv\\data\\snapshot']
  ]) {
    assert.throws(
      () => assertSftpCopyTargetOutsideSource(source, target),
      /source|target|源|目标|内部|自身/i
    )
  }
  assert.doesNotThrow(() => (
    assertSftpCopyTargetOutsideSource('/srv/data', '/srv/backups/data')
  ))
})

test('SFTP copy budget independently bounds depth nodes and total bytes', () => {
  const depthBudget = createSftpCopyBudget({
    maxDepth: 1,
    maxNodes: 10,
    maxTotalBytes: 100
  })
  consumeSftpCopyBudget(depthBudget, { depth: 0, bytes: 0 })
  assert.throws(
    () => consumeSftpCopyBudget(depthBudget, { depth: 2, bytes: 0 }),
    /depth|深度|上限/i
  )

  const nodeBudget = createSftpCopyBudget({
    maxDepth: 10,
    maxNodes: 1,
    maxTotalBytes: 100
  })
  consumeSftpCopyBudget(nodeBudget, { depth: 0, bytes: 0 })
  assert.throws(
    () => consumeSftpCopyBudget(nodeBudget, { depth: 1, bytes: 0 }),
    /node|节点|上限/i
  )

  const byteBudget = createSftpCopyBudget({
    maxDepth: 10,
    maxNodes: 10,
    maxTotalBytes: 3
  })
  assert.throws(
    () => consumeSftpCopyBudget(byteBudget, { depth: 0, bytes: 4 }),
    /byte|字节|大小|上限/i
  )

  assert.throws(
    () => createSftpCopyBudget({ maxNodes: 0 }),
    /预算|节点|上限/
  )
})
