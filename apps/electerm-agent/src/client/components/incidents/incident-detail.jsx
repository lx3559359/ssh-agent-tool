import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Tag
} from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  SaveOutlined,
  StarFilled,
  StarOutlined,
  VerticalAlignTopOutlined
} from '@ant-design/icons'

const e = window.translate

const transitionActions = {
  investigating: [
    'waiting_action',
    'verifying',
    'unresolved',
    'false_positive'
  ],
  waiting_action: ['investigating', 'verifying', 'unresolved'],
  verifying: ['investigating', 'resolved', 'unresolved', 'false_positive'],
  resolved: ['archived', 'investigating'],
  unresolved: ['archived', 'investigating'],
  false_positive: ['archived', 'investigating'],
  archived: ['investigating']
}

const blankDraft = {
  title: '',
  endpointRef: '',
  severity: 'medium',
  serviceTags: [],
  customTags: [],
  summary: '',
  rootCause: '',
  resolution: '',
  storagePolicy: 'standard',
  isFavorite: false,
  isPinned: false
}

function toIncidentDraft (incident) {
  if (!incident) return { ...blankDraft }
  return {
    title: incident.title || '',
    endpointRef: incident.endpointRef || '',
    severity: incident.severity || 'medium',
    serviceTags: [...(incident.serviceTags || [])],
    customTags: [...(incident.customTags || [])],
    summary: incident.summary || '',
    rootCause: incident.rootCause || '',
    resolution: incident.resolution || '',
    storagePolicy: incident.storagePolicy || 'standard',
    isFavorite: Boolean(incident.isFavorite),
    isPinned: Boolean(incident.isPinned)
  }
}

