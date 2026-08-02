import assert from 'node:assert/strict'
import test from 'node:test'
import {
  reconcileSelectedFileIds
} from '../../src/client/components/sftp/file-selection.js'

const remoteFile = (id, name) => ({
  id,
  name,
  path: '/root',
  type: 'remote'
})

test('returns an empty selection when nothing was selected', () => {
  const nextFiles = [remoteFile('new-a', 'a.log')]

  assert.deepEqual(
    [...reconcileSelectedFileIds([], nextFiles, new Set())],
    []
  )
})

test('maps selected files to their refreshed ids', () => {
  const previousFiles = [
    remoteFile('old-a', 'a.log'),
    remoteFile('old-b', 'b.log')
  ]
  const nextFiles = [
    remoteFile('new-a', 'a.log'),
    remoteFile('new-b', 'b.log')
  ]

  assert.deepEqual(
    [...reconcileSelectedFileIds(
      previousFiles,
      nextFiles,
      new Set(['old-a', 'old-b'])
    )],
    ['new-a', 'new-b']
  )
})

test('does not select files that appeared after the original selection', () => {
  const previousFiles = [remoteFile('old-a', 'a.log')]
  const nextFiles = [
    remoteFile('new-a', 'a.log'),
    remoteFile('new-c', 'c.log')
  ]

  assert.deepEqual(
    [...reconcileSelectedFileIds(
      previousFiles,
      nextFiles,
      new Set(['old-a'])
    )],
    ['new-a']
  )
})

test('drops selected files that disappeared during refresh', () => {
  const previousFiles = [
    remoteFile('old-a', 'a.log'),
    remoteFile('old-b', 'b.log')
  ]
  const nextFiles = [remoteFile('new-a', 'a.log')]

  assert.deepEqual(
    [...reconcileSelectedFileIds(
      previousFiles,
      nextFiles,
      new Set(['old-a', 'old-b'])
    )],
    ['new-a']
  )
})

test('SFTP keyboard rows reuse the existing selection methods', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const source = fs.readFileSync(path.resolve(
    import.meta.dirname,
    '../../src/client/components/sftp/file-item.jsx'
  ), 'utf8')
  const entry = fs.readFileSync(path.resolve(
    import.meta.dirname,
    '../../src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')

  assert.match(source, /event\.key === 'ArrowUp'[\s\S]*this\.props\.selectPrev\(type\)/)
  assert.match(source, /event\.key === 'ArrowDown'[\s\S]*this\.props\.selectNext\(type\)/)
  assert.match(source, /event\.key === 'Enter'[\s\S]*this\.transferOrEnterDirectory\(event\)/)
  assert.match(source, /event\.key === ' '[\s\S]*this\.onClick\(event\)/)
  assert.match(entry, /'selectPrev'/)
  assert.match(entry, /'selectNext'/)
  assert.doesNotMatch(source, /keyboardSelectedFiles|rowSelectionState/)
})
