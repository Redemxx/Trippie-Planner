import { useState } from 'react'
import { Camera, Calendar, Compass, MapPin, Plus, RefreshCw, Sparkles, Utensils } from 'lucide-react'
import { integration } from 'deepspace'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'
import type { DestinationData, LightWindow, StopCategory, StopData } from '@/lib/trip-types'

interface PlaceCandidate {
  id: string
  title: string
  address?: string
  rating?: number
  type?: string
  lat?: number
  lng?: number
  category: StopCategory
  bestLightWindow?: LightWindow
  photoTip?: string
}

interface DiscoverPanelProps {
  destinations: Array<DestinationData & { id?: string }>
  totalDays: number
  activeDay: number
  canEdit: boolean
  onAddStop: (
    payload: Partial<StopData> & { dayNumber: number; title: string; category: StopCategory },
  ) => Promise<void>
  onAskAi?: (prompt: string) => void
}

type FilterTab = 'must_see' | 'restaurant' | 'photo_spot' | 'day_trip' | 'events'

const QUERY_SUFFIX: Record<FilterTab, string> = {
  must_see: 'top sightseeing landmarks must see',
  restaurant: 'best local restaurants street food',
  photo_spot: 'best scenic viewpoints sunset photography spots',
  day_trip: 'best day trips nearby excursions',
  events: 'upcoming concerts festivals exhibitions',
}

