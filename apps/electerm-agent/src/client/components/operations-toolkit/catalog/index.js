import { defineOperationsTool } from '../shared/definition.js'
import { systemStorageTools } from './diagnostics/system-storage.js'
import { networkSecurityTools } from './diagnostics/network-security.js'
import { udpCheckTools } from './diagnostics/udp-check.js'
import { servicesPlatformTools } from './diagnostics/services-platform.js'
import { getOperationsRunbooks } from './scripts/index.js'

export function buildOperationsCatalog (groups = []) {
  const toolIds = new Set()
  const legacyIds = new Set()
  const tools = groups.flat().map(input => {
    const tool = defineOperationsTool(input)
    if (legacyIds.has(tool.id)) {
      throw new Error(`运维工具 ID 与旧 ID 冲突：${tool.id}`)
    }
    if (toolIds.has(tool.id)) {
      throw new Error(`运维工具 ID 重复：${tool.id}`)
    }
    toolIds.add(tool.id)
    for (const legacyId of tool.legacyIds || []) {
      if (toolIds.has(legacyId) || legacyIds.has(legacyId)) {
        throw new Error(`运维工具旧 ID 重复：${legacyId}`)
      }
      legacyIds.add(legacyId)
    }
    return tool
  })
  return Object.freeze(tools)
}

let operationsCatalog = buildOperationsCatalog([
  systemStorageTools,
  networkSecurityTools,
  udpCheckTools,
  servicesPlatformTools,
  getOperationsRunbooks()
])

export function setOperationsCatalogGroups (groups) {
  operationsCatalog = buildOperationsCatalog(groups)
  return operationsCatalog
}

export function getOperationsCatalog () {
  return operationsCatalog
}

export function getOperationsTool (id) {
  return operationsCatalog.find(tool => {
    return tool.id === id || tool.legacyIds?.includes(id)
  }) || null
}
