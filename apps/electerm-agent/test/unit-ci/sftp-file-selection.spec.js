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
