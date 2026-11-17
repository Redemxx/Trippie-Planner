import { useState } from 'react'
import { signOut, useUser } from 'deepspace'
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'

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

export default function SettingsPage() {
  const { user } = useUser()
  const { success } = useToast()
  const [defaultPace, setDefaultPace] = useState('balanced')
  const [defaultTransport, setDefaultTransport] = useState('transit')

  function saveLocalPreferences() {
    try {
      localStorage.setItem(
        'trippie-prefs',
        JSON.stringify({ defaultPace, defaultTransport }),
      )
    } catch { /* ignore */ }
    success('Preferences saved', 'Default trip planning preferences updated.')
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-12">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Preferences</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Account &amp; Travel Defaults</h1>
        </div>

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
