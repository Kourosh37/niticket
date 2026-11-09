export type Theme = 'light' | 'dark';

export const THEME_KEY = 'niticket-theme';

const THEME_EVENT = 'niticket:theme';

export const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export const getServerTheme = (): undefined => undefined;

function apply(theme: Theme, preference: Theme | 'system') {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePreference = preference;
  window.dispatchEvent(new Event(THEME_EVENT));
}

function saveCookie(theme: Theme | null) {
  document.cookie = `${THEME_KEY}=${theme ?? ''}; Path=/; Max-Age=${theme ? 31536000 : 0}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

export function setTheme(theme: Theme) {
  if (!isTheme(theme)) return;
  apply(theme, theme);
  saveCookie(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme switching still works when browser storage is unavailable.
  }
}

export function subscribeTheme(listener: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const systemChanged = () => {
    if (document.documentElement.dataset.themePreference === 'system')
      apply(media.matches ? 'dark' : 'light', 'system');
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    const preference = isTheme(event.newValue) ? event.newValue : null;
    apply(preference ?? (media.matches ? 'dark' : 'light'), preference ?? 'system');
    saveCookie(preference);
  };
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener('storage', storageChanged);
  media.addEventListener('change', systemChanged);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener('storage', storageChanged);
    media.removeEventListener('change', systemChanged);
  };
}

// Executes in the head before any UI can paint; the request nonce preserves the CSP.
export const themeBootstrap = `(()=>{const r=document.documentElement;let p=r.dataset.themePreference;try{if(p==='system'){const s=localStorage.getItem('${THEME_KEY}');if(s==='light'||s==='dark')p=s}}catch{}r.dataset.themePreference=p;r.dataset.theme=p==='light'||p==='dark'?p:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})()`;
