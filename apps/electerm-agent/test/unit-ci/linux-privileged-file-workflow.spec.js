const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflow = fs.readFileSync(
  path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-ci.yml'),
  'utf8'
)

function extractJob (name) {
  const lines = workflow.split(/\r?\n/)
  const header = `  ${name}:`
  const start = lines.indexOf(header)
  assert.notEqual(start, -1, `workflow must define the ${name} job`)

  const nextJobOffset = lines
    .slice(start + 1)
    .findIndex(line => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line))
  const end = nextJobOffset === -1
    ? lines.length
    : start + 1 + nextJobOffset

  return lines.slice(start, end).join('\n')
}

function extractStep (job, name) {
  const lines = job.split('\n')
  const header = `      - name: ${name}`
  const start = lines.indexOf(header)
  assert.notEqual(start, -1, `job must define the ${name} step`)

  const nextStepOffset = lines
    .slice(start + 1)
    .findIndex(line => /^ {6}- name: /.test(line))
  const end = nextStepOffset === -1
    ? lines.length
    : start + 1 + nextStepOffset

  return lines.slice(start, end).join('\n')
}

test('defines a distinct Ubuntu job for privileged file protocol tests', () => {
  const linuxJob = extractJob('linux-privileged-file-tests')
  const windowsJob = extractJob('unit-tests')

  assert.notEqual(linuxJob, windowsJob)
  assert.match(linuxJob, /^ {4}runs-on: ubuntu-latest$/m)
  assert.match(
    linuxJob,
    /^ {4}defaults:\n {6}run:\n {8}working-directory: apps\/electerm-agent$/m
  )
})

test('Linux job configures Node 22 with the electerm-agent lockfile cache', () => {
  const linuxJob = extractJob('linux-privileged-file-tests')
  const setupNode = extractStep(linuxJob, 'Setup Node.js 22')

  assert.match(setupNode, /^ {8}uses: actions\/setup-node@v4$/m)
  assert.match(setupNode, /^ {10}node-version: "22"$/m)
  assert.match(setupNode, /^ {10}cache: npm$/m)
  assert.match(
    setupNode,
    /^ {10}cache-dependency-path: apps\/electerm-agent\/package-lock\.json$/m
  )
})

test('Linux job installs dependencies before running the exact root command', () => {
  const linuxJob = extractJob('linux-privileged-file-tests')
  const installStep = extractStep(linuxJob, 'Install dependencies')
  const privilegedStep = extractStep(
    linuxJob,
    'Run privileged file protocol tests as UID 0'
  )

  assert.match(installStep, /^ {8}run: npm ci$/m)
  assert.match(
    privilegedStep,
    /^ {8}run: sudo "\$\(command -v node\)" build\/bin\/run-linux-privileged-file-tests\.js$/m
  )
  assert.ok(
    linuxJob.indexOf(installStep) < linuxJob.indexOf(privilegedStep),
    'npm ci must run before the privileged test command'
  )
})

test('existing Windows unit job retains its runner, SSH agent, and unit suite', () => {
  const windowsJob = extractJob('unit-tests')
  const sshAgentStep = extractStep(
    windowsJob,
    'Start Windows OpenSSH agent service'
  )
  const unitTestStep = extractStep(windowsJob, 'Run unit tests')

  assert.match(windowsJob, /^ {4}runs-on: windows-latest$/m)
  assert.match(
    windowsJob,
    /^ {4}defaults:\n {6}run:\n {8}working-directory: apps\/electerm-agent$/m
  )
  assert.match(sshAgentStep, /^ {10}Set-Service ssh-agent -StartupType Manual$/m)
  assert.match(sshAgentStep, /^ {10}Start-Service ssh-agent$/m)
  assert.match(unitTestStep, /^ {8}run: npm run test-unit-ci$/m)
})

test('Linux job neither changes ownership recursively nor runs all unit tests as root', () => {
  const linuxJob = extractJob('linux-privileged-file-tests')

  assert.doesNotMatch(linuxJob, /\bchown\b/i)
  assert.doesNotMatch(
    linuxJob,
    /\bsudo\b[^\n]*(?:npm run test-unit-ci|test\/unit-ci\/\*\.spec\.js)/
  )
})
