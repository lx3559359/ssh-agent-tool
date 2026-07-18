/**
 * communication between webview and app
 * run functions in seprate process, avoid using electron.remote directly
 */

const fs = require('./fs')
const log = require('../common/log')
const fetch = require('./fetch')
const sync = require('./sync')
const {
  createTerm,
  testTerm,
  resize,
  runCmd,
  cancelRunCmd,
  toggleTerminalLog,
  toggleTerminalLogTimestamp,
  setTerminalLogPath,
  startTerminalLogFile
} = require('./terminal-api')
const globalState = require('./global-state')
const wsDec = require('./ws-dec')
const {
  collectionInputFromMessage,
  createFleetStatusService
} = require('./fleet-status-service')

const fleetStatusService = createFleetStatusService()

const { tokenElecterm } = process.env

function verify (req) {
  const { token: to } = req.query
  if (to !== tokenElecterm) {
    throw new Error('not valid request')
  }
  if (process.env.requireAuth === 'yes' && !globalState.authed) {
    throw new Error('auth required')
  }
}

function fleetErrorResponse (error) {
  const code = typeof error?.code === 'string'
    ? error.code
    : 'FLEET_STATUS_ERROR'
  const messages = {
    INVALID_REQUEST: 'Invalid fleet status request',
    INVALID_TASK_ID: 'Invalid fleet status task id',
    INVALID_TARGETS: 'Invalid fleet status targets',
    INVALID_PROBE_ID: 'Invalid fleet status probe id',
    TASK_EXISTS: 'Fleet status task already exists',
    FLEET_STATUS_ERROR: 'Fleet status request failed'
  }
  return {
    code,
    message: messages[code] || messages.FLEET_STATUS_ERROR
  }
}

async function collectFleetStatus (ws, msg) {
  try {
    const data = await fleetStatusService.collect(
      collectionInputFromMessage(msg),
      ws
    )
    ws.s({ id: msg.id, data })
  } catch (error) {
    ws.s({ id: msg.id, error: fleetErrorResponse(error) })
  }
}

async function collectFleetServiceInventory (ws, msg) {
  try {
    const data = await fleetStatusService.inventory(
      collectionInputFromMessage(msg),
      ws
    )
    ws.s({ id: msg.id, data })
  } catch (error) {
    ws.s({ id: msg.id, error: fleetErrorResponse(error) })
  }
}

async function cancelFleetStatus (ws, msg) {
  try {
    const data = await fleetStatusService.cancel(msg.taskId)
    ws.s({ id: msg.id, data })
  } catch (error) {
    ws.s({ id: msg.id, error: fleetErrorResponse(error) })
  }
}

const initWs = function (app) {
  // common functions
  app.ws('/common/s', (ws, req) => {
    verify(req)
    wsDec(ws)
    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message)
        const { action } = msg
        if (action === 'fetch') {
          fetch(ws, msg)
        } else if (action === 'sync') {
          sync(ws, msg)
        } else if (action === 'fs') {
          fs(ws, msg)
        } else if (action === 'create-terminal') {
          createTerm(ws, msg)
        } else if (action === 'test-terminal') {
          testTerm(ws, msg)
        } else if (action === 'resize-terminal') {
          resize(ws, msg)
        } else if (action === 'toggle-terminal-log') {
          toggleTerminalLog(ws, msg)
        } else if (action === 'toggle-terminal-log-timestamp') {
          toggleTerminalLogTimestamp(ws, msg)
        } else if (action === 'set-terminal-log-path') {
          setTerminalLogPath(ws, msg)
        } else if (action === 'start-terminal-log-file') {
          startTerminalLogFile(ws, msg)
        } else if (action === 'run-cmd') {
          runCmd(ws, msg)
        } else if (action === 'cancel-run-cmd') {
          cancelRunCmd(ws, msg)
        } else if (action === 'collect-fleet-status') {
          await collectFleetStatus(ws, msg)
        } else if (action === 'collect-fleet-service-inventory') {
          await collectFleetServiceInventory(ws, msg)
        } else if (action === 'cancel-fleet-status') {
          await cancelFleetStatus(ws, msg)
        }
      } catch (err) {
        log.error('common ws error', err)
      }
    })
  })
  // end
}

exports.verifyWs = verify
exports.initWs = initWs
