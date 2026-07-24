import { systemResourceRunbooks } from './system-resources.js'
import { applicationServiceRunbooks } from './application-services.js'
import { networkSecurityRunbooks } from './network-security.js'
import { compatibilityRunbooks } from './compatibility.js'

const operationsRunbooks = Object.freeze([
  ...systemResourceRunbooks,
  ...applicationServiceRunbooks,
  ...networkSecurityRunbooks,
  ...compatibilityRunbooks
])

export function getOperationsRunbooks () {
  return operationsRunbooks
}

export {
  applicationServiceRunbooks,
  compatibilityRunbooks,
  networkSecurityRunbooks,
  systemResourceRunbooks
}
