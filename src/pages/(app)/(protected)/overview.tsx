import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Compass, Gauge, MapPin, Plus, Trash2 } from 'lucide-react'
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
import { callTripAction } from '@/lib/actions-client'
import { buildBaselineOverview } from '@/lib/overview-planner'
import type { TripPace } from '@/lib/trip-types'

const PACE_LABELS: Record<TripPace, string> = {
  relaxed: 'Relaxed (deep stays)',
  balanced: 'Balanced',
  packed: 'Packed (see more)',
}

export default function OverviewPlannerPage() {
  const navigate = useNavigate()
  const { success, error } = useToast()

  const [title, setTitle] = useState('European Rail Explorer')
  const [totalDays, setTotalDays] = useState('10')
  const [pace, setPace] = useState<TripPace>('balanced')
  const [newCity, setNewCity] = useState('')
  const [locations, setLocations] = useState<Array<{ name: string; country?: string }>>([
    { name: 'Lisbon', country: 'Portugal' },
    { name: 'Porto', country: 'Portugal' },
    { name: 'Seville', country: 'Spain' },
  ])
  const [saving, setSaving] = useState(false)

  const preview = useMemo(
    () =>
      buildBaselineOverview({
        tripId: 'preview',
        locations,
        totalDays: Math.max(1, Number(totalDays) || 10),
        pace,
        interests: ['sightseeing', 'food', 'photography'],
      }),
    [locations, totalDays, pace],
  )

  function addLocation() {
    if (!newCity.trim()) return
    setLocations((prev) => [...prev, { name: newCity.trim() }])
    setNewCity('')
  }

  async function handleSaveAsTrip() {
    if (locations.length === 0) {
      error('Add at least one destination', 'Enter the locations you want to evaluate.')
      return
    }
    setSaving(true)
    try {
      const res = await callTripAction<{ tripId: string }>('createTrip', {
        title: title.trim() || 'Overview Trip Blueprint',
        mode: 'overview',
        totalDays: Math.max(1, Number(totalDays) || 10),
        pace,
        destinations: locations,
      })
      success('Overview blueprint saved', 'Opening your collaborative overview workspace.')
      navigate(`/trips/${res.tripId}`)
    } catch (err) {
      error('Could not save overview', err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full px-5 py-6 text-foreground md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Broad Overview Mode
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
              How Long Can You Stay &amp; What Fits?
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Enter the places on your wish list and your available timeframe. Instantly see
              recommended stay lengths, transit overhead, and a generalized timeline before locking
              dates.
            </p>
          </div>
          <Button loading={saving} onClick={handleSaveAsTrip} data-testid="save-overview-trip-btn">
            Save &amp; Refine with AI
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>

        {/* Controls */}
        <div className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-12">
          <div className="md:col-span-5">
            <Label htmlFor="ov-title">Blueprint title</Label>
            <Input
              id="ov-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Iberia 10-Day Loop"
            />
          </div>
          <div className="md:col-span-3">
            <Label htmlFor="ov-days">Available days</Label>
            <Input
              id="ov-days"
              type="number"
              min={1}
              max={60}
              value={totalDays}
              onChange={(e) => setTotalDays(e.target.value)}
            />
          </div>
          <div className="md:col-span-4">
            <Label>Travel pace</Label>
            <Select
              value={pace}
              onValueChange={(v) => v && setPace(v as TripPace)}
              items={PACE_LABELS}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PACE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end gap-2 md:col-span-12">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="ov-add-city">Add a destination to test</Label>
              <Input
                id="ov-add-city"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                placeholder="e.g. Madrid, Kyoto, Amalfi..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addLocation()
                }}
              />
            </div>
            <Button variant="secondary" onClick={addLocation}>
              <Plus className="size-3.5" aria-hidden />
              Add Place
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-12">
            {locations.map((loc, idx) => (
              <div
                key={loc.name + idx}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs"
              >
                <MapPin className="size-3.5 text-primary" aria-hidden />
                <span className="font-medium">{loc.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${loc.name}`}
                  onClick={() => setLocations((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Live Pacing & Feasibility Preview */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Gauge className="size-4 text-primary" aria-hidden />
            <Badge
              variant="outline"
              className={
                preview.feasibilityStatus === 'comfortable'
                  ? 'border-success/40 text-success'
                  : preview.feasibilityStatus === 'ambitious'
                    ? 'border-warning/40 text-warning'
                    : 'border-destructive/40 text-destructive'
              }
            >
              {preview.feasibilityStatus.toUpperCase()} · {preview.feasibilityScore}/100
            </Badge>
            <span className="text-xs text-muted-foreground">
              Est. intercity transit: {preview.totalTransitHours} hrs
            </span>
          </div>
          <p className="mt-3 text-sm text-foreground">{preview.summary}</p>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {preview.allocations.map((alloc) => (
              <div
                key={alloc.destinationName}
                className="rounded-lg border border-border bg-muted/30 p-3.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {alloc.destinationName}
                  </span>
                  <Badge>{alloc.recommendedDays} days</Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Minimum recommended: {alloc.minDays}d
                </p>
                <p className="mt-2 text-muted-foreground">{alloc.rationale}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Compass className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">
              Generalized {totalDays}-Day Outline
            </h2>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {preview.dailyOutline.map((d) => (
              <div key={d.dayNumber} className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                <p className="font-mono font-semibold text-primary">
                  Day {d.dayNumber} · {d.location} — {d.theme}
                </p>
                <p className="mt-1 text-muted-foreground">{d.morning}</p>
                <p className="mt-1 text-muted-foreground">{d.evening}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
