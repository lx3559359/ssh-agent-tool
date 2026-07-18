/**
 * user-controll.json controll
 */

const { dbAction } = require('./db')
const { userConfigId, userNoEncryptConfigId } = require('../common/constants')
const { getDbConfig } = require('./get-config')
const globalState = require('./glob-state')
const { protectAIConfigCredentials } = require('./ai-credential-storage')

const configNoEncryptFields = ['allowMultiInstance']

function hasNoEncryptFields (userConfig) {
  for (const f of configNoEncryptFields) {
    if (f in userConfig) {
      return true
    }
  }
  return false
}

exports.saveUserConfig = async (userConfig) => {
  const q = {
    _id: userConfigId
  }
  const runtimeConfig = { ...userConfig }
  delete runtimeConfig.host
  delete runtimeConfig.terminalTypes
  delete runtimeConfig.tokenElecterm
  delete runtimeConfig.server
  delete runtimeConfig.port
  globalState.update('config', runtimeConfig)
  const conf = await getDbConfig()
  if (hasNoEncryptFields(runtimeConfig)) {
    const q1 = {
      _id: userNoEncryptConfigId
    }
    const noEncryptConfig = {}
    for (const f of configNoEncryptFields) {
      if (f in runtimeConfig) {
        noEncryptConfig[f] = runtimeConfig[f]
      }
    }
    await dbAction('data', 'update', q1, noEncryptConfig, {
      upsert: true
    })
  }
  const persistedConfig = protectAIConfigCredentials({
    ...q,
    ...conf,
    ...runtimeConfig
  })
  return dbAction('data', 'update', q, persistedConfig, {
    upsert: true
  })
}
