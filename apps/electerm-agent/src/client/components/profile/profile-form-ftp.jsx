import {
  Form,
  Input
} from 'antd'
import { formItemLayout } from '../../common/form-layout'
import Password from '../common/password'
import { createShellPilotMaxRule } from '../../common/shellpilot-i18n-overrides.js'

const FormItem = Form.Item
const e = window.translate

export default function ProfileFormSsh (props) {
  return (
    <>
      <FormItem
        {...formItemLayout}
        label={e('username')}
        hasFeedback
        name={['ftp', 'user']}
        rules={[createShellPilotMaxRule(e, 128)]}
      >
        <Input />
      </FormItem>
      <FormItem
        {...formItemLayout}
        label={e('password')}
        hasFeedback
        name={['ftp', 'password']}
      >
        <Password />
      </FormItem>
    </>
  )
}
