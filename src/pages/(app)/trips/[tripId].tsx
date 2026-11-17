import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CloudSun,
  Download,
  Lock,
  MapPin,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { AuthOverlay, useAuth, usePresenceRoom, useQuery } from 'deepspace'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/components/ui'
import { AtlasMap } from '@/components/trip/AtlasMap'
import { BudgetChecklistTab } from '@/components/trip/BudgetChecklistTab'
import { DiscoverPanel } from '@/components/trip/DiscoverPanel'
import { ItineraryTimeline } from '@/components/trip/ItineraryTimeline'
import { OverviewPlannerView } from '@/components/trip/OverviewPlannerView'
import { ShareTripModal } from '@/components/trip/ShareTripModal'
import { useTripChat } from '@/contexts/TripChatContext'
import { callTripAction } from '@/lib/actions-client'
import { itineraryToMarkdown } from '@/lib/export-itinerary'
import type {
  ChecklistData,
  DestinationData,
  OverviewData,
  StopCategory,
  StopData,
  TeamMemberData,
  TripAccessRole,
  TripData,
} from '@/lib/trip-types'

export default function TripWorkspacePage() {
  const { tripId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')

  const navigate = useNavigate()
  const { isLoaded, isSignedIn, userId } = useAuth()
  const { success, error } = useToast()
  const tripChat = useTripChat()

  const { records: tripRows, status: tripQueryStatus } = useQuery<TripData>('trips', {
    where: { teamId: tripId || '__none__' },
    limit: 1,
  })
  const { records: destRows } = useQuery<DestinationData>('trip_destinations', {
    where: { tripId: tripId || '__none__' },
  })
  const { records: stopRows } = useQuery<StopData>('trip_stops', {
    where: { tripId: tripId || '__none__' },
  })
  const { records: overviewRows } = useQuery<OverviewData>('trip_overviews', {
    where: { tripId: tripId || '__none__' },
    limit: 1,
  })
  const { records: checklistRows } = useQuery<ChecklistData>('trip_checklists', {
    where: { tripId: tripId || '__none__' },
  })
  const { records: memberRows } = useQuery<TeamMemberData>('team_members', {
    where: { teamId: tripId || '__none__', status: 'active' },
  })

  const { peers } = usePresenceRoom(tripId ? `trip:${tripId}` : 'trip:none')

  const tripRecord = tripRows[0] ?? null
  const trip = tripRecord?.data ?? null
  const overview = overviewRows[0]?.data ?? null

  const destinations = useMemo(
    () =>
      destRows
        .map((r) => ({ id: r.recordId, ...r.data }))
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [destRows],
  )
  const stops = useMemo(
    () =>
      stopRows
        .map((r) => ({ id: r.recordId, ...r.data }))
        .sort((a, b) => a.dayNumber - b.dayNumber || (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [stopRows],
  )
  const checklists = useMemo(
    () => checklistRows.map((r) => ({ id: r.recordId, ...r.data })),
    [checklistRows],
  )
  const members = useMemo(
    () => memberRows.map((r) => ({ id: r.recordId, ...r.data })),
    [memberRows],
  )

  const callerRole: TripAccessRole | null = useMemo(() => {
    if (!trip || !userId) return null
    if (trip.ownerId === userId) return 'owner'
    if (Array.isArray(trip.editors) && trip.editors.includes(userId)) return 'editor'
    const m = members.find((r) => r.userId === userId)
    if (m?.role === 'editor' || m?.role === 'viewer' || m?.role === 'owner') return m.role
    if (Array.isArray(trip.viewers) && trip.viewers.includes(userId)) return 'viewer'
    return null
  }, [trip, userId, members])

  const canEdit = callerRole === 'owner' || callerRole === 'editor'
  const isOwner = callerRole === 'owner'

  const [activeTab, setActiveTab] = useState<'itinerary' | 'overview' | 'discover' | 'budget'>(
    'itinerary',
  )
  const [tabInitialized, setTabInitialized] = useState(false)
  const [activeDay, setActiveDay] = useState(1)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [acceptingInvite, setAcceptingInvite] = useState(false)
  const [weatherLoadingId, setWeatherLoadingId] = useState<string | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)

  useEffect(() => {
    if (trip && !tabInitialized) {
      setActiveTab(trip.mode === 'overview' ? 'overview' : 'itinerary')
      setTabInitialized(true)
    }
  }, [trip, tabInitialized])

  // Keep Copilot AI Dock synced to the open trip and selected day
  const setActiveTripContext = tripChat?.setActiveTripContext
  const tripTitle = trip?.title ?? null
  useEffect(() => {
    if (!setActiveTripContext) return
    setActiveTripContext({
      tripId: tripTitle ? tripId : null,
      tripTitle,
      dayNumber: activeDay,
    })
  }, [setActiveTripContext, tripTitle, tripId, activeDay])

  useEffect(() => {
    return () => {
      setActiveTripContext?.({ tripId: null, tripTitle: null, dayNumber: null })
    }
  }, [setActiveTripContext])

  const totalDays = useMemo(() => {
    const maxStopDay = stops.reduce((max, s) => Math.max(max, s.dayNumber), 1)
    return Math.max(trip?.totalDays ?? 1, maxStopDay)
  }, [trip?.totalDays, stops])

  const dayStops = useMemo(
    () => stops.filter((s) => s.dayNumber === activeDay),
    [stops, activeDay],
  )

  async function handleAcceptInvite() {
    if (!inviteToken) return
    setAcceptingInvite(true)
    try {
      const res = await callTripAction<{ tripId: string; role: string }>('acceptTripInvite', {
        token: inviteToken,
      })
      success('Invite accepted', `Joined trip as ${res.role}.`)
      setSearchParams({}, { replace: true })
    } catch (err) {
      error('Could not accept invite', err instanceof Error ? err.message : 'Failed')
    } finally {
      setAcceptingInvite(false)
    }
  }

  async function handleRefreshWeather(destinationId: string) {
    setWeatherLoadingId(destinationId)
    try {
      await callTripAction('refreshDestinationWeather', { tripId, destinationId })
      success('Weather updated', 'Loaded current conditions and 5-day forecast.')
    } catch (err) {
      error('Weather lookup failed', err instanceof Error ? err.message : 'Failed')
    } finally {
      setWeatherLoadingId(null)
    }
  }

  async function handleDeleteTrip() {
    setDeleting(true)
    try {
      await callTripAction('deleteTrip', { tripId })
      success('Trip deleted', `"${trip?.title ?? 'Trip'}" was removed.`)
      navigate('/home')
    } catch (err) {
      error('Delete failed', err instanceof Error ? err.message : 'Failed')
    } finally {
      setDeleting(false)
    }
  }

  function handleExportMarkdown() {
    if (!trip) return
    const md = itineraryToMarkdown({ trip, destinations, stops, overview })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${trip.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'itinerary'}.md`
    a.click()
    URL.revokeObjectURL(url)
    success('Exported Markdown', 'Downloaded portable itinerary file.')
  }

  if (!isLoaded || (isSignedIn && tripQueryStatus === 'loading')) {
    return (
      <div className="space-y-4 p-8">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {inviteToken ? 'You were invited to a Trippie trip' : 'Sign in to view this trip'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {inviteToken
              ? 'Sign in with Google or GitHub to accept your collaboration invite.'
              : 'Trips are private by default and visible only to the owner and invited companions.'}
          </p>
          <Button className="mt-5 w-full" onClick={() => setShowAuthModal(true)}>
            Sign in
          </Button>
          {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
        </div>
      </div>
    )
  }

  if (!trip && inviteToken) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Join Shared Trip</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Accept this invitation to access the collaborative itinerary and route map.
          </p>
          <Button
            className="mt-5 w-full"
            loading={acceptingInvite}
            onClick={handleAcceptInvite}
            data-testid="accept-invite-button"
          >
            Accept Trip Invitation
          </Button>
        </div>
      </div>
    )
  }

  if (!trip) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Lock className="size-5" />}
          title="Trip not found or access required"
          description="Ask the trip owner to invite your account as a viewer or editor."
          action={{ label: 'Back to Atlas Home', onClick: () => navigate('/home') }}
        />
      </div>
    )
  }

  return (
    <div className="min-h-full px-5 py-6 text-foreground md:px-8" data-testid="trip-workspace">
      <div className="mx-auto max-w-7xl space-y-5">
        {/* Trip Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={trip.mode === 'overview' ? 'secondary' : 'default'}>
                {trip.mode === 'overview' ? 'Overview Mode' : 'Detailed Itinerary'}
              </Badge>
              <Badge variant="outline" data-testid="trip-role-badge">
                {callerRole === 'owner'
                  ? 'Owner'
                  : callerRole === 'editor'
                    ? 'Editor'
                    : 'Viewer (Read-only)'}
              </Badge>
              {trip.startDate && trip.endDate && (
                <span className="font-mono text-xs text-muted-foreground">
                  {trip.startDate} → {trip.endDate}
                </span>
              )}
              <span className="font-mono text-xs text-muted-foreground">
                · {totalDays} days · {trip.pace ?? 'balanced'}
              </span>
            </div>

            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground md:text-3xl" data-testid="trip-title">
              {trip.title}
            </h1>
            {trip.summaryNotes && (
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{trip.summaryNotes}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {peers.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                <Users className="size-3.5 text-success" aria-hidden />
                <div className="flex -space-x-1.5">
                  {peers.slice(0, 4).map((p) => (
                    <Avatar key={p.userId} className="size-5 ring-1 ring-background">
                      <AvatarFallback className="text-[9px]">
                        {(p.userName?.[0] ?? 'T').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <span className="text-muted-foreground">{peers.length} online</span>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                tripChat?.queuePrompt(
                  `Review "${trip.title}" and suggest any timing, restaurant, or photography improvements.`,
                )
              }
            >
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              Steer with AI
            </Button>

            <Button size="sm" variant="outline" onClick={handleExportMarkdown}>
              <Download className="size-3.5" aria-hidden />
              Export
            </Button>

            {isOwner && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShareOpen(true)}
                  data-testid="share-trip-button"
                >
                  <Share2 className="size-3.5" aria-hidden />
                  Share
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Delete trip"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-4 text-destructive" aria-hidden />
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Read-only notice for Viewers */}
        {!canEdit && (
          <div
            data-testid="viewer-readonly-banner"
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground"
          >
            <Lock className="size-3.5 text-primary" aria-hidden />
            <span>
              You have <strong className="text-foreground">view-only</strong> access to this
              itinerary. Ask the owner to grant Editor permissions if you want to make changes.
            </span>
          </div>
        )}

        {/* Destinations & Live Weather Strip */}
        {destinations.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {destinations.map((dest) => (
              <div
                key={dest.id}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-xs"
              >
                <MapPin className="size-3.5 text-primary" aria-hidden />
                <div>
                  <span className="font-semibold text-foreground">
                    {dest.name}
                    {dest.country ? `, ${dest.country}` : ''}
                  </span>
                  {dest.arrivalDate && dest.departureDate && (
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {dest.arrivalDate} – {dest.departureDate}
                    </span>
                  )}
                  {dest.weatherCache && (
                    <span className="ml-2 inline-flex items-center gap-1 text-primary">
                      <CloudSun className="size-3" aria-hidden />
                      {dest.weatherCache.tempC}°C {dest.weatherCache.description}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  title="Refresh live weather"
                  aria-label={`Refresh weather for ${dest.name}`}
                  disabled={weatherLoadingId === dest.id}
                  onClick={() => void handleRefreshWeather(dest.id)}
                  className="ml-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw
                    className={`size-3 ${weatherLoadingId === dest.id ? 'animate-spin' : ''}`}
                    aria-hidden
                  />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Workspace Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(v as 'itinerary' | 'overview' | 'discover' | 'budget')
          }
        >
          <TabsList>
            <TabsTrigger value="itinerary">Daily Itinerary &amp; Map</TabsTrigger>
            <TabsTrigger value="overview">Broad Overview &amp; Pacing</TabsTrigger>
            <TabsTrigger value="discover">Discover &amp; Photo Spots</TabsTrigger>
            <TabsTrigger value="budget">Budget &amp; Checklist</TabsTrigger>
          </TabsList>

          <TabsContent value="itinerary" className="mt-5">
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <ItineraryTimeline
                  tripId={tripId}
                  dayNumber={activeDay}
                  totalDays={totalDays}
                  onSelectDay={setActiveDay}
                  stops={stops}
                  canEdit={canEdit}
                  currency={trip.currency ?? 'USD'}
                  selectedStopId={selectedStopId}
                  onSelectStop={setSelectedStopId}
                  onOptimizeDay={(d) => callTripAction('optimizeTripDay', { tripId, dayNumber: d })}
                  onSaveStop={(payload) =>
                    callTripAction('upsertTripStop', { tripId, ...payload }).then(() => undefined)
                  }
                  onMoveStop={(stopId, direction) =>
                    callTripAction('moveTripStop', { tripId, stopId, direction }).then(
                      () => undefined,
                    )
                  }
                  onDeleteStop={(stopId) =>
                    callTripAction('removeTripStop', { tripId, stopId }).then(() => undefined)
                  }
                  onAskAi={(prompt) => tripChat?.queuePrompt(prompt)}
                />
              </div>

              <div className="lg:col-span-5">
                <div className="sticky top-6">
                  <AtlasMap
                    stops={dayStops}
                    destinations={destinations}
                    selectedStopId={selectedStopId}
                    onSelectStop={setSelectedStopId}
                    className="h-[460px]"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="overview" className="mt-5">
            <OverviewPlannerView
              tripId={tripId}
              totalDays={totalDays}
              destinations={destinations}
              overview={overview}
              canEdit={canEdit}
              onAddDestination={(name, country) =>
                callTripAction('addDestination', { tripId, name, country }).then(() => undefined)
              }
              onRemoveDestination={(destinationId) =>
                callTripAction('removeDestination', { tripId, destinationId }).then(() => undefined)
              }
              onGenerateOverview={(days, useAi) =>
                callTripAction('generateOverviewBlueprint', {
                  tripId,
                  totalDays: days,
                  useAi,
                }).then(() => undefined)
              }
              onPromoteToDetailed={async (startDate) => {
                await callTripAction('promoteOverviewToDetailed', { tripId, startDate })
                setActiveTab('itinerary')
              }}
              onAskAi={(prompt) => tripChat?.queuePrompt(prompt)}
            />
          </TabsContent>

          <TabsContent value="discover" className="mt-5">
            <DiscoverPanel
              destinations={destinations}
              totalDays={totalDays}
              activeDay={activeDay}
              canEdit={canEdit}
              onAddStop={(payload) =>
                callTripAction('upsertTripStop', { tripId, ...payload }).then(() => undefined)
              }
              onAskAi={(prompt) => tripChat?.queuePrompt(prompt)}
            />
          </TabsContent>

          <TabsContent value="budget" className="mt-5">
            <BudgetChecklistTab
              stops={stops}
              travelers={trip.travelers ?? 2}
              currency={trip.currency ?? 'USD'}
              checklists={checklists}
              canEdit={canEdit}
              onAddChecklist={(category, label) =>
                callTripAction('addChecklistItem', { tripId, category, label }).then(
                  () => undefined,
                )
              }
              onToggleChecklist={(itemId, completed) =>
                callTripAction('toggleChecklistItem', { tripId, itemId, completed }).then(
                  () => undefined,
                )
              }
              onRemoveChecklist={(itemId) =>
                callTripAction('removeChecklistItem', { tripId, itemId }).then(() => undefined)
              }
            />
          </TabsContent>
        </Tabs>
      </div>

      {isOwner && (
        <ShareTripModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          tripId={tripId}
          tripTitle={trip.title}
          ownerId={trip.ownerId}
          members={members}
        />
      )}

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteTrip}
        title={`Delete "${trip.title}"?`}
        description="This permanently deletes all destinations, stops, checklists, and collaborator access."
        confirmText="Delete trip"
        variant="destructive"
        loading={deleting}
      />
    </div>
  )
}
