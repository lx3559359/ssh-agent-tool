import React, { useState, useCallback } from 'react'
import { Input, Button } from 'antd'
import Modal from '../common/modal'

const e = window.translate

export default function WebAuthModal ({ authRequest, onAuthSubmit, onAuthCancel }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = useCallback(() => {
    onAuthSubmit(username, password)
    setUsername('')
    setPassword('')
  }, [onAuthSubmit, username, password])

  const handleCancel = useCallback(() => {
    onAuthCancel()
    setUsername('')
    setPassword('')
  }, [onAuthCancel])

  return (
    <Modal
      open={!!authRequest}
      title={e('shellpilotWebAuthenticationRequired')}
      width={400}
      onCancel={handleCancel}
      footer={null}
    >
      <div className='pd1y'>
        <p>
          <b>{authRequest?.host}</b> {e('shellpilotWebRequiresAuthentication')}
          {authRequest?.realm ? `（${authRequest.realm}）` : ''}
        </p>
        <div className='pd1b'>
          <div className='pd1b'>{e('shellpilotAccount')}</div>
          <Input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={e('shellpilotEnterAccount')}
            autoFocus
          />
        </div>
        <div className='pd1b'>
          <div className='pd1b'>{e('shellpilotPassword')}</div>
          <Input.Password
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={e('shellpilotEnterPassword')}
            onPressEnter={handleSubmit}
          />
        </div>
        <div className='pd1t alignright'>
          <Button className='mg1r' onClick={handleCancel}>{e('cancel')}</Button>
          <Button type='primary' onClick={handleSubmit}>{e('shellpilotLogin')}</Button>
        </div>
      </div>
    </Modal>
  )
}
