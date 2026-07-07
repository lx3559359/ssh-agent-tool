import WidgetInstance from './widget-instance'
import { Empty } from 'antd'

export default function WidgetInstances ({ widgetInstances }) {
  if (!widgetInstances.length) {
    return (
      <div className='widget-instances-empty'>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无运行中的工具' />
      </div>
    )
  }
  return (
    <div className='widget-instances-list'>
      {widgetInstances.map(item => (
        <WidgetInstance
          key={item.id}
          item={item}
        />
      ))}
    </div>
  )
}
