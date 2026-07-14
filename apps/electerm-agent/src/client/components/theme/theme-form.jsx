import { useRef, useState } from 'react'
import { Button, Input, Form, Space } from 'antd'
import message from '../common/message'
import {
  convertTheme,
  convertThemeToText,
  exportTheme
} from '../../common/terminal-theme'
import { defaultTheme, defaultThemeLight } from '../../common/theme-defaults'
import { normalizeTerminalThemeConfig } from '../../common/shellpilot-theme-constraints.js'
import {
  validateThemeName,
  validateThemeText
} from '../../common/theme-validation.js'
import generate from '../../common/uid'
import Link from '../common/external-link'
import InputAutoFocus from '../common/input-auto-focus'
import ThemePicker from './theme-editor'
import Upload from '../common/upload'
import './theme-form.styl'

const { TextArea } = Input
const FormItem = Form.Item
const e = window.translate

export default function ThemeForm (props) {
  const [form] = Form.useForm()
  const [txt, setTxt] = useState(convertThemeToText(props.formData))
  const [editor, setEditor] = useState('theme-editor-color-picker')
  const action = useRef('submit')
  function exporter () {
    exportTheme(props.formData.id)
  }
  function saveOnly () {
    action.current = 'saveOnly'
    form.submit()
  }
  // A function to validate the input text
  async function validateInput (_, value) {
    const errors = validateThemeText(value, e)
    if (errors.length) {
      return Promise.reject(new Error(errors.join('\n')))
    }
    setTxt(value)
    return Promise.resolve()
  }

  async function validateName (_, value) {
    const errors = validateThemeName(value, e)
    return errors.length
      ? Promise.reject(new Error(errors.join('\n')))
      : Promise.resolve()
  }

  async function handleSubmit (res) {
    if (!res.themeText) {
      res.themeText = txt
    }
    const { formData } = props
    const {
      themeName,
      themeText
    } = res
    const converted = convertTheme(themeText)
    converted.themeConfig = normalizeTerminalThemeConfig(converted.themeConfig)
    const update = {
      name: themeName,
      ...converted
    }
    const update1 = {
      ...update,
      id: generate()
    }
    if (formData.id) {
      props.store.editTheme(formData.id, update)
    } else {
      props.store.addTheme(update1)
      props.store.storeAssign({
        item: update1
      })
    }
    if (action.current !== 'saveOnly') {
      props.store.setTheme(
        formData.id || update1.id
      )
    }
    message.success(e('saved'))
    action.current = 'submit'
  }

  function renderSrc (type) {
    if (type === 'iterm') {
      const url = `https://github.com/mbadolato/iTerm2-Color-Schemes/blob/master/electerm/${encodeURIComponent(themeName)}.txt`
      return (
        <FormItem>
          <span className='mg1r'>src:</span>
          <Link
            to={url}
          >{url}
          </Link>
        </FormItem>
      )
    }
    return null
  }

  async function beforeUpload (file) {
    const txt = file.fileContent !== undefined
      ? file.fileContent
      : await window.fs.readFile(file.filePath)
    const { name, themeConfig, uiThemeConfig } = convertTheme(txt)
    const tt = convertThemeToText({
      themeConfig, uiThemeConfig
    })
    form.setFieldsValue({
      themeName: name,
      themeText: tt
    })
    setTxt(tt)
  }

  function handleSwitchEditor (e) {
    e.preventDefault()
    setEditor(editor === 'theme-editor-txt' ? 'theme-editor-color-picker' : 'theme-editor-txt')
  }

  function renderFuncs (id) {
    if (!id) {
      return null
    }
    return (
      <FormItem>
        <Button
          type='dashed'
          onClick={exporter}
        >
          {e('export')}
        </Button>
      </FormItem>
    )
  }

  function onPickerChange (value, name) {
    const realName = name.includes('terminal:')
      ? name.replace('terminal:', '')
      : name
    const text = form.getFieldValue('themeText')
    const obj = convertTheme(text)
    if (obj.themeConfig[realName]) {
      obj.themeConfig[realName] = value
    } else if (obj.uiThemeConfig[realName]) {
      obj.uiThemeConfig[realName] = value
    }
    form.setFieldsValue({
      themeText: convertThemeToText(obj)
    })
    setTxt(convertThemeToText(obj))
  }

  function renderTxt () {
    return (
      <FormItem
        noStyle
        name='themeText'
        hasFeedback
        rules={[{
          validator: validateInput
        }]}
      >
        <TextArea rows={33} disabled={disabled} />
      </FormItem>
    )
  }

  const {
    readonly,
    id,
    type,
    name: themeName
  } = props.formData
  const initialValues = {
    themeName,
    themeText: convertThemeToText(props.formData)
  }
  const isDefaultTheme = id === defaultTheme().id || id === defaultThemeLight().id
  const disabled = readonly || isDefaultTheme
  const switchTxt = editor === 'theme-editor-txt' ? e('editWithColorPicker') : e('editWithTextEditor')
  const pickerProps = {
    onChange: onPickerChange,
    themeText: txt,
    disabled
  }
  return (
    <Form
      onFinish={handleSubmit}
      form={form}
      initialValues={initialValues}
      className={editor}
      name='terminal-theme-form'
      layout='vertical'
    >
      {renderFuncs(id)}
      <FormItem
        label={e('themeName')}
        hasFeedback
        name='themeName'
        rules={[{
          validator: validateName
        }]}
      >
        <InputAutoFocus
          selectall='yes'
          disabled={disabled}
        />
      </FormItem>
      <FormItem
        label={e('themeConfig')}
      >
        <div className='mg1b fix'>
          <span className='fleft'>
            <Space>
              <Button
                type='dashed'
                onClick={handleSwitchEditor}
              >
                {switchTxt}
              </Button>
            </Space>
          </span>
          <span className='fright'>
            <Upload
              beforeUpload={beforeUpload}
              fileList={[]}
              className='mg1b'
            >
              <Button
                type='dashed'
                disabled={disabled}
              >
                {e('importFromFile')}
              </Button>
            </Upload>
          </span>
        </div>
        {
          editor === 'theme-editor-txt'
            ? renderTxt()
            : (
              <ThemePicker
                {...pickerProps}
              />
              )
        }
      </FormItem>
      {
        disabled
          ? null
          : (
            <FormItem>
              <p>
                <Button
                  type='primary'
                  htmlType='submit'
                  className='mg1r mg1b'
                >{e('saveAndApply')}
                </Button>
                <Button
                  type='dashed'
                  className='mg1r mg1b'
                  onClick={saveOnly}
                >{e('save')}
                </Button>
              </p>
            </FormItem>
            )
      }
      {
        renderSrc(type)
      }
    </Form>
  )
}
