import { Alert, Button, Modal, Space } from 'antd'

const e = window.translate

export default function AIWebAccessModal ({
  challenge,
  activeAIName,
  onDecision,
  onCancel
}) {
  const addressClass = challenge?.addressClass
  const warning = addressClass === 'loopback'
    ? e('shellpilotAiWebAccessLoopbackWarning')
    : e('shellpilotAiWebAccessPrivateWarning')

  return (
    <Modal
      title={e('shellpilotAiWebAccessTitle')}
      open={Boolean(challenge)}
      onCancel={onCancel}
      footer={null}
      maskClosable={false}
      destroyOnClose
    >
      <Space direction='vertical' size={14} className='shellpilot-ai-web-access-content'>
        <Alert type='warning' showIcon message={warning} />
        <div className='shellpilot-ai-web-access-origin'>
          <span>{e('shellpilotAiWebAccessOrigin')}</span>
          <code>{challenge?.origin || ''}</code>
        </div>
        <div className='shellpilot-ai-web-access-disclosure'>
          {e('shellpilotAiWebAccessSendWarning')}
          {activeAIName ? ` ${activeAIName}` : ''}
        </div>
        <Space wrap className='shellpilot-ai-web-access-actions'>
          <Button
            data-testid='ai-web-cancel'
            onClick={onCancel}
          >
            {e('cancel')}
          </Button>
          <Button
            data-testid='ai-web-allow-always'
            onClick={() => onDecision('always')}
          >
            {e('shellpilotAiWebAllowAlways')}
          </Button>
          <Button
            type='primary'
            data-testid='ai-web-allow-once'
            onClick={() => onDecision('once')}
          >
            {e('shellpilotAiWebAllowOnce')}
          </Button>
        </Space>
      </Space>
    </Modal>
  )
}
