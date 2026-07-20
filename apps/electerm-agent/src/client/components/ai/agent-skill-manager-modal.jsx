import {
  Alert,
  Button,
  Empty,
  List,
  Modal,
  Select,
  Space,
  Tag,
  Typography
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import message from '../common/message'
import { getFilePath } from '../../common/file-drop-utils.js'
import AgentSkillEditor from './agent-skill-editor.jsx'
import AgentSkillCreateModal from './agent-skill-create-modal.jsx'
import {
  disableAgentSkill,
  enableAgentSkillDraft,
  importAgentSkill,
  listAgentSkills,
  removeAgentSkill,
  rollbackAgentSkill,
  validateAgentSkillDraft
} from './agent-skill-client.js'
import './agent-skill-manager.styl'

const e = window.translate

function stateLabel (skill) {
  if (skill?.state === 'draft') return e('shellpilotSkillDisabledDraft')
  if (skill?.enabled) return e('shellpilotSkillEnabled')
  return e('shellpilotDisabled')
}

function selectedImportPath (files) {
  const file = files?.[0]
  const filePath = file ? getFilePath(file) : ''
  if (!filePath) return ''
  const relativeParts = String(file.webkitRelativePath || '')
    .split('/')
    .filter(Boolean)
  let selectedPath = filePath
  for (let index = 1; index < relativeParts.length; index += 1) {
    selectedPath = selectedPath.replace(/[\\/][^\\/]+$/, '')
  }
  return selectedPath
}

export default function AgentSkillManagerModal ({
  open,
  onClose,
  onCatalogChange
}) {
  const archiveInputRef = useRef()
  const folderInputRef = useRef()
  const [catalog, setCatalog] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [validation, setValidation] = useState(null)
  const [rollbackDigest, setRollbackDigest] = useState('')
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editorBlocked, setEditorBlocked] = useState(false)
  const selected = useMemo(
    () => catalog.find(item => item.id === selectedId) || null,
    [catalog, selectedId]
  )

  async function refresh (preferredId) {
    setLoading(true)
    try {
      const items = await listAgentSkills()
      setCatalog(items)
      onCatalogChange?.(items)
      setSelectedId(current => {
        const next = preferredId || current
        return items.some(item => item.id === next) ? next : items[0]?.id || ''
      })
    } catch (error) {
      message.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  useEffect(() => {
    setValidation(null)
    setRollbackDigest(selected?.historyDigests?.[0] || '')
    setEditorBlocked(true)
  }, [selectedId])

  async function importSelection (event) {
    const sourcePath = selectedImportPath(event.target.files)
    event.target.value = ''
    if (!sourcePath) return
    try {
      const draft = await importAgentSkill(sourcePath)
      message.success(e('shellpilotSkillImportedDisabled'))
      await refresh(draft.id)
    } catch (error) {
      message.error(error.message)
    }
  }

  async function validateSelected () {
    if (!selected || selected.state !== 'draft') return
    try {
      const result = await validateAgentSkillDraft(selected.id)
      setValidation(result)
      if (result.valid) message.success(e('shellpilotSkillValidationPassed'))
    } catch (error) {
      setValidation(error.validation || { valid: false, errors: [error.message] })
      message.error(error.message)
    }
  }

  function enableSelected () {
    const canEnable = selected?.state === 'draft' &&
      validation && validation.valid &&
      validation.packageDigest === selected.packageDigest
    if (!canEnable) return
    Modal.confirm({
      title: e('shellpilotSkillEnableConfirm'),
      content: (
        <div>
          <p>{e('shellpilotSkillEnableExplain')}</p>
          <p><b>Digest:</b> {validation.packageDigest}</p>
          <p><b>{e('shellpilotSkillPermissions')}:</b> {(selected.requestedPermissions || []).join(', ') || e('shellpilotSkillNone')}</p>
          <pre>{JSON.stringify(selected.riskSummary || {}, null, 2)}</pre>
        </div>
      ),
      onOk: async () => {
        const enabled = await enableAgentSkillDraft(
          selected.id,
          validation.packageDigest
        )
        setValidation(null)
        await refresh(enabled.id)
      }
    })
  }

  function disableSelected () {
    if (!selected?.enabled) return
    Modal.confirm({
      title: e('shellpilotSkillDisableConfirm'),
      content: e('shellpilotSkillDisableExplain'),
      onOk: async () => {
        const disabled = await disableAgentSkill(selected.skillId)
        await refresh(disabled.id)
      }
    })
  }

  function removeSelected () {
    if (!selected) return
    Modal.confirm({
      title: e('shellpilotSkillRemoveConfirm'),
      content: e('shellpilotSkillRemoveExplain'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeAgentSkill(selected.id)
        await refresh()
      }
    })
  }

  function rollbackSelected () {
    if (!selected?.skillId || !rollbackDigest) return
    Modal.confirm({
      title: e('shellpilotSkillRollbackConfirm'),
      content: (
        <div>
          <p>{e('shellpilotSkillRollbackExplain')}</p>
          <p><b>Digest:</b> {rollbackDigest}</p>
        </div>
      ),
      onOk: async () => {
        const rolledBack = await rollbackAgentSkill(
          selected.skillId,
          rollbackDigest
        )
        await refresh(rolledBack.id)
      }
    })
  }

  async function handleSaved (draft) {
    setValidation(null)
    await refresh(draft.id)
  }

  const canValidate = selected?.state === 'draft' && !editorBlocked
  const canEnable = canValidate &&
    validation && validation.valid &&
    validation.packageDigest === selected.packageDigest

  return (
    <Modal
      title={e('shellpilotSkillManagerTitle')}
      open={open}
      onCancel={onClose}
      footer={null}
      width='min(1180px, 96vw)'
      destroyOnClose
    >
      <div className='agent-skill-manager'>
        <Space wrap className='agent-skill-manager-actions'>
          <Button type='primary' onClick={() => setCreateOpen(true)}>
            {e('shellpilotSkillCreateWithAi')}
          </Button>
          <Button onClick={() => archiveInputRef.current?.click()}>
            {e('shellpilotSkillImportArchive')}
          </Button>
          <Button onClick={() => folderInputRef.current?.click()}>
            {e('shellpilotSkillImportFolder')}
          </Button>
          <input
            ref={archiveInputRef}
            hidden
            type='file'
            accept='.zip,.tar,.tgz,.tar.gz'
            onChange={importSelection}
          />
          <input
            ref={folderInputRef}
            hidden
            type='file'
            webkitdirectory=''
            onChange={importSelection}
          />
          <Button
            onClick={validateSelected}
            disabled={!canValidate}
          >
            {e('shellpilotSkillValidate')}
          </Button>
          <Button type='primary' disabled={!canEnable} onClick={enableSelected}>
            {e('shellpilotSkillEnable')}
          </Button>
          <Button disabled={!selected?.enabled} onClick={disableSelected}>
            {e('shellpilotSkillDisable')}
          </Button>
          <Select
            aria-label={e('shellpilotSkillHistory')}
            value={rollbackDigest || undefined}
            options={(selected?.historyDigests || []).map(digest => ({
              value: digest,
              label: digest.slice(0, 12)
            }))}
            onChange={setRollbackDigest}
            placeholder={e('shellpilotSkillHistory')}
            style={{ width: 160 }}
          />
          <Button disabled={!rollbackDigest} onClick={rollbackSelected}>
            {e('shellpilotSkillRollback')}
          </Button>
          <Button danger disabled={!selected} onClick={removeSelected}>
            {e('shellpilotDelete')}
          </Button>
        </Space>

        {validation?.valid === false && (
          <Alert
            type='error'
            showIcon
            message={e('shellpilotSkillValidationFailed')}
          />
        )}

        <div className='agent-skill-manager-body'>
          <div className='agent-skill-manager-list'>
            <Typography.Title level={5}>{e('shellpilotSkillManagerTitle')}</Typography.Title>
            {catalog.length
              ? (
                <List
                  loading={loading}
                  dataSource={catalog}
                  renderItem={item => (
                    <List.Item
                      className={item.id === selectedId ? 'is-selected' : ''}
                      onClick={() => setSelectedId(item.id)}
                      tabIndex={0}
                      onKeyDown={event => event.key === 'Enter' && setSelectedId(item.id)}
                    >
                      <List.Item.Meta
                        title={item.name}
                        description={item.description || item.skillId}
                      />
                      <Tag color={item.enabled ? 'green' : 'default'}>
                        {stateLabel(item)}
                      </Tag>
                    </List.Item>
                  )}
                />
                )
              : <Empty description={e('shellpilotSkillEmpty')} />}
          </div>
          <AgentSkillEditor
            skill={selected}
            validation={validation}
            onSaved={handleSaved}
            onEditStateChange={setEditorBlocked}
          />
        </div>
        <AgentSkillCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onDraftReady={draft => refresh(draft.id)}
          onManualEdit={draft => {
            setCreateOpen(false)
            refresh(draft.id)
          }}
          onEnabled={skill => {
            setCreateOpen(false)
            refresh(skill.id)
          }}
        />
      </div>
    </Modal>
  )
}
