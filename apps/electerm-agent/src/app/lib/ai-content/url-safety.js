const {
  classifyAddress,
  inspectWebTarget
} = require('./web-access-policy')
const {
  WebAccessError
} = require('./web-access-errors')

function isPrivateAddress (address) {
  return classifyAddress(address) !== 'public'
}

async function assertSafePublicUrl (input) {
  const result = await inspectWebTarget(input)
  if (result.decision !== 'allow-public') {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Only public web pages are allowed on the static reader.',
      {
        origin: result.target.origin,
        addressClass: result.target.addressClass
      }
    )
  }
  return {
    url: new URL(result.target.url),
    addresses: result.target.addresses
  }
}

module.exports = {
  assertSafePublicUrl,
  isPrivateAddress
}