export function DiscoverPanel({
  destinations,
  totalDays,
  activeDay,
  canEdit,
  onAddStop,
  onAskAi,
}: DiscoverPanelProps) {
  const { success, error } = useToast()
  const [selectedDest, setSelectedDest] = useState<string>(destinations[0]?.name ?? '')
  const [filter, setFilter] = useState<FilterTab>('photo_spot')
  const [customQuery, setCustomQuery] = useState('')
  const [targetDay, setTargetDay] = useState(String(activeDay))
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [results, setResults] = useState<PlaceCandidate[]>([])
  const [addingId, setAddingId] = useState<string | null>(null)

  const effectiveDest = selectedDest || destinations[0]?.name || ''

  async function runSearch(tabOverride?: FilterTab) {
    const activeTab = tabOverride ?? filter
    const locationPart = effectiveDest || 'Kyoto'
    const q = customQuery.trim()
      ? `${customQuery.trim()} in ${locationPart}`
      : `${QUERY_SUFFIX[activeTab]} in ${locationPart}`

    setStatus('loading')
    setErrorMsg(null)
    try {
      if (activeTab === 'events') {
        const res = await integration.post<{
          events_results?: Array<{
            title?: string
            date?: { when?: string }
            address?: string[]
            link?: string
          }>
        }>('serpapi/events', { q, location: locationPart })
        if (!res.success || !res.data) {
          setStatus('error')
          setErrorMsg(res.error ?? 'Events search failed')
          return
        }
        const mapped: PlaceCandidate[] = (res.data.events_results ?? [])
          .slice(0, 8)
          .map((ev, i) => ({
            id: `ev-${i}`,
            title: ev.title ?? 'Local Event',
            address: Array.isArray(ev.address) ? ev.address.join(', ') : ev.date?.when,
            type: ev.date?.when ?? 'Event',
            category: 'must_see',
          }))
        setResults(mapped)
        setStatus('ready')
        return
      }

      const res = await integration.post<{
        local_results?: Array<{
          title?: string
          address?: string
          rating?: number
          type?: string
          gps_coordinates?: { latitude?: number; longitude?: number }
        }>
      }>('serpapi/places-search', { q })

      if (!res.success || !res.data) {
        setStatus('error')
        setErrorMsg(res.error ?? 'Places search failed')
        return
      }

      const mapped: PlaceCandidate[] = (res.data.local_results ?? [])
        .slice(0, 8)
        .map((p, i) => ({
          id: `place-${i}`,
          title: p.title ?? 'Place',
          address: p.address,
          rating: p.rating,
          type: p.type,
          lat: p.gps_coordinates?.latitude,
          lng: p.gps_coordinates?.longitude,
          category: activeTab === 'photo_spot' ? 'photo_spot' : activeTab,
          bestLightWindow: activeTab === 'photo_spot' ? 'golden_hour' : 'any',
          photoTip:
            activeTab === 'photo_spot'
              ? 'Scout vantage point 20 minutes before sunset for clean framing.'
              : undefined,
        }))
      setResults(mapped)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Discovery search failed')
    }
  }

  async function handleAdd(item: PlaceCandidate) {
    setAddingId(item.id)
    try {
      const dayNum = Math.max(1, Math.min(totalDays || 1, Number(targetDay) || activeDay))
      await onAddStop({
        dayNumber: dayNum,
        title: item.title,
        category: item.category,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        rating: item.rating,
        bestLightWindow: item.bestLightWindow,
        photoTip: item.photoTip,
        preferredWindow:
          item.category === 'photo_spot'
            ? 'golden_hour'
            : item.category === 'restaurant'
              ? 'dinner'
              : 'afternoon',
      })
      success('Added to itinerary', `"${item.title}" placed on Day ${dayNum}.`)
    } catch (err) {
      error('Could not add stop', err instanceof Error ? err.message : 'Failed')
    } finally {
      setAddingId(null)
    }
  }

  const destItems = Object.fromEntries(destinations.map((d) => [d.name, d.name]))
  const dayItems = Object.fromEntries(
    Array.from({ length: Math.max(1, totalDays) }, (_, i) => [String(i + 1), `Day ${i + 1}`]),
  )

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          {destinations.length > 0 && (
            <div>
              <Label>Destination</Label>
              <Select
                value={effectiveDest}
                onValueChange={(v) => v && setSelectedDest(v)}
                items={destItems}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {destinations.map((d) => (
                    <SelectItem key={d.name} value={d.name}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="min-w-[200px] flex-1">
            <Label htmlFor="discover-query">Refine search (optional)</Label>
            <Input
              id="discover-query"
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder="e.g. rooftop cocktail, quiet tea house, waterfall hike"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
            />
          </div>

          <div>
            <Label>Add to</Label>
            <Select
              value={targetDay}
              onValueChange={(v) => v && setTargetDay(v)}
              items={dayItems}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(dayItems).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button loading={status === 'loading'} onClick={() => void runSearch()}>
            Search Places
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['photo_spot', 'Photo Spots', Camera],
              ['must_see', 'Must-See', Compass],
              ['restaurant', 'Restaurants', Utensils],
              ['day_trip', 'Day Trips', MapPin],
              ['events', 'Events', Calendar],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setFilter(id)
                void runSearch(id)
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' && (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-muted/60" />
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-card p-4 text-sm">
          <div>
            <p className="font-medium text-foreground">Live search unavailable</p>
            <p className="text-xs text-muted-foreground">
              {errorMsg || 'Please check your DeepSpace credits or try again.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void runSearch()}>
              <RefreshCw className="size-3.5" aria-hidden />
              Retry
            </Button>
            {onAskAi && (
              <Button
                size="sm"
                onClick={() =>
                  onAskAi(
                    `Recommend 4 ${filter.replace('_', ' ')} options in ${effectiveDest || 'our next stop'} with coordinates and add the top pick to Day ${targetDay}.`,
                  )
                }
              >
                <Sparkles className="size-3.5" aria-hidden />
                Ask AI Instead
              </Button>
            )}
          </div>
        </div>
      )}

      {status === 'idle' && (
        <EmptyState
          icon={<Camera className="size-5" />}
          title="Discover live spots & photo locations"
          description="Pick a category above or search for cafes, scenic viewpoints, hidden gems, and local events to add straight to your itinerary."
          action={{ label: `Search ${effectiveDest || 'places'}`, onClick: () => void runSearch() }}
        />
      )}

      {status === 'ready' && results.length === 0 && (
        <EmptyState
          icon={<MapPin className="size-5" />}
          title="No matches found"
          description="Try broadening your search terms or ask the AI Concierge for bespoke local picks."
        />
      )}

      {status === 'ready' && results.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between rounded-xl border border-border bg-card p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
                  {item.rating && (
                    <Badge variant="secondary" className="shrink-0 text-[11px]">
                      ★ {item.rating.toFixed(1)}
                    </Badge>
                  )}
                </div>
                {item.type && <p className="mt-0.5 text-xs text-primary">{item.type}</p>}
                {item.address && (
                  <p className="mt-1 text-xs text-muted-foreground">{item.address}</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-[11px] text-muted-foreground">
                  {item.lat && item.lng ? 'Mapped GPS ready' : 'Address match'}
                </span>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={addingId === item.id}
                    onClick={() => void handleAdd(item)}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Add to Day {targetDay}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
