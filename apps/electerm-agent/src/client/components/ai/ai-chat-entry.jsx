import { lazy, memo, Suspense } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import { areAIChatEntryPropsEqual } from './ai-chat-entry-props.js'

const AIChat = lazy(() => import('./ai-chat'))
const e = window.translate

function AIChatEntry (props) {
  return (
    <LazyModuleBoundary moduleName={e('shellpilotAiAssistantModule')} fallback={null}>
      <Suspense fallback={null}>
        <AIChat {...props} />
      </Suspense>
    </LazyModuleBoundary>
  )
}

export default memo(AIChatEntry, areAIChatEntryPropsEqual)
