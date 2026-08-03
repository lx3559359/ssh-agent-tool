import { Button, Dropdown } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'

const e = window.translate

export default function IncidentExportButton ({
  onExport,
  disabled = false,
  loading = false
}) {
  const items = [
    { key: 'md', label: e('shellpilotIncidentExportMarkdown') },
    { key: 'html', label: e('shellpilotIncidentExportHtml') },
    { key: 'json', label: e('shellpilotIncidentExportJson') }
  ]
  return (
    <Dropdown
      disabled={disabled || loading}
      menu={{ items, onClick: ({ key }) => onExport(key) }}
      trigger={['click']}
    >
      <Button
        icon={<DownloadOutlined />}
        disabled={disabled}
        loading={loading}
      >
        {e('shellpilotIncidentExport')}
      </Button>
    </Dropdown>
  )
}
