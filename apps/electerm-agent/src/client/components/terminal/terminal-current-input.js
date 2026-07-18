export function extractTerminalCommandInput (lineText = '') {
  const text = String(lineText)
  const windowsPrompt = text.match(/^(?:PS\s+)?(?:[A-Za-z]:\\|\\\\)[^>\r\n]*>\s?/)
  let commandStart = windowsPrompt?.[0]?.length || 0
  const promptEndings = ['$ ', '# ', '> ', '% ', '] ', ') ']

  for (const ending of promptEndings) {
    const index = text.lastIndexOf(ending)
    if (index !== -1 && index + ending.length > commandStart) {
      commandStart = index + ending.length
    }
  }

  return text.slice(commandStart)
}
