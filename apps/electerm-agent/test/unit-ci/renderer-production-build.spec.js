const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const packageJson = require(path.join(root, 'package.json'))
const viteRoot = path.join(root, 'build/vite')
const viteExecutable = path.join(root, 'node_modules/vite/bin/vite.js')

function commandFailure (result) {
  return [
    `exit status: ${result.status}`,
    `signal: ${result.signal}`,
    result.error?.stack,
    result.stdout,
    result.stderr
  ].filter(Boolean).join('\n')
}

function assertCommandSucceeded (result, description) {
  assert.ok(!result.error, `${description}\n${commandFailure(result)}`)
  assert.equal(result.signal, null, `${description}\n${commandFailure(result)}`)
  assert.equal(result.status, 0, `${description}\n${commandFailure(result)}`)
}

function listJavaScriptFiles (directory) {
  const files = []
  const directories = [directory]
  while (directories.length) {
    const current = directories.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(entryPath)
      }
    }
  }
  return files.sort()
}

test('production renderer config honors an isolated output directory', () => {
  const isolatedOutDir = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'shellpilot-renderer-config-'
  ))
  try {
    const probe = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "import config from './conf.js'",
        'console.log(JSON.stringify({',
        '  buildOutDir: config.build.outDir,',
        '  outputDir: config.build.rollupOptions.output.dir',
        '}))'
      ].join('\n')
    ], {
      cwd: viteRoot,
      env: {
        ...process.env,
        SHELLPILOT_VITE_OUT_DIR: isolatedOutDir
      },
      encoding: 'utf8',
      timeout: 10_000
    })

    assertCommandSucceeded(probe, 'Vite config probe failed')
    const configured = JSON.parse(probe.stdout.trim())
    assert.equal(path.resolve(configured.buildOutDir), isolatedOutDir)
    assert.equal(path.resolve(configured.outputDir), isolatedOutDir)
  } finally {
    fs.rmSync(isolatedOutDir, { recursive: true, force: true })
  }
})

test('production renderer build isolates and checks every emitted JavaScript file', {
  timeout: 100_000
}, () => {
  const isolatedOutDir = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'shellpilot-renderer-build-'
  ))
  try {
    const build = spawnSync(process.execPath, [
      viteExecutable,
      'build',
      '--config',
      './conf.js'
    ], {
      cwd: viteRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SHELLPILOT_VITE_OUT_DIR: isolatedOutDir
      },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 45_000
    })
    assertCommandSucceeded(build, 'isolated Vite renderer build failed')

    const rendererBundle = path.join(
      isolatedOutDir,
      `js/electerm-${packageJson.version}.js`
    )
    assert.ok(fs.existsSync(rendererBundle), 'renderer bundle must exist')
    assert.ok(
      fs.statSync(rendererBundle).size > 100_000,
      'renderer bundle must contain the production application graph'
    )

    const javaScriptFiles = listJavaScriptFiles(isolatedOutDir)
    assert.ok(javaScriptFiles.length > 1, 'renderer build must emit its JavaScript graph')
    const syntaxDeadline = Date.now() + 45_000
    for (const file of javaScriptFiles) {
      const syntax = spawnSync(process.execPath, ['--check', file], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: Math.max(1, syntaxDeadline - Date.now())
      })
      assertCommandSucceeded(
        syntax,
        `syntax check failed for ${path.relative(isolatedOutDir, file)}`
      )
    }
  } finally {
    fs.rmSync(isolatedOutDir, { recursive: true, force: true })
  }
})
