/* home pattern: product-preview-first — active trips hub or interactive Kyoto sample atlas for signed-out visitors */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BedDouble,
  Calendar,
  Camera,
  MapPin,
  Plus,
  Users,
} from 'lucide-react'
import { AuthOverlay, useAuth, useQuery } from 'deepspace'
import {
  Badge,
  Button,
  EmptyState,
  useToast,
} from '@/components/ui'
import { AtlasMap } from '@/components/trip/AtlasMap'
import { callTripAction } from '@/lib/actions-client'
import {
  computeDaySchedule,
  hotelPointFromDestination,
  isCheckInOrOutStop,
  resolveDayContext,
} from '@/lib/route-optimizer'
import { SAMPLE_TRIP } from '@/lib/sample-trip'
import {
  CATEGORY_META,
  LIGHT_WINDOW_LABELS,
  type DestinationData,
  type TeamMemberData,
  type TripData,
} from '@/lib/trip-types'

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
  const [sampleDay, setSampleDay] = useState(1)
  const [selectedSampleStop, setSelectedSampleStop] = useState<string | null>(null)

  const sampleDayStops = useMemo(
    () => SAMPLE_TRIP.stops.filter((s) => s.dayNumber === sampleDay),
    [sampleDay],
  )
  const sampleHotels = useMemo(() => {
    const ctx = resolveDayContext(
      sampleDay,
      SAMPLE_TRIP.trip.totalDays ?? 4,
      SAMPLE_TRIP.trip.startDate,
      SAMPLE_TRIP.destinations,
    )
    const startDest = ctx.isLocationChange ? ctx.previousDestination ?? ctx.destination : ctx.destination
    const endDest = ctx.destination ?? ctx.previousDestination
    return {
      startHotel: hotelPointFromDestination(startDest),
      endHotel: hotelPointFromDestination(endDest),
    }
  }, [sampleDay])
  const sampleSchedule = useMemo(
    () =>
      computeDaySchedule(
        sampleDayStops,
        9 * 60,
        sampleHotels.startHotel ?? undefined,
      ),
    [sampleDayStops, sampleHotels],
  )

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
      <div className="mx-auto max-w-6xl space-y-7">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-xs font-medium text-primary">Trippie Atlas</p>
            <h1 className="font-editorial-display mt-1 text-3xl font-medium tracking-tight text-foreground md:text-4xl">
              {isSignedIn ? 'Your Vacation Atlas' : 'Kyoto & Hakone Route Atlas'}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {isSignedIn
                ? 'Build multi-stop itineraries anchored around hotels, optimize transit legs, and steer plans with your AI Concierge.'
                : 'Preview a live travel-time optimized itinerary with golden-hour photo spots. Sign in to create and co-edit your own trips.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSignedIn ? (
              <Button onClick={() => navigate('/trips/new')} data-testid="new-trip-cta">
                <Plus className="size-3.5" aria-hidden />
                New Trip
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowAuth(true)}>
                  Sign in to Create Trips
                </Button>
                <Button onClick={() => setShowAuth(true)}>
                  Get Started
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              </>
            )}
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
                icon={<MapPin className="size-5" />}
                title="No trips plotted yet"
                description="Create a dated itinerary anchored around your hotels to start planning."
                action={{ label: 'Create a Trip', onClick: () => navigate('/trips/new') }}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tripRecords.map((rec) => {
                  const t = rec.data
                  const tripDests = destRecords
                    .filter((d) => d.data.tripId === rec.recordId)
                    .sort((a, b) => a.data.orderIndex - b.data.orderIndex)
                  const role = resolveUserRoleForTrip(t, rec.recordId)
                  const collabCount =
                    (Array.isArray(t.editors) ? t.editors.length : 1) +
                    (Array.isArray(t.viewers) ? t.viewers.length : 0)

                  return (
                    <Link
                      key={rec.recordId}
                      to={`/trips/${rec.recordId}`}
                      data-testid={`trip-card-${rec.recordId}`}
                      className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-primary">Trip Itinerary</span>
                          <span>{role}</span>
                        </div>

                        <h3 className="mt-2.5 text-base font-semibold text-foreground group-hover:text-primary">
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

                      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
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

            <div className="grid gap-6 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
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
                            {isCheckInOrOutStop(item.stop) ? (
                              <BedDouble className="size-3" aria-label="Hotel" />
                            ) : (
                              idx + 1
                            )}
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

              <div className="lg:col-span-7">
                <AtlasMap
                  stops={sampleDayStops}
                  destinations={SAMPLE_TRIP.destinations}
                  startHotel={sampleHotels.startHotel}
                  endHotel={sampleHotels.endHotel}
                  selectedStopId={selectedSampleStop}
                  onSelectStop={setSelectedSampleStop}
                  className="h-[380px] sm:h-[460px] lg:h-[580px]"
                />
              </div>
            </div>
          </section>
        )}
      </div>

      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
