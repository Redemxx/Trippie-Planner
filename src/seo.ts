/**
 * Public-page SEO — shared by <Seo> and prerender.ts.
 */

import { APP_NAME } from './constants'

declare const __DEEPSPACE_SITE_ORIGIN__: string | undefined

export const seo = {
  title: `${APP_NAME} — Atlas Vacation & Route Planner`,
  description:
    'Collaborative AI vacation planner with travel-time route optimization, photography light windows, broad trip pacing, and real-time co-editing.',
  origin:
    typeof __DEEPSPACE_SITE_ORIGIN__ === 'string'
      ? __DEEPSPACE_SITE_ORIGIN__
      : 'http://localhost',
  noindex: false,
}
