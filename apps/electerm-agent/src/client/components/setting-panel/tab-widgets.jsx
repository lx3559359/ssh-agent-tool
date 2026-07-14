import SettingCol from './col'
import WidgetControl from '../widgets/widget-control'
import WidgetList from '../widgets/widgets-list'
import {
  settingMap
} from '../../common/constants'

export default function TabWidgets (props) {
  const {
    settingTab
  } = props
  if (settingTab !== settingMap.widgets) {
    return null
  }
  const {
    settingItem,
    listProps,
    formProps,
    languageVersion
  } = props
  return (
    <div
      className='setting-tabs-profile'
    >
      <SettingCol>
        <WidgetList
          {...listProps}
          languageVersion={languageVersion}
        />
        <WidgetControl
          {...formProps}
          languageVersion={languageVersion}
          key={settingItem.id}
        />
      </SettingCol>
    </div>
  )
}
