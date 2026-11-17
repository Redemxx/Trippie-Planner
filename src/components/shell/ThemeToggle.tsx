/**
 * ThemeToggle — flips between `atlas` (dark default) and `cartographer` (light).
 */

import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import type { ThemeId } from '../../themes'
import { getActiveTheme } from '../../themes'

const DARK_THEME: ThemeId = 'atlas'
const LIGHT_THEME: ThemeId = 'cartographer'
const STORAGE_KEY = 'ui-theme'

function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === DARK_THEME || stored === LIGHT_THEME) return stored
  } catch { /* private mode */ }
  return getActiveTheme()
}

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<ThemeId>(readTheme)
  const isDark = theme !== LIGHT_THEME

  const toggle = () => {
    const next = isDark ? LIGHT_THEME : DARK_THEME
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch { /* private mode */ }
  }

  const label = isDark ? 'Light atlas' : 'Dark atlas'

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex w-full items-center gap-[10px] rounded-md px-[10px] py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {isDark ? (
        <Sun className="size-[15px] shrink-0" aria-hidden />
      ) : (
        <Moon className="size-[15px] shrink-0" aria-hidden />
      )}
      <span
        className="whitespace-nowrap transition-opacity duration-150"
        style={{ opacity: collapsed ? 0 : 1 }}
      >
        {label}
      </span>
    </button>
  )
}
