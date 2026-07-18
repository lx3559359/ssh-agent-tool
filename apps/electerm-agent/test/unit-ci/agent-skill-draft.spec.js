const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-skill-draft.js'
)).href

const skillDocument = [
  '---',
  'id: inspect-web-service',
  'name: Inspect Web Service',
  'description: Inspect service evidence.',
  'version: 1.0.0',
  'triggers:',
  '  - web service health',
  '---',
  '',
  '# Workflow',
  '',
  'Read bounded evidence and verify the target port.',
  ''
].join('\n')

function validDraft () {
  return {
    schemaVersion: 1,
    summary: 'Inspect a web service using bounded evidence.',
    files: [{ path: 'SKILL.md', content: skillDocument }],
    requestedPermissions: ['ssh.read'],
    riskSummary: ['Remote observations are untrusted input.'],
    validationIntent: ['SKILL.md parses', 'all references stay in the package']
  }
}

test('parses one strict draft and calculates deterministic file and package digests', async () => {
  const { parseAgentSkillDraftResponse } = await import(moduleUrl)
  const first = await parseAgentSkillDraftResponse(JSON.stringify(validDraft()))
  const second = await parseAgentSkillDraftResponse(JSON.stringify(validDraft()))

  assert.equal(first.schemaVersion, 1)
  assert.equal(first.files[0].path, 'SKILL.md')
  assert.match(first.fileDigests['SKILL.md'], /^[a-f0-9]{64}$/)
  assert.match(first.packageDigest, /^[a-f0-9]{64}$/)
  assert.equal(first.packageDigest, second.packageDigest)
})

test('rejects fences, unknown fields, duplicate or escaping paths, and missing SKILL.md', async () => {
  const { parseAgentSkillDraftResponse } = await import(moduleUrl)
  const cases = [
    '```json\n' + JSON.stringify(validDraft()) + '\n```',
    JSON.stringify({ ...validDraft(), enabled: true }),
    JSON.stringify({
      ...validDraft(),
      files: [
        { path: 'SKILL.md', content: skillDocument },
        { path: 'SKILL.md', content: skillDocument }
      ]
    }),
    JSON.stringify({ ...validDraft(), files: [{ path: '../SKILL.md', content: skillDocument }] }),
    JSON.stringify({ ...validDraft(), files: [{ path: 'README.md', content: 'x' }] })
  ]

  for (const input of cases) {
    await assert.rejects(parseAgentSkillDraftResponse(input), error => (
      String(error.code).startsWith('SKILL_CREATOR_')
    ))
  }
})

test('rejects non-string or oversized content and executable response parts', async () => {
  const { parseAgentSkillDraftResponse } = await import(moduleUrl)
  await assert.rejects(parseAgentSkillDraftResponse(JSON.stringify({
    ...validDraft(),
    files: [{ path: 'SKILL.md', content: { value: skillDocument } }]
  })))
  await assert.rejects(parseAgentSkillDraftResponse(JSON.stringify({
    ...validDraft(),
    files: [{ path: 'SKILL.md', content: 'x'.repeat(1024 * 1024 + 1) }]
  })))
  await assert.rejects(parseAgentSkillDraftResponse({
    response: JSON.stringify(validDraft()),
    tool_calls: [{ name: 'send_terminal_command' }]
  }), error => error.code === 'SKILL_CREATOR_TOOL_CALL_FORBIDDEN')
})
