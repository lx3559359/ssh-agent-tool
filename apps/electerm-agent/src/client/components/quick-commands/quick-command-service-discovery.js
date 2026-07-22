import { createFleetStatusClient } from '../../common/fleet-status-client.js'
import { normalizeFleetServiceInventoryResult } from '../fleet-status/fleet-service-selector-model.js'

const stateLabels = Object.freeze({
  running: '运行中',
  stopped: '已停止',
  failed: '异常',
  starting: '启动中',
  restarting: '重启中',
  paused: '已暂停',
  unknown: '未知'
})

const stateLabelKeys = Object.freeze({
  running: 'shellpilotFleetRunning',
  stopped: 'shellpilotFleetStopped',
  failed: 'shellpilotFleetAbnormal',
  starting: 'shellpilotFleetStarting',
  restarting: 'shellpilotFleetRestarting',
  paused: 'shellpilotFleetPaused',
  unknown: 'shellpilotFleetUnknown'
})

function getStateLabel (state, translate) {
  const normalizedState = stateLabels[state] ? state : 'unknown'
  const fallback = stateLabels[normalizedState]
  if (typeof translate !== 'function') return fallback
  const translated = translate(stateLabelKeys[normalizedState])
  return translated && translated !== stateLabelKeys[normalizedState]
    ? translated
    : fallback
}

function normalizeSources (sources) {
  return new Set(
    (Array.isArray(sources) ? sources : [])
      .map(source => String(source || '').trim().toLowerCase())
      .filter(Boolean)
  )
}

export async function discoverQuickCommandTargets (bookmark, options = {}) {
  const client = options.client || createFleetStatusClient()
  const response = await client.inventory({
    bookmark,
    signal: options.signal
  })
  const normalized = normalizeFleetServiceInventoryResult(response)
  const type = String(options.type || '').trim().toLowerCase()
  const sources = normalizeSources(options.sources)
  const optionsList = normalized.items
    .filter(item => (!type || item.type === type) && (!sources.size || sources.has(item.source)))
    .map(item => ({
      value: item.name,
      label: `${item.name} · ${getStateLabel(item.state, options.translate)} · ${item.source}`,
      state: item.state,
      autostart: item.autostart,
      source: item.source,
      description: item.description
    }))
    .sort((left, right) => left.value.localeCompare(right.value, 'zh-CN'))

  return {
    ...normalized,
    options: optionsList
  }
}
