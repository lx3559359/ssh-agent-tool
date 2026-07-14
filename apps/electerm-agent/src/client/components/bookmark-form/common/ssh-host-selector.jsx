import { Form } from 'antd'
import InputAutoFocus from '../../common/input-auto-focus.jsx'
import { ColorPickerItem } from './color-picker-item.jsx'
import { formItemLayout } from '../../../common/form-layout.js'
import {
  createShellPilotMaxRule,
  createShellPilotRequiredRule
} from '../../../common/shellpilot-i18n-overrides.js'

const FormItem = Form.Item
const e = window.translate

export default function SshHostSelector ({ ips = [], useIp, form, onBlur, onPaste, trim, ...props }) {
  // ips is ipaddress string[]
  function renderIps () {
    return ips.map(ip => {
      return (
        <div
          key={ip}
          className='iblock mg2r pointer ip-item'
          onClick={() => useIp(form, ip)}
        >
          <b>{ip}</b>
          <span
            className='mg1l item-item-use'
          >
            {e('use')}
          </span>
        </div>
      )
    })
  }

  return (
    <FormItem
      {...formItemLayout}
      label={e('host')}
      hasFeedback
      rules={[
        createShellPilotMaxRule(e, 520),
        createShellPilotRequiredRule(e, 'host')
      ]}
      normalize={props.trim}
    >
      {
        ips.length
          ? renderIps()
          : (
            <div className='dns-section'>
              {e('shellpilotHostOrIp')}
            </div>
            )
      }
      <FormItem noStyle name='host'>
        <InputAutoFocus
          name='host'
          onBlur={props.onBlur}
          onPaste={e => onPaste(e, form)}
          prefix={<ColorPickerItem />}
        />
      </FormItem>
    </FormItem>
  )
}
