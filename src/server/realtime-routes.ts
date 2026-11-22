/**
 * WebSocket routing for app-owned Durable Objects.
 *
 * Caller identity in query parameters and headers is never trusted. Routes
 * scrub it and forward verified JWT identity in internal-only headers.
 * Only the primary RecordRoom (`app:<DEEPSPACE_APP_ID>`) and authenticated
 * trip presence rooms (`trip:<tripId>`) are exposed.
 */

import type { Context, Hono } from 'hono'
import { authenticatedRoomRequest, verifyJwt } from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'
import { assertTripAccess, createServerRecordTools } from './trip-helpers.js'

function jwtConfig(env: Env): JwtVerifierConfig {
  return { publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }
}

async function resolvePresenceRole(
  env: Env,
  scopeId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  if (!scopeId.startsWith('trip:')) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  const tripId = scopeId.slice('trip:'.length)
  if (!tripId || tripId === 'none') {
    return { ok: false, status: 404, error: 'Not found' }
  }
  const tools = createServerRecordTools(env, userId, env.APP_OWNER_JWT ?? '')
  const access = await assertTripAccess(tools, tripId, userId, 'viewer')
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error }
  }
  return { ok: true }
}

export function registerRealtimeRoutes(app: Hono<AppContext>): void {
  // Primary RecordRoom WebSocket (supports anonymous read for public sample on /home;
  // restricted to the app's canonical `app:<DEEPSPACE_APP_ID>` room).
  app.get('/ws/:roomId', async (c: Context<AppContext>) => {
    const id = c.req.param('roomId')
    if (!id || id !== `app:${c.env.DEEPSPACE_APP_ID}`) {
      return new Response('Not found', { status: 404 })
    }
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt(jwtConfig(c.env), token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }

    const roomRequest = authenticatedRoomRequest(c.req.raw, auth)
    const stub = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(id))
    return stub.fetch(roomRequest)
  })

  // Trip presence WebSocket — requires authenticated JWT and verified trip membership.
  app.get('/ws/presence/:scopeId', async (c: Context<AppContext>) => {
    const scopeId = c.req.param('scopeId') ?? ''
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')
    const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
    if (!auth) return new Response('Unauthorized', { status: 401 })

    const access = await resolvePresenceRole(c.env, scopeId, auth.userId)
    if (!access.ok) {
      return new Response(access.error, { status: access.status })
    }

    const roomRequest = authenticatedRoomRequest(c.req.raw, auth)
    const stub = c.env.PRESENCE_ROOMS.get(c.env.PRESENCE_ROOMS.idFromName(scopeId))
    return stub.fetch(roomRequest)
  })
}
