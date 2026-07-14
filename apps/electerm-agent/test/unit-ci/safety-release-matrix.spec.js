const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Chinese help explains the complete safety transaction workflow and limits', () => {
  const help = read('src/client/components/main/help-center-modal.jsx')

  for (const text of [
    '服务器与 SSH 终端',
    'SFTP 文件与传输',
    '服务器状态与异常一键诊断',
    '只读排查计划',
    '确认计划',
    '实时进度',
    '取消任务',
    '终端手工修改与自动恢复',
    'vim、nano',
    '无法自动回滚',
    '安全操作中心',
    '执行中',
    '可回滚',
    '历史记录',
    '旧版记录',
    '立即回滚',
    '保留修改',
    'endpoint',
    '重新连接',
    '快捷命令表单',
    '多组 API',
    'MCP、CLI 与 Skill',
    '发布确认',
    '工具日志'
  ]) {
    assert.match(help, new RegExp(text), text)
  }

  assert.match(help, /FTP[^。\n]*(不支持|无法)[^。\n]*自动回滚/)
  assert.match(help, /SFTP[^。\n]*(上传|下载|覆盖|复制|移动)/)
  assert.match(help, /只有普通只读命令[^。；\n]*常规终端直达/)
  assert.match(help, /已识别修改[^。；\n]*判断[^。；\n]*能否建立恢复点/)
  assert.match(help, /可恢复修改[^。；\n]*恢复点验证[^。；\n]*等待确认/)
  assert.match(help, /不可恢复修改[^。\n]*风险确认[^。\n]*阻止/)
  assert.doesNotMatch(help, /已识别修改[^。；\n]*先建立恢复点/)
  assert.doesNotMatch(help, /未纳入保护的输入[^。\n]*直达/)
  assert.match(help, /vim、nano[^。\n]*无法预快照[^。\n]*警告/)
  assert.match(help, /回滚完成后[^。\n]*回滚验证/)
  assert.doesNotMatch(help, /手工(?:输入的)?\s*(?:SSH\s*)?命令(?:会)?直接执行/)
  assert.doesNotMatch(help, /(?:无需|不需要)二次确认/)
  assert.doesNotMatch(help, /electerm\/electerm\/wiki/i)
})

test('architecture document records states, support boundaries, performance and recovery', () => {
  const document = read('docs/AI-OPS-SAFETY-TRANSACTIONS.md')

  for (const heading of [
    '# AI 运维安全事务架构',
    '## 架构',
    '## 状态机',
    '## 支持矩阵',
    '## 不可恢复边界',
    '## 性能策略',
    '## 故障恢复',
    '## 测试方法'
  ]) {
    assert.match(document, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), heading)
  }

  for (const text of [
    'preparing',
    'awaiting-confirmation',
    'rollback-available',
    'restored',
    'endpoint',
    '恢复绑定',
    '回滚验证',
    'FTP',
    'vim',
    'nano',
    'SFTP 传输',
    '按需执行',
    '不自动轮询'
  ]) {
    assert.match(document, new RegExp(text), text)
  }
})

test('0.4.0 release notes are structured and do not overstate recovery guarantees', () => {
  const notes = read('docs/releases/v0.4.0.md')

  assert.match(notes, /^# ShellPilot v0\.4\.0$/m)
  assert.match(notes, /^## \[新增\]$/m)
  assert.match(notes, /^## \[修复\]$/m)
  assert.match(notes, /^## \[改动\]$/m)
  assert.match(notes, /FTP[^。\n]*无自动回滚/)
  assert.match(notes, /vim\/nano[^。\n]*不能可靠快照/)
  assert.match(notes, /endpoint/)
  assert.match(notes, /SFTP 传输/)
  assert.doesNotMatch(notes, /全部操作.*自动回滚|任何操作.*自动回滚/)
})

test('safety smoke source is local-first and forbids host configuration mutations', () => {
  const source = read('build/bin/smoke-safety-transactions.js')

  assert.match(source, /require\(['"]\.\/smoke-ssh-sftp['"]\)/)
  assert.match(source, /createValidatedRemoteScope/)
  assert.match(source, /finally/)
  assert.match(source, /chmod/)
  assert.match(source, /cancel/i)
  assert.match(source, /restore/i)
  assert.doesNotMatch(source, /(?:iptables|ip6tables|nft|ufw|firewall-cmd)\s+(?:-A|-D|add|delete|allow|deny|enable|disable)/i)
  assert.doesNotMatch(source, /systemctl\s+(?:start|stop|restart|enable|disable|mask)/i)
  assert.doesNotMatch(source, /(?:nmcli|ip\s+(?:addr|route))\s+(?:add|delete|del|modify|mod)/i)
})

test('safety smoke requires opt-in and generates a fresh validated remote scope', () => {
  const smoke = require(path.join(root, 'build/bin/smoke-safety-transactions.js'))
  const disabled = smoke.validateRemoteConfig(smoke.resolveRemoteConfig({
    SHELLPILOT_SAFETY_SMOKE_REAL: '',
    SHELLPILOT_SSH_HOST: 'example.invalid',
    SHELLPILOT_SSH_USER: 'tester',
    SHELLPILOT_SSH_PASSWORD: 'not-used'
  }))
  assert.equal(disabled.enabled, false)

  const config = {
    requested: true,
    complete: true,
    port: 22,
    timeoutMs: 1000,
    testRoot: '/tmp'
  }
  const first = smoke.validateRemoteConfig(config)
  const second = smoke.validateRemoteConfig(config)
  assert.equal(first.enabled, true)
  assert.equal(second.enabled, true)
  assert.match(first.scope.remoteTestDir, /^\/tmp\/shellpilot-smoke-[a-f0-9]+(?:-[a-f0-9]+)*$/)
  assert.notEqual(first.scope.remoteTestDir, second.scope.remoteTestDir)

  const unsafe = smoke.validateRemoteConfig({ ...config, testRoot: '/etc' })
  assert.equal(unsafe.enabled, false)
  assert.match(unsafe.error, /临时目录/)
})

test('safety smoke runs local checks without credentials and never prints secrets', () => {
  const secret = 'smoke-secret-must-not-appear'
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build/bin/smoke-safety-transactions.js')],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SHELLPILOT_SSH_HOST: '',
        SHELLPILOT_SSH_USER: '',
        SHELLPILOT_SSH_PASSWORD: secret,
        SHELLPILOT_SSH_PRIVATE_KEY: '',
        SHELLPILOT_SAFETY_SMOKE_REAL: ''
      }
    }
  )
  const output = `${result.stdout || ''}${result.stderr || ''}`

  assert.equal(result.status, 0, output)
  assert.doesNotMatch(output, new RegExp(secret))
  const summaryLine = String(result.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .find(line => line.startsWith('{"kind":"shellpilot-safety-smoke"'))
  assert.ok(summaryLine, output)
  const summary = JSON.parse(summaryLine)
  assert.equal(summary.mode, 'local')
  assert.equal(summary.failed, 0)
  assert.ok(summary.passed >= 4)
  assert.equal(summary.remote.skipped, true)
})

test('candidate package metadata is consistently set to 0.4.0', () => {
  const pack = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))

  assert.equal(pack.version, '0.4.0')
  assert.equal(lock.version, '0.4.0')
  assert.equal(lock.packages[''].version, '0.4.0')
})
