export function readTheme(storage) {
 try { return storage.getItem('codex-float-theme') === 'light' ? 'light' : 'dark'; }
 catch { return 'dark'; }
}
export function nextTheme(theme) { return theme === 'dark' ? 'light' : 'dark'; }
