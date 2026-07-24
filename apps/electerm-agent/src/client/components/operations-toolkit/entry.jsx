import { lazy, Suspense } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'

const OperationsWorkspace = lazy(() => import(
  './workspace/operations-workspace'
))
const e = window.translate

export default function OperationsToolkitEntry (props) {
  if (!props.openQuickCommandBar && !props.pinnedQuickCommandBar) {
    return null
  }
  return (
    <LazyModuleBoundary moduleName={e('shellpilotOperationsTitle')} fallback={null}>
      <Suspense fallback={<div className='operations-toolkit-loading'>{e('shellpilotOperationsLoading')}</div>}>
        <OperationsWorkspace {...props} />
      </Suspense>
    </LazyModuleBoundary>
  )
}
