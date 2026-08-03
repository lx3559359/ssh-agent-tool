const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const parserUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-tool-call-parser.js'
)).href

function descriptor (parameters = {}) {
  return {
    function: {
      name: 'read_recent_logs',
      parameters: {
        type: 'object',
        properties: {
          unit: { type: 'string', minLength: 2, maxLength: 16 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          mode: { type: 'string', enum: ['system', 'user'] },
          filters: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: {
              type: 'object',
              properties: { value: { type: 'number' } },
              required: ['value'],
              additionalProperties: false
            }
          }
        },
        required: ['unit'],
        additionalProperties: false,
        ...parameters
      }
    }
  }
}

test('malformed arguments never become an empty object', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  let descriptorReads = 0
  assert.throws(() => parseAgentToolCall({
    id: 'call-a',
    function: { name: 'list_tabs', arguments: '{bad' }
  }, {
    resolveDescriptor: () => {
      descriptorReads += 1
      return descriptor({ properties: {}, required: [] })
    }
  }), error => error.code === 'AGENT_TOOL_ARGUMENTS_INVALID_JSON')
  assert.equal(descriptorReads, 0)
})

test('valid parsed arguments are deeply frozen and reuse the public tool name', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  const parsed = parseAgentToolCall({
    id: 'call-b',
    function: {
      name: 'read_recent_logs',
      arguments: '{"unit":"sshd","limit":20,"mode":"system","filters":[{"value":1.5}]}'
    }
  }, {
    resolveDescriptor: () => descriptor()
  })
  assert.equal(parsed.name, 'read_recent_logs')
  assert.deepEqual(parsed.args, {
    unit: 'sshd',
    limit: 20,
    mode: 'system',
    filters: [{ value: 1.5 }]
  })
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.args), true)
  assert.equal(Object.isFrozen(parsed.args.filters), true)
  assert.equal(Object.isFrozen(parsed.args.filters[0]), true)
})

test('schema validation rejects required type enum range length and unknown fields', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  const invalid = [
    ['{}', '$.unit', 'required'],
    ['{"unit":1}', '$.unit', 'type'],
    ['{"unit":"s"}', '$.unit', 'minLength'],
    ['{"unit":"abcdefghijklmnopq"}', '$.unit', 'maxLength'],
    ['{"unit":"sshd","limit":0}', '$.limit', 'minimum'],
    ['{"unit":"sshd","limit":101}', '$.limit', 'maximum'],
    ['{"unit":"sshd","limit":1.5}', '$.limit', 'type'],
    ['{"unit":"sshd","mode":"other"}', '$.mode', 'enum'],
    ['{"unit":"sshd","extra":true}', '$.extra', 'additionalProperties'],
    ['{"unit":"sshd","filters":[]}', '$.filters', 'minItems'],
    ['{"unit":"sshd","filters":[{"value":1},{"value":2},{"value":3}]}', '$.filters', 'maxItems'],
    ['{"unit":"sshd","filters":[{}]}', '$.filters[0].value', 'required'],
    ['{"unit":"sshd","filters":[{"value":null}]}', '$.filters[0].value', 'type'],
    ['{"unit":"sshd","filters":[{"value":1,"secret":"x"}]}', '$.filters[0].secret', 'additionalProperties']
  ]

  for (const [argumentsText, expectedPath, expectedRule] of invalid) {
    assert.throws(() => parseAgentToolCall({
      function: { name: 'read_recent_logs', arguments: argumentsText }
    }, { resolveDescriptor: () => descriptor() }), error => (
      error.code === 'AGENT_TOOL_ARGUMENTS_SCHEMA_INVALID' &&
      error.message.includes(expectedPath) &&
      error.message.includes(expectedRule) &&
      !error.message.includes('"x"')
    ))
  }
})

test('valid no-argument tools accept omitted or empty arguments', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  const noArgs = descriptor({ properties: {}, required: [] })
  for (const source of [undefined, '']) {
    const parsed = parseAgentToolCall({
      function: { name: 'list_tabs', arguments: source }
    }, { resolveDescriptor: () => noArgs })
    assert.deepEqual(parsed.args, {})
  }
})

test('argument byte limits fail before descriptor lookup', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  let descriptorReads = 0
  assert.throws(() => parseAgentToolCall({
    function: { name: 'list_tabs', arguments: '{"text":"你好"}' }
  }, {
    maxArgumentBytes: 10,
    resolveDescriptor: () => {
      descriptorReads += 1
      return descriptor()
    }
  }), error => error.code === 'AGENT_TOOL_ARGUMENTS_TOO_LARGE')
  assert.equal(descriptorReads, 0)
})

test('unknown tools retain the descriptor error without executing validation', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  assert.throws(() => parseAgentToolCall({
    function: { name: 'unknown_tool', arguments: '{}' }
  }, {
    resolveDescriptor: name => {
      const error = new Error(`Unknown Agent tool: ${name}`)
      error.code = 'UNKNOWN_AGENT_TOOL'
      throw error
    }
  }), error => error.code === 'UNKNOWN_AGENT_TOOL')
})
