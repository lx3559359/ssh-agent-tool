import { useEffect, useRef } from 'react'

const activeOwners = new Map()
const portalStates = new Map()
let previousState = null

function captureState (element) {
  return {
    inert: element.inert,
    ariaHidden: element.getAttribute('aria-hidden')
  }
}

function restoreState (element, state) {
  element.inert = state.inert
  if (state.ariaHidden === null) {
    element.removeAttribute('aria-hidden')
  } else {
    element.setAttribute('aria-hidden', state.ariaHidden)
  }
}

function bodyLayerFor (dialogRoot) {
  const body = dialogRoot?.ownerDocument?.body
  if (!body) return null
  let layer = dialogRoot
  while (layer?.parentElement && layer.parentElement !== body) {
    layer = layer.parentElement
  }
  return layer?.parentElement === body ? layer : null
}

function isDialogLayer (element, activeLayers) {
  return activeLayers.includes(element) ||
    element.matches?.('[role="dialog"]') ||
    Boolean(element.querySelector?.('[role="dialog"]'))
}

function updatePortalIsolation () {
  const entries = [...activeOwners.values()]
  const topEntry = entries.at(-1)
  const body = topEntry?.dialogRoot?.ownerDocument?.body
  if (!body) return
  const activeLayers = entries
    .map(entry => bodyLayerFor(entry.dialogRoot))
    .filter(Boolean)
  const topLayer = activeLayers.at(-1)
  const candidates = [...body.children].filter(element => (
    element !== previousState?.root && isDialogLayer(element, activeLayers)
  ))

  for (const element of candidates) {
    if (!portalStates.has(element)) {
      portalStates.set(element, captureState(element))
    }
    if (element === topLayer) {
      restoreState(element, portalStates.get(element))
    } else {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
  }
}

export function acquireDialogBackgroundIsolation (
  owner,
  root = document.getElementById('container'),
  dialogRoot = null
) {
  if (!root || activeOwners.has(owner)) return
  if (!activeOwners.size) {
    previousState = {
      root,
      ...captureState(root)
    }
    root.inert = true
    root.setAttribute('aria-hidden', 'true')
  }
  activeOwners.set(owner, { root, dialogRoot })
  updatePortalIsolation()
}

export function releaseDialogBackgroundIsolation (owner) {
  if (!activeOwners.delete(owner)) return
  if (activeOwners.size) {
    updatePortalIsolation()
    return
  }
  if (!previousState) return
  const { root, inert, ariaHidden } = previousState
  restoreState(root, { inert, ariaHidden })
  for (const [element, state] of portalStates) {
    restoreState(element, state)
  }
  portalStates.clear()
  previousState = null
}

export function useDialogBackgroundIsolation (open, dialogRootRef) {
  const ownerRef = useRef(Symbol('dialog-owner'))

  useEffect(() => {
    if (!open) return undefined
    const owner = ownerRef.current
    acquireDialogBackgroundIsolation(owner, undefined, dialogRootRef?.current)
    return () => releaseDialogBackgroundIsolation(owner)
  }, [dialogRootRef, open])
}
