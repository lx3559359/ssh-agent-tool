const log = require('electron-log')
const { isDev } = require('./runtime-constants')
const {
  installLogRedaction
} = require('../lib/log-redaction')

log.transports.console.format = '{h}:{i}:{s} {level} › {text}'

installLogRedaction(log)

if (!isDev) {
  log.transports.console.level = 'warn'
  log.transports.file.level = 'warn'
}

module.exports = exports.default = log
