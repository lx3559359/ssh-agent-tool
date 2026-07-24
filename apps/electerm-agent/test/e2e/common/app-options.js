const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const cwd = process.cwd()
const profileRoot = mkdtempSync(join(tmpdir(), 'shellpilot-legacy-e2e-'))

process.once('exit', () => {
  const resolved = resolve(profileRoot)
  const tempRoot = resolve(tmpdir()) + require('path').sep
  if (resolved.startsWith(tempRoot) && resolved.includes('shellpilot-legacy-e2e-')) {
    rmSync(resolved, { recursive: true, force: true })
  }
})

module.exports = {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    NODE_TEST: 'yes',
    APPDATA: profileRoot,
    LOCALAPPDATA: profileRoot,
    DATA_PATH: resolve(profileRoot, 'data')
  },
  args: [
    resolve(cwd, 'work/app'),
    '--disable-gpu',
    '--disable-dev-shm-usage'
  ]
}
