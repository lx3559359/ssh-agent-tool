/**
 * common error handler
 */

import { notification } from '../components/common/notification'
import { createSafeErrorDiagnostic } from './error-diagnostics'
import { packInfo } from './constants'

export default (e) => {
  console.error(e)
  const diagnostic = createSafeErrorDiagnostic(e, {
    version: packInfo.version,
    os: window.navigator?.platform || 'unknown'
  })
  const description = (
    <div className='common-err-desc'>
      <div>{diagnostic.safeMessage}</div>
      <div>{diagnostic.id}</div>
    </div>
  )
  notification.error({
    message: window.translate('shellpilotInterfaceError'),
    description,
    duration: 55
  })
}
