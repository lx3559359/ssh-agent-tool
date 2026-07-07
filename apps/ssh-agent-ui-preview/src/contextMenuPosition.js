const DEFAULT_MENU_WIDTH = 336;
const DEFAULT_MENU_HEIGHT = 520;
const DEFAULT_MARGIN = 8;

export function getContextMenuPosition(options = {}) {
  const margin = normalizePositiveNumber(options.margin, DEFAULT_MARGIN);
  const viewportWidth = normalizePositiveNumber(options.viewportWidth, 0);
  const viewportHeight = normalizePositiveNumber(options.viewportHeight, 0);
  const menuWidth = normalizePositiveNumber(options.menuWidth, DEFAULT_MENU_WIDTH);
  const menuHeight = normalizePositiveNumber(options.menuHeight, DEFAULT_MENU_HEIGHT);
  const clientX = normalizeNumber(options.clientX, margin);
  const clientY = normalizeNumber(options.clientY, margin);

  const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
  const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
  const x = clamp(clientX, margin, maxX);
  const y = clamp(clientY, margin, maxY);
  const maxHeight = Math.max(24, viewportHeight - y - margin);

  return {
    x,
    y,
    maxHeight: `${maxHeight}px`,
  };
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
