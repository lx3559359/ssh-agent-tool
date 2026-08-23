/**
 * terminal interactive UI - renders a single interactive event modal
 */

import { Form, Button } from 'antd'
import Modal from '../common/modal'
import InputAutoFocus from '../common/input-auto-focus'
import SshHostKeyConfirmation from './ssh-host-key-confirmation'

const e = window.translate
const FormItem = Form.Item

export default function TermInteractiveUI ({
  opts,
  onSend,
  onClose
}) {
  const [form] = Form.useForm()

  function onCancel () {
    onSend({
      id: opts.id,
      results: []
    })
    onClose()
  }
  function onOk () {
    form.submit()
  }
  function onConfirm () {
    onSend({
      id: opts.id,
      results: [opts.options.confirmResult || 'yes']
    })
    onClose()
  }
  function onIgnore () {
    onSend({
      id: opts.id,
      results: Object.keys(opts.options.prompts).map(() => '')
    })
    onClose()
  }
  function onFinish (res) {
    onSend({
      id: opts.id,
      results: Object.values(res)
    })
    onClose()
  }
  function renderFormItem (pro, i) {
    const {
      prompt,
      echo
    } = pro
    const note = (opts.options.instructions || [])[i]
    const type = echo
      ? 'input'
      : 'password'
    return (
      <FormItem
        key={prompt + i}
        label={prompt}
        rules={[{
          required: true, message: e('shellpilotFieldRequiredGeneric')
        }]}
      >
        <div>
          <pre>{note}</pre>
        </div>
        <FormItem noStyle name={'item' + i}>
          <InputAutoFocus
            type={type}
            placeholder={note}
          />
        </FormItem>
      </FormItem>
    )
  }
  function renderConfirmBody () {
    return (
      <SshHostKeyConfirmation
        details={opts.options.hostKeyDetails}
        instructions={opts.options.instructions}
        translate={e}
      />
    )
  }
  const confirmFooter = (
    <div className='terminal-interactive-confirm-actions'>
      <Button
        className='terminal-interactive-cancel'
        onClick={onCancel}
      >
        {opts.options.cancelText || e('cancel')}
      </Button>
      <Button
        type='primary'
        className='terminal-interactive-confirm'
        onClick={onConfirm}
      >
        {opts.options.submitText || e('save')}
      </Button>
    </div>
  )
  const props = {
    maskClosable: false,
    okText: e('submit'),
    onCancel,
    onOk,
    closable: false,
    open: true,
    title: opts.options?.name || '?',
    footer: opts.options?.mode === 'confirm' ? confirmFooter : null
  }
  return (
    <Modal
      {...props}
      keyboardConfirm={false}
      initialFocusSelector='.terminal-interactive-cancel'
    >
      {
        opts.options?.mode === 'confirm'
          ? renderConfirmBody()
          : (
            <Form
              form={form}
              layout='vertical'
              onFinish={onFinish}
            >
              {
                opts.options.prompts.map(renderFormItem)
              }
              <FormItem>
                <Button
                  type='primary'
                  htmlType='submit'
                >
                  {e('submit')}
                </Button>
                <Button
                  type='dashed'
                  className='mg1l'
                  onClick={onIgnore}
                >
                  {e('ignore')}
                </Button>
                <Button
                  className='mg1l'
                  onClick={onCancel}
                >
                  {e('cancel')}
                </Button>
              </FormItem>
            </Form>
            )
      }
    </Modal>
  )
}
