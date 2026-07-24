import { Button, Empty, Popconfirm } from 'antd'
import { DeleteOutlined, RobotOutlined } from '@ant-design/icons'
import { formatShellPilotTranslation } from '../../../common/shellpilot-i18n-overrides.js'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
const statusLabels = {
  completed: '已完成',
  cancelled: '已取消',
  'timed-out': '已超时',
  failed: '失败',
  disconnected: '连接断开',
  'partially-completed': '部分完成'
}

export default function ResultViewer ({
  records,
  tools,
  onSelect,
  onAnalyze,
  onClear
}) {
  if (!records.length) {
    return <Empty description={e('shellpilotOperationsNoHistory')} />
  }
  return (
    <div className='operations-history'>
      <div className='operations-history-head'>
        <span>{tf('shellpilotOperationsHistoryCount', { count: records.length })}</span>
        <Popconfirm
          title={e('shellpilotOperationsClearHistoryTitle')}
          description={e('shellpilotOperationsClearHistoryDescription')}
          onConfirm={onClear}
        >
          <Button danger size='small' icon={<DeleteOutlined />}>{e('shellpilotOperationsClear')}</Button>
        </Popconfirm>
      </div>
      {records.map(record => {
        const tool = tools.find(item => item.id === record.toolId)
        return (
          <article key={record.id}>
            <button onClick={() => onSelect(record)}>
              <strong>{tool?.title || record.toolId}</strong>
              <span>{record.endpointKey}</span>
              <small>
                {statusLabels[record.status] || record.status}
                {' · '}
                {new Date(record.createdAt).toLocaleString()}
              </small>
            </button>
            <Button
              size='small'
              icon={<RobotOutlined />}
              onClick={() => onAnalyze(record)}
            >
              {e('shellpilotOperationsAIAnalysis')}
            </Button>
          </article>
        )
      })}
    </div>
  )
}
