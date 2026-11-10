export const DEFAULT_APPEARANCE = Object.freeze({ blur: 10, transparency: 60 });
export const DEFAULT_LIGHT_APPEARANCE = Object.freeze({ blur: 10, transparency: 25 });
const defaults = (theme) => (theme === 'light' ? DEFAULT_LIGHT_APPEARANCE : DEFAULT_APPEARANCE);
const number = (value, fallback, max) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(max, value)))
    : fallback;
export function normalizeAppearance(value = {}, theme = 'dark') {
  return {
    blur: number(value?.blur, 10, 60),
    transparency: number(value?.transparency, defaults(theme).transparency, 100),
  };
}
export function readAppearance(storage, theme = 'dark') {
  try {
    return normalizeAppearance(
      JSON.parse(storage.getItem('codex-float-appearance') || '{}'),
      theme,
    );
  } catch {
    return { ...defaults(theme) };
  }
}
export function applyTransparency(root, transparency) {
  const value = number(transparency, defaults(root.dataset?.theme).transparency, 100);
  root.style.setProperty('--background-alpha', String(value / 100));
}
