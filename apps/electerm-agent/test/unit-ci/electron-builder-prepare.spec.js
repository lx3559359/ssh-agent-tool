const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const workflowNamePlaceholder = '${' + 'env.WORKFLOW_NAME}'

test('electron builder prepare script writes a local default publish channel', () => {
  const {
    prepareElectronBuilderConfig
  } = require(path.resolve(__dirname, '../../build/bin/prepare-electron-build.js'))

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-builder-prepare-'))
  fs.mkdirSync(path.join(tmpRoot, 'build'), { recursive: true })
  fs.writeFileSync(
    path.join(tmpRoot, 'build/electron-builder.json'),
    JSON.stringify({
      win: {
        publish: {
          channel: workflowNamePlaceholder
        }
      }
    }),
    'utf8'
  )

  prepareElectronBuilderConfig({
    cwd: tmpRoot,
    workflowName: ''
  })

  const config = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'electron-builder.json'), 'utf8'))

  assert.equal(config.win.publish.channel, 'aigshell-local')
})

test('electron builder prepare script keeps CI publish channel explicit', () => {
  const {
    prepareElectronBuilderConfig
  } = require(path.resolve(__dirname, '../../build/bin/prepare-electron-build.js'))

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-builder-prepare-'))
  fs.mkdirSync(path.join(tmpRoot, 'build'), { recursive: true })
  fs.writeFileSync(
    path.join(tmpRoot, 'build/electron-builder.json'),
    JSON.stringify({
      win: {
        publish: {
          channel: workflowNamePlaceholder
        }
      }
    }),
    'utf8'
  )

  prepareElectronBuilderConfig({
    cwd: tmpRoot,
    workflowName: 'windows-electerm-agent'
  })

  const config = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'electron-builder.json'), 'utf8'))

  assert.equal(config.win.publish.channel, 'windows-electerm-agent')
})

test('electron builder config cleans packaged batch scripts after native rebuild', () => {
  const config = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../build/electron-builder.json'),
    'utf8'
  ))

  assert.equal(config.afterPack, 'build/bin/after-pack-cleanup.js')
})
