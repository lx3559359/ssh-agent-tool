import { Alert, Button, Input, Modal, Progress, Space, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import message from '../common/message'
import { createAgentSkillCreatorController } from './agent-skill-creator-controller.js'
import {
  enableAgentSkillDraft,
  validateAgentSkillDraft
} from './agent-skill-client.js'
import AgentSkillDraftReview from './agent-skill-draft-review.jsx'

const e = window.translate

const progressByState = {
  idle: 0,
  gathering: 15,
  generating: 55,
  validating: 85,
  'draft-ready': 100,
  failed: 100,
  cancelled: 0
}

export default function AgentSkillCreateModal ({
  open,
  onClose,
  onDraftReady,
  onManualEdit,
  onEnabled
}) {
  const controller = useMemo(
    () => createAgentSkillCreatorController(),
    []
  )
  const [requirements, setRequirements] = useState('')
  const [conversation, setConversation] = useState([])
  const [creatorState, setCreatorState] = useState(controller.getState())
  const [draft, setDraft] = useState(null)
  const [generated, setGenerated] = useState(null)
  const [validation, setValidation] = useState(null)

  useEffect(() => controller.subscribe(setCreatorState), [controller])

  useEffect(() => {
    if (!open) return
    controller.reset()
    setRequirements('')
    setConversation([])
    setDraft(null)
    setGenerated(null)
    setValidation(null)
  }, [controller, open])

  async function generate () {
    const text = requirements.trim()
    if (!text) return
    const nextConversation = [
      ...conversation,
      { role: 'user', content: text }
    ]
    setConversation(nextConversation)
    try {
      const result = await controller.generate({
        requirements: text,
        conversation: nextConversation,
        existingDraft: draft,
        config: window.store.config
      })
      setDraft(result.draft)
      setGenerated(result.generated)
      setValidation(null)
      setConversation(items => [
        ...items,
        { role: 'assistant', content: result.generated.summary }
      ])
      setRequirements('')
      onDraftReady?.(result.draft)
    } catch (error) {
      if (error.code !== 'SKILL_CREATOR_CANCELLED') message.error(error.message)
    }
  }

  async function validate () {
    if (!draft) return null
    try {
      const result = await validateAgentSkillDraft(draft.id)
      setValidation(result)
      return result
    } catch (error) {
      const failed = error.validation || {
        valid: false,
        errors: [{ message: error.message }],
        warnings: []
      }
      setValidation(failed)
      return failed
    }
  }

  function handleDraftChange (updated) {
    setDraft(updated)
    setValidation(null)
    onDraftReady?.(updated)
  }

  async function saveAndEnable () {
    const fresh = await validate()
    if (!fresh?.valid || fresh.packageDigest !== draft.packageDigest) return
    Modal.confirm({
      title: e('shellpilotSkillEnableConfirm'),
      content: (
        <div>
          <p>{e('shellpilotSkillEnableExplain')}</p>
          <p><b>Digest:</b> {fresh.packageDigest}</p>
          <p><b>{e('shellpilotSkillPermissions')}:</b> {(draft.requestedPermissions || []).join(', ') || e('shellpilotSkillNone')}</p>
          <pre>{JSON.stringify(draft.riskSummary || {}, null, 2)}</pre>
        </div>
      ),
      onOk: async () => {
        const enabled = await enableAgentSkillDraft(draft.id, fresh.packageDigest)
        onEnabled?.(enabled)
        onClose?.()
      }
    })
  }

  async function close () {
    await controller.cancel()
    onClose?.()
  }

  const busy = ['gathering', 'generating', 'validating']
    .includes(creatorState.status)
  const canEnable = Boolean(
    draft && validation && validation.valid &&
    validation.packageDigest === draft.packageDigest
  )

  return (
    <Modal
      title={e('shellpilotSkillCreateTitle')}
      open={open}
      onCancel={close}
      footer={null}
      width='min(1120px, 96vw)'
      destroyOnClose
    >
      <div className='agent-skill-create-modal'>
        <Typography.Paragraph>
          {e('shellpilotSkillCreateDescription')}
        </Typography.Paragraph>
        <div className='agent-skill-create-conversation' aria-live='polite'>
          {conversation.map((item, index) => (
            <div className={`agent-skill-create-message ${item.role}`} key={index}>
              <b>{item.role === 'user' ? e('shellpilotSkillYou') : 'AI'}:</b> {item.content}
            </div>
          ))}
        </div>
        <Input.TextArea
          aria-label={e('shellpilotSkillRequirements')}
          value={requirements}
          onChange={event => setRequirements(event.target.value)}
          placeholder={e('shellpilotSkillRequirementsPlaceholder')}
          autoSize={{ minRows: 3, maxRows: 8 }}
          disabled={busy}
        />
        <Space wrap className='agent-skill-create-actions'>
          <Button type='primary' loading={busy} disabled={!requirements.trim()} onClick={generate}>
            {draft
              ? e('shellpilotSkillContinueConversation')
              : e('shellpilotSkillGenerateDraft')}
          </Button>
          {busy && <Button onClick={() => controller.cancel()}>{e('cancel')}</Button>}
          {draft && <Button onClick={validate}>{e('shellpilotSkillValidate')}</Button>}
          {draft && (
            <Button onClick={() => onManualEdit?.(draft)}>
              {e('shellpilotSkillManualEdit')}
            </Button>
          )}
          {draft && <Button onClick={close}>{e('shellpilotSkillSaveDraftOnly')}</Button>}
          {draft && (
            <Button type='primary' disabled={!canEnable} onClick={saveAndEnable}>
              {e('shellpilotSkillSaveAndEnable')}
            </Button>
          )}
        </Space>
        <div className='agent-skill-create-status' aria-live='polite'>
          <Progress
            percent={progressByState[creatorState.status] || 0}
            status={creatorState.status === 'failed' ? 'exception' : 'active'}
            size='small'
          />
          <Typography.Text>
            {e(`shellpilotSkillCreatorState_${creatorState.status}`)}
          </Typography.Text>
        </div>
        {creatorState.status === 'failed' && (
          <Alert type='error' showIcon message={creatorState.error} />
        )}
        <AgentSkillDraftReview
          draft={draft}
          generated={generated}
          validation={validation}
          onDraftChange={handleDraftChange}
        />
      </div>
    </Modal>
  )
}
