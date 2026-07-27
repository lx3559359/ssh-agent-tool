import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  RedoOutlined,
  UndoOutlined
} from '@ant-design/icons'

const e = window.translate

const { TextArea } = Input
const MAX_HISTORY = 50
const AUTOSAVE_DELAY = 800

function cloneDraft (value) {
  return JSON.parse(JSON.stringify(value || {}))
}

export default function DocumentPreview ({ source, onSave }) {
  const [draft, setDraft] = useState(() => cloneDraft(source))
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [dirty, setDirty] = useState(false)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    setDraft(cloneDraft(source))
    setHistory([])
    setFuture([])
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

  const commit = updater => {
    setDraft(current => {
      const next = cloneDraft(current)
      updater(next)
      setHistory(items => [...items, cloneDraft(current)].slice(-MAX_HISTORY))
      setFuture([])
      setDirty(true)
      return next
    })
  }

  const undo = () => {
    if (!history.length) return
    const previous = history.at(-1)
    setHistory(items => items.slice(0, -1))
    setFuture(items => [cloneDraft(draft), ...items].slice(0, MAX_HISTORY))
    setDraft(cloneDraft(previous))
    setDirty(true)
  }

  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setHistory(items => [...items, cloneDraft(draft)].slice(-MAX_HISTORY))
    setFuture(items => items.slice(1))
    setDraft(cloneDraft(next))
    setDirty(true)
  }

  const updateSection = (index, field, value) => {
    commit(next => {
      next.sections[index][field] = value
    })
  }

  const moveSection = (index, offset) => {
    commit(next => {
      const target = index + offset
      if (target < 0 || target >= next.sections.length) return
      const [section] = next.sections.splice(index, 1)
      next.sections.splice(target, 0, section)
    })
  }

  const removeSection = index => {
    commit(next => {
      next.sections.splice(index, 1)
    })
  }

  const addSection = () => {
    commit(next => {
      next.sections = Array.isArray(next.sections) ? next.sections : []
      next.sections.push({
        title: e('shellpilotArtifactNewSection'),
        content: ''
      })
    })
  }

  return (
    <div className='artifact-document-preview'>
      <div className='artifact-editor-toolbar'>
        <Button
          size='small'
          icon={<UndoOutlined />}
          disabled={!history.length}
          onClick={undo}
        >
          {e('shellpilotArtifactUndo')}
        </Button>
        <Button
          size='small'
          icon={<RedoOutlined />}
          disabled={!future.length}
          onClick={redo}
        >
          {e('shellpilotArtifactRedo')}
        </Button>
        <span>
          {dirty
            ? e('shellpilotArtifactAutosavePending')
            : e('shellpilotSaved')}
        </span>
      </div>
      <article className='artifact-document-page'>
        <Input
          className='artifact-document-title'
          value={draft.title || ''}
          onChange={event => commit(next => {
            next.title = event.target.value
          })}
          placeholder={e('shellpilotArtifactDocumentTitle')}
        />
        <TextArea
          value={draft.summary || ''}
          onChange={event => commit(next => {
            next.summary = event.target.value
          })}
          autoSize={{ minRows: 3, maxRows: 12 }}
          placeholder={e('shellpilotArtifactSummary')}
        />
        {(draft.sections || []).map((section, index) => (
          <section className='artifact-document-section' key={`${index}-${section.title}`}>
            <div className='artifact-document-section-heading'>
              <Input
                value={section.title || ''}
                onChange={event => updateSection(index, 'title', event.target.value)}
                placeholder={e('shellpilotArtifactSectionTitle')}
              />
              <Button
                type='text'
                aria-label={e('shellpilotArtifactMoveSectionUp')}
                icon={<ArrowUpOutlined />}
                disabled={index === 0}
                onClick={() => moveSection(index, -1)}
              />
              <Button
                type='text'
                aria-label={e('shellpilotArtifactMoveSectionDown')}
                icon={<ArrowDownOutlined />}
                disabled={index === draft.sections.length - 1}
                onClick={() => moveSection(index, 1)}
              />
              <Button
                type='text'
                danger
                aria-label={e('shellpilotArtifactDeleteSection')}
                title={e('shellpilotArtifactDeleteSection')}
                icon={<DeleteOutlined />}
                onClick={() => removeSection(index)}
              />
            </div>
            <TextArea
              value={section.content || ''}
              onChange={event => updateSection(index, 'content', event.target.value)}
              autoSize={{ minRows: 3, maxRows: 16 }}
              placeholder={e('shellpilotArtifactSectionContent')}
            />
          </section>
        ))}
        <Button icon={<PlusOutlined />} onClick={addSection}>
          {e('shellpilotArtifactAddSection')}
        </Button>
      </article>
    </div>
  )
}
