import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select } from 'antd'

const e = window.translate

const ROW_HEIGHT = 36
const VIEWPORT_HEIGHT = 432
const OVERSCAN = 10
const AUTOSAVE_DELAY = 800

function cloneDraft (value) {
  return JSON.parse(JSON.stringify(value || {}))
}

export default function SpreadsheetPreview ({ source, onSave }) {
  const [draft, setDraft] = useState(() => cloneDraft(source))
  const [tableIndex, setTableIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [filter, setFilter] = useState('')
  const [sortColumn, setSortColumn] = useState(-1)
  const [dirty, setDirty] = useState(false)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    setDraft(cloneDraft(source))
    setTableIndex(0)
    setScrollTop(0)
    setDirty(false)
  }, [source])

  useEffect(() => {
    if (!dirty || !saveRef.current) return undefined
    const timer = setTimeout(async () => {
      await saveRef.current(cloneDraft(draft))
      setDirty(false)
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [draft, dirty])

  const tables = draft.tables || []
  const table = tables[tableIndex] || { columns: [], rows: [] }
  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase()
    let next = (table.rows || []).map((row, originalIndex) => ({
      row,
      originalIndex
    }))
    if (query) {
      next = next.filter(item => item.row.some(cell => (
        String(cell ?? '').toLowerCase().includes(query)
      )))
    }
    if (sortColumn >= 0) {
      next = [...next].sort((left, right) => (
        String(left.row[sortColumn] ?? '').localeCompare(
          String(right.row[sortColumn] ?? ''),
          'zh-CN',
          { numeric: true }
        )
      ))
    }
    return next
  }, [filter, sortColumn, table.rows])

  const visibleStart = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN
  )
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2
  const visibleEnd = Math.min(rows.length, visibleStart + visibleCount)
  const visibleRows = rows.slice(visibleStart, visibleEnd)

  const updateCell = (originalIndex, columnIndex, value) => {
    setDraft(current => {
      const next = cloneDraft(current)
      next.tables[tableIndex].rows[originalIndex][columnIndex] = value
      setDirty(true)
      return next
    })
  }

  return (
    <div className='artifact-spreadsheet-preview'>
      <div className='artifact-spreadsheet-toolbar'>
        <Select
          value={tableIndex}
          options={tables.map((item, index) => ({
            value: index,
            label: item.title || e('shellpilotArtifactTableLabel')
              .replace('{index}', index + 1)
          }))}
          onChange={value => {
            setTableIndex(value)
            setScrollTop(0)
          }}
          aria-label={e('shellpilotArtifactSelectTable')}
        />
        <Input.Search
          value={filter}
          onChange={event => setFilter(event.target.value)}
          placeholder={e('shellpilotArtifactFilterTable')}
          allowClear
        />
        <Select
          value={sortColumn}
          options={[
            { value: -1, label: e('shellpilotArtifactNoSort') },
            ...(table.columns || []).map((column, index) => ({
              value: index,
              label: e('shellpilotArtifactSortBy')
                .replace('{column}', column)
            }))
          ]}
          onChange={setSortColumn}
          aria-label={e('shellpilotArtifactSort')}
        />
        <Button disabled>
          {e('shellpilotArtifactFilteredRows').replace('{count}', rows.length)}
        </Button>
        <span>
          {dirty
            ? e('shellpilotArtifactAutosavePending')
            : e('shellpilotSaved')}
        </span>
      </div>
      <div className='artifact-grid-header'>
        {(table.columns || []).map((column, index) => (
          <strong key={`${column}-${index}`}>
            {column || e('shellpilotArtifactColumnLabel')
              .replace('{index}', index + 1)}
          </strong>
        ))}
      </div>
      <div
        className='artifact-grid-viewport'
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className='artifact-grid-spacer'
          style={{ height: rows.length * ROW_HEIGHT }}
        >
          {visibleRows.map(({ row, originalIndex }, offset) => (
            <div
              className='artifact-grid-row'
              key={originalIndex}
              style={{
                height: ROW_HEIGHT,
                transform: `translateY(${(visibleStart + offset) * ROW_HEIGHT}px)`
              }}
            >
              {(table.columns || []).map((column, columnIndex) => (
                <div
                  key={`${columnIndex}-${column}`}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={event => updateCell(
                    originalIndex,
                    columnIndex,
                    event.currentTarget.textContent || ''
                  )}
                >
                  {String(row[columnIndex] ?? '')}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
