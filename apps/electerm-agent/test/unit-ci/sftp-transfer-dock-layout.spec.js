const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/components/sftp/sftp-transfer-dock-layout.js'
)

async function loadLayout () {
  const url = pathToFileURL(modulePath)
  url.search = `test=${Date.now()}-${Math.random()}`
  return import(url)
}

test('SFTP dock follows the visible bottom of a fully visible workspace', async () => {
  const { computeSftpTransferDockLayout } = await loadLayout()
  assert.deepEqual(computeSftpTransferDockLayout({
    containerRect: { left: 70, right: 1438, bottom: 1040 },
    viewportWidth: 1600,
    viewportHeight: 1098
  }), {
    left: 80,
    right: 172,
    bottom: 66,
    maxWidth: 1348
  })
})

test('SFTP dock stays inside the viewport when its workspace overflows', async () => {
  const { computeSftpTransferDockLayout } = await loadLayout()
  assert.deepEqual(computeSftpTransferDockLayout({
    containerRect: { left: 70, right: 1700, bottom: 1123 },
    viewportWidth: 1600,
    viewportHeight: 1098
  }), {
    left: 80,
    right: 10,
    bottom: 8,
    maxWidth: 1510
  })
})

test('SFTP dock clamps cropped, narrow, and invalid geometry', async () => {
  const { computeSftpTransferDockLayout } = await loadLayout()
  assert.deepEqual(computeSftpTransferDockLayout({
    containerRect: { left: -40, right: 280, bottom: 700 },
    viewportWidth: 320,
    viewportHeight: 720
  }), {
    left: 10,
    right: 50,
    bottom: 28,
    maxWidth: 260
  })
  const fallback = computeSftpTransferDockLayout({
    containerRect: { left: Number.NaN, right: Infinity, bottom: undefined },
    viewportWidth: 900,
    viewportHeight: 600
  })
  assert.deepEqual(fallback, {
    left: 10,
    right: 10,
    bottom: 8,
    maxWidth: 880
  })
  assert.equal(Object.values(fallback).every(Number.isFinite), true)
})
