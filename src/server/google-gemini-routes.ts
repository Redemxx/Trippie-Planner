import type { Hono } from 'hono'
import type { AppContext, Env } from '../../worker.js'
import { resolveAuth } from './http-routes.js'
import { createServerRecordTools } from './trip-helpers.js'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google Gemini' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google Gemini' },
] as const

export type GeminiModelId = (typeof GEMINI_MODELS)[number]['id']

export function isGeminiModelId(id: string | undefined): id is GeminiModelId {
  return GEMINI_MODELS.some((m) => m.id === id)
}

export type StoredGoogleCredential = {
  userId: string
  provider: 'google_gemini'
  authType: 'oauth' | 'api_key'
  googleEmail?: string
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

function hmacSecret(env: Env): string {
  return env.APP_IDENTITY_TOKEN || env.APP_OWNER_JWT || env.DEEPSPACE_APP_ID
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return toBase64Url(new Uint8Array(sig))
}

async function signState(payload: Record<string, unknown>, env: Env): Promise<string> {
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSign(encoded, hmacSecret(env))
  return `${encoded}.${sig}`
}

async function verifyState(state: string, env: Env): Promise<Record<string, unknown> | null> {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts
  const expected = await hmacSign(encoded, hmacSecret(env))
  if (sig.length !== expected.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (diff !== 0) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function getUserGeminiCredential(
  env: Env,
  userId: string,
): Promise<{
  recordId: string
  authType: 'oauth' | 'api_key'
  googleEmail?: string
  apiKey?: string
  accessToken?: string
} | null> {
  const tools = createServerRecordTools(env, userId, env.APP_OWNER_JWT ?? '')
  const q = await tools.query<StoredGoogleCredential>('user_ai_credentials', {
    where: { userId, provider: 'google_gemini' },
    limit: 1,
  })
  if (!q.success || q.data.records.length === 0) return null
  const rec = q.data.records[0]
  const data = rec.data

  if (data.authType === 'api_key' && data.apiKey) {
    return {
      recordId: rec.recordId,
      authType: 'api_key',
      googleEmail: data.googleEmail,
      apiKey: data.apiKey,
    }
  }

  if (data.authType === 'oauth' && data.accessToken) {
    let accessToken = data.accessToken
    const needsRefresh =
      typeof data.expiresAt === 'number' && Date.now() >= data.expiresAt - 60_000

    if (needsRefresh && data.refreshToken && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          refresh_token: data.refreshToken,
          grant_type: 'refresh_token',
        }),
      })
      if (tokenRes.ok) {
        const refreshed = (await tokenRes.json()) as {
          access_token?: string
          expires_in?: number
        }
        if (refreshed.access_token) {
          accessToken = refreshed.access_token
          await tools.update('user_ai_credentials', rec.recordId, {
            accessToken,
            expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
          })
        }
      }
    }

    return {
      recordId: rec.recordId,
      authType: 'oauth',
      googleEmail: data.googleEmail,
      accessToken,
    }
  }

  return null
}

async function upsertGoogleCredential(
  env: Env,
  userId: string,
  cred: Omit<StoredGoogleCredential, 'userId' | 'provider'>,
): Promise<void> {
  const tools = createServerRecordTools(env, userId, env.APP_OWNER_JWT ?? '')
  const existing = await tools.query<StoredGoogleCredential>('user_ai_credentials', {
    where: { userId, provider: 'google_gemini' },
    limit: 1,
  })
  if (existing.success && existing.data.records.length > 0) {
    await tools.update('user_ai_credentials', existing.data.records[0].recordId, cred)
  } else {
    await tools.create('user_ai_credentials', {
      userId,
      provider: 'google_gemini',
      ...cred,
    })
  }
}

