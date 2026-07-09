const { Client } = require('@electerm/ssh2')
const crypto = require('crypto')

const env = process.env
const host = env.SHELLPILOT_SSH_HOST
const username = env.SHELLPILOT_SSH_USER
const password = env.SHELLPILOT_SSH_PASSWORD
const port = Number(env.SHELLPILOT_SSH_PORT || 22)
const testDir = env.SHELLPILOT_SSH_TEST_DIR || '/tmp'
const timeoutMs = Number(env.SHELLPILOT_SSH_TIMEOUT || 20000)
const started = Date.now()
const results = []

function redact (text) {
  return String(text || '').replaceAll(password || '', '[REDACTED]')
}

function record (name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' - ' + detail : ''}`)
}

function failMissingEnv () {
  const missing = [
    ['SHELLPILOT_SSH_HOST', host],
    ['SHELLPILOT_SSH_USER', username],
    ['SHELLPILOT_SSH_PASSWORD', password]
  ].filter(([, value]) => !value).map(([name]) => name)
  if (!missing.length) {
    return
  }
  console.error(`Missing required environment variables: ${missing.join(', ')}`)
  console.error('Example: set SHELLPILOT_SSH_HOST, SHELLPILOT_SSH_USER and SHELLPILOT_SSH_PASSWORD, then run npm run smoke:ssh-sftp')
  process.exit(2)
}

function connect () {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect({
      host,
      port,
      username,
      password,
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000,
      hostVerifier: () => true
    })
  })
}

function execCommand (conn, command, commandTimeoutMs = timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        reject(new Error(`exec timeout: ${command}`))
      }
    }, commandTimeoutMs)

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer)
        reject(err)
        return
      }
      stream.on('close', code => {
        done = true
        clearTimeout(timer)
        resolve({
          code,
          stdout: redact(stdout),
          stderr: redact(stderr)
        })
      })
      stream.on('data', data => {
        stdout += data.toString('utf8')
      })
      stream.stderr.on('data', data => {
        stderr += data.toString('utf8')
      })
    })
  })
}

function sftpClient (conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp))
  })
}

function sftpOp (sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (err, result) => err ? reject(err) : resolve(result))
  })
}

function shellTest (conn) {
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, stream) => {
      if (err) {
        reject(err)
        return
      }
      let data = ''
      const timer = setTimeout(() => reject(new Error('interactive shell timeout')), timeoutMs + 5000)
      stream.on('data', chunk => {
        data += chunk.toString('utf8')
        if (data.includes('__CTRL_C_OK__')) {
          clearTimeout(timer)
          stream.end('exit\n')
          resolve(redact(data))
        }
      })
      stream.write('printf "__SHELL_READY__\\n"\n')
      setTimeout(() => stream.write('sleep 20\n'), 800)
      setTimeout(() => stream.write('\x03'), 1800)
      setTimeout(() => stream.write('echo __CTRL_C_OK__\n'), 2600)
    })
  })
}

async function runSmoke () {
  failMissingEnv()
  let conn
  try {
    conn = await connect()
    record('SSH password login', true, `connected ${host}:${port} in ${Date.now() - started}ms`)

    const basic = await execCommand(conn, 'printf "user="; whoami; printf "uid="; id -u; printf "kernel="; uname -s; printf "pwd="; pwd')
    record(
      'remote command execution',
      basic.code === 0 && basic.stdout.includes('user=root'),
      basic.stdout.trim().replace(/\s+/g, ' | ')
    )

    const health = await execCommand(conn, 'set -o pipefail; printf "load="; uptime; printf "disk_root="; df -h / | tail -n 1; printf "mem="; free -m | awk \'/Mem:/ {print $2"MB total,"$7"MB available"}\'')
    record('basic health commands', health.code === 0, health.stdout.trim().replace(/\n/g, ' | '))

    const shellOutput = await shellTest(conn)
    record(
      'interactive shell Ctrl+C',
      shellOutput.includes('__SHELL_READY__') && shellOutput.includes('__CTRL_C_OK__'),
      'sleep interrupted and shell accepted next command'
    )

    const sftp = await sftpClient(conn)
    const token = crypto.randomBytes(4).toString('hex')
    const remote = `${testDir.replace(/\/$/, '')}/shellpilot-smoke-${token}.txt`
    const renamed = `${testDir.replace(/\/$/, '')}/shellpilot-smoke-${token}.renamed.txt`
    const content = `ShellPilot SFTP smoke ${new Date().toISOString()}\n`
    await sftpOp(sftp, 'writeFile', remote, Buffer.from(content))
    const stat = await sftpOp(sftp, 'stat', remote)
    const readBack = await sftpOp(sftp, 'readFile', remote)
    await sftpOp(sftp, 'rename', remote, renamed)
    const list = await sftpOp(sftp, 'readdir', testDir)
    await sftpOp(sftp, 'unlink', renamed)
    sftp.end()

    record(
      'SFTP write/read/rename/delete',
      stat.size === Buffer.byteLength(content) &&
        readBack.toString() === content &&
        list.some(item => item.filename === renamed.split('/').pop()),
      `temp=${remote.replace(/\.txt$/, '.*')} size=${stat.size}`
    )

    const cleanup = await execCommand(conn, `ls ${testDir.replace(/'/g, "'\\''")}/shellpilot-smoke-* 2>/dev/null | wc -l`)
    record('remote temp cleanup check', cleanup.code === 0, `${cleanup.stdout.trim()} shellpilot-smoke candidates remain`)
  } catch (err) {
    record('smoke flow error', false, redact(err.stack || err.message))
    process.exitCode = 1
  } finally {
    if (conn) {
      conn.end()
    }
    const summary = {
      passed: results.filter(item => item.ok).length,
      failed: results.filter(item => !item.ok).length,
      results
    }
    console.log(`\nSUMMARY ${JSON.stringify(summary, null, 2)}`)
  }
}

runSmoke()
