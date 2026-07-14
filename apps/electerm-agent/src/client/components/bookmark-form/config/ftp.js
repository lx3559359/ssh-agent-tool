import { formItemLayout } from '../../../common/form-layout.js'
import { terminalFtpType } from '../../../common/constants.js'
import { createBaseInitValues, getAuthTypeDefault } from '../common/init-values.js'
import { commonFields } from './common-fields.js'
import { isEmpty } from 'lodash-es'
import { createShellPilotRequiredRule } from '../../../common/shellpilot-i18n-overrides.js'

const e = window.translate

const ftpConfig = {
  key: 'ftp',
  type: terminalFtpType,
  initValues: (props) => {
    return createBaseInitValues(props, terminalFtpType, {
      port: 21,
      user: '',
      password: '',
      secure: false,
      encode: 'utf-8',
      ...getAuthTypeDefault(props)
    })
  },
  layout: formItemLayout,
  tabs: () => [
    {
      key: 'auth',
      label: e('auth'),
      fields: [
        commonFields.category,
        commonFields.colorTitle,
        commonFields.labels,
        { type: 'input', name: 'host', label: () => e('host'), rules: [createShellPilotRequiredRule(e, 'host')] },
        commonFields.port,
        { type: 'profileItem', name: '__profile__', label: '', profileFilter: d => !isEmpty(d.ftp) },
        { type: 'input', name: 'user', label: () => e('username') },
        { type: 'password', name: 'password', label: () => e('password') },
        { type: 'switch', name: 'secure', label: () => e('secure'), valuePropName: 'checked' },
        commonFields.encode,
        commonFields.proxy,
        commonFields.type
      ]
    }
  ]
}

export default ftpConfig
