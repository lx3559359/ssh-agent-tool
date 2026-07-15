import {
  Form,
  Input
} from 'antd'
import { formItemLayout } from '../../common/form-layout'
import renderAuth from '../bookmark-form/common/render-auth-ssh'
import { createShellPilotMaxRule } from '../../common/shellpilot-i18n-overrides.js'

const FormItem = Form.Item
const e = window.translate

export default function ProfileFormTelnet (props) {
  return (
    <>
      <FormItem
        {...formItemLayout}
        label={e('username')}
        hasFeedback
        name={['telnet', 'username']}
        rules={[createShellPilotMaxRule(e, 128)]}
      >
        <Input />
      </FormItem>
      {
        renderAuth({
          store: props.store,
          form: props.form,
          authType: 'password',
          formItemName: ['telnet', 'password']
        })
      }
    </>
  )
}
