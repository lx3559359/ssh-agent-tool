import { Button, Empty, Popconfirm } from 'antd'
import { DeleteOutlined, RobotOutlined } from '@ant-design/icons'

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
    return <Empty description='还没有执行记录' />
  }
  return (
    <div className='operations-history'>
      <div className='operations-history-head'>
        <span>共 {records.length} 条本地记录</span>
        <Popconfirm
          title='清空全部运维记录？'
          description='仅删除本机的任务历史，不会改动服务器。'
          onConfirm={onClear}
        >
          <Button danger size='small' icon={<DeleteOutlined />}>清空</Button>
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
              AI 分析
            </Button>
          </article>
        )
      })}
    </div>
  )
}
