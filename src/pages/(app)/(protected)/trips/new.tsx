import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Compass, MapPin, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '@/components/ui'
import { callTripAction } from '@/lib/actions-client'
import type {
  BudgetTier,
  IntercityTransport,
  TransportMode,
  TripMode,
  TripPace,
} from '@/lib/trip-types'

interface DestDraft {
  id: string
  name: string
  country: string
  arrivalDate: string
  departureDate: string
  transportFromPrev: IntercityTransport
}

const PACE_ITEMS: Record<TripPace, string> = {
  relaxed: 'Relaxed (2–3 stops/day)',
  balanced: 'Balanced (3–4 stops/day)',
  packed: 'Packed (5+ stops/day)',
}

const BUDGET_ITEMS: Record<BudgetTier, string> = {
  budget: 'Budget-conscious',
  moderate: 'Moderate',
  luxury: 'Luxury',
}

const TRANSPORT_ITEMS: Record<TransportMode, string> = {
  walk: 'Mostly Walking',
  transit: 'Public Transit + Walk',
  drive: 'Car / Taxi',
}

const INTEREST_OPTIONS = [
  'sightseeing',
  'food',
  'photography',
  'hidden-gems',
  'nature',
  'history',
  'art',
  'nightlife',
] as const

export default function NewTripPage() {
  const navigate = useNavigate()
  const { success, error } = useToast()

  const [mode, setMode] = useState<TripMode>('detailed')
  const [title, setTitle] = useState('')
  const [totalDays, setTotalDays] = useState('7')
  const [travelers, setTravelers] = useState('2')
  const [pace, setPace] = useState<TripPace>('balanced')
  const [budgetTier, setBudgetTier] = useState<BudgetTier>('moderate')
  const [transportPreference, setTransportPreference] = useState<TransportMode>('transit')
  const [interests, setInterests] = useState<string[]>(['sightseeing', 'food', 'photography'])
  const [summaryNotes, setSummaryNotes] = useState('')
  const [destinations, setDestinations] = useState<DestDraft[]>([
    {
      id: 'd1',
      name: '',
      country: '',
      arrivalDate: '',
      departureDate: '',
      transportFromPrev: 'none',
    },
  ])
  const [titleError, setTitleError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function toggleInterest(tag: string) {
    setInterests((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  function addDestRow() {
    setDestinations((prev) => [
      ...prev,
      {
        id: `d-${Date.now()}-${prev.length}`,
        name: '',
        country: '',
        arrivalDate: '',
        departureDate: '',
        transportFromPrev: 'train',
      },
    ])
  }

  function updateDest(id: string, patch: Partial<DestDraft>) {
    setDestinations((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function removeDest(id: string) {
    setDestinations((prev) => (prev.length > 1 ? prev.filter((d) => d.id !== id) : prev))
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setTitleError('Give your trip a name (e.g., "Autumn in Japan").')
      return
    }
    setTitleError('')
    const validDests = destinations.filter((d) => d.name.trim().length > 0)
    const firstArrival = validDests.find((d) => d.arrivalDate)?.arrivalDate
    const lastDeparture = validDests
      .slice()
      .reverse()
      .find((d) => d.departureDate)?.departureDate

    setSubmitting(true)
    try {
      const res = await callTripAction<{ tripId: string }>('createTrip', {
        title: title.trim(),
        mode,
        startDate: firstArrival || undefined,
        endDate: lastDeparture || undefined,
        totalDays: Math.max(1, Number(totalDays) || 7),
        travelers: Math.max(1, Number(travelers) || 2),
        pace,
        budgetTier,
        transportPreference,
        interests,
        summaryNotes: summaryNotes.trim() || undefined,
        destinations: validDests.map((d) => ({
          name: d.name.trim(),
          country: d.country.trim() || undefined,
          arrivalDate: d.arrivalDate || undefined,
          departureDate: d.departureDate || undefined,
          transportFromPrev: d.transportFromPrev,
        })),
      })
      success('Trip created', `"${title.trim()}" is ready in your atlas.`)
      navigate(`/trips/${res.tripId}`)
    } catch (err) {
      error('Could not create trip', err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-full px-4 py-5 text-foreground sm:px-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">New Atlas</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Create a Vacation Plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with fixed dates per city, or choose Broad Overview Mode to test stay durations
            and pacing first.
          </p>
        </div>

        {/* Mode Picker */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode('detailed')}
            className={`rounded-xl border p-4 text-left transition-colors ${
              mode === 'detailed'
                ? 'border-primary bg-accent/40'
                : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MapPin className="size-4 text-primary" aria-hidden />
              Detailed Itinerary Mode
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter cities &amp; exact dates, map daily stops, and optimize transit times.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('overview')}
            className={`rounded-xl border p-4 text-left transition-colors ${
              mode === 'overview'
                ? 'border-primary bg-accent/40'
                : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Compass className="size-4 text-primary" aria-hidden />
              Broad Overview Mode
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              List places you want to visit + total days; get suggested stay lengths &amp;
              feasibility.
            </p>
          </button>
        </div>

        {/* Core Details */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div>
            <Label htmlFor="trip-title">Trip title</Label>
            <Input
              id="trip-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Portugal Coast & Douro Valley"
            />
            {titleError && <p className="mt-1 text-xs text-destructive">{titleError}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="trip-days">
                {mode === 'overview' ? 'Total timeframe (days)' : 'Est. days'}
              </Label>
              <Input
                id="trip-days"
                type="number"
                min={1}
                max={60}
                value={totalDays}
                onChange={(e) => setTotalDays(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="trip-travelers">Travelers</Label>
              <Input
                id="trip-travelers"
                type="number"
                min={1}
                max={20}
                value={travelers}
                onChange={(e) => setTravelers(e.target.value)}
              />
            </div>
            <div>
              <Label>Pace</Label>
              <Select
                value={pace}
                onValueChange={(v) => v && setPace(v as TripPace)}
                items={PACE_ITEMS}
              >
                <SelectTrigger className="w-full" data-testid="new-trip-pace-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PACE_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Budget</Label>
              <Select
                value={budgetTier}
                onValueChange={(v) => v && setBudgetTier(v as BudgetTier)}
                items={BUDGET_ITEMS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BUDGET_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Default local transport</Label>
              <Select
                value={transportPreference}
                onValueChange={(v) => v && setTransportPreference(v as TransportMode)}
                items={TRANSPORT_ITEMS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSPORT_ITEMS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Focus areas</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {INTEREST_OPTIONS.map((tag) => {
                  const active = interests.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleInterest(tag)}
                      className={`rounded-md border px-2.5 py-1 text-xs capitalize transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tag.replace('-', ' ')}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Destinations */}
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Destinations &amp; Dates</h2>
              <p className="text-xs text-muted-foreground">
                {mode === 'overview'
                  ? 'Just list the cities/regions you hope to see — Trippie will suggest stay durations.'
                  : 'Add each stop and your arrival/departure dates.'}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={addDestRow}>
              <Plus className="size-3.5" aria-hidden />
              Add Destination
            </Button>
          </div>

          <div className="space-y-3">
            {destinations.map((dest, idx) => (
              <div
                key={dest.id}
                className="space-y-3 rounded-lg border border-border bg-muted/30 p-3.5"
              >
                <div className="flex items-end gap-3">
                  <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>City / Region #{idx + 1}</Label>
                      <Input
                        value={dest.name}
                        onChange={(e) => updateDest(dest.id, { name: e.target.value })}
                        placeholder="e.g. Lisbon"
                      />
                    </div>
                    <div>
                      <Label>Country</Label>
                      <Input
                        value={dest.country}
                        onChange={(e) => updateDest(dest.id, { country: e.target.value })}
                        placeholder="Portugal"
                      />
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove destination"
                    disabled={destinations.length === 1}
                    onClick={() => removeDest(dest.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>

                {mode === 'detailed' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Arrive</Label>
                      <Input
                        type="date"
                        value={dest.arrivalDate}
                        onChange={(e) => updateDest(dest.id, { arrivalDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Depart</Label>
                      <Input
                        type="date"
                        value={dest.departureDate}
                        onChange={(e) => updateDest(dest.id, { departureDate: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div>
            <Label htmlFor="trip-notes">Preferences / must-do notes for the AI</Label>
            <Textarea
              id="trip-notes"
              rows={2}
              value={summaryNotes}
              onChange={(e) => setSummaryNotes(e.target.value)}
              placeholder="e.g. Love sunrise coastal photography, vegetarian-friendly dinner spots, prefer trains over flights..."
            />
          </div>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/home')}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            className="w-full sm:w-auto"
            onClick={handleSubmit}
            data-testid="create-trip-submit"
          >
            Create Trip
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}
