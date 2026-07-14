const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('top bar exposes an in-client Chinese help center', () => {
  const topbar = read('src/client/components/main/aigshell-topbar.jsx')
  const help = read('src/client/components/main/help-center-modal.jsx')

  assert.match(topbar, /QuestionCircleOutlined/)
  assert.match(topbar, /label:\s*'帮助'/)
  assert.match(topbar, /<HelpCenterModal/)
  assert.match(help, /ShellPilot 帮助中心/)
  for (const topic of [
    '第一次使用',
    '服务器与连接信息',
    '认证与密钥',
    'SSH 终端',
    'SFTP 文件管理',
    '安全备份与恢复',
    'AI 助手',
    '大日志与附件分析',
    '快捷命令',
    '端口转发',
    'MCP 与 CLI',
    '备份同步',
    '在线更新',
    '设置与主题',
    '工具日志与问题排查'
  ]) {
    assert.match(help, new RegExp(topic))
  }
  assert.match(help, /Ctrl\+C/)
  assert.match(help, /拖到 AI/)
  assert.match(help, /ModelScope/)
  assert.match(help, /回滚/)
  assert.match(help, /全部服务器/)
  assert.match(help, /失败记录/)
  assert.match(help, /保留新配置/)
  assert.match(help, /服务器状态中心/)
  assert.match(help, /平台与服务自动识别/)
  assert.match(help, /权限受限/)
  assert.match(help, /发送给 AI/)
})

test('repository includes an offline Chinese user guide', () => {
  const guide = read('docs/USER_GUIDE_ZH.md')

  assert.match(guide, /# ShellPilot 中文使用帮助/)
  assert.match(guide, /SSH 终端/)
  assert.match(guide, /SFTP/)
  assert.match(guide, /更新源/)
  assert.match(guide, /安全操作中心/)
  assert.match(guide, /第一次使用/)
  assert.match(guide, /端口转发/)
  assert.match(guide, /大日志与压缩日志/)
  assert.match(guide, /常见问题/)
  assert.match(guide, /服务器状态中心/)
  assert.match(guide, /平台与服务自动识别/)
})

test('AI configuration uses ShellPilot inline guidance without upstream wiki branding', () => {
  const config = read('src/client/components/ai/ai-config.jsx')

  assert.doesNotMatch(config, /electerm\/electerm\/wiki\/AI-model-config-guide/)
  assert.doesNotMatch(config, /aiConfigWikiLink/)
  assert.match(config, /e\('shellpilotAiQuickSetup'\)/)
  assert.match(config, /e\('shellpilotAiQuickSetupDescription'\)/)
})
