const defaultMenuItemHeight = 32
const defaultMinItemsBeforeSplit = 6

function currentMoreLabel () {
  if (typeof window !== 'undefined' && typeof window.translate === 'function') {
    const translated = window.translate('more')
    if (typeof translated === 'string' && translated.trim() && translated !== 'more') {
      return translated
    }
  }
  return 'More'
}

export function splitOverflowMenu ({
  items = [],
  clientY,
  windowHeight,
  menuItemHeight = defaultMenuItemHeight,
  minItemsBeforeSplit = defaultMinItemsBeforeSplit,
  moreLabel = currentMoreLabel()
} = {}) {
  if (!clientY || !windowHeight || items.length <= minItemsBeforeSplit) {
    return items
  }

  const estimatedMenuHeight = items.length * menuItemHeight
  const availableHeight = windowHeight - clientY

  if (estimatedMenuHeight <= availableHeight) {
    return items
  }

  const splitIndex = Math.ceil(items.length / 2)
  return [
    ...items.slice(0, splitIndex),
    {
      key: 'more-submenu',
      label: moreLabel,
      children: items.slice(splitIndex)
    }
  ]
}
