const stableStatuses = new Set(['healthy', 'warning', 'critical', 'unknown'])

export function buildServerStatusPresentation (
  { overallStatus, alerts = [] } = {},
  translated = {}
) {
  const status = stableStatuses.has(overallStatus) ? overallStatus : 'unknown'
  const copy = translated[status] || translated.unknown || {}
  return {
    status,
    severityLabel: String(copy.severityLabel || ''),
    impact: String(copy.impact || ''),
    nextStep: String(copy.nextStep || ''),
    alertCount: Array.isArray(alerts) ? alerts.length : 0
  }
}
