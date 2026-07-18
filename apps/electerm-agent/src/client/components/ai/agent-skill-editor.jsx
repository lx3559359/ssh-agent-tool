import { Alert, Button, Empty, Input, Space, Spin, Tree, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import message from '../common/message'
import {
  readAgentSkillFile,
  updateAgentSkillDraftFile
} from './agent-skill-client.js'

const e = window.translate

function evidenceList (items = []) {
  if (!Array.isArray(items) || !items.length) return e('shellpilotSkillNone')
  return items.map(item => (
    typeof item === 'string'
      ? item
      : [item.code, item.message, item.path].filter(Boolean).join(' · ')
  )).join('\n')
}

export default function AgentSkillEditor ({
  skill,
  validation,
  onSaved
}) {
  const [selectedPath, setSelectedPath] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const filePaths = useMemo(
    () => Array.isArray(skill?.filePaths) ? skill.filePaths : [],
    [skill]
  )

  useEffect(() => {
    setSelectedPath(current => filePaths.includes(current)
      ? current
      : filePaths[0] || '')
  }, [filePaths])

  useEffect(() => {
    let active = true
    if (!skill?.id || !selectedPath) {
      setContent('')
      setSavedContent('')
      return () => { active = false }
    }
    setLoading(true)
    readAgentSkillFile(skill.id, selectedPath)
      .then(file => {
        if (!active) return
        setContent(file.content)
        setSavedContent(file.content)
      })
      .catch(error => active && message.error(error.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [skill?.id, selectedPath])

  async function save () {
    try {
      setSaving(true)
      const updated = await updateAgentSkillDraftFile(
        skill.id,
        selectedPath,
        content
      )
      setSavedContent(content)
      onSaved?.(updated)
      message.success(e('shellpilotSkillSavedAsDraft'))
    } catch (error) {
      message.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  if (!skill) return <Empty description={e('shellpilotSkillSelectHint')} />

  const evidence = validation || skill
  return (
    <div className='agent-skill-editor'>
      <div className='agent-skill-editor-files'>
        <Typography.Title level={5}>{e('shellpilotSkillFiles')}</Typography.Title>
        <Tree
          aria-label={e('shellpilotSkillFiles')}
          selectedKeys={selectedPath ? [selectedPath] : []}
          treeData={filePaths.map(filePath => ({
            key: filePath,
            title: filePath
          }))}
          onSelect={keys => keys[0] && setSelectedPath(String(keys[0]))}
        />
      </div>
      <div className='agent-skill-editor-content'>
        <Space className='agent-skill-editor-toolbar' wrap>
          <Typography.Text code>{selectedPath}</Typography.Text>
          <Button
            type='primary'
            loading={saving}
            disabled={!selectedPath || loading || content === savedContent}
            onClick={save}
          >
            {e('save')}
          </Button>
        </Space>
        <Spin spinning={loading}>
          <Input.TextArea
            aria-label={e('shellpilotSkillFileContent')}
            value={content}
            onChange={event => setContent(event.target.value)}
            autoSize={{ minRows: 14, maxRows: 28 }}
          />
        </Spin>
      </div>
      <aside className='agent-skill-editor-evidence' aria-live='polite'>
        <Typography.Title level={5}>{e('shellpilotSkillPermissions')}</Typography.Title>
        <pre>{evidenceList(skill.requestedPermissions)}</pre>
        <Typography.Title level={5}>{e('shellpilotSkillRisk')}</Typography.Title>
        <pre>{JSON.stringify(skill.riskSummary || {}, null, 2)}</pre>
        <Typography.Title level={5}>{e('shellpilotSkillValidation')}</Typography.Title>
        {evidence.valid === false && (
          <Alert type='error' showIcon message={e('shellpilotSkillValidationFailed')} />
        )}
        <Typography.Text strong>{e('shellpilotSkillErrors')}</Typography.Text>
        <pre>{evidenceList(evidence.errors)}</pre>
        <Typography.Text strong>{e('shellpilotSkillWarnings')}</Typography.Text>
        <pre>{evidenceList(evidence.warnings)}</pre>
      </aside>
    </div>
  )
}
