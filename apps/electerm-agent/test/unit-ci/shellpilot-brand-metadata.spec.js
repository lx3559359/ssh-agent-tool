const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readTree (directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return [readTree(target)]
    return /\.(?:js|jsx|json|styl)$/.test(entry.name)
      ? [fs.readFileSync(target, 'utf8')]
      : []
  }).join('\n')
}

test('desktop package metadata only exposes the ShellPilot product identity', () => {
  const pack = require(path.join(root, 'package.json'))
  const builder = require(path.join(root, 'build/electron-builder.json'))

  assert.equal(pack.productName, 'ShellPilot')
  assert.equal(pack.author.name, 'ShellPilot Team')
  assert.doesNotMatch(JSON.stringify(pack.author), /ZHAO Xudong|zxdong|electerm/i)
  assert.equal(pack.privacyNoticeLink, undefined)
  assert.equal(pack.sponsorLink, undefined)
  assert.equal(pack.langugeRepo, undefined)
  assert.equal(builder.appx.publisherDisplayName, 'ShellPilot Team')
  assert.equal(
    builder.protocols.find(item => item.schemes.includes('aigshell')).name,
    'ShellPilot 协议'
  )
  assert.deepEqual(
    builder.protocols.slice(0, 5).map(item => item.name),
    ['SSH 协议', 'Telnet 协议', 'RDP 协议', 'VNC 协议', '串口协议']
  )
})

test('about dialog does not render upstream author sponsor privacy or cloud promotion', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/sidebar/info-modal.jsx'),
    'utf8'
  )

  assert.doesNotMatch(source, /authorName|authorUrl|sponsorLink|langugeRepo|electermOnline/)
  assert.doesNotMatch(source, /cloud\.electerm\.org|sponsorElecterm/)
  assert.match(source, /bugReportLink/)
  assert.match(source, /releaseLink/)
})

test('client help links stay within the ShellPilot project instead of upstream product pages', () => {
  const clientSource = readTree(path.join(root, 'src/client'))

  assert.doesNotMatch(clientSource, /https:\/\/github\.com\/electerm/i)
  assert.doesNotMatch(clientSource, /cloud\.electerm\.org|sponsor-electerm/i)
})

test('repository landing documents describe ShellPilot without upstream promotion or contacts', () => {
  for (const name of ['README.md', 'README_cn.md']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8')
    assert.match(source, /ShellPilot/)
    assert.doesNotMatch(source, /zxdong|electerm\.org|github\.com\/sponsors\/electerm/i)
  }
})
