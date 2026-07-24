import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const appOptions = require('../e2e/common/app-options')

test('legacy E2E launches with an isolated temporary profile', () => {
  const appData = path.resolve(appOptions.env.APPDATA)
  const localAppData = path.resolve(appOptions.env.LOCALAPPDATA)
  const dataPath = path.resolve(appOptions.env.DATA_PATH)
  const tempRoot = path.resolve(os.tmpdir()) + path.sep

  assert.ok(appData.startsWith(tempRoot))
  assert.ok(path.basename(appData).startsWith('shellpilot-legacy-e2e-'))
  assert.equal(localAppData, appData)
  assert.equal(dataPath, path.join(appData, 'data'))
  assert.notEqual(appData, path.resolve(process.env.APPDATA || ''))
})

test('E2E package scripts use cross-platform Playwright patterns', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))

  assert.match(pkg.scripts.test1, /"test\/e2e\/00\.\*\\\.js"/)
  assert.match(pkg.scripts.test2, /"test\/e2e\/01\.\*\\\.js"/)
  assert.doesNotMatch(pkg.scripts.test1, /00\*\.js/)
  assert.doesNotMatch(pkg.scripts.test2, /01\*\.js/)
})

test('legacy E2E helpers use bilingual stable menu labels without mojibake', () => {
  const source = fs.readFileSync(
    path.resolve('test/e2e/common/common.js'),
    'utf8'
  )

  for (const pair of [
    ['新建文件', 'New File'],
    ['新建文件夹', 'New Folder'],
    ['复制', 'Copy'],
    ['剪切', 'Cut'],
    ['粘贴', 'Paste'],
    ['重命名', 'Rename'],
    ['进入', 'Enter'],
    ['全选', 'Select All'],
    ['编辑权限', 'Edit Permission']
  ]) {
    assert.ok(
      pair.every(label => source.includes(label)),
      `missing bilingual labels: ${pair.join(' / ')}`
    )
  }

  assert.doesNotMatch(source, /鏂板缓|淇′换|绔¯|璁剧疆/)
  assert.match(source, /getVisibleMenuItem/)
})

test('legacy E2E credentials are validated only when a real connection starts', () => {
  const envSource = fs.readFileSync(
    path.resolve('test/e2e/common/env.js'),
    'utf8'
  )
  const commonSource = fs.readFileSync(
    path.resolve('test/e2e/common/common.js'),
    'utf8'
  )

  assert.doesNotMatch(envSource, /if \(!TEST_HOST \|\| !TEST_PASS \|\| !TEST_USER\) \{\s*throw/)
  assert.match(envSource, /hasRealServerCredentials/)
  assert.match(commonSource, /requireRealServerCredentials/)
})
