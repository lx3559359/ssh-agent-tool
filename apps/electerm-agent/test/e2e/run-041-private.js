const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const privateSpec =
  'test/e2e/041.secondary-sudo-sftp-visibility.spec.js'
const privateReporter =
  './test/e2e/run-041-private.js'
const valueOptions = new Set([
  '--grep',
  '--output',
  '--repeat-each',
  '--reporter'
])
const flagOptions = new Set(['--list'])

function rejectArgument () {
  throw new Error('Unsupported private runner argument')
}

function validateOptionValue (option, value) {
  if (!value) rejectArgument()
  if (option === '--repeat-each' && !/^[1-9][0-9]?$/.test(value)) {
    rejectArgument()
  }
  if (option === '--reporter' && !['dot', 'line'].includes(value)) {
    rejectArgument()
  }
  if (option === '--grep' && value.length > 200) {
    rejectArgument()
  }
  if (option === '--output' && !/^test-results-reporter-[a-z0-9-]+$/
    .test(value)) {
    rejectArgument()
  }
}

function normalizeExtraArguments (argv) {
  const normalized = []
  let reporterStyle = 'line'
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index])
    if (flagOptions.has(argument)) {
      normalized.push(argument)
      continue
    }
    const equalsIndex = argument.indexOf('=')
    const option = equalsIndex > 0
      ? argument.slice(0, equalsIndex)
      : argument
    if (!valueOptions.has(option)) rejectArgument()
    if (equalsIndex > 0) {
      const value = argument.slice(equalsIndex + 1)
      validateOptionValue(option, value)
      if (option === '--reporter') {
        reporterStyle = value
      } else {
        normalized.push(argument)
      }
      continue
    }
    const value = String(argv[index + 1] || '')
    validateOptionValue(option, value)
    if (option === '--reporter') {
      reporterStyle = value
    } else {
      normalized.push(argument, value)
    }
    index += 1
  }
  return { arguments: normalized, reporterStyle }
}

function buildPlaywrightArguments (extraArguments = process.argv.slice(2)) {
  const normalized = normalizeExtraArguments(extraArguments)
  return [
    'test',
    privateSpec,
    '--workers=1',
    `--reporter=${privateReporter}`,
    ...normalized.arguments
  ]
}

function buildPlaywrightEnvironment (
  environment = process.env,
  reporterStyle = 'line'
) {
  return {
    ...environment,
    PLAYWRIGHT_NO_COPY_PROMPT: '1',
    SHELLPILOT_PRIVATE_REPORTER_ACTIVE: '1',
    SHELLPILOT_PRIVATE_REPORTER_STYLE: reporterStyle === 'dot'
      ? 'dot'
      : 'line'
  }
}

function isPrivateArtifactPath (artifactPath) {
  if (!artifactPath) return false
  const relative = path.relative(
    process.cwd(),
    path.resolve(artifactPath)
  ).replaceAll('\\', '/')
  const artifactPattern =
    /^(?:test-results|test-results-reporter-[a-z0-9-]+)\/[^/]+\/error-context\.md$/
  return artifactPattern.test(relative)
}

class PrivateArtifactReporter {
  constructor () {
    this.counts = {
      failed: 0,
      interrupted: 0,
      passed: 0,
      skipped: 0,
      timedOut: 0,
      unknown: 0
    }
    this.internalFailureCounts = {
      'artifact-path-rejected': 0,
      'artifact-unlink-failed': 0
    }
    this.internalFailureCount = 0
    this.reporterStyle = process.env.SHELLPILOT_PRIVATE_REPORTER_STYLE === 'dot'
      ? 'dot'
      : 'line'
    this.testCount = 0
  }

  emit (event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  }

  safeStatus (status) {
    return Object.hasOwn(this.counts, status) ? status : 'unknown'
  }

