const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const {
  createIncidentDatabase
} = require('../../src/app/lib/incidents/incident-database')
const {
  createIncidentRepository
} = require('../../src/app/lib/incidents/incident-repository')

const harnesses = []
const repositoryDatabases = new WeakMap()

test.afterEach(() => {
  while (harnesses.length) {
    const harness = harnesses.pop()
    harness.manager.close()
    fs.rmSync(harness.rootPath, { recursive: true, force: true })
  }
})

function createRepositoryHarness () {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-incidents-'))
  const manager = createIncidentDatabase({ rootPath })
  let clock = 1000
  let sequence = 0
  const repository = createIncidentRepository({
    getDatabase: () => manager.db,
    now: () => clock++,
    createId: () => `generated-${++sequence}`
  })
  repositoryDatabases.set(repository, manager.db)
  harnesses.push({ rootPath, manager })
  return repository
}

function createRepositoryDatabaseHarness () {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-incidents-'))
  const manager = createIncidentDatabase({ rootPath })
  harnesses.push({ rootPath, manager })
  return manager.db
}

function seedIncidents (repository, count) {
  if (count >= 1000) {
    const database = repositoryDatabases.get(repository)
    const insertIncident = database.prepare(`
      INSERT INTO incidents (
        id, title, endpoint_ref, state, severity, service_tags_json,
        custom_tags_json, verification_status, storage_policy,
        is_pinned, is_favorite, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSearch = database.prepare(`
      INSERT INTO incident_search (
        incident_id, title, summary, root_cause, resolution,
        service_tags, custom_tags, notes
      ) VALUES (?, ?, '', '', '', ?, ?, '')
    `)
    database.exec('BEGIN IMMEDIATE')
    try {
      for (let index = 0; index < count; index += 1) {
        const matching = index % 2 === 0
        const id = `seed-${index}`
        const title = matching ? `nginx timeout ${index}` : `disk report ${index}`
        const serviceTags = matching ? ['nginx'] : ['storage']
        const customTags = matching ? ['production'] : ['test']
        insertIncident.run(
          id,
          title,
          `server-${index % 8}`,
          'investigating',
          matching ? 'high' : 'low',
          JSON.stringify(serviceTags),
          JSON.stringify(customTags),
          'pending',
          'standard',
          Number(index % 101 === 0),
          Number(matching),
          1000 + index,
          1000 + index
        )
        insertSearch.run(
          id,
          title,
          serviceTags.join(' '),
          customTags.join(' ')
        )
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return
  }
  for (let index = 0; index < count; index += 1) {
    const matching = index % 2 === 0
    repository.create({
      title: matching ? `nginx timeout ${index}` : `disk report ${index}`,
      endpointRef: `server-${index % 8}`,
      severity: matching ? 'high' : 'low',
      serviceTags: matching ? ['nginx'] : ['storage'],
      customTags: matching ? ['production'] : ['test'],
      isFavorite: matching,
      isPinned: index % 101 === 0
    })
  }
}

test('creates, edits and transitions an incident transactionally', () => {
  const repository = createRepositoryHarness()
  const created = repository.create({
    title: 'Nginx 502',
    endpointRef: 'server-1',
    serviceTags: ['nginx']
  })
  repository.update(created.id, {
    summary: 'upstream timeout',
    customTags: ['production']
  })
  repository.addNote(created.id, 'upstream-a repeatedly timed out')
  repository.transition(created.id, {
    state: 'verifying',
    verificationStatus: 'pending'
  })
  repository.transition(created.id, {
    state: 'resolved',
    verificationStatus: 'passed_manual'
  })

  const detail = repository.get(created.id)
  assert.equal(detail.state, 'resolved')
  assert.equal(detail.summary, 'upstream timeout')
  assert.equal(
    repository.list({ query: 'upstream-a', page: 1, pageSize: 20 }).total,
    1
  )
  assert.deepEqual(
    detail.stateEvents.map(event => event.toState),
    ['investigating', 'verifying', 'resolved']
  )
})

test('searches and filters with stable pagination', () => {
  const repository = createRepositoryHarness()
  seedIncidents(repository, 120)
  const page = repository.list({
    query: 'nginx timeout',
    state: ['investigating'],
    severity: ['high'],
    serviceTags: ['nginx'],
    customTags: ['production'],
    updatedFrom: 1000,
    updatedTo: 9999999999999,
    favoriteOnly: true,
    page: 2,
    pageSize: 20
  })
  assert.equal(page.page, 2)
  assert.equal(page.pageSize, 20)
  assert.equal(page.items.length, 20)
  assert.ok(page.total >= 40)
  assert.ok(page.items.every(item => item.state === 'investigating'))
})

test('keeps ten thousand incidents pageable without loading all rows', () => {
  const repository = createRepositoryHarness()
  seedIncidents(repository, 10000)
  const startedAt = performance.now()
  const page = repository.list({
    query: 'nginx',
    page: 100,
    pageSize: 40
  })
  const duration = performance.now() - startedAt
  assert.equal(page.items.length, 40)
  assert.ok(page.total > 4000)
  assert.ok(duration < 3000, `paged query took ${duration}ms`)
})

test('rebuilds missing full text rows from incidents and notes', () => {
  const database = createRepositoryDatabaseHarness()
  const repository = createIncidentRepository({
    getDatabase: () => database
  })
  const incident = repository.create({ title: 'Disk alert' })
  repository.addNote(incident.id, 'inode exhaustion')
  database.prepare(
    'DELETE FROM incident_search WHERE incident_id = ?'
  ).run(incident.id)

  assert.equal(repository.ensureSearchIndex(), 1)
  assert.equal(
    repository.list({ query: 'inode', page: 1, pageSize: 20 }).total,
    1
  )
})

test('deduplicates, dismisses and reopens pending incident candidates', () => {
  const repository = createRepositoryHarness()
  const first = repository.upsertCandidate({
    fingerprint: 'fleet:server-1:nginx:failed',
    source: 'fleet-status',
    sourceRef: 'server-1:nginx',
    endpointRef: 'server-1',
    title: 'Nginx 服务异常',
    severity: 'high',
    summary: '服务状态为 failed',
    evidence: { service: 'nginx', state: 'failed' }
  })
  const repeated = repository.upsertCandidate({
    fingerprint: 'fleet:server-1:nginx:failed',
    source: 'fleet-status',
    sourceRef: 'server-1:nginx',
    endpointRef: 'server-1',
    title: 'Nginx 服务仍然异常',
    severity: 'critical',
    summary: '服务持续为 failed',
    evidence: { service: 'nginx', state: 'failed', checks: 2 }
  })

  assert.equal(repeated.id, first.id)
  assert.equal(repeated.occurrenceCount, 2)
  assert.equal(repeated.severity, 'critical')
  assert.equal(repository.listCandidates({ status: ['pending'] }).total, 1)

  assert.equal(repository.dismissCandidate(first.id).status, 'dismissed')
  assert.equal(repository.listCandidates({ status: ['pending'] }).total, 0)
  assert.equal(repository.reopenCandidate(first.id).status, 'pending')
})

test('converts a candidate and appends an idempotent incident timeline', () => {
  const repository = createRepositoryHarness()
  const candidate = repository.upsertCandidate({
    fingerprint: 'operations:server-1:task-1',
    source: 'operations',
    sourceRef: 'task-1',
    endpointRef: 'server-1',
    title: '端口诊断超时',
    severity: 'medium',
    summary: '只读诊断任务超时',
    evidence: { taskStatus: 'timed-out' }
  })

  const incident = repository.convertCandidate(candidate.id, {
    title: '端口诊断超时',
    endpointRef: 'server-1',
    severity: 'medium',
    summary: '只读诊断任务超时'
  })

  assert.equal(incident.timelineEvents.length, 1)
  assert.equal(incident.timelineEvents[0].sourceRef, 'task-1')
  assert.equal(repository.getCandidate(candidate.id).status, 'converted')
  assert.equal(repository.getCandidate(candidate.id).incidentId, incident.id)

  repository.appendTimelineEvent(incident.id, {
    kind: 'diagnostic',
    source: 'operations',
    sourceRef: 'task-2',
    title: '服务诊断',
    body: 'systemd 状态采集完成',
    metadata: { taskStatus: 'completed' }
  })
  repository.appendTimelineEvent(incident.id, {
    kind: 'diagnostic',
    source: 'operations',
    sourceRef: 'task-2',
    title: '服务诊断重复回调',
    body: '这条重复回调不应新增记录',
    metadata: { taskStatus: 'completed' }
  })

  const detail = repository.get(incident.id)
  assert.equal(detail.timelineEvents.length, 2)
  assert.equal(detail.timelineEvents[1].title, '服务诊断')
})

test('deletes an incident and dependent rows while preserving its candidate', () => {
  const repository = createRepositoryHarness()
  const candidate = repository.upsertCandidate({
    fingerprint: 'operations:server-1:delete-test',
    source: 'operations',
    sourceRef: 'delete-test',
    endpointRef: 'server-1',
    title: 'Delete test',
    severity: 'medium',
    summary: 'Candidate remains available'
  })
  const incident = repository.convertCandidate(candidate.id, {
    title: 'Delete test incident',
    endpointRef: 'server-1'
  })
  repository.addNote(incident.id, 'Local note')
  repository.appendTimelineEvent(incident.id, {
    kind: 'note',
    source: 'manual',
    title: 'Local event'
  })

  assert.deepEqual(repository.delete(incident.id), {
    deleted: true,
    incidentId: incident.id
  })
  assert.throws(
    () => repository.get(incident.id),
    error => error.code === 'INCIDENT_NOT_FOUND'
  )
  assert.equal(repository.list({ page: 1, pageSize: 20 }).total, 0)
  assert.equal(repository.getCandidate(candidate.id).incidentId, '')
  assert.equal(repository.getCandidate(candidate.id).status, 'converted')
})
