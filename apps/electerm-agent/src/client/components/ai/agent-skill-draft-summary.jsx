import { CheckCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Tag, Typography } from 'antd'

const e = window.translate

function list (value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : []
}

export function getAgentSkillDraftSummary ({
  draft,
  generated,
  validation
} = {}) {
  const permissions = list(
    generated?.requestedPermissions || draft?.requestedPermissions
  )
  const risk = draft?.riskSummary || {}
  const validationState = validation?.valid === false
    ? 'failed'
    : validation?.valid === true || draft?.valid === true
      ? 'validated'
      : 'review-required'
  const safetyStatus = risk.level === 'risky' || risk.hasExecutableArtifacts
    ? 'risk-review'
    : 'bounded-draft'

  return {
    name: draft?.name || draft?.skillId || draft?.id || '',
    purpose: generated?.summary || draft?.description || '',
    triggers: list(draft?.triggers),
    capabilityCount: permissions.length,
    safetyStatus,
    validationState,
    enabled: false
  }
}

function statusTag (summary) {
  if (summary.validationState === 'failed') {
    return <Tag color='error'>{e('shellpilotSkillValidationFailed')}</Tag>
  }
  if (summary.safetyStatus === 'risk-review') {
    return <Tag color='warning'>{e('shellpilotSkillRiskReview')}</Tag>
  }
  return (
    <Tag color='success' icon={<CheckCircleOutlined />}>
      {e('shellpilotSkillSafetyChecked')}
    </Tag>
  )
}

export default function AgentSkillDraftSummary (props) {
  const summary = getAgentSkillDraftSummary(props)
  return (
    <div
      className='agent-skill-draft-summary'
      data-testid='agent-skill-draft-summary'
    >
      <div className='agent-skill-draft-summary-heading'>
        <div>
          <Typography.Text type='secondary'>
            {e('shellpilotSkillGeneratedResult')}
          </Typography.Text>
          <Typography.Title level={4}>{summary.name}</Typography.Title>
        </div>
        <div className='agent-skill-draft-summary-status'>
          <Tag icon={<SafetyCertificateOutlined />}>
            {e('shellpilotSkillDisabledDraft')}
          </Tag>
          {statusTag(summary)}
        </div>
      </div>
      <Typography.Paragraph className='agent-skill-draft-purpose'>
        {summary.purpose}
      </Typography.Paragraph>
      <dl className='agent-skill-draft-facts'>
        <div>
          <dt>{e('shellpilotSkillTriggers')}</dt>
          <dd>{summary.triggers.join('、') || e('shellpilotSkillNone')}</dd>
        </div>
        <div>
          <dt>{e('shellpilotSkillCapabilities')}</dt>
          <dd>{e('shellpilotSkillCapabilityCount').replace('{count}', summary.capabilityCount)}</dd>
        </div>
        <div>
          <dt>{e('shellpilotSkillValidationState')}</dt>
          <dd>
            {summary.validationState === 'failed'
              ? e('shellpilotSkillValidationFailed')
              : e('shellpilotSkillValidationPassed')}
          </dd>
        </div>
      </dl>
    </div>
  )
}
