/**
 * terminal apis
 */

import fetch from '../../common/fetch-from-server'
import { normalizeTerminalResizeSize } from '../../common/terminal-resize-size.js'

export function createTerm (body) {
  return fetch({
    body,
    action: 'create-terminal'
  })
}

export function runCmd (pid, cmd, options = {}) {
  return fetch({
    pid,
    cmd,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    executionId: options.executionId,
    action: 'run-cmd'
  })
}

export function cancelRunCmd (pid, executionId) {
  return fetch({
    pid,
    executionId,
    action: 'cancel-run-cmd'
  })
}

export function startSshTunnel (pid, tunnel) {
  return fetch({
    pid,
    tunnel,
    action: 'ssh-tunnel-start'
  })
}

export function stopSshTunnel (pid, tunnelId) {
  return fetch({
    pid,
    tunnelId,
    action: 'ssh-tunnel-stop'
  })
}

export function listSshTunnels (pid) {
  return fetch({
    pid,
    action: 'ssh-tunnel-list'
  })
}

export function testSshTunnel (pid, tunnelId) {
  return fetch({
    pid,
    tunnelId,
    action: 'ssh-tunnel-test'
  })
}

export function resizeTerm (pid, cols, rows) {
  const size = normalizeTerminalResizeSize(cols, rows)
  return fetch({
    pid,
    cols: size.cols,
    rows: size.rows,
    action: 'resize-terminal'
  })
}

export function toggleTerminalLog (pid) {
  return fetch({
    pid,
    action: 'toggle-terminal-log'
  })
}

export function toggleTerminalLogTimestamp (pid) {
  return fetch({
    pid,
    action: 'toggle-terminal-log-timestamp'
  })
}

export function setTerminalLogPath (pid, logPath) {
  return fetch({
    pid,
    logPath,
    action: 'set-terminal-log-path'
  })
}

export function startTerminalLogFile (pid, logFilePath, addTimeStampToTermLog) {
  return fetch({
    pid,
    logFilePath,
    addTimeStampToTermLog,
    action: 'start-terminal-log-file'
  })
}
