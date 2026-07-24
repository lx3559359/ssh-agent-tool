import { lazy, Suspense } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'

const OperationsWorkspace = lazy(() => import(
  './workspace/operations-workspace'
))

export default function OperationsToolkitEntry (props) {
  if (!props.openQuickCommandBar && !props.pinnedQuickCommandBar) {
    return null
  }
  return (
    <LazyModuleBoundary moduleName='运维工具' fallback={null}>
      <Suspense fallback={<div className='operations-toolkit-loading'>正在加载运维工具...</div>}>
        <OperationsWorkspace {...props} />
      </Suspense>
    </LazyModuleBoundary>
  )
}
