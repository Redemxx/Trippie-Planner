import type { Hono } from 'hono'
import type { AppContext } from '../../worker.js'

const ALLOWED_STYLES = new Set(['dark_all', 'light_all', 'voyager'])

export function registerMapRoutes(app: Hono<AppContext>): void {
  app.get('/api/map-config', (c) => {
    return c.json({
      provider: c.env.CARTO_API_KEY ? 'carto' : 'osm',
    })
  })

  app.get('/api/map-tiles/:style/:z/:x/:y', async (c) => {
    const apiKey = c.env.CARTO_API_KEY
    if (!apiKey) {
      return c.json({ error: 'CARTO_API_KEY is not configured' }, 404)
    }

    const style = c.req.param('style')
    const z = c.req.param('z')
    const x = c.req.param('x')
    const yRaw = c.req.param('y').replace(/\.png$/i, '')

    if (!ALLOWED_STYLES.has(style) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(yRaw)) {
      return c.json({ error: 'Invalid tile coordinates' }, 400)
    }

    const pathPrefix = style === 'voyager' ? 'rastertiles/voyager' : style
    const upstream = `https://a.basemaps.cartocdn.com/${pathPrefix}/${z}/${x}/${yRaw}.png?api_key=${encodeURIComponent(apiKey)}`
    const res = await fetch(upstream)
    if (!res.ok) {
      return new Response('Tile unavailable', { status: 502 })
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  })
}
