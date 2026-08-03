export function buildSftpRowAriaLabel ({
  file = {},
  type,
  selected,
  properties = [],
  translate = value => value,
  formatSize = String,
  formatTime = String
}) {
  const fields = properties.map(property => (
    typeof property === 'string' ? property : property.id
  ))
  const hasTime = fields.some(id => String(id).toLowerCase().includes('time'))
  const name = file.name || translate('shellpilotSftpEmptyName')
  const itemType = file.isParent
    ? translate('shellpilotSftpParentDirectory')
    : file.isDirectory
      ? translate('shellpilotSftpFolder')
      : translate('shellpilotSftpFile')

  return [
    translate(type),
    name,
    itemType,
    fields.includes('size') && !file.isDirectory && file.size !== undefined
      ? formatSize(file.size)
      : '',
    hasTime && file.modifyTime
      ? formatTime(file.modifyTime)
      : '',
    translate(selected ? 'shellpilotSftpSelected' : 'shellpilotSftpNotSelected')
  ].filter(Boolean).join(', ')
}
