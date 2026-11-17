/**
 * Theme catalog for Trippie.
 */

export const THEMES = [
  {
    id: 'atlas',
    label: 'Coastal Lagoon',
    description: 'Deep tropical ocean-teal canvas with luminous seafoam accents.',
  },
  {
    id: 'cartographer',
    label: 'Coastal Daylight',
    description: 'Crisp white destination cards on airy seafoam mist for bright daylight.',
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
