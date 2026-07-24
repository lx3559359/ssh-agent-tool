/**
 * export test username/password/host/port
 */
require('dotenv').config({
  override: true
})
const os = require('os').platform()
const {
  env
} = process

const TEST_HOST = env[`TEST_HOST_${os}`] || env.TEST_HOST
const TEST_PASS = env[`TEST_PASS_${os}`] || env.TEST_PASS
const TEST_USER = env[`TEST_USER_${os}`] || env.TEST_USER
const TEST_PORT = env[`TEST_PORT_${os}`] || env.TEST_PORT || '22'

const hasRealServerCredentials = Boolean(TEST_HOST && TEST_PASS && TEST_USER)

function requireRealServerCredentials (credentials = {}) {
  const host = credentials.host || TEST_HOST
  const password = credentials.password || TEST_PASS
  const username = credentials.username || TEST_USER
  if (!host || !password || !username) {
    throw new Error(`
    basic sftp test need TEST_HOST TEST_PASS TEST_USER env set,
    TEST_PORT is optional (default 22)
    you can run "cp .sample.env .env" to create env file, then edit .env, fill all required field
  `)
  }
  return { host, password, username }
}

module.exports = {
  hasRealServerCredentials,
  requireRealServerCredentials,
  TEST_HOST,
  TEST_PASS,
  TEST_USER,
  TEST_PORT: '' + TEST_PORT
}
