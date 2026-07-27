import { Button, Dropdown } from 'antd'
import { FileAddOutlined } from '@ant-design/icons'
import { ARTIFACT_TEMPLATES } from './artifact-templates'
import './artifacts.styl'

const e = window.translate

function buildTemplatePrompt (template) {
  const output = template.formats.map(format => format.toUpperCase()).join('、')
  return [
    `请根据当前对话和可用上下文生成“${template.label}”。`,
    template.description,
    `使用 ${template.type} 模板，输出格式：${output}。`,
    '请创建可在成果中心预览、轻量修改和另存为的结构化成果。'
  ].join('\n')
}

export default function CreateArtifactMenu ({ onSeedPrompt }) {
  const items = ARTIFACT_TEMPLATES.map(template => ({
    key: template.type,
    label: template.label,
    title: template.description,
    onClick: () => onSeedPrompt(
      buildTemplatePrompt(template),
      template.type
    )
  }))

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement='topLeft'>
      <Button
        size='small'
        className='create-artifact-button'
        icon={<FileAddOutlined />}
        title={e('shellpilotArtifactCreateTitle')}
      >
        {e('shellpilotArtifactCreateButton')}
      </Button>
    </Dropdown>
  )
}
