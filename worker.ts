/**
 * App Worker — explicit assembly for DeepSpace app routes and Durable Objects.
 *
 * Route implementations live under src/server. Keep their registration order
 * here: specific API and WebSocket handlers must precede the SPA fallback.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  PresenceRoom,
  RecordRoom,
  workerErrorHandler,
} from 'deepspace/worker'
import type { DOBindings, DOManifest } from 'deepspace/worker'
import { AI_CHATS_SCHEMA } from 'deepspace/schema'
import { registerAgent } from './src/ai/agent.js'
import { buildTools } from './src/ai/tools.js'
import { schemas } from './src/schemas.js'
import { registerActionRoutes } from './src/server/action-routes.js'
import { registerGoogleGeminiRoutes } from './src/server/google-gemini-routes.js'
import {
  registerAuthAndIntegrationRoutes,
  registerPlatformProxyRoutes,
  registerStaticRoutes,
  resolveAuth,
} from './src/server/http-routes.js'
import { registerMapRoutes } from './src/server/map-routes.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }
}

export class AppPresenceRoom extends PresenceRoom<Env> {}

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Platform service binding in production; deepspace dev supplies the URL
   * fallback. Standard app files use the platform's shared, app-scoped R2
   * bucket rather than a local binding.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  /**
   * HMAC app credential minted on first deploy. Proxy routes omit identity
   * headers when it is absent so upstream services fail closed.
   */
  APP_IDENTITY_TOKEN?: string
  /** API service binding in production with a deepspace-dev URL fallback. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  /** Comma-separated exact Expo/native callback URIs (for example, myapp://auth/callback). */
  NATIVE_AUTH_REDIRECT_URIS?: string
  APP_NAME: string
  /** Immutable record-scope and platform identity. */
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived owner JWT used for developer-billed server calls. User-billed
   * calls always forward the signed-in caller's JWT instead.
   */
  APP_OWNER_JWT: string
  /**
   * Enables /api/debug/* only when exactly "true". The route still requires
   * an authenticated app owner/admin. deepspace dev/test set it locally.
   */
  ALLOW_DEBUG_ROUTES?: string
  /** Optional CartoDB basemaps API key stored via `npx deepspace secrets set CARTO_API_KEY=...`. */
  CARTO_API_KEY?: string
  /** Optional Google OAuth client credentials for per-user Gemini OAuth linking. */
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  /** Per-app AES-256-GCM key derivation secret for encrypting stored user AI credentials. */
  USER_CREDENTIALS_ENCRYPTION_KEY?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()
app.use('/api/*', cors())

// Registration order is part of the worker contract. The wildcard auth route
// follows its special cases, AI precedes platform proxies, and static is last.
registerAuthAndIntegrationRoutes(app)
registerMapRoutes(app)
registerGoogleGeminiRoutes(app)
registerRealtimeRoutes(app)
registerActionRoutes(app, resolveAuth)
// Every scaffold exposes selected tools through HTTP, MCP and browser tools.
// Only copilot owns the collections needed for the in-app chat UI.
registerAgent(app, {
  tools: buildTools,
  inApp: schemas.some((schema) => schema.name === AI_CHATS_SCHEMA.name),
})
registerPlatformProxyRoutes(app)
registerStaticRoutes(app)

// Hono registers ONE error handler (last onError wins), and its default is
// `console.error(err)` — whose message Workers Logs drops, keeping only the
// stack frames. workerErrorHandler logs the string form instead (message
// first, frames and bounded cause chain, method + path for context), keeps a
// response-bearing error's (HTTPException — auth 401s, upload 413s) own
// answer, and returns a generic 500 for the rest.
app.onError(workerErrorHandler('error'))

export default app
