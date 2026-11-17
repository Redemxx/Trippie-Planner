/* home pattern: product-preview-first — active trips hub or interactive Kyoto sample atlas for signed-out visitors */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Calendar,
  Camera,
  Compass,
  Copy,
  Map as MapIcon,
  MapPin,
  Plus,
  Route,
  Users,
} from 'lucide-react'
import { AuthOverlay, useAuth, useQuery } from 'deepspace'
import {
  Badge,
  Button,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/components/ui'
import { AtlasMap } from '@/components/trip/AtlasMap'
import { callTripAction } from '@/lib/actions-client'
import { computeDaySchedule } from '@/lib/route-optimizer'
import { SAMPLE_TRIP } from '@/lib/sample-trip'
import {
  CATEGORY_META,
  LIGHT_WINDOW_LABELS,
  type DestinationData,
  type TeamMemberData,
  type TripData,
} from '@/lib/trip-types'

const TRIP_COVERS = [
  '/images/card-coast.jpg',
  '/images/card-lagoon.jpg',
  '/images/card-forest.jpg',
] as const

export default function HomePage() {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const navigate = useNavigate()
  const { success, error } = useToast()

  const { records: tripRecords, status: tripsStatus } = useQuery<TripData>('trips', {
    orderBy: 'updatedAt',
    orderDir: 'desc',
  })
  const { records: destRecords } = useQuery<DestinationData>('trip_destinations')
  const { records: memberRecords } = useQuery<TeamMemberData>('team_members')

  const [showAuth, setShowAuth] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [sampleDay, setSampleDay] = useState(1)
  const [sampleTab, setSampleTab] = useState<'itinerary' | 'overview'>('itinerary')
  const [selectedSampleStop, setSelectedSampleStop] = useState<string | null>(null)

  const sampleDayStops = useMemo(
    () => SAMPLE_TRIP.stops.filter((s) => s.dayNumber === sampleDay),
    [sampleDay],
  )
  const sampleSchedule = useMemo(() => computeDaySchedule(sampleDayStops), [sampleDayStops])

  async function handleCloneSample() {
    if (!isSignedIn) {
      setShowAuth(true)
      return
    }
    setCloning(true)
    try {
      const res = await callTripAction<{ tripId: string }>('cloneSampleTrip')
      success('Sample trip cloned', 'Kyoto & Hakone Autumn Atlas is now in your workspace.')
      navigate(`/trips/${res.tripId}`)
    } catch (err) {
      error('Could not clone sample trip', err instanceof Error ? err.message : 'Failed')
    } finally {
      setCloning(false)
    }
  }

  function resolveUserRoleForTrip(trip: TripData, tripId: string): 'Owner' | 'Editor' | 'Viewer' {
    if (trip.ownerId === userId) return 'Owner'
    if (Array.isArray(trip.editors) && userId && trip.editors.includes(userId)) return 'Editor'
    const m = memberRecords.find(
      (r) => r.data.teamId === tripId && r.data.userId === userId && r.data.status === 'active',
    )
    if (m?.data.role === 'editor') return 'Editor'
    return 'Viewer'
  }

  return (
    <div className="min-h-full px-4 py-5 text-foreground sm:px-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
        {/* Tropical Lagoon Header Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-[#044649] p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
          <img
            src="/images/hero-lagoon.jpg"
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(105deg, rgba(3, 52, 55, 0.94) 0%, rgba(5, 75, 79, 0.82) 55%, rgba(4, 54, 57, 0.60) 100%)',
            }}
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#5eead4]">
                Trippie Coastal Atlas
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">
                {isSignedIn ? 'Your Vacation Atlas' : 'Kyoto & Hakone Route Atlas'}
              </h1>
              <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-white/85 sm:text-sm">
                {isSignedIn
                  ? 'Build multi-stop itineraries, test pacing in Overview Mode, optimize transit legs, and steer plans with your AI Concierge.'
                  : 'Preview a live travel-time optimized itinerary with golden-hour photo spots and overview pacing. Sign in to create and co-edit your own trips.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isSignedIn ? (
                <>
                  <Button
                    variant="outline"
                    className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                    loading={cloning}
                    onClick={handleCloneSample}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    Clone Kyoto Sample
                  </Button>
                  <Button
                    variant="secondary"
                    className="bg-white/15 text-white hover:bg-white/25"
                    onClick={() => navigate('/overview')}
                  >
                    <MapIcon className="size-3.5" aria-hidden />
                    Overview Mode
                  </Button>
                  <Button
                    className="bg-[#2dd4bf] text-[#032b2d] hover:bg-[#5eead4]"
                    onClick={() => navigate('/trips/new')}
                    data-testid="new-trip-cta"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    New Trip
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                    onClick={() => setShowAuth(true)}
                  >
                    Sign in to Create Trips
                  </Button>
                  <Button
                    className="bg-[#2dd4bf] text-[#032b2d] hover:bg-[#5eead4]"
                    onClick={() => setShowAuth(true)}
                  >
                    Get Started
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Signed-in Trips Grid */}
        {isLoaded && isSignedIn && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Active &amp; Shared Trips ({tripRecords.length})
              </h2>
            </div>

            {tripsStatus === 'loading' ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-44 animate-pulse rounded-xl border border-border bg-muted/60" />
                ))}
              </div>
            ) : tripRecords.length === 0 ? (
              <EmptyState
                icon={<Compass className="size-5" />}
                title="No trips plotted yet"
                description="Create a dated itinerary, start with Broad Overview Mode to test how long you can stay in each city, or clone the Kyoto sample trip."
                action={{ label: 'Create a Trip', onClick: () => navigate('/trips/new') }}
                secondaryAction={{ label: 'Clone Kyoto Sample', onClick: handleCloneSample }}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tripRecords.map((rec, index) => {
                  const t = rec.data
                  const tripDests = destRecords
                    .filter((d) => d.data.tripId === rec.recordId)
                    .sort((a, b) => a.data.orderIndex - b.data.orderIndex)
                  const role = resolveUserRoleForTrip(t, rec.recordId)
                  const collabCount =
                    (Array.isArray(t.editors) ? t.editors.length : 1) +
                    (Array.isArray(t.viewers) ? t.viewers.length : 0)
                  const coverImage = TRIP_COVERS[index % TRIP_COVERS.length]

                  return (
                    <Link
                      key={rec.recordId}
                      to={`/trips/${rec.recordId}`}
                      data-testid={`trip-card-${rec.recordId}`}
                      className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-[var(--shadow-card-hover)]"
                    >
                      <div>
                        <div className="relative h-24 w-full overflow-hidden bg-[#044649]">
                          <img
                            src={coverImage}
                            alt=""
                            aria-hidden
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/20" />
                          <div className="absolute inset-x-3 top-2.5 flex items-center justify-between gap-2">
                            <Badge variant={t.mode === 'overview' ? 'secondary' : 'default'}>
                              {t.mode === 'overview' ? 'Overview Mode' : 'Detailed'}
                            </Badge>
                            <Badge variant="outline" className="border-white/40 bg-black/35 text-white backdrop-blur-xs">
                              {role}
                            </Badge>
                          </div>
                        </div>

                        <div className="p-4 pb-2">
                          <h3 className="text-base font-semibold text-foreground group-hover:text-primary">
                            {t.title}
                          </h3>

                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
                            <span className="truncate">
                              {tripDests.length > 0
                                ? tripDests.map((d) => d.data.name).join(' → ')
                                : t.coverDestination || 'No destinations yet'}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="mx-4 mb-4 mt-2 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3.5" aria-hidden />
                          {t.startDate && t.endDate
                            ? `${t.startDate} → ${t.endDate}`
                            : `${t.totalDays ?? 5} days`}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3.5" aria-hidden />
                          {collabCount}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* Signed-out Interactive Sample Atlas Preview */}
        {!isSignedIn && (
          <section className="space-y-5" data-testid="sample-atlas-preview">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge>Sample Atlas</Badge>
                <span className="text-sm font-semibold text-foreground">
                  {SAMPLE_TRIP.trip.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  Kyoto (3d) → Hakone (1d) · {SAMPLE_TRIP.trip.pace} pace
                </span>
              </div>
              <Button size="sm" onClick={() => setShowAuth(true)}>
                Sign in to Customize &amp; Save
              </Button>
            </div>

            <Tabs
              value={sampleTab}
              onValueChange={(v) => setSampleTab(v as 'itinerary' | 'overview')}
            >
              <TabsList>
                <TabsTrigger value="itinerary">Daily Route &amp; Map</TabsTrigger>
                <TabsTrigger value="overview">Broad Overview Pacing</TabsTrigger>
              </TabsList>

              <TabsContent value="itinerary" className="mt-4">
                <div className="grid gap-6 lg:grid-cols-12">
                  <div className="space-y-3 lg:col-span-7">
                    <div className="flex items-center gap-2">
                      {[1, 2, 3].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSampleDay(d)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            sampleDay === d
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Day {d}
                        </button>
                      ))}
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {sampleSchedule.totalTravelMinutes}m transit ·{' '}
                        {sampleSchedule.totalDistanceKm.toFixed(1)} km
                      </span>
                    </div>

                    {sampleSchedule.items.map((item, idx) => {
                      const meta = CATEGORY_META[item.stop.category]
                      return (
                        <div key={item.stop.id}>
                          {idx > 0 && (
                            <div className="ml-5 border-l border-dashed border-border py-1.5 pl-4 font-mono text-[11px] text-muted-foreground">
                              {item.travelMinutesFromPrev} min {item.stop.transportMode} ·{' '}
                              {item.travelDistanceKmFromPrev.toFixed(1)} km
                            </div>
                          )}
                          <div
                            onClick={() => setSelectedSampleStop(item.stop.id)}
                            className={`cursor-pointer rounded-xl border p-3.5 transition-colors ${
                              selectedSampleStop === item.stop.id
                                ? 'border-primary bg-accent/40'
                                : 'border-border bg-card'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="flex size-5 items-center justify-center rounded-full text-[11px] font-bold text-primary-foreground"
                                style={{ backgroundColor: meta.color }}
                              >
                                {idx + 1}
                              </span>
                              <span className="font-mono text-xs text-primary">
                                {item.startTime}–{item.endTime}
                              </span>
                              <Badge variant="secondary" className="text-[10px]">
                                {meta.label}
                              </Badge>
                            </div>
                            <h3 className="mt-1.5 text-sm font-semibold text-foreground">
                              {item.stop.title}
                            </h3>
                            {item.stop.photoTip && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                                <Camera className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                                <span>
                                  {item.stop.bestLightWindow && item.stop.bestLightWindow !== 'any'
                                    ? `${LIGHT_WINDOW_LABELS[item.stop.bestLightWindow]}: `
                                    : ''}
                                  {item.stop.photoTip}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="lg:col-span-5">
                    <AtlasMap
                      stops={sampleDayStops}
                      destinations={SAMPLE_TRIP.destinations}
                      selectedStopId={selectedSampleStop}
                      onSelectStop={setSelectedSampleStop}
                      className="h-[280px] sm:h-[360px] lg:h-[420px]"
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="overview" className="mt-4">
                <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="outline" className="border-success/40 text-success">
                      Comfortable Pace · {SAMPLE_TRIP.overview.feasibilityScore}/100
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Route className="size-3.5 text-primary" aria-hidden />
                      {SAMPLE_TRIP.overview.totalTransitHours}h intercity transit
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{SAMPLE_TRIP.overview.summary}</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {SAMPLE_TRIP.overview.allocations.map((alloc) => (
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
                        <p className="mt-2 text-muted-foreground">{alloc.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        )}
      </div>

      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
