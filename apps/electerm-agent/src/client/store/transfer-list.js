/**
 * file transfer list related functions
 */

import uid from '../common/uid'

const { assign } = Object

export default Store => {
  Store.prototype.handleTransferTab = function (tab) {
    window.store.transferTab = tab
  }

  Store.prototype.updateTransfer = function (id, update) {
    const { fileTransfers } = window.store
    const index = fileTransfers.findIndex(t => t.id === id)
    if (index < 0) {
      return
    }
    assign(fileTransfers[index], update)
  }

  Store.prototype.addTransferList = function (items) {
    // console.log('addTransferList', JSON.stringify(items, null, 2))
    const { fileTransfers } = window.store
    const transferBatch = uid()
    const nextItems = items.map(t => {
      t.transferBatch = transferBatch
      return t
    })
    fileTransfers.push(...nextItems)
  }

  Store.prototype.pauseAll = function () {
    const { fileTransfers } = window.store
    window.store.pauseAllTransfer = true
    const len = fileTransfers.length
    for (let i = 0; i < len; i++) {
      const transfer = fileTransfers[i]
      if (
        transfer.inited &&
        !['paused', 'pausing', 'resuming'].includes(transfer.status)
      ) {
        transfer.pausing = true
        transfer.paused = false
        transfer.status = 'pausing'
      }
    }
  }

  Store.prototype.resumeAll = function () {
    const { fileTransfers } = window.store
    window.store.pauseAllTransfer = false
    const len = fileTransfers.length
    for (let i = 0; i < len; i++) {
      const transfer = fileTransfers[i]
      if (transfer.status === 'paused' || transfer.paused) {
        transfer.pausing = false
        transfer.paused = false
        transfer.status = 'resuming'
      }
    }
  }

  Store.prototype.cancelAll = function () {
    window.store.fileTransfers = []
  }
}
