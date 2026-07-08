import { formItemLayout } from '../../../common/form-layout.js'
import { terminalWebType } from '../../../common/constants.js'
import { createBaseInitValues } from '../common/init-values.js'
import { commonFields } from './common-fields.js'

const e = window.translate

const webConfig = {
  key: 'web',
  type: terminalWebType,
  initValues: (props) => {
    return createBaseInitValues(props, terminalWebType)
  },
  layout: formItemLayout,
  tabs: () => [
    {
      key: 'main',
      label: e('auth'),
      fields: [
        commonFields.category,
        commonFields.colorTitle,
        commonFields.labels,
        {
          type: 'input',
          name: 'url',
          label: () => e('URL'),
          rules: [
            { required: true, message: '请输入 URL' },
            {
              validator: (_, value) =>
                /^[a-z\d.+-]+:\/\/[^\s/$.?#].[^\s]*$/i.test(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error('URL 必须以 http:// 或 https:// 开头'))
            }
          ]
        },
        commonFields.description,
        { type: 'input', name: 'useragent', label: () => e('useragent') },
        { type: 'switch', name: 'hideAddressBar', label: 'hideAddressBar', valuePropName: 'checked' },
        commonFields.type
      ]
    }
  ]
}

export default webConfig
