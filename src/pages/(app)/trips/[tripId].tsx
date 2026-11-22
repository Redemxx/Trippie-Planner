import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  BedDouble,
  Clock,
  CloudSun,
  Download,
  Lock,
  MapPin,
  Pencil,
  RotateCcw,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { AuthOverlay, useAuth, usePresenceRoom, useQuery } from 'deepspace'
import {
  Avatar,
  AvatarFallback,
  Button,
  ConfirmModal,
  EmptyState,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from '@/components/ui'
import { AtlasMap } from '@/components/trip/AtlasMap'
import { BudgetChecklistTab } from '@/components/trip/BudgetChecklistTab'
import { DiscoverPanel } from '@/components/trip/DiscoverPanel'
import { ItineraryTimeline } from '@/components/trip/ItineraryTimeline'
import { ManageStaysModal } from '@/components/trip/ManageStaysModal'
import { ShareTripModal } from '@/components/trip/ShareTripModal'
import { useTripChat } from '@/contexts/TripChatContext'
import { callTripAction } from '@/lib/actions-client'
import { itineraryToMarkdown } from '@/lib/export-itinerary'
import {
  computeDaySchedule,
  diffDaysInclusive,
  formatIsoDateLabel,
  isoAddDays,
  resolveActiveDayHotels,
  resolveDayContext,
  resolveEffectiveTripStartDate,
} from '@/lib/route-optimizer'
import {
  INTERCITY_TRANSPORT_LABELS,
  type BudgetTier,
  type ChecklistData,
  type DestinationData,
  type IntercityTransport,
  type StopCategory,
  type StopData,
  type TeamMemberData,
  type TransportMode,
  type TripAccessRole,
  type TripData,
  type TripPace,
} from '@/lib/trip-types'

const PACE_LABELS: Record<TripPace, string> = {
  relaxed: 'Relaxed',
  balanced: 'Balanced',
  packed: 'Packed',
}

const BUDGET_LABELS: Record<BudgetTier, string> = {
  budget: 'Budget',
  moderate: 'Moderate',
  luxury: 'Luxury',
}

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  walk: 'Walk',
  transit: 'Public Transit',
  bullet_train: 'Bullet Train',
  drive: 'Car / Taxi',
  flight: 'Flight',
}

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
  const { records: checklistRows } = useQuery<ChecklistData>('trip_checklists', {
    where: { tripId: tripId || '__none__' },
  })
  const { records: memberRows } = useQuery<TeamMemberData>('team_members', {
    where: { teamId: tripId || '__none__', status: 'active' },
  })

  const tripRecord = tripRows[0] ?? null
  const trip = tripRecord?.data ?? null

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

  const [activeTab, setActiveTab] = useState<'itinerary' | 'discover' | 'budget'>(
    'itinerary',
  )
  const [tabInitialized, setTabInitialized] = useState(false)
  const [activeDay, setActiveDay] = useState(1)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editTotalDays, setEditTotalDays] = useState('5')
  const [editTravelers, setEditTravelers] = useState('2')
  const [editPace, setEditPace] = useState<TripPace>('balanced')
  const [editBudget, setEditBudget] = useState<BudgetTier>('moderate')
  const [editTransport, setEditTransport] = useState<TransportMode>('transit')
  const [acceptingInvite, setAcceptingInvite] = useState(false)
  const [mobileView, setMobileView] = useState<'schedule' | 'map'>('schedule')
  const [manageStaysOpen, setManageStaysOpen] = useState(false)
  const [stayEditOpen, setStayEditOpen] = useState(false)
  const [editingDestId, setEditingDestId] = useState<string>('')
  const [stayDestName, setStayDestName] = useState('')
  const [stayDestCountry, setStayDestCountry] = useState('')
  const [stayLodgingName, setStayLodgingName] = useState('')
  const [stayLodgingAddress, setStayLodgingAddress] = useState('')
  const [stayCheckIn, setStayCheckIn] = useState('15:00')
  const [stayCheckOut, setStayCheckOut] = useState('10:00')
  const [stayArrive, setStayArrive] = useState('')
  const [stayDepart, setStayDepart] = useState('')
  const [savingStay, setSavingStay] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const activeDayInitRef = useRef(false)
  const weatherFetchedIdsRef = useRef<Set<string>>(new Set())
  const [showAuthModal, setShowAuthModal] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (trip && !tabInitialized) {
      setActiveTab('itinerary')
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

  const activeDayHotels = useMemo(
    () => resolveActiveDayHotels(activeDay, totalDays, trip?.startDate, destinations),
    [activeDay, totalDays, trip?.startDate, destinations],
  )

  const liveClock = useMemo(() => {
    const d = new Date(nowTick)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return {
      todayIso: `${yyyy}-${mm}-${dd}`,
      nowMinutes: d.getHours() * 60 + d.getMinutes(),
    }
  }, [nowTick])

  const effectiveStartDate = useMemo(
    () => resolveEffectiveTripStartDate(trip?.startDate, destinations),
    [trip?.startDate, destinations],
  )

  const currentTripDayNumber = useMemo(() => {
    if (!effectiveStartDate) return null
    const dayIdx = diffDaysInclusive(effectiveStartDate, liveClock.todayIso)
    if (liveClock.todayIso < effectiveStartDate || dayIdx < 1 || dayIdx > totalDays) return null
    return dayIdx
  }, [effectiveStartDate, liveClock.todayIso, totalDays])

  const isTripInProgress = currentTripDayNumber !== null

  useEffect(() => {
    if (isTripInProgress && currentTripDayNumber && !activeDayInitRef.current) {
      activeDayInitRef.current = true
      setActiveDay(currentTripDayNumber)
    }
  }, [isTripInProgress, currentTripDayNumber])

  const todayContext = useMemo(
    () =>
      currentTripDayNumber
        ? resolveDayContext(currentTripDayNumber, totalDays, effectiveStartDate, destinations)
        : null,
    [currentTripDayNumber, totalDays, effectiveStartDate, destinations],
  )

  const todayVisitedDestinations = useMemo(() => {
    if (!todayContext) return []
    const list: Array<DestinationData & { id: string }> = []
    if (
      todayContext.previousDestination?.id &&
      todayContext.isLocationChange
    ) {
      list.push(todayContext.previousDestination as DestinationData & { id: string })
    }
    if (
      todayContext.destination?.id &&
      !list.some((d) => d.id === todayContext.destination?.id)
    ) {
      list.push(todayContext.destination as DestinationData & { id: string })
    }
    return list
  }, [todayContext])

  // Auto-load live weather strictly when the trip is actively underway for locations visited today
  useEffect(() => {
    if (!isTripInProgress || !tripId || todayVisitedDestinations.length === 0) return
    for (const dest of todayVisitedDestinations) {
      if (weatherFetchedIdsRef.current.has(dest.id)) continue
      const fetchedAt = dest.weatherCache?.fetchedAt
        ? Date.parse(dest.weatherCache.fetchedAt)
        : 0
      const fresh = Number.isFinite(fetchedAt) && Date.now() - fetchedAt < 3 * 3600 * 1000
      if (!fresh) {
        weatherFetchedIdsRef.current.add(dest.id)
        void callTripAction('refreshDestinationWeather', {
          tripId,
          destinationId: dest.id,
        }).catch(() => undefined)
      }
    }
  }, [isTripInProgress, tripId, todayVisitedDestinations])

  const todaySchedule = useMemo(() => {
    if (!currentTripDayNumber || !todayContext) return null
    const rawTodayStops = stops.filter((s) => s.dayNumber === currentTripDayNumber)
    const originDest = todayContext.isLocationChange
      ? todayContext.previousDestination ?? todayContext.destination
      : todayContext.destination
    const originLat = originDest?.lodgingLat ?? originDest?.lat
    const originLng = originDest?.lodgingLng ?? originDest?.lng
    const hotelOrigin =
      typeof originLat === 'number' && typeof originLng === 'number'
        ? { name: originDest?.lodgingName || originDest?.name, lat: originLat, lng: originLng }
        : undefined
    return computeDaySchedule(rawTodayStops, 9 * 60, hotelOrigin)
  }, [currentTripDayNumber, todayContext, stops])

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

  function openStayEditor(dest: DestinationData & { id: string }) {
    setEditingDestId(dest.id)
    setStayDestName(dest.name ?? '')
    setStayDestCountry(dest.country ?? '')
    setStayLodgingName(dest.lodgingName ?? '')
    setStayLodgingAddress(dest.lodgingAddress ?? '')
    setStayCheckIn(dest.checkInTime ?? '15:00')
    setStayCheckOut(dest.checkOutTime ?? '10:00')
    setStayArrive(dest.arrivalDate ?? '')
    setStayDepart(dest.departureDate ?? '')
    setStayEditOpen(true)
  }

  async function handleSaveStay() {
    if (!editingDestId) return
    setSavingStay(true)
    try {
      await callTripAction('updateDestination', {
        tripId,
        destinationId: editingDestId,
        name: stayDestName,
        country: stayDestCountry,
        refreshGeocode: true,
        lodgingName: stayLodgingName,
        lodgingAddress: stayLodgingAddress,
        checkInTime: stayCheckIn,
        checkOutTime: stayCheckOut,
        arrivalDate: stayArrive,
        departureDate: stayDepart,
      })
      setStayEditOpen(false)
      success('Stay updated', 'Saved hotel location, check-in/out times, and dates.')
    } catch (err) {
      error('Could not save stay', err instanceof Error ? err.message : 'Failed')
    } finally {
      setSavingStay(false)
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

  function openEditTripModal() {
    if (!trip) return
    setEditTitle(trip.title)
    setEditDescription(trip.summaryNotes ?? '')
    setEditStartDate(trip.startDate ?? '')
    setEditEndDate(trip.endDate ?? '')
    setEditTotalDays(String(trip.totalDays ?? 5))
    setEditTravelers(String(trip.travelers ?? 2))
    setEditPace(trip.pace ?? 'balanced')
    setEditBudget(trip.budgetTier ?? 'moderate')
    setEditTransport(trip.transportPreference ?? 'transit')
    setEditOpen(true)
  }

  async function handleSaveTripDetails() {
    if (!editTitle.trim()) {
      error('Trip title required', 'Please enter a title for this trip.')
      return
    }
    setSavingEdit(true)
    try {
      await callTripAction('updateTripDetails', {
        tripId,
        title: editTitle.trim(),
        summaryNotes: editDescription.trim(),
        startDate: editStartDate || '',
        endDate: editEndDate || '',
        totalDays: Math.max(1, Number(editTotalDays) || 5),
        travelers: Math.max(1, Number(editTravelers) || 2),
        pace: editPace,
        budgetTier: editBudget,
        transportPreference: editTransport,
      })
      setEditOpen(false)
      success('Trip updated', 'Saved trip title, description, and settings.')
    } catch (err) {
      error('Could not update trip', err instanceof Error ? err.message : 'Failed')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleRegenerateTrip() {
    setRegenerating(true)
    try {
      await callTripAction('regenerateTrip', {
        tripId,
        ...(editTitle.trim() ? { title: editTitle.trim() } : {}),
        summaryNotes: editDescription.trim(),
        startDate: editStartDate || '',
        endDate: editEndDate || '',
        totalDays: Math.max(1, Number(editTotalDays) || 5),
        travelers: Math.max(1, Number(editTravelers) || 2),
        pace: editPace,
        budgetTier: editBudget,
        transportPreference: editTransport,
      })
      setRegenerateConfirmOpen(false)
      setEditOpen(false)
      setActiveDay(1)
      success('Trip regenerated', 'Rebuilt destination transit legs and seeded lodging/travel stops from scratch.')
    } catch (err) {
      error('Could not regenerate trip', err instanceof Error ? err.message : 'Failed')
    } finally {
      setRegenerating(false)
    }
  }

  function handleExportMarkdown() {
    if (!trip) return
    const md = itineraryToMarkdown({ trip, destinations, stops })
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
    <div className="min-h-full px-4 py-4 text-foreground sm:px-6 md:px-8 md:py-6" data-testid="trip-workspace">
      <div className="mx-auto max-w-7xl space-y-5">
        {/* Trip Header — clean editorial hierarchy without pill clutter */}
        <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              <span className="font-semibold text-primary">Trip Itinerary</span>
              <span>·</span>
              <span className="font-medium text-foreground" data-testid="trip-role-badge">
                {callerRole === 'owner'
                  ? 'Owner'
                  : callerRole === 'editor'
                    ? 'Editor'
                    : 'Viewer (Read-only)'}
              </span>
              {trip.startDate && trip.endDate && (
                <>
                  <span>·</span>
                  <span className="font-mono">
                    {trip.startDate} → {trip.endDate}
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                {totalDays} days · {trip.pace ?? 'balanced'}
              </span>
            </div>

            <h1
              className="font-editorial-display mt-2 text-3xl font-medium tracking-tight text-foreground md:text-4xl"
              data-testid="trip-title"
            >
              {trip.title}
            </h1>
            {trip.summaryNotes ? (
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground" data-testid="trip-description">
                {trip.summaryNotes}
              </p>
            ) : canEdit ? (
              <button
                type="button"
                onClick={openEditTripModal}
                className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                + Add trip description
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {callerRole && tripId ? <TripLivePresence tripId={tripId} /> : null}

            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={openEditTripModal}
                data-testid="edit-trip-button"
              >
                <Pencil className="size-3.5" aria-hidden />
                Edit Trip
              </Button>
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
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground"
          >
            <Lock className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              You have <strong className="text-foreground">view-only</strong> access to this
              itinerary. Ask the owner to grant Editor permissions if you want to make changes.
            </span>
          </div>
        )}

        {/* Active-Trip Live Today Agenda & Weather for Locations Visited Today */}
        {isTripInProgress && currentTripDayNumber && todaySchedule && (
          <section
            data-testid="live-today-panel"
            className="rounded-xl border border-primary/45 bg-card p-4 sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-primary">
                  Trip in Progress · {formatIsoDateLabel(liveClock.todayIso, 'full')}
                </p>
                <h2 className="font-editorial-display mt-0.5 text-2xl font-medium text-foreground">
                  Today{todayContext?.destination ? ` in ${todayContext.destination.name}` : ''}
                </h2>
              </div>

              {todayVisitedDestinations.some((d) => d.weatherCache) && (
                <div className="flex flex-wrap gap-4 border-t border-border pt-2 text-xs sm:border-t-0 sm:pt-0">
                  {todayVisitedDestinations.map(
                    (dest) =>
                      dest.weatherCache && (
                        <div key={dest.id} className="flex items-center gap-2 text-foreground">
                          <CloudSun className="size-4 text-primary" aria-hidden />
                          <span>
                            <strong>{dest.name}:</strong> {dest.weatherCache.tempC}°C{' '}
                            <span className="text-muted-foreground">
                              {dest.weatherCache.description}
                            </span>
                          </span>
                        </div>
                      ),
                  )}
                </div>
              )}
            </div>

            {(() => {
              const items = todaySchedule.items
              const activeItem = items.find(
                (i) => i.startMinutes <= liveClock.nowMinutes && liveClock.nowMinutes <= i.endMinutes,
              )
              const nextItem = items.find((i) => i.startMinutes > liveClock.nowMinutes)
              const completedCount = items.filter((i) => i.endMinutes < liveClock.nowMinutes).length

              return (
                <div className="mt-3 grid gap-3 border-t border-border pt-3 text-xs sm:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground">Happening now</span>
                    <p className="mt-0.5 font-medium text-foreground">
                      {activeItem
                        ? `${activeItem.startTime}–${activeItem.endTime} · ${activeItem.stop.title}`
                        : nextItem
                          ? 'Between stops / free window'
                          : 'Day complete'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Up next</span>
                    <p className="mt-0.5 font-medium text-foreground">
                      {nextItem
                        ? `${nextItem.startTime} · ${nextItem.stop.title}`
                        : 'No remaining stops today'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:block">
                    <div>
                      <span className="text-muted-foreground">Day progress</span>
                      <p className="mt-0.5 font-medium text-foreground">
                        {completedCount} of {items.length} stops finished
                      </p>
                    </div>
                    {activeDay !== currentTripDayNumber && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 sm:mt-2"
                        onClick={() => setActiveDay(currentTripDayNumber)}
                      >
                        Jump to Today
                      </Button>
                    )}
                  </div>
                </div>
              )
            })()}
          </section>
        )}

        {/* Destinations & Stays Summary + Hotels Menu */}
        {(destinations.length > 0 || canEdit) && (
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-border pb-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {destinations.map((dest, idx) => (
                <div key={dest.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="font-medium text-foreground">
                    {idx + 1}. {dest.name}
                    {dest.country ? `, ${dest.country}` : ''}
                  </span>
                  {dest.arrivalDate && dest.departureDate && (
                    <span className="font-mono text-[11px]">
                      ({dest.arrivalDate} – {dest.departureDate})
                    </span>
                  )}
                  {idx > 0 && dest.transportFromPrev && dest.transportFromPrev !== 'none' && (
                    <span className="font-mono text-[11px] text-primary">
                      via {INTERCITY_TRANSPORT_LABELS[dest.transportFromPrev] ?? dest.transportFromPrev}
                      {typeof dest.transitHoursFromPrev === 'number' && dest.transitHoursFromPrev > 0
                        ? ` (~${dest.transitHoursFromPrev}h)`
                        : ''}
                    </span>
                  )}
                  {dest.lodgingName && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <BedDouble className="size-3 text-primary" aria-hidden />
                      {dest.lodgingName} ({dest.checkInTime || '15:00'}/{dest.checkOutTime || '10:00'})
                    </span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openStayEditor(dest)}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      {dest.lodgingName ? 'Edit stay' : '+ Add hotel'}
                    </button>
                  )}
                </div>
              ))}
              {destinations.length === 0 && (
                <span className="text-muted-foreground">No hotels or cities added yet.</span>
              )}
            </div>

            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setManageStaysOpen(true)}
                data-testid="manage-stays-button"
              >
                <BedDouble className="size-3.5 text-primary" aria-hidden />
                Hotels &amp; Stays
              </Button>
            )}
          </div>
        )}

        {/* Workspace Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'itinerary' | 'discover' | 'budget')}
        >
          <TabsList>
            <TabsTrigger value="itinerary">Daily Itinerary &amp; Map</TabsTrigger>
            <TabsTrigger value="discover">Discover &amp; Photo Spots</TabsTrigger>
            <TabsTrigger value="budget">Budget &amp; Checklist</TabsTrigger>
          </TabsList>

          <TabsContent value="itinerary" className="@container mt-5">
            {/* Mobile Schedule / Map toggle */}
            <div className="mb-3 flex gap-2 lg:hidden">
              <Button
                size="sm"
                variant={mobileView === 'schedule' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setMobileView('schedule')}
              >
                <Clock className="size-3.5" aria-hidden />
                Timeline
              </Button>
              <Button
                size="sm"
                variant={mobileView === 'map' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setMobileView('map')}
              >
                <MapPin className="size-3.5" aria-hidden />
                Map ({dayStops.length})
              </Button>
            </div>

            <div className="grid gap-6 @min-[840px]:grid-cols-12">
              <div className={`${mobileView === 'map' ? 'hidden lg:block' : ''} @min-[840px]:col-span-5`}>
                <ItineraryTimeline
                  tripId={tripId}
                  dayNumber={activeDay}
                  totalDays={totalDays}
                  tripStartDate={effectiveStartDate}
                  destinations={destinations}
                  onSelectDay={setActiveDay}
                  stops={stops}
                  canEdit={canEdit}
                  currency={trip.currency ?? 'USD'}
                  selectedStopId={selectedStopId}
                  onSelectStop={setSelectedStopId}
                  liveNowMinutes={liveClock.nowMinutes}
                  isActiveToday={Boolean(isTripInProgress && activeDay === currentTripDayNumber)}
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

              <div className={`${mobileView === 'schedule' ? 'hidden lg:block' : ''} @min-[840px]:col-span-7`}>
                <div className="@min-[840px]:sticky @min-[840px]:top-4">
                  <AtlasMap
                    stops={dayStops}
                    destinations={destinations}
                    startHotel={activeDayHotels.startHotel}
                    endHotel={activeDayHotels.endHotel}
                    selectedStopId={selectedStopId}
                    onSelectStop={setSelectedStopId}
                    className="h-[calc(100dvh-210px)] min-h-[440px] sm:h-[520px] @min-[840px]:h-[calc(100dvh-135px)] @min-[840px]:min-h-[620px]"
                  />
                </div>
              </div>
            </div>
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

      {canEdit && (
        <Modal open={editOpen} onClose={() => setEditOpen(false)}>
          <Modal.Header>
            <h3 className="text-base font-semibold text-foreground">Edit Trip Details</h3>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <div>
              <Label htmlFor="edit-trip-title">Trip title</Label>
              <Input
                id="edit-trip-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-trip-description">Trip description &amp; AI guidance</Label>
              <Textarea
                id="edit-trip-description"
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe trip goals, dietary notes, photography priorities..."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-start-date">Start date</Label>
                <Input
                  id="edit-start-date"
                  type="date"
                  value={editStartDate}
                  onChange={(e) => {
                    const nextStart = e.target.value
                    setEditStartDate(nextStart)
                    if (nextStart && editEndDate) {
                      const d = diffDaysInclusive(nextStart, editEndDate)
                      if (d > 0) setEditTotalDays(String(Math.min(60, d)))
                    } else if (nextStart && editTotalDays) {
                      const n = Math.max(1, Math.min(60, Number(editTotalDays) || 1))
                      setEditEndDate(isoAddDays(nextStart, n - 1))
                    }
                  }}
                />
              </div>
              <div>
                <Label htmlFor="edit-end-date">End date</Label>
                <Input
                  id="edit-end-date"
                  type="date"
                  value={editEndDate}
                  onChange={(e) => {
                    const nextEnd = e.target.value
                    setEditEndDate(nextEnd)
                    if (editStartDate && nextEnd) {
                      const d = diffDaysInclusive(editStartDate, nextEnd)
                      if (d > 0) setEditTotalDays(String(Math.min(60, d)))
                    }
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-total-days">Total days</Label>
                <Input
                  id="edit-total-days"
                  type="number"
                  min={1}
                  max={60}
                  value={editTotalDays}
                  onChange={(e) => {
                    const val = e.target.value
                    setEditTotalDays(val)
                    const n = Number(val)
                    if (editStartDate && Number.isFinite(n) && n >= 1) {
                      setEditEndDate(isoAddDays(editStartDate, Math.min(60, Math.round(n)) - 1))
                    }
                  }}
                />
              </div>
              <div>
                <Label htmlFor="edit-travelers">Travelers</Label>
                <Input
                  id="edit-travelers"
                  type="number"
                  min={1}
                  max={20}
                  value={editTravelers}
                  onChange={(e) => setEditTravelers(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Pace</Label>
                <Select
                  value={editPace}
                  onValueChange={(v) => v && setEditPace(v as TripPace)}
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
              <div>
                <Label>Budget</Label>
                <Select
                  value={editBudget}
                  onValueChange={(v) => v && setEditBudget(v as BudgetTier)}
                  items={BUDGET_LABELS}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BUDGET_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Default transit</Label>
                <Select
                  value={editTransport}
                  onValueChange={(v) => v && setEditTransport(v as TransportMode)}
                  items={TRANSPORT_LABELS}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRANSPORT_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer className="flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRegenerateConfirmOpen(true)}
              data-testid="regenerate-trip-btn"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Regenerate Trip
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button loading={savingEdit} onClick={handleSaveTripDetails} data-testid="save-trip-details-btn">
                Save Changes
              </Button>
            </div>
          </Modal.Footer>
        </Modal>
      )}

      {canEdit && (
        <ConfirmModal
          open={regenerateConfirmOpen}
          onClose={() => setRegenerateConfirmOpen(false)}
          onConfirm={handleRegenerateTrip}
          loading={regenerating}
          variant="destructive"
          title="Regenerate trip as if just created?"
          description="This clears all current scheduled stops and rebuilds your destination transit estimates and hotel check-in, check-out, and travel cards using these trip settings."
          confirmText="Regenerate Trip"
        />
      )}

      {canEdit && (
        <Modal open={stayEditOpen} onClose={() => setStayEditOpen(false)}>
          <Modal.Header>
            <h3 className="text-base font-semibold text-foreground">Edit Destination Stay &amp; Lodging</h3>
          </Modal.Header>
          <Modal.Body className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="stay-dest-name">City / Destination</Label>
                <Input
                  id="stay-dest-name"
                  value={stayDestName}
                  onChange={(e) => setStayDestName(e.target.value)}
                  placeholder="e.g. Osaka"
                />
              </div>
              <div>
                <Label htmlFor="stay-dest-country">Country</Label>
                <Input
                  id="stay-dest-country"
                  value={stayDestCountry}
                  onChange={(e) => setStayDestCountry(e.target.value)}
                  placeholder="e.g. Japan or JP"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="stay-lodging-name">Hotel / Lodging name</Label>
              <Input
                id="stay-lodging-name"
                value={stayLodgingName}
                onChange={(e) => setStayLodgingName(e.target.value)}
                placeholder="e.g. Hotel Gracery Kyoto"
              />
            </div>
            <div>
              <Label htmlFor="stay-lodging-addr">Address or neighborhood (used for travel estimates)</Label>
              <Input
                id="stay-lodging-addr"
                value={stayLodgingAddress}
                onChange={(e) => setStayLodgingAddress(e.target.value)}
                placeholder="Street or district"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="stay-checkin">Check-in time</Label>
                <Input
                  id="stay-checkin"
                  type="time"
                  value={stayCheckIn}
                  onChange={(e) => setStayCheckIn(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="stay-checkout">Check-out time</Label>
                <Input
                  id="stay-checkout"
                  type="time"
                  value={stayCheckOut}
                  onChange={(e) => setStayCheckOut(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="stay-arrive">Arrival date</Label>
                <Input
                  id="stay-arrive"
                  type="date"
                  value={stayArrive}
                  onChange={(e) => setStayArrive(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="stay-depart">Departure date</Label>
                <Input
                  id="stay-depart"
                  type="date"
                  value={stayDepart}
                  onChange={(e) => setStayDepart(e.target.value)}
                />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline" onClick={() => setStayEditOpen(false)}>
              Cancel
            </Button>
            <Button loading={savingStay} onClick={handleSaveStay}>
              Save Stay
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {canEdit && (
        <ManageStaysModal
          open={manageStaysOpen}
          onClose={() => setManageStaysOpen(false)}
          destinations={destinations}
          onAddStay={(payload) =>
            callTripAction('addDestination', { tripId, ...payload }).then(() => undefined)
          }
          onEditStay={openStayEditor}
          onChangeTransit={(destinationId, mode) =>
            callTripAction('updateDestination', {
              tripId,
              destinationId,
              transportFromPrev: mode,
            }).then(() => undefined)
          }
          onClearHotel={(destinationId) =>
            callTripAction('updateDestination', {
              tripId,
              destinationId,
              clearLodging: true,
            }).then(() => undefined)
          }
          onRemoveStay={(destinationId) =>
            callTripAction('removeDestination', { tripId, destinationId }).then(() => undefined)
          }
        />
      )}
    </div>
  )
}

function TripLivePresence({ tripId }: { tripId: string }) {
  const { peers } = usePresenceRoom(`trip:${tripId}`)
  if (peers.length === 0) return null
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
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
  )
}
