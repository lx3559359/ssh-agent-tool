const log = require('electron-log')
const { isDev } = require('./runtime-constants')
const {
  installLogRedaction
} = require('../lib/log-redaction')
const {
  createQualityLogger
} = require('../lib/quality/quality-log')

log.transports.console.format = '{h}:{i}:{s} {level} › {text}'
log.transports.file.sync = false

installLogRedaction(log)
log.recordQualityEvent = createQualityLogger(log)

if (!isDev) {
  log.transports.console.level = 'warn'
  log.transports.file.level = 'warn'
}

module.exports = exports.default = log
