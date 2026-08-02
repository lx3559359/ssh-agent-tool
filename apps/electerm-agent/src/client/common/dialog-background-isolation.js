import { useEffect, useRef } from 'react'

const activeOwners = new Set()
let previousState = null

export function acquireDialogBackgroundIsolation (
  owner,
  root = document.getElementById('container')
) {
  if (!root || activeOwners.has(owner)) return
  if (!activeOwners.size) {
    previousState = {
      root,
      inert: root.inert,
      ariaHidden: root.getAttribute('aria-hidden')
    }
    root.inert = true
    root.setAttribute('aria-hidden', 'true')
  }
  activeOwners.add(owner)
}

export function releaseDialogBackgroundIsolation (owner) {
  if (!activeOwners.delete(owner) || activeOwners.size || !previousState) return
  const { root, inert, ariaHidden } = previousState
  root.inert = inert
  if (ariaHidden === null) {
    root.removeAttribute('aria-hidden')
  } else {
    root.setAttribute('aria-hidden', ariaHidden)
  }
  previousState = null
}

export function useDialogBackgroundIsolation (open) {
  const ownerRef = useRef(Symbol('dialog-owner'))

  useEffect(() => {
    if (!open) return undefined
    const owner = ownerRef.current
    acquireDialogBackgroundIsolation(owner)
    return () => releaseDialogBackgroundIsolation(owner)
  }, [open])
}
