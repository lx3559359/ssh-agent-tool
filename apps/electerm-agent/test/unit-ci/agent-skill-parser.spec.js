const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  parseSkillDocument
} = require(path.resolve(__dirname, '../../src/app/lib/agent-skill-parser'))

const validDocument = `---
id: inspect-web-service
name: Inspect Web Service
description: Collect bounded service evidence and verify a listening port.
version: 1.0.0
triggers:
  - web service health
permissions:
  - ssh.read
---

# Workflow

Read service status, recent logs, and the expected listening port.
`

test('parses only the controlled skill frontmatter subset', () => {
  const parsed = parseSkillDocument(validDocument)
  assert.deepEqual(parsed.frontmatter, {
    id: 'inspect-web-service',
    name: 'Inspect Web Service',
    description: 'Collect bounded service evidence and verify a listening port.',
    version: '1.0.0',
    triggers: ['web service health'],
    permissions: ['ssh.read']
  })
  assert.match(parsed.body, /# Workflow/)
})

test('rejects duplicate keys, yaml features, nesting and oversized documents', () => {
  const invalidDocuments = [
    validDocument.replace('name: Inspect Web Service', 'name: One\nname: Two'),
    validDocument.replace('name: Inspect Web Service', 'name: &shared Inspect Web Service'),
    validDocument.replace('description: Collect bounded service evidence and verify a listening port.', 'description: !unsafe value'),
    validDocument.replace('  - web service health', '  - key: nested'),
    validDocument.replace('triggers:', 'unknown:'),
    '---\nid: inspect-web-service\n---\nbody'
  ]
  for (const document of invalidDocuments) {
    assert.throws(() => parseSkillDocument(document), error => error.code.startsWith('SKILL_'))
  }
  assert.throws(
    () => parseSkillDocument(validDocument + 'x'.repeat(300 * 1024)),
    error => error.code === 'SKILL_DOCUMENT_TOO_LARGE'
  )
})
