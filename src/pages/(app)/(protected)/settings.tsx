import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, KeyRound, Link2, Sparkles, Unlink } from 'lucide-react'
import { getAuthToken, signOut, useUser } from 'deepspace'
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'

const PACE_OPTIONS = {
  relaxed: 'Relaxed (2–3 stops/day)',
  balanced: 'Balanced (3–4 stops/day)',
  packed: 'Packed (5+ stops/day)',
}

const TRANSPORT_OPTIONS = {
  walk: 'Walking',
  transit: 'Public Transit',
  drive: 'Car / Rideshare',
}

interface GoogleGeminiStatus {
  connected: boolean
  authType: 'oauth' | 'api_key' | null
  googleEmail: string | null
  oauthConfigured: boolean
}

export default function SettingsPage() {
  const { user } = useUser()
  const { success, error } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [defaultPace, setDefaultPace] = useState('balanced')
  const [defaultTransport, setDefaultTransport] = useState('transit')

  const [geminiStatus, setGeminiStatus] = useState<GoogleGeminiStatus | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [googleEmailInput, setGoogleEmailInput] = useState('')
  const [savingGemini, setSavingGemini] = useState(false)
  const [disconnectingGemini, setDisconnectingGemini] = useState(false)

  async function loadGeminiStatus() {
    try {
      const token = await getAuthToken()
      if (!token) return
      const res = await fetch('/api/ai/google/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setGeminiStatus((await res.json()) as GoogleGeminiStatus)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadGeminiStatus()
  }, [])

  useEffect(() => {
    const param = searchParams.get('google_gemini')
    if (!param) return
    if (param === 'connected') {
      success('Google Gemini linked', 'You can now select Gemini 4 Hydrogen & 3.8 Flash in the AI Concierge.')
      window.dispatchEvent(new Event('trippie:google-ai-updated'))
      void loadGeminiStatus()
    } else if (param === 'error') {
      error('Google link failed', 'Could not complete Google OAuth linking. Please try again.')
    }
    searchParams.delete('google_gemini')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams, success, error])

  function saveLocalPreferences() {
    try {
      localStorage.setItem(
        'trippie-prefs',
        JSON.stringify({ defaultPace, defaultTransport }),
      )
    } catch { /* ignore */ }
    success('Preferences saved', 'Default trip planning preferences updated.')
  }

  async function handleConnectGoogleOAuth() {
    const token = await getAuthToken()
    if (!token) {
      error('Sign in required', 'Please sign in first.')
      return
    }
    try {
      const res = await fetch('/api/ai/google/oauth/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = (await res.json().catch(() => ({}))) as { authUrl?: string; error?: string }
      if (!res.ok || !body.authUrl) {
        throw new Error(body.error || 'Could not initiate Google OAuth')
      }
      window.location.href = body.authUrl
    } catch (err) {
      error('Google OAuth failed', err instanceof Error ? err.message : 'Could not start OAuth')
    }
  }

  async function handleSaveGeminiKey() {
    if (!apiKeyInput.trim()) {
      error('API key required', 'Paste your Google AI Studio Gemini API key.')
      return
    }
    setSavingGemini(true)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/ai/google/api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          apiKey: apiKeyInput.trim(),
          googleEmail: googleEmailInput.trim() || user?.email || undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(body.error || 'Could not link Gemini key')
      }
      setApiKeyInput('')
      success('Google Gemini linked', 'Gemini 4 Hydrogen & 3.8 Flash are now active in the AI Concierge.')
      window.dispatchEvent(new Event('trippie:google-ai-updated'))
      await loadGeminiStatus()
    } catch (err) {
      error('Could not link Gemini', err instanceof Error ? err.message : 'Failed')
    } finally {
      setSavingGemini(false)
    }
  }

  async function handleDisconnectGemini() {
    setDisconnectingGemini(true)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/ai/google/disconnect', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Disconnect failed')
      success('Disconnected', 'Removed your linked Google Gemini credentials.')
      window.dispatchEvent(new Event('trippie:google-ai-updated'))
      await loadGeminiStatus()
    } catch (err) {
      error('Disconnect failed', err instanceof Error ? err.message : 'Failed')
    } finally {
      setDisconnectingGemini(false)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Preferences</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Account, Gemini AI &amp; Travel Defaults
          </h1>
        </div>

        {/* Google Account & Gemini AI Linking */}
        <section
          data-testid="google-gemini-settings"
          className="space-y-4 rounded-xl border border-border bg-card p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              <h2 className="text-base font-semibold">Google Account &amp; Gemini AI</h2>
            </div>
            {geminiStatus?.connected ? (
              <Badge variant="outline" className="border-success/40 text-success">
                Connected ({geminiStatus.authType === 'oauth' ? 'Google OAuth' : 'Google AI Studio'})
              </Badge>
            ) : (
              <Badge variant="secondary">Not linked</Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Link your Google account so you can choose <strong>Gemini 4 Hydrogen</strong>,{' '}
            <strong>Carbon</strong>, <strong>Argon</strong>, or{' '}
            <strong>Gemini 3.8 / 3.5 Flash</strong> inside the AI Concierge. Your credentials stay
            stored server-side only and are never exposed to other users.
          </p>

          {geminiStatus?.connected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3.5 text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {geminiStatus.googleEmail || 'Google Gemini Active'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Select Gemini 4 Hydrogen or Gemini 3.8 Flash from the model menu in the AI Concierge.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={disconnectingGemini}
                onClick={handleDisconnectGemini}
                data-testid="disconnect-gemini-btn"
              >
                <Unlink className="size-3.5" aria-hidden />
                Disconnect
              </Button>
            </div>
          )}

          {geminiStatus?.oauthConfigured && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3.5">
              <div className="text-xs">
                <p className="font-medium text-foreground">Google OAuth (Direct Account Link)</p>
                <p className="text-muted-foreground">
                  Authorize Trippie to call Gemini directly with your Google account.
                </p>
              </div>
              <Button size="sm" onClick={handleConnectGoogleOAuth}>
                <Link2 className="size-3.5" aria-hidden />
                {geminiStatus.connected ? 'Reconnect Google OAuth' : 'Connect Google Account'}
              </Button>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <KeyRound className="size-3.5 text-primary" aria-hidden />
                <span>Link via Google AI Studio (Gemini API Key)</span>
              </div>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Get key with your Google account
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="gemini-api-key">Gemini API Key</Label>
                <Input
                  id="gemini-api-key"
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIza..."
                />
              </div>
              <div>
                <Label htmlFor="gemini-email">Google account email label (optional)</Label>
                <Input
                  id="gemini-email"
                  type="email"
                  value={googleEmailInput}
                  onChange={(e) => setGoogleEmailInput(e.target.value)}
                  placeholder={user?.email ?? 'you@gmail.com'}
                />
              </div>
            </div>

            <Button
              size="sm"
              loading={savingGemini}
              onClick={handleSaveGeminiKey}
              data-testid="save-gemini-key-btn"
            >
              Link Google Gemini Key
            </Button>
          </div>
        </section>

        {/* Planning Defaults */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold">Planning Defaults</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Default pace</Label>
              <Select
                value={defaultPace}
                onValueChange={(v) => v && setDefaultPace(v)}
                items={PACE_OPTIONS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PACE_OPTIONS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Preferred local transit</Label>
              <Select
                value={defaultTransport}
                onValueChange={(v) => v && setDefaultTransport(v)}
                items={TRANSPORT_OPTIONS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSPORT_OPTIONS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" onClick={saveLocalPreferences}>
            Save Defaults
          </Button>
        </section>

        {/* Account */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-base font-semibold">Your Account</h2>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>
      </div>
    </div>
  )
}
