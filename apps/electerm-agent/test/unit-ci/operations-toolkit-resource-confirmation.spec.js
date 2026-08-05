const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const endpointKey = 'root@example.com:22'
const params = {
  protocol: 'tcp',
  interfaceName: 'eth0',
  packetCount: 100
}

test('resource confirmation is bound to tool endpoint and canonical params', async () => {
  const {
    assertOperationsResourceConfirmation,
    createOperationsResourceConfirmation
  } = await importModule(
    'src/client/components/operations-toolkit/shared/resource-confirmation.js'
  )
  const confirmation = createOperationsResourceConfirmation({
    toolId: 'network.packet-capture',
    endpointKey,
    params,
    now: () => 1000,
    createNonce: () => 'confirmation-1'
  })
  const consumedNonces = new Set()

  assert.doesNotThrow(() => assertOperationsResourceConfirmation({
    confirmation,
    toolId: 'network.packet-capture',
    endpointKey,
    params: { packetCount: 100, interfaceName: 'eth0', protocol: 'tcp' },
    consumedNonces,
    now: () => 1500
  }))
  assert.equal(consumedNonces.has('confirmation-1'), true)
  assert.throws(() => assertOperationsResourceConfirmation({
    confirmation,
    toolId: 'network.packet-capture',
    endpointKey,
    params,
    consumedNonces,
    now: () => 1600
  }), /已经使用/)
})

test('resource confirmation rejects changed params endpoint and expiry', async () => {
  const {
    assertOperationsResourceConfirmation,
    createOperationsResourceConfirmation
  } = await importModule(
    'src/client/components/operations-toolkit/shared/resource-confirmation.js'
  )
  const confirmation = createOperationsResourceConfirmation({
    toolId: 'network.packet-capture',
    endpointKey,
    params,
    now: () => 1000,
    createNonce: () => 'confirmation-2'
  })

  for (const override of [
    { endpointKey: 'root@other.example:22' },
    { params: { ...params, packetCount: 101 } },
    { now: () => 62001 }
  ]) {
    assert.throws(() => assertOperationsResourceConfirmation({
      confirmation,
      toolId: 'network.packet-capture',
      endpointKey,
      params,
      consumedNonces: new Set(),
      now: () => 1500,
      ...override
    }), /确认/)
  }
})
