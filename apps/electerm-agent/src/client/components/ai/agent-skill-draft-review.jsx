import { Alert, Button, Collapse, Descriptions, List, Typography } from 'antd'
import { useEffect, useState } from 'react'
import AgentSkillDraftSummary from './agent-skill-draft-summary.jsx'
import AgentSkillEditor from './agent-skill-editor.jsx'

const e = window.translate

function lines (items = []) {
  return Array.isArray(items) && items.length
    ? items.join('\n')
    : e('shellpilotSkillNone')
}

export default function AgentSkillDraftReview ({
  draft,
  generated,
  validation,
  onDraftChange,
  onValidate
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const errors = validation?.errors || draft?.errors || []
  const warnings = validation?.warnings || draft?.warnings || []

  useEffect(() => {
    if (errors.length) setDetailsOpen(true)
  }, [errors.length])

  if (!draft) return null
  const fileDigests = generated?.fileDigests || {}
  const details = (
    <div
      className='agent-skill-technical-details'
      data-testid='agent-skill-technical-details'
    >
      <Descriptions bordered size='small' column={1}>
        <Descriptions.Item label='Digest'>
          <Typography.Text code copyable>{draft.packageDigest}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label={e('shellpilotSkillPermissions')}>
          <pre>{lines(generated?.requestedPermissions || draft.requestedPermissions)}</pre>
        </Descriptions.Item>
        <Descriptions.Item label={e('shellpilotSkillRisk')}>
          <pre>{lines(generated?.riskSummary)}</pre>
        </Descriptions.Item>
      </Descriptions>
      <Typography.Title level={5}>{e('shellpilotSkillChangedFiles')}</Typography.Title>
      <List
        size='small'
        dataSource={Object.entries(fileDigests)}
        renderItem={([filePath, digest]) => (
          <List.Item>
            <Typography.Text>{filePath}</Typography.Text>
            <Typography.Text code>{digest.slice(0, 12)}</Typography.Text>
          </List.Item>
        )}
      />
      {errors.length > 0 && (
        <Alert
          type='error'
          showIcon
          message={e('shellpilotSkillErrors')}
          description={<pre>{lines(errors.map(item => item.message || String(item)))}</pre>}
        />
      )}
      {warnings.length > 0 && (
        <Alert
          type='warning'
          showIcon
          message={e('shellpilotSkillWarnings')}
          description={<pre>{lines(warnings.map(item => item.message || String(item)))}</pre>}
        />
      )}
      {validation?.valid === false && (
        <Button className='mg1b' onClick={onValidate}>
          {e('shellpilotSkillRetryValidation')}
        </Button>
      )}
      {detailsOpen && (
        <AgentSkillEditor
          skill={draft}
          validation={validation}
          onSaved={onDraftChange}
        />
      )}
    </div>
  )

  return (
    <section className='agent-skill-draft-review' aria-live='polite'>
      <AgentSkillDraftSummary
        draft={draft}
        generated={generated}
        validation={validation}
      />
      <Collapse
        activeKey={detailsOpen ? ['technical'] : []}
        onChange={keys => setDetailsOpen(keys.includes('technical'))}
        items={[{
          key: 'technical',
          label: e('shellpilotSkillTechnicalDetails'),
          children: details
        }]}
      />
    </section>
  )
}
