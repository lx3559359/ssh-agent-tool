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

  assert.equal(config.win.publish.channel, 'shellpilot-local')
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

test('electron builder prepare generates cpu-features build config for pnpm installs', () => {
  const {
    prepareCpuFeaturesBuildConfig
  } = require(path.resolve(__dirname, '../../build/bin/prepare-electron-build.js'))

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-cpu-features-'))
  const packageDirs = [
    'node_modules/.pnpm/cpu-features@0.0.10/node_modules/cpu-features',
    'work/app/node_modules/.pnpm/node_modules/cpu-features'
  ].map(relativePath => path.join(tmpRoot, relativePath))
  for (const packageDir of packageDirs) {
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(
      path.join(packageDir, 'buildcheck.js'),
      'console.log(JSON.stringify({ conditions: [] }, null, 2))\n',
      'utf8'
    )
  }

  try {
    const prepared = prepareCpuFeaturesBuildConfig({ cwd: tmpRoot })
    assert.deepEqual(prepared, packageDirs)
    for (const packageDir of packageDirs) {
      const generated = JSON.parse(fs.readFileSync(
        path.join(packageDir, 'buildcheck.gypi'),
        'utf8'
      ))
      assert.deepEqual(generated, { conditions: [] })
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('electron builder config cleans packaged batch scripts after native rebuild', () => {
  const config = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../build/electron-builder.json'),
    'utf8'
  ))

  assert.equal(config.afterPack, 'build/bin/after-pack-cleanup.js')
})

test('windows installer lets users choose the installation directory', () => {
  const config = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../build/electron-builder.json'),
    'utf8'
  ))

  assert.equal(config.nsis.oneClick, false)
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true)
})

test('after-pack cleanup rewrites updater cache name to ShellPilot', () => {
  const {
    patchPackagedUpdateConfig
  } = require(path.resolve(__dirname, '../../build/bin/prepare-cleanup-utils'))
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-after-pack-'))
  const resourcesDir = path.join(tmpRoot, 'resources')
  fs.mkdirSync(resourcesDir, { recursive: true })
  const updateConfigPath = path.join(resourcesDir, 'app-update.yml')
  fs.writeFileSync(updateConfigPath, [
    'owner: lx3559359',
    'repo: ssh-agent-tool',
    'updaterCacheDirName: ssh-agent-tool-updater',
    ''
  ].join('\n'))

  try {
    assert.equal(patchPackagedUpdateConfig(tmpRoot), true)
    assert.match(fs.readFileSync(updateConfigPath, 'utf8'), /updaterCacheDirName: ShellPilot-updater/)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
