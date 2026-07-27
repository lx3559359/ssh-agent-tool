const INVALID_FILENAME = /[<>:"/\\|?*]/g

function replaceInvalidFilenameCharacters (value) {
  return [...String(value || '')].map(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || INVALID_FILENAME.test(character)
      ? '-'
      : character
  }).join('')
}
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function artifactFilename (title, extension) {
  let safeTitle = replaceInvalidFilenameCharacters(title || 'AI 成果物')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 120)
  if (!safeTitle || WINDOWS_RESERVED.test(safeTitle)) {
    safeTitle = 'AI 成果物'
  }
  return `${safeTitle}.${extension}`
}

module.exports = {
  artifactFilename
}
