export default (Store) => {
  Store.prototype.checkForDbUpgrade = async function () {
    // Database preparation is owned by the main process before createWindow().
    // Keep the legacy method as a compatibility no-op for older extensions.
    window.migrating = false
    return false
  }
}
