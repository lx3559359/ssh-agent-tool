import WidgetInstance from './widget-instance'
import { Empty } from 'antd'

export default function WidgetInstances ({ widgetInstances, languageVersion }) {
  const e = window.translate
  if (!widgetInstances.length) {
    return (
      <div className='widget-instances-empty'>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={e('shellpilotWidgetEmptyRunning')} />
      </div>
    )
  }
  return (
    <div className='widget-instances-list'>
      {widgetInstances.map(item => (
        <WidgetInstance
          key={item.id}
          item={item}
          languageVersion={languageVersion}
        />
      ))}
    </div>
  )
}
