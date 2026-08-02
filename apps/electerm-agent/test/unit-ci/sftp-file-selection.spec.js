import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextSftpSelectionId,
  preserveSftpDraftItems,
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

test('keeps an unfinished new-item draft across a background refresh', () => {
  const draft = {
    name: '',
    nameTemp: 'release-notes',
    isDirectory: true,
    isEditing: true,
    type: 'remote'
  }
  const refreshed = [remoteFile('new-a', 'a.log')]

  assert.deepEqual(
    preserveSftpDraftItems([draft, remoteFile('old-a', 'a.log')], refreshed),
    [draft, ...refreshed]
  )
})

test('does not retain committed or cancelled rows during refresh', () => {
  const refreshed = [remoteFile('new-a', 'a.log')]

  assert.equal(
    preserveSftpDraftItems([
      { ...remoteFile('old-a', 'a.log'), isEditing: true },
      { name: '', isEditing: false, type: 'remote' }
    ], refreshed),
    refreshed
  )
})

test('keyboard navigation advances from the focused row instead of stale selection', () => {
  const files = [
    remoteFile('a', 'a.log'),
    remoteFile('b', 'b.log'),
    remoteFile('c', 'c.log')
  ]

  assert.equal(nextSftpSelectionId(files, new Set(['c']), 'next', 'a'), 'b')
  assert.equal(nextSftpSelectionId(files, new Set(['a']), 'previous', 'a'), 'c')
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

  assert.match(source, /event\.key === 'ArrowUp'[\s\S]*this\.props\.selectPrev\(type, currentId, focusSelectedRow\)/)
  assert.match(source, /event\.key === 'ArrowDown'[\s\S]*this\.props\.selectNext\(type, currentId, focusSelectedRow\)/)

  const shortcutSource = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../src/client/components/shortcuts/shortcut-control.jsx'
    ),
    'utf8'
  )
  assert.match(shortcutSource, /sftpRowHandledKeys = new Set\(\['ArrowDown', 'ArrowUp', 'Enter', ' '\]\)/)
  assert.match(shortcutSource, /'\[role="dialog"\], \.operations-toolkit-workspace'/)
  assert.match(shortcutSource, /if \(isSftpRowKeyboardEvent\(e\) \|\| isForegroundWorkspaceKeyboardEvent\(e\)\) \{\s*return\s*\}/)
  assert.match(source, /document\.getElementById\('file-' \+ nextId\)\?\.focus\(\)/)
  assert.match(entry, /this\.setState\(\{[\s\S]*selectedFiles:[\s\S]*\}, \(\) => onSelected\?\.\(nextFile\.id\)\)/)
  assert.match(source, /event\.key === 'Enter'[\s\S]*this\.transferOrEnterDirectory\(event\)/)
  assert.match(source, /event\.key === ' '[\s\S]*this\.onClick\(event\)/)
  assert.match(entry, /'selectPrev'/)
  assert.match(entry, /'selectNext'/)
  assert.doesNotMatch(source, /keyboardSelectedFiles|rowSelectionState/)
})
