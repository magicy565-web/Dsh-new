// The canvas follows the host's colour scheme and lets the user pin light or dark.
// No documented host signal exists, so the host document is inspected for the usual markers
// and the operating-system preference is the final fallback.

const PREFERENCE_KEY = 'dsh-commerce-network:theme';
export const THEME_CHOICES = Object.freeze([
  { id: 'auto', label: '跟随宿主' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
]);

function declared(element) {
  if (!element) return null;
  for (const name of ['data-theme', 'data-color-mode', 'data-color-scheme', 'data-bs-theme']) {
    const value = element.getAttribute?.(name);
    if (/dark/i.test(value || '')) return 'dark';
    if (/light/i.test(value || '')) return 'light';
  }
  if (element.classList?.contains('dark')) return 'dark';
  if (element.classList?.contains('light')) return 'light';
  return null;
}

export function resolveHostTheme(win = globalThis.window) {
  const doc = win?.document;
  const found = declared(doc?.documentElement) || declared(doc?.body);
  if (found) return found;
  return win?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

export function loadThemeChoice(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(PREFERENCE_KEY);
    return THEME_CHOICES.some((choice) => choice.id === value) ? value : 'auto';
  } catch { return 'auto'; }
}

export function saveThemeChoice(choice, storage = globalThis.localStorage) {
  try { storage?.setItem(PREFERENCE_KEY, choice); } catch { /* A blocked store only loses the preference. */ }
}

export const effectiveTheme = (choice, host) => (choice === 'light' || choice === 'dark' ? choice : host);

/** Call `listener(theme)` whenever the host theme may have changed. Returns a disposer. */
export function watchHostTheme(listener, win = globalThis.window) {
  const doc = win?.document;
  const Observer = win?.MutationObserver;
  const notify = () => listener(resolveHostTheme(win));
  const observer = Observer && doc ? new Observer(notify) : null;
  const options = { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-mode', 'data-color-scheme', 'data-bs-theme'] };
  observer?.observe(doc.documentElement, options);
  if (doc?.body) observer?.observe(doc.body, options);
  const query = win?.matchMedia?.('(prefers-color-scheme: dark)');
  query?.addEventListener?.('change', notify);
  return () => { observer?.disconnect(); query?.removeEventListener?.('change', notify); };
}
