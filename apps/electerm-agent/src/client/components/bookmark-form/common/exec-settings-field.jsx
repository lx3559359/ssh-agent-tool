/**
 * bookmark form - exec settings field
 * Renders exec path and arguments fields for Windows/Mac/Linux
 */
import React from 'react'
import { Form, Input, Select, Space } from 'antd'
import { formItemLayout } from '../../../common/form-layout'
import { formatShellPilotTranslation } from '../../../common/shellpilot-i18n-overrides'

const FormItem = Form.Item

export default function ExecSettingsField () {
  const e = window.translate
  const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
  const platforms = ['linux', 'mac', 'windows']
  return platforms.map((platform) => {
    const platformCapitalized = platform.charAt(0).toUpperCase() + platform.slice(1)
    const label = `exec${platformCapitalized}`
    return (
      <React.Fragment key={platform}>
        <FormItem
          {...formItemLayout}
          label={tf('shellpilotExecPath', { platform: platformCapitalized })}
        >
          <Space.Compact className='width-100'>
            <FormItem noStyle name={label}>
              <Input
                placeholder={tf('shellpilotExecPath', { platform: platformCapitalized })}
                maxLength={500}
              />
            </FormItem>
            <FormItem
              noStyle
              name={`exec${platformCapitalized}Args`}
            >
              <Select
                mode='tags'
                placeholder={tf('shellpilotExecArguments', { platform: platformCapitalized })}
                tokenSeparators={['\n']}
              />
            </FormItem>
          </Space.Compact>
        </FormItem>
      </React.Fragment>
    )
  })
}
