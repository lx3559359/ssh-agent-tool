import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Popconfirm,
  Select,
  Spin,
  Tag
} from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined
} from '@ant-design/icons'

const e = window.translate

const sourceLabelKeys = {
  'fleet-status': 'shellpilotIncidentSourceFleet',
  operations: 'shellpilotIncidentSourceOperations',
  'safety-operation': 'shellpilotIncidentSourceSafety',
  'ai-diagnostic': 'shellpilotIncidentSourceAi',
  manual: 'shellpilotIncidentSourceManual'
}

const getSourceLabel = source => sourceLabelKeys[source]
  ? e(sourceLabelKeys[source])
  : source

function formatTime (value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function toDraft (candidate) {
  const service = candidate?.evidence?.service
  return {
    title: candidate?.title || '',
    endpointRef: candidate?.endpointRef || '',
    severity: candidate?.severity || 'medium',
    serviceTags: service ? [service] : [],
    customTags: [e('shellpilotIncidentAutoDetectedTag')],
    summary: candidate?.summary || '',
    rootCause: '',
    resolution: '',
    storagePolicy: 'standard',
    isFavorite: false,
    isPinned: false
  }
}

export default function IncidentCandidateList ({
  store,
  onOpenIncident
}) {
  const severityOptions = ['critical', 'high', 'medium', 'low'].map(value => ({
    value,
    label: e(`shellpilotIncidentSeverity_${value}`)
  }))
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState('pending')
  const candidates = store.incidentCandidates || []
  const selected = useMemo(
    () => candidates.find(item => item.id === selectedId) || candidates[0],
    [candidates, selectedId]
  )
  const [draft, setDraft] = useState(toDraft(selected))

  useEffect(() => {
    if (!selectedId && candidates[0]) setSelectedId(candidates[0].id)
    if (selectedId && !candidates.some(item => item.id === selectedId)) {
      setSelectedId(candidates[0]?.id || '')
    }
  }, [candidates, selectedId])

  useEffect(() => {
    setDraft(toDraft(selected))
  }, [selected?.id, selected?.updatedAt])

  const confirm = async () => {
    if (!selected || !draft.title.trim()) return
    const incident = await store.convertIncidentCandidate(selected.id, draft)
    if (incident) onOpenIncident?.(incident.id)
  }

  const dismiss = async () => {
    if (!selected) return
    await store.dismissIncidentCandidate(selected.id)
  }

  const reopen = async () => {
    if (!selected) return
    await store.reopenIncidentCandidate(selected.id)
  }

  const changeStatus = value => {
    setStatus(value)
    setSelectedId('')
    store.loadIncidentCandidates({
      status: [value],
      page: 1
    })
  }

  const statusSelector = (
    <Select
      className='incident-candidate-status-select'
      value={status}
      options={[
        {
          value: 'pending',
          label: e('shellpilotIncidentPendingCandidates')
        },
        {
          value: 'dismissed',
          label: e('shellpilotIncidentCandidateIgnored')
        }
      ]}
      onChange={changeStatus}
    />
  )

  if (store.incidentCandidateLoading && !candidates.length) {
    return (
      <section className='incident-candidate-loading'>
        <Spin />
      </section>
    )
  }

  if (!candidates.length) {
    return (
      <section className='incident-candidate-empty'>
        {statusSelector}
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={e(
            status === 'dismissed'
              ? 'shellpilotIncidentCandidateIgnoredEmpty'
              : 'shellpilotIncidentCandidateEmpty'
          )}
        >
          <Button
            icon={<ReloadOutlined />}
            onClick={() => store.loadIncidentCandidates({
              status: [status],
              page: 1
            })}
          >
            {e('shellpilotIncidentCandidateRecheck')}
          </Button>
        </Empty>
      </section>
    )
  }

  return (
    <div className='incident-candidate-workspace'>
      <aside className='incident-candidate-list'>
        <header>
          <div>
            <strong>
              {e(
                status === 'dismissed'
                  ? 'shellpilotIncidentCandidateIgnored'
                  : 'shellpilotIncidentPendingCandidates'
              )}
            </strong>
            <span>{e('shellpilotIncidentCandidateSubtitle')}</span>
          </div>
          {statusSelector}
          <Button
            type='text'
            aria-label={e('shellpilotIncidentCandidateRefresh')}
            icon={<ReloadOutlined />}
            loading={store.incidentCandidateLoading}
            onClick={() => store.loadIncidentCandidates()}
          />
        </header>
        <div className='incident-candidate-list-scroll'>
          {candidates.map(candidate => (
            <button
              type='button'
              key={candidate.id}
              className={candidate.id === selected?.id ? 'active' : ''}
              onClick={() => setSelectedId(candidate.id)}
            >
              <i className={`incident-severity incident-severity-${candidate.severity}`} />
              <span>
                <strong>{candidate.title}</strong>
                <small>
                  {getSourceLabel(candidate.source)}
                  {candidate.endpointRef ? ` · ${candidate.endpointRef}` : ''}
                </small>
                <em>
                  {formatTime(candidate.lastSeenAt)}
                  {candidate.occurrenceCount > 1
                    ? ` · ${e('shellpilotIncidentCandidateOccurrence')
                        .replace('{count}', candidate.occurrenceCount)}`
                    : ''}
                </em>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className='incident-candidate-review'>
        <header>
          <div>
            <h2>{e('shellpilotIncidentCandidateConfirmTitle')}</h2>
            <p>{e('shellpilotIncidentCandidateConfirmDescription')}</p>
          </div>
          <Tag>{getSourceLabel(selected.source)}</Tag>
        </header>

        <div className='incident-candidate-form'>
          <label>
            <span>{e('shellpilotIncidentTitle')}</span>
            <Input
              maxLength={200}
              value={draft.title}
              onChange={event => setDraft(current => ({
                ...current,
                title: event.target.value
              }))}
            />
          </label>
          <label>
            <span>{e('shellpilotIncidentSeverity')}</span>
            <Select
              value={draft.severity}
              options={severityOptions}
              onChange={severity => setDraft(current => ({
                ...current,
                severity
              }))}
            />
          </label>
          <label className='incident-candidate-form-wide'>
            <span>{e('shellpilotIncidentSummary')}</span>
            <Input.TextArea
              maxLength={20000}
              autoSize={{ minRows: 4, maxRows: 12 }}
              value={draft.summary}
              onChange={event => setDraft(current => ({
                ...current,
                summary: event.target.value
              }))}
            />
          </label>
        </div>

        <div className='incident-candidate-evidence'>
          <h3>{e('shellpilotIncidentCandidateEvidence')}</h3>
          <dl>
            {Object.entries(selected.evidence || {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value ?? '')}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <footer>
          {status === 'dismissed'
            ? (
              <Button icon={<ReloadOutlined />} onClick={reopen}>
                {e('shellpilotIncidentCandidateReopen')}
              </Button>
              )
            : (
              <Popconfirm
                title={e('shellpilotIncidentCandidateDismissTitle')}
                description={e('shellpilotIncidentCandidateDismissDescription')}
                okText={e('shellpilotIncidentCandidateDismiss')}
                cancelText={e('cancel')}
                onConfirm={dismiss}
              >
                <Button danger icon={<CloseOutlined />}>
                  {e('shellpilotIncidentCandidateDismiss')}
                </Button>
              </Popconfirm>
              )}
          {status === 'pending' && (
            <Button
              type='primary'
              icon={<CheckOutlined />}
              loading={store.incidentSaving}
              disabled={!draft.title.trim()}
              onClick={confirm}
            >
              {e('shellpilotIncidentCandidateConfirm')}
            </Button>
          )}
        </footer>
      </section>
    </div>
  )
}
