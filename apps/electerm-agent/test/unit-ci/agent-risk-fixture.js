const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const riskUrl = pathToFileURL(path.join(aiRoot, 'agent-risk-transaction.js')).href
const grantUrl = pathToFileURL(path.join(aiRoot, 'agent-plan-grant.js')).href

async function createRiskPreparation ({
  toolName = 'send_terminal_command',
  args = { command: 'systemctl restart nginx' },
  endpoint,
  riskTaskId = 'agent-risk-test'
} = {}) {
  const {
    buildRiskPlanPayload,
    buildRiskTransaction
  } = await import(riskUrl)
  const { createPlanGrant } = await import(grantUrl)
  const riskTransaction = buildRiskTransaction([{
    name: toolName,
    args
  }], {
    endpoint,
    goal: `Test ${toolName}`,
    affectedObjects: [toolName],
    resourceImpact: {
      cpu: 'low',
      memory: 'low',
      disk: 'low',
      network: 'low',
      duration: 'short'
    },
    recovery: {
      type: 'none',
      verified: false,
      limits: 'test only'
    }
  })
  return {
    riskTaskId,
    riskTransaction,
    riskPlanGrant: await createPlanGrant(
      buildRiskPlanPayload(riskTransaction),
      { confirmedBy: 'user', now: 1000 }
    )
  }
}

module.exports = { createRiskPreparation }
