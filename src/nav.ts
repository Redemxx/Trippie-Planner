import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Atlas Home' },
  { path: '/trips/new', label: 'New Trip' },
  { path: '/settings', label: 'Preferences' },
]
