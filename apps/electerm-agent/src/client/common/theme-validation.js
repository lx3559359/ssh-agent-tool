import {
  requiredThemeProps,
  validThemeProps
} from './terminal-theme.js'

const themeNameMaxLength = 30
const themeConfigMaxLength = 1000
const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const rgbaColorRegex = /^rgba\(\d{1,3}, +\d{1,3}, +\d{1,3}, +(0|0?\.\d+|1)\)$/

function translateMessage (translate, key) {
  const value = typeof translate === 'function'
    ? translate(key)
    : ''
  return typeof value === 'string' && value.trim()
    ? value
    : key
}

function withProperty (translate, key, property) {
  return `${translateMessage(translate, key)}: ${property}`
}

function hasOwn (object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function parseThemeText (value) {
  return value.split('\n').reduce((result, line) => {
    let [name = '', color = ''] = line.split('=')
    name = name.trim()
    color = color.trim()
    if (name && color) {
      result[name] = color
    }
    return result
  }, Object.create(null))
}

export function validateThemeName (value, translate) {
  if (typeof value !== 'string' || !value.trim()) {
    return [translateMessage(translate, 'themeNameRequired')]
  }
  if (value.length > themeNameMaxLength) {
    return [translateMessage(translate, 'themeMaxChars')]
  }
  return []
}

export function validateThemeText (value, translate) {
  if (typeof value !== 'string' || !value.trim()) {
    return [translateMessage(translate, 'themeConfigRequired')]
  }

  const errors = []
  if (value.length > themeConfigMaxLength) {
    errors.push(translateMessage(translate, 'themeConfigMaxChars'))
  }
  const input = parseThemeText(value)

  for (const prop of requiredThemeProps) {
    if (!hasOwn(input, prop) || !input[prop]) {
      errors.push(withProperty(translate, 'themeMissingProperty', prop))
      continue
    }
    const isValidColor = prop.startsWith('terminal:')
      ? rgbaColorRegex.test(input[prop]) || hexColorRegex.test(input[prop])
      : hexColorRegex.test(input[prop])
    if (!isValidColor) {
      errors.push(withProperty(translate, 'themeInvalidColor', prop))
    }
  }

  for (const key of Object.keys(input)) {
    if (!validThemeProps.includes(key)) {
      errors.push(withProperty(translate, 'themeUnsupportedProperty', key))
    }
  }
  return errors
}
