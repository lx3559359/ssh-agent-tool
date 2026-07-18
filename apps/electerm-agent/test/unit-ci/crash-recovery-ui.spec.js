import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(currentDir, '../..')

function readSource (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('crash recovery notice exposes safe Chinese recovery actions', () => {
  const source = readSource('src/client/components/main/crash-recovery-notice.jsx')

  for (const text of [
    '上次运行异常结束',
    '恢复标签',
    '待重新连接',
    '查看安全中心',
    '查看更新中心',
    '忽略'
  ]) {
    assert.match(source, new RegExp(text))
  }

  assert.doesNotMatch(source, /ipcOpenTab|runSafetyCommand|nativeUpdateInstall/)
})

test('recovered tabs remain dormant until an explicit reconnect', () => {
  const source = readSource('src/client/components/session/session.jsx')

  assert.match(source, /recoveryPending/)
  assert.match(source, /重新连接/)
  assert.match(source, /handleRecoveryReconnect/)
  assert.match(source, /renderRecoveryPending/)
})

test('startup loads a plan but does not restore or connect tabs automatically', () => {
  const source = readSource('src/client/store/load-data.js')

  assert.match(source, /createRecoveredTabs/)
  assert.match(source, /Store\.prototype\.restoreRecoveryTabs/)
  assert.doesNotMatch(source, /await store\.restoreRecoveryTabs\(\)/)
  assert.doesNotMatch(source, /store\.ipcOpenTab\([^\n]*recovery/i)
})

test('recovery notice is mounted in the existing main shell', () => {
  const source = readSource('src/client/components/main/main.jsx')

  assert.match(source, /CrashRecoveryNotice/)
  assert.match(source, /recoveryPlan=\{store\.recoveryPlan\}/)
})

test('crash recovery notice preserves native CSS min syntax for Stylus builds', () => {
  const style = readSource('src/client/components/main/crash-recovery-notice.styl')

  assert.match(style, /width unquote\('min\(860px, calc\(100vw - 176px\)\)'\)/)
  assert.doesNotMatch(style, /^\s*width min\(/m)
})
