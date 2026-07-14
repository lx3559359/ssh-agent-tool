import { ReloadOutlined } from '@ant-design/icons'
import { AutoComplete, Spin, Form } from 'antd'
import { formItemLayout } from '../../../common/form-layout'
import { createShellPilotRequiredRule } from '../../../common/shellpilot-i18n-overrides'

const FormItem = Form.Item
const e = window.translate

export default function SerialPathSelector ({
  serials = [],
  loaddingSerials,
  store = window.store,
  ...props
}) {
  return (
    <FormItem
      {...formItemLayout}
      label={e('path')}
      rules={[createShellPilotRequiredRule(e, 'path')]}
      normalize={props.trim}
    >
      <FormItem noStyle name='path'>
        <AutoComplete
          options={serials.map(d => {
            return {
              value: d.path
            }
          })}
        />
      </FormItem>
      <Spin spinning={loaddingSerials}>
        <span onClick={store.handleGetSerials} className='pointer'>
          <ReloadOutlined /> {e('reload')} {e('shellpilotSerials')}
        </span>
      </Spin>
    </FormItem>
  )
}
