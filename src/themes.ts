/**
 * Theme catalog for Trippie.
 */

export const THEMES = [
  {
    id: 'atlas',
    label: 'Editorial Dark',
    description: 'Warm charcoal surfaces paired with stone ink and #ffc61a golden-hour accents.',
  },
  {
    id: 'cartographer',
    label: 'Editorial Light',
    description: 'Warm #f5f4f0 paper ground with #ecebe8 surfaces and crisp #131313 ink.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Read the currently active theme id from <html data-theme>. */
export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'atlas'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id === 'cartographer' ? 'cartographer' : 'atlas'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
