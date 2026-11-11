export type Theme = 'system' | 'light' | 'dark'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem('theme', t)
  } catch {
    /* storage unavailable */
  }
  applyTheme(t)
}