function formatTime (value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export default function IncidentDetail ({
  store,
  creating,
  onCreated,
  onBack,
  onCancelCreate,
  onDirtyChange
}) {
  const incident = store.activeIncident
  const [draft, setDraft] = useState(toIncidentDraft(incident))
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')
  const [verificationStatus, setVerificationStatus] = useState('')

  useEffect(() => {
    setDraft(toIncidentDraft(incident))
    setDirty(false)
    setNote('')
    setVerificationStatus(
      ['passed_manual', 'passed_auto'].includes(incident?.verificationStatus)
        ? incident.verificationStatus
        : ''
    )
    onDirtyChange?.(false)
  }, [creating, incident?.id, incident?.updatedAt])

  const endpointOptions = useMemo(
    () => (store.bookmarks || []).map((bookmark, index) => ({
      value: String(bookmark.id || bookmark._id || `bookmark-${index}`),
      label: bookmark.title || bookmark.name || bookmark.host || e('unknown')
    })),
    [store.bookmarks]
  )

  const updateDraft = patch => {
    setDraft(current => ({ ...current, ...patch }))
    if (!dirty) {
      setDirty(true)
      onDirtyChange?.(true)
    }
  }

  const save = async () => {
    if (!draft.title.trim()) {
      Modal.warning({
        title: e('shellpilotIncidentTitleRequired')
      })
      return
    }
    const saved = creating
      ? await store.createIncidentArchive(draft)
      : await store.updateActiveIncident(draft)
    if (!saved) return
    setDirty(false)
    onDirtyChange?.(false)
    onCreated?.(saved)
  }

  const ensureDraftSaved = () => {
    if (!dirty) return true
    Modal.warning({
      title: e('shellpilotIncidentSaveBeforeAction')
    })
    return false
  }

  const transition = async (state, overrideVerification) => {
    if (!ensureDraftSaved()) return
    let nextVerification = overrideVerification || 'pending'
    if (state === 'resolved') {
      if (!['passed_manual', 'passed_auto'].includes(verificationStatus)) {
        Modal.warning({
          title: e('shellpilotIncidentVerificationRequired')
        })
        return
      }
      nextVerification = verificationStatus
    }
    await store.transitionActiveIncident({
      state,
      verificationStatus: nextVerification
    })
  }

  const addNote = async () => {
    if (!ensureDraftSaved()) return
    const body = note.trim()
    if (!body) return
    const updated = await store.addActiveIncidentNote(body)
    if (updated) setNote('')
  }

  const handleNoteKeyDown = event => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault()
      addNote()
    }
  }

  if (!creating && !incident) {
    return (
      <section className='incident-detail-panel'>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={e('shellpilotIncidentSelectPrompt')}
        />
      </section>
    )
  }

  const nextStates = incident
    ? transitionActions[incident.state] || []
    : []

  return (
    <section className='incident-detail-panel'>
      <Button
        type='text'
        className='incident-mobile-back'
        icon={<ArrowLeftOutlined />}
        onClick={onBack}
      >
        {e('shellpilotIncidentBackToList')}
      </Button>
      <header className='incident-detail-header'>
        <div>
          <h2>
            {creating
              ? e('shellpilotIncidentCreate')
              : incident.title}
          </h2>
          {!creating && (
            <span>{formatTime(incident.updatedAt)}</span>
          )}
        </div>
        <div className='incident-detail-actions'>
          {creating && (
            <Button onClick={onCancelCreate}>
              {e('cancel')}
            </Button>
          )}
          <Button
            type='primary'
            icon={<SaveOutlined />}
            loading={store.incidentSaving}
            disabled={!dirty && !creating}
            onClick={save}
          >
            {e('save')}
          </Button>
        </div>
      </header>

      <div className='incident-form-section incident-form-basics'>
        <label>
          <span>{e('shellpilotIncidentTitle')}</span>
          <Input
            maxLength={200}
            value={draft.title}
            onChange={event => updateDraft({ title: event.target.value })}
          />
        </label>
        <label>
          <span>{e('shellpilotIncidentServer')}</span>
          <Select
            allowClear
            showSearch
            optionFilterProp='label'
            value={draft.endpointRef || undefined}
            options={endpointOptions}
            onChange={value => updateDraft({ endpointRef: value || '' })}
          />
        </label>
        <label>
          <span>{e('shellpilotIncidentSeverity')}</span>
          <Select
            value={draft.severity}
            options={['critical', 'high', 'medium', 'low'].map(value => ({
              value,
              label: e(`shellpilotIncidentSeverity_${value}`)
            }))}
            onChange={value => updateDraft({ severity: value })}
          />
        </label>
        <div className='incident-flag-controls'>
          <label>
            <Switch
              size='small'
              checked={draft.isFavorite}
              onChange={value => updateDraft({ isFavorite: value })}
            />
            {draft.isFavorite ? <StarFilled /> : <StarOutlined />}
            <span>{e('shellpilotIncidentFavorite')}</span>
          </label>
          <label>
            <Switch
              size='small'
              checked={draft.isPinned}
              onChange={value => updateDraft({ isPinned: value })}
            />
            <VerticalAlignTopOutlined />
            <span>{e('shellpilotIncidentPinned')}</span>
          </label>
        </div>
        <label className='incident-form-wide'>
          <span>{e('shellpilotIncidentServiceTags')}</span>
          <Select
            mode='tags'
            maxTagCount='responsive'
            value={draft.serviceTags}
            onChange={value => updateDraft({ serviceTags: value })}
          />
        </label>
        <label className='incident-form-wide'>
          <span>{e('shellpilotIncidentCustomTags')}</span>
          <Select
            mode='tags'
            maxTagCount='responsive'
            value={draft.customTags}
            onChange={value => updateDraft({ customTags: value })}
          />
        </label>
      </div>

      <div className='incident-form-section'>
        <h3>{e('shellpilotIncidentSummary')}</h3>
        <Input.TextArea
          maxLength={20000}
          autoSize={{ minRows: 3, maxRows: 10 }}
          value={draft.summary}
          onChange={event => updateDraft({ summary: event.target.value })}
        />
      </div>

      <div className='incident-form-section incident-analysis-grid'>
        <label>
          <span>{e('shellpilotIncidentRootCause')}</span>
          <Input.TextArea
            maxLength={20000}
            autoSize={{ minRows: 4, maxRows: 12 }}
            value={draft.rootCause}
            onChange={event => updateDraft({ rootCause: event.target.value })}
          />
        </label>
        <label>
          <span>{e('shellpilotIncidentResolution')}</span>
          <Input.TextArea
            maxLength={20000}
            autoSize={{ minRows: 4, maxRows: 12 }}
            value={draft.resolution}
            onChange={event => updateDraft({ resolution: event.target.value })}
          />
        </label>
      </div>

      {!creating && (
        <div className='incident-form-section'>
          <h3>{e('shellpilotIncidentStateAndVerification')}</h3>
          <div className='incident-current-state'>
            <Tag>{e(`shellpilotIncidentState_${incident.state}`)}</Tag>
            <span>
              {e(`shellpilotIncidentVerification_${incident.verificationStatus}`)}
            </span>
          </div>
          {nextStates.includes('resolved') && (
            <label className='incident-verification-select'>
              <span>{e('shellpilotIncidentVerificationRequired')}</span>
              <Select
                value={verificationStatus || undefined}
                options={[
                  {
                    value: 'passed_manual',
                    label: e('shellpilotIncidentManualVerification')
                  },
                  {
                    value: 'passed_auto',
                    label: e('shellpilotIncidentAutomaticVerification')
                  }
                ]}
                onChange={setVerificationStatus}
              />
            </label>
          )}
          <div className='incident-transition-actions'>
            {nextStates.map(state => (
              <Button
                key={state}
                disabled={dirty}
                onClick={() => transition(state)}
              >
                {e(`shellpilotIncidentMoveTo_${state}`)}
              </Button>
            ))}
            {nextStates.includes('unresolved') && (
              <Button
                disabled={dirty}
                onClick={() => transition('unresolved', 'mitigated')}
              >
                {e('shellpilotIncidentTemporaryMitigation')}
              </Button>
            )}
          </div>
        </div>
      )}

      {!creating && (
        <div className='incident-form-section'>
          <h3>{e('shellpilotIncidentNotes')}</h3>
          <Input.TextArea
            maxLength={20000}
            autoSize={{ minRows: 3, maxRows: 8 }}
            value={note}
            placeholder={e('shellpilotIncidentNotePlaceholder')}
            onChange={event => setNote(event.target.value)}
            onKeyDown={handleNoteKeyDown}
          />
          <div className='incident-note-submit'>
            <span>{e('shellpilotIncidentNoteShortcut')}</span>
            <Button
              type='primary'
              disabled={!note.trim() || dirty}
              onClick={addNote}
            >
              {e('shellpilotIncidentAddNote')}
            </Button>
          </div>
          <div className='incident-notes'>
            {(incident.notes || []).map(item => (
              <article key={item.id} className='incident-note'>
                <header>
                  <time>{formatTime(item.createdAt)}</time>
                  <Popconfirm
                    title={e('shellpilotIncidentDeleteNoteConfirm')}
                    onConfirm={() => store.deleteActiveIncidentNote(item.id)}
                  >
                    <Button
                      type='text'
                      size='small'
                      disabled={dirty}
                      aria-label={e('delete')}
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>
                </header>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      )}

    </section>
  )
}
