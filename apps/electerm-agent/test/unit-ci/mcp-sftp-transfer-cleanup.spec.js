const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/store/mcp-sftp-transfer-cleanup.js'
)).href

test('prepared upload cleanup releases its session even when safety cancel fails', async () => {
  const { cleanupPreparedSftpTransfer } = await import(moduleUrl)
  const cancelFailure = new Error('cancel failed')
  const calls = []
  const sftpEntry = {
    async cancelTransferSafetyOperation (id) {
      calls.push(`cancel:${id}`)
      throw cancelFailure
    },
    async releasePreparedTransferFileSession (id) {
      calls.push(`release:${id}`)
    }
  }

  await assert.rejects(cleanupPreparedSftpTransfer({
    sftpEntry,
    safetyOperationIds: ['operation-a'],
    transferId: 'transfer-a'
  }), error => error === cancelFailure)
  assert.deepEqual(calls, ['cancel:operation-a', 'release:transfer-a'])
})

test('prepared upload cleanup preserves the preflight error and records cleanup failures', async () => {
  const { cleanupPreparedSftpTransfer } = await import(moduleUrl)
  const preflightFailure = new Error('source changed')
  const cancelFailure = new Error('cancel failed')
  const releaseFailure = new Error('release failed')
  const calls = []
  const sftpEntry = {
    async cancelTransferSafetyOperation (id) {
      calls.push(`cancel:${id}`)
      throw cancelFailure
    },
    async releasePreparedTransferFileSession (id) {
      calls.push(`release:${id}`)
      throw releaseFailure
    }
  }

  await assert.rejects(cleanupPreparedSftpTransfer({
    sftpEntry,
    safetyOperationIds: ['operation-a'],
    transferId: 'transfer-a',
    primaryError: preflightFailure
  }), error => {
    assert.equal(error, preflightFailure)
    assert.deepEqual(error.cleanupErrors, [cancelFailure, releaseFailure])
    return true
  })
  assert.deepEqual(calls, ['cancel:operation-a', 'release:transfer-a'])
})
