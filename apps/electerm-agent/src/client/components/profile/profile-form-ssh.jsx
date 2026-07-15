import {
  Form,
  Input
} from 'antd'
import renderAuth from '../bookmark-form/common/render-auth-ssh'
import { formItemLayout } from '../../common/form-layout'
import { createShellPilotMaxRule } from '../../common/shellpilot-i18n-overrides.js'

const FormItem = Form.Item
const e = window.translate

export default function ProfileFormSsh (props) {
  const { form } = props
  return (
    <>
      <FormItem
        {...formItemLayout}
        label={e('username')}
        hasFeedback
        name='username'
        rules={[createShellPilotMaxRule(e, 128)]}
      >
        <Input />
      </FormItem>
      {
        renderAuth({
          store: window.store,
          form,
          authType: 'password'
        })
      }
      {
        renderAuth({
          store: window.store,
          form
        })
      }
    </>
  )
}