export function registerGoogleGeminiRoutes(app: Hono<AppContext>): void {
  app.get('/api/ai/google/status', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)

    const cred = await getUserGeminiCredential(c.env, auth.userId)
    return c.json({
      connected: Boolean(cred),
      authType: cred?.authType ?? null,
      googleEmail: cred?.googleEmail ?? null,
      oauthConfigured: Boolean(
        c.env.GOOGLE_OAUTH_CLIENT_ID && c.env.GOOGLE_OAUTH_CLIENT_SECRET,
      ),
      models: GEMINI_MODELS,
    })
  })

  app.post('/api/ai/google/api-key', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req
      .json<{ apiKey?: string; googleEmail?: string }>()
      .catch(() => ({}) as { apiKey?: string; googleEmail?: string })
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!apiKey || apiKey.length < 16) {
      return c.json({ error: 'Enter a valid Google Gemini API key.' }, 400)
    }

    // Lightweight verification against Gemini models endpoint unless mocked/skipped
    try {
      const checkRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      )
      if (checkRes.status === 400 || checkRes.status === 401 || checkRes.status === 403) {
        return c.json(
          { error: 'Google rejected that API key. Double-check it in Google AI Studio.' },
          400,
        )
      }
    } catch {
      // Allow save if upstream check could not reach Google in isolated environments
    }

    const googleEmail =
      typeof body.googleEmail === 'string' && body.googleEmail.trim()
        ? body.googleEmail.trim()
        : auth.claims.email || undefined

    await upsertGoogleCredential(c.env, auth.userId, {
      authType: 'api_key',
      googleEmail,
      apiKey,
      accessToken: undefined,
      refreshToken: undefined,
      expiresAt: undefined,
    })

    return c.json({
      connected: true,
      authType: 'api_key',
      googleEmail: googleEmail ?? null,
    })
  })

  app.get('/api/ai/google/oauth/start', async (c) => {
    const clientId = c.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = c.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      return c.json(
        {
          error:
            'Google OAuth for Gemini is not configured on this app yet. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET via `npx deepspace secrets set`, or link your Google AI Studio key.',
        },
        400,
      )
    }

    const tokenParam = c.req.query('token')
    const reqWithAuth = tokenParam
      ? new Request(c.req.url, {
          headers: { Authorization: `Bearer ${tokenParam}` },
        })
      : c.req.raw
    const auth = await resolveAuth(reqWithAuth, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)

    const origin = new URL(c.req.url).origin
    const redirectUri = `${origin}/api/ai/google/oauth/callback`
    const state = await signState(
      {
        userId: auth.userId,
        exp: Date.now() + 10 * 60_000,
        nonce: crypto.randomUUID(),
      },
      c.env,
    )

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/generative-language.retriever',
        'https://www.googleapis.com/auth/cloud-platform',
      ].join(' '),
      state,
    })

    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  app.get('/api/ai/google/oauth/callback', async (c) => {
    const origin = new URL(c.req.url).origin
    const code = c.req.query('code')
    const stateRaw = c.req.query('state') ?? ''
    const state = await verifyState(stateRaw, c.env)
    if (!code || !state || typeof state.userId !== 'string' || Number(state.exp) < Date.now()) {
      return c.redirect(`${origin}/settings?google_gemini=error`)
    }

    const clientId = c.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = c.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      return c.redirect(`${origin}/settings?google_gemini=unconfigured`)
    }

    const redirectUri = `${origin}/api/ai/google/oauth/callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      return c.redirect(`${origin}/settings?google_gemini=error`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!tokens.access_token) {
      return c.redirect(`${origin}/settings?google_gemini=error`)
    }

    let googleEmail: string | undefined
    try {
      const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (uiRes.ok) {
        const ui = (await uiRes.json()) as { email?: string }
        googleEmail = ui.email
      }
    } catch {
      // Optional email display
    }

    await upsertGoogleCredential(c.env, state.userId, {
      authType: 'oauth',
      googleEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      apiKey: undefined,
    })

    return c.redirect(`${origin}/settings?google_gemini=connected`)
  })

  app.delete('/api/ai/google/disconnect', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)

    const tools = createServerRecordTools(c.env, auth.userId, c.env.APP_OWNER_JWT ?? '')
    await tools.deleteWhere('user_ai_credentials', {
      userId: auth.userId,
      provider: 'google_gemini',
    })
    return c.json({ connected: false })
  })
}