  recordInternalFailure (failureCategory) {
    const category = Object.hasOwn(
      this.internalFailureCounts,
      failureCategory
    )
      ? failureCategory
      : 'artifact-unlink-failed'
    this.internalFailureCounts[category] += 1
    this.internalFailureCount += 1
    this.emit({
      category: 'private-reporter-internal-failure',
      failureCategory: category,
      failureCount: this.internalFailureCounts[category]
    })
  }

  onBegin (_config, suite) {
    this.testCount = suite.allTests().length
    if (this.reporterStyle === 'line') {
      this.emit({ category: 'private-test-run', testCount: this.testCount })
    }
  }

  onTestEnd (_test, result) {
    for (let index = result.attachments.length - 1; index >= 0; index -= 1) {
      const attachment = result.attachments[index]
      if (attachment.name !== 'error-context') continue
      result.attachments.splice(index, 1)
      if (!isPrivateArtifactPath(attachment.path)) {
        this.recordInternalFailure('artifact-path-rejected')
        continue
      }
      try {
        fs.unlinkSync(attachment.path)
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          this.recordInternalFailure('artifact-unlink-failed')
        }
      }
    }
    const status = this.safeStatus(result.status)
    this.counts[status] += 1
    if (this.reporterStyle === 'dot') {
      const statusMark = { passed: '.', skipped: 'S' }[status] || 'F'
      process.stdout.write(statusMark)
      return
    }
    this.emit({
      category: 'private-test-result',
      durationMs: Math.max(0, Math.round(Number(result.duration) || 0)),
      errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
      retryCount: Math.max(0, Number(result.retry) || 0),
      status
    })
  }

  onEnd (result) {
    if (this.reporterStyle === 'dot') process.stdout.write('\n')
    const status = [
      'failed',
      'interrupted',
      'passed',
      'timedout'
    ].includes(result.status)
      ? result.status
      : 'unknown'
    const finalStatus = this.internalFailureCount > 0
      ? 'failed'
      : status
    this.emit({
      category: 'private-test-summary',
      failedCount: this.counts.failed,
      internalFailureCount: this.internalFailureCount,
      interruptedCount: this.counts.interrupted,
      passedCount: this.counts.passed,
      skippedCount: this.counts.skipped,
      status: finalStatus,
      testCount: this.testCount,
      timedOutCount: this.counts.timedOut
    })
    if (this.internalFailureCount > 0) return { status: 'failed' }
  }

  onExit () {
    if (this.internalFailureCount === 0) return
    process.exitCode = 1
    this.emit({
      category: 'private-reporter-exit',
      internalFailureCount: this.internalFailureCount,
      status: 'failed'
    })
  }
}

function main () {
  let cliPath
  let child
  try {
    cliPath = require.resolve('@playwright/test/cli')
    const reporterStyle = normalizeExtraArguments(process.argv.slice(2)).reporterStyle
    child = spawn(
      process.execPath,
      [cliPath, ...buildPlaywrightArguments()],
      {
        cwd: path.resolve(__dirname, '../..'),
        env: buildPlaywrightEnvironment(process.env, reporterStyle),
        stdio: 'inherit',
        windowsHide: true
      }
    )
  } catch {
    console.error('Private test runner could not start')
    process.exitCode = 2
    return
  }
  child.once('error', () => {
    console.error('Private test runner could not start')
    process.exitCode = 2
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      try {
        process.kill(process.pid, signal)
      } catch {
        process.exitCode = 1
      }
      return
    }
    process.exitCode = Number.isInteger(code) ? code : 1
  })
}

if (require.main === module) main()

PrivateArtifactReporter.buildPlaywrightArguments = buildPlaywrightArguments
PrivateArtifactReporter.buildPlaywrightEnvironment = buildPlaywrightEnvironment
PrivateArtifactReporter.isPrivateArtifactPath = isPrivateArtifactPath
PrivateArtifactReporter.normalizeExtraArguments = normalizeExtraArguments

module.exports = PrivateArtifactReporter
