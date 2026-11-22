import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { formatWeatherQuery, resolveCountryIso } from '../lib/location-query.js'
import {
  computeDestinationDaySpans,
  diffDaysInclusive,
  estimateIntercityTransit,
  reconcileTripDatesAndDays,
  resolveEffectiveTripStartDate,
} from '../lib/route-optimizer.js'
import type {
  BudgetTier,
  ChecklistData,
  DestinationData,
  IntercityTransport,
  LightWindow,
  PreferredWindow,
  StopCategory,
  StopData,
  TeamMemberData,
  TransportMode,
  TripAccessRole,
  TripData,
  TripInviteData,
  TripMode,
  TripPace,
  WeatherForecastSummary,
} from '../lib/trip-types.js'
import {
  assertTripAccess,
  geocodePlaceName,
  parseIdArray,
  recalculateAndPersistDay,
  resolveHotelCoordinates,
  resolveHotelOriginForDay,
  resolveStopCoordinates,
  resolveTripGeocodeBias,
  syncEditorsAcrossTripRecords,
} from '../server/trip-helpers.js'

const DELETE_BATCH_LIMIT = 200
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function fail(
  error: string,
  opts?: { code?: string; status?: number },
): ActionResult<never> {
  return {
    success: false,
    error,
    code: opts?.code ?? 'action_failed',
    status: opts?.status ?? 400,
  }
}

async function deleteAllWhere(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  collection: string,
  where: Record<string, unknown>,
): Promise<void> {
  let deleted = DELETE_BATCH_LIMIT
  while (deleted === DELETE_BATCH_LIMIT) {
    const res = await tools.deleteWhere(collection, where, DELETE_BATCH_LIMIT)
    if (!res.success) break
    deleted = typeof res.data?.deleted === 'number' ? res.data.deleted : 0
  }
}

function normalizeSafeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString().slice(0, 1000)
  } catch {
    return null
  }
}

function addDaysIso(startIso: string, deltaDays: number): string {
  const d = new Date(`${startIso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return startIso
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

async function resolveCallerDisplay(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  userId: string,
): Promise<{ name: string; imageUrl?: string }> {
  const u = await tools.get<{ name?: string; email?: string; imageUrl?: string }>('users', userId)
  if (u.success && u.data?.record?.data) {
    return {
      name: u.data.record.data.name || u.data.record.data.email || 'Traveler',
      imageUrl: u.data.record.data.imageUrl,
    }
  }
  return { name: 'Traveler' }
}

function normalizeTimeHHmm(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^\d{1,2}:\d{2}$/.test(raw.trim())) {
    const [h, m] = raw.trim().split(':').map(Number)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  return fallback
}

function mapIntercityToStopTransport(mode: IntercityTransport): TransportMode {
  if (mode === 'bullet_train') return 'bullet_train'
  if (mode === 'flight') return 'flight'
  if (mode === 'drive') return 'drive'
  return 'transit'
}

function normalizeIntercityInput(raw: unknown): IntercityTransport | undefined {
  if (
    raw === 'bullet_train' ||
    raw === 'flight' ||
    raw === 'train' ||
    raw === 'drive' ||
    raw === 'ferry' ||
    raw === 'bus' ||
    raw === 'none'
  ) {
    return raw
  }
  return undefined
}

async function seedHotelAndTravelStops(params: {
  tools: Parameters<ActionHandler<Env>>[0]['tools']
  tripId: string
  userId: string
  editors: string[]
  totalDays: number
  startDate?: string
  destinations: Array<DestinationData & { id: string }>
}): Promise<void> {
  const { tools, tripId, userId, editors, totalDays, startDate, destinations } = params
  if (destinations.length === 0) return

  const effectiveStart = resolveEffectiveTripStartDate(startDate, destinations)
  const daySpans = computeDestinationDaySpans(totalDays, destinations, effectiveStart)
  const touchedDays = new Set<number>()

  for (let i = 0; i < destinations.length; i++) {
    const curr = destinations[i]
    const prev = i > 0 ? destinations[i - 1] : null
    const dayNumber = daySpans[i]?.startDay ?? 1

    const currHotel = curr.lodgingName?.trim() || `${curr.name} stay`
    const currLat = curr.lodgingLat ?? curr.lat
    const currLng = curr.lodgingLng ?? curr.lng
    const checkInTime = normalizeTimeHHmm(curr.checkInTime, '15:00')

    if (prev) {
      const prevHotel = prev.lodgingName?.trim() || `${prev.name} stay`
      const prevLat = prev.lodgingLat ?? prev.lat
      const prevLng = prev.lodgingLng ?? prev.lng
      const checkOutTime = normalizeTimeHHmm(prev.checkOutTime, '10:00')
      const leg = estimateIntercityTransit(
        { lat: prevLat, lng: prevLng },
        { lat: currLat, lng: currLng },
        curr.transportFromPrev,
      )
      const travelMinutes = Math.max(20, Math.round((curr.transitHoursFromPrev ?? leg.hours) * 60))
      const transportMode: TransportMode = mapIntercityToStopTransport(leg.mode)
      const modeLabel =
        leg.mode === 'bullet_train'
          ? 'bullet train'
          : leg.mode === 'drive'
            ? 'car'
            : leg.mode

      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: prev.id,
        ownerId: userId,
        editors,
        dayNumber,
        orderIndex: 0,
        title: `Check out: ${prevHotel}`.slice(0, 180),
        category: 'lodging',
        address: prev.lodgingAddress || prev.name,
        lat: prevLat,
        lng: prevLng,
        startTime: checkOutTime,
        durationMinutes: 20,
        fixedTime: true,
        preferredWindow: 'morning',
        transportMode: 'walk',
        notes: `Check out from ${prevHotel} before heading to ${curr.name}.`,
      })

      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: curr.id,
        ownerId: userId,
        editors,
        dayNumber,
        orderIndex: 1,
        title: `Travel: ${prev.name} → ${curr.name}`.slice(0, 180),
        category: 'transit',
        address: `${prev.name} to ${curr.name}`,
        lat: currLat,
        lng: currLng,
        durationMinutes: travelMinutes,
        fixedTime: false,
        preferredWindow: 'morning',
        transportMode,
        transportOverridden: Boolean(curr.transportFromPrev && curr.transportFromPrev !== 'none'),
        notes: `Estimated ~${Math.round((travelMinutes / 60) * 10) / 10}h via ${modeLabel} from ${prevHotel} to ${currHotel}.`,
      })

      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: curr.id,
        ownerId: userId,
        editors,
        dayNumber,
        orderIndex: 2,
        title: `Check in: ${currHotel}`.slice(0, 180),
        category: 'lodging',
        address: curr.lodgingAddress || curr.name,
        lat: currLat,
        lng: currLng,
        startTime: checkInTime,
        durationMinutes: 25,
        fixedTime: true,
        preferredWindow: 'afternoon',
        transportMode: 'transit',
        notes: `Check in at ${currHotel} (${checkInTime} standard check-in).`,
      })
      touchedDays.add(dayNumber)
    } else if (curr.lodgingName?.trim()) {
      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: curr.id,
        ownerId: userId,
        editors,
        dayNumber: 1,
        orderIndex: 0,
        title: `Check in: ${currHotel}`.slice(0, 180),
        category: 'lodging',
        address: curr.lodgingAddress || curr.name,
        lat: currLat,
        lng: currLng,
        startTime: checkInTime,
        durationMinutes: 25,
        fixedTime: true,
        preferredWindow: 'afternoon',
        transportMode: 'transit',
        notes: `Base lodging in ${curr.name} (${checkInTime} check-in · ${normalizeTimeHHmm(curr.checkOutTime, '10:00')} checkout).`,
      })
      touchedDays.add(1)
    }
  }

  for (const d of touchedDays) {
    await recalculateAndPersistDay(tools, tripId, d)
  }
}

export const createTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const title = typeof params.title === 'string' ? params.title.trim() : ''
  if (!title) return fail('Trip title is required', { code: 'invalid_input', status: 400 })

  const mode: TripMode = 'detailed'
  const pace: TripPace =
    params.pace === 'relaxed' || params.pace === 'packed' ? params.pace : 'balanced'
  const budgetTier: BudgetTier =
    params.budgetTier === 'budget' || params.budgetTier === 'luxury' ? params.budgetTier : 'moderate'
  const transportPreference: TransportMode =
    params.transportPreference === 'walk' || params.transportPreference === 'drive'
      ? params.transportPreference
      : 'transit'

  const rawStartDate = typeof params.startDate === 'string' && params.startDate ? params.startDate : undefined
  const rawEndDate = typeof params.endDate === 'string' && params.endDate ? params.endDate : undefined
  const { startDate, endDate, totalDays } = reconcileTripDatesAndDays({
    startDate: rawStartDate,
    endDate: rawEndDate,
    totalDays: typeof params.totalDays === 'number' ? params.totalDays : undefined,
    fallbackDays: 5,
  })

  const rawDests = Array.isArray(params.destinations)
    ? (params.destinations as Array<Record<string, unknown>>)
    : []

  const tripId = `trip_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const editors = [userId]

  const tripData: TripData = {
    title: title.slice(0, 140),
    ownerId: userId,
    teamId: tripId,
    editors,
    viewers: [],
    mode,
    startDate,
    endDate,
    totalDays,
    travelers: typeof params.travelers === 'number' ? Math.max(1, Math.round(params.travelers)) : 2,
    pace,
    budgetTier,
    currency: typeof params.currency === 'string' && params.currency ? params.currency : 'USD',
    transportPreference,
    interests: Array.isArray(params.interests)
      ? (params.interests as unknown[]).filter((v): v is string => typeof v === 'string')
      : ['sightseeing', 'food', 'photography'],
    coverDestination:
      typeof rawDests[0]?.name === 'string' ? rawDests[0].name : undefined,
    summaryNotes: typeof params.summaryNotes === 'string' ? params.summaryNotes : undefined,
  }

  const created = await tools.create('trips', tripData as unknown as Record<string, unknown>, tripId)
  if (!created.success) {
    return fail(created.error ?? 'Failed to create trip', { status: 500 })
  }

  const caller = await resolveCallerDisplay(tools, userId)
  await tools.create<TeamMemberData & Record<string, unknown>>('team_members', {
    teamId: tripId,
    userId,
    role: 'owner',
    status: 'active',
    displayName: caller.name,
    imageUrl: caller.imageUrl,
    addedBy: userId,
  })

  const createdDestinations: Array<DestinationData & { id: string }> = []

  for (let i = 0; i < rawDests.length; i++) {
    const item = rawDests[i]
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue

    let lat = typeof item.lat === 'number' ? item.lat : undefined
    let lng = typeof item.lng === 'number' ? item.lng : undefined
    let country = typeof item.country === 'string' ? item.country : undefined

    if (lat === undefined || lng === undefined) {
      const geo = await geocodePlaceName(tools, name, { countryHint: country })
      lat = geo.lat
      lng = geo.lng
      if (geo.country) {
        country = resolveCountryIso(country) ?? geo.country
      } else if (country) {
        country = resolveCountryIso(country) ?? country
      }
    }

    const lodgingName = typeof item.lodgingName === 'string' ? item.lodgingName.trim() : undefined
    const lodgingAddress =
      typeof item.lodgingAddress === 'string' ? item.lodgingAddress.trim() : undefined
    let lodgingLat = typeof item.lodgingLat === 'number' ? item.lodgingLat : undefined
    let lodgingLng = typeof item.lodgingLng === 'number' ? item.lodgingLng : undefined

    if ((lodgingName || lodgingAddress) && (lodgingLat === undefined || lodgingLng === undefined)) {
      const hotelGeo = await resolveHotelCoordinates(tools, {
        lodgingName,
        lodgingAddress,
        cityName: name,
        countryHint: country,
        cityLat: lat,
        cityLng: lng,
      })
      lodgingLat = hotelGeo.lat
      lodgingLng = hotelGeo.lng
    }
    if (lodgingLat === undefined) lodgingLat = lat
    if (lodgingLng === undefined) lodgingLng = lng

    const checkInTime = normalizeTimeHHmm(item.checkInTime, '15:00')
    const checkOutTime = normalizeTimeHHmm(item.checkOutTime, '10:00')

    const prevCreated = i > 0 ? createdDestinations[createdDestinations.length - 1] : null
    const requestedTransport = normalizeIntercityInput(item.transportFromPrev)
    const intercity = estimateIntercityTransit(
      prevCreated ? { lat: prevCreated.lodgingLat ?? prevCreated.lat, lng: prevCreated.lodgingLng ?? prevCreated.lng } : null,
      { lat: lodgingLat ?? lat, lng: lodgingLng ?? lng },
      i === 0 ? 'none' : requestedTransport,
    )

    const destId = `dest_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
    const destRecord: DestinationData = {
      tripId,
      ownerId: userId,
      editors,
      name,
      country,
      lat,
      lng,
      arrivalDate: typeof item.arrivalDate === 'string' && item.arrivalDate ? item.arrivalDate : undefined,
      departureDate:
        typeof item.departureDate === 'string' && item.departureDate ? item.departureDate : undefined,
      lodgingName: lodgingName?.slice(0, 160),
      lodgingAddress: lodgingAddress?.slice(0, 300),
      lodgingLat,
      lodgingLng,
      checkInTime,
      checkOutTime,
      orderIndex: i,
      transportFromPrev: i === 0 ? 'none' : intercity.mode,
      transitHoursFromPrev: i === 0 ? 0 : intercity.hours,
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    }

    await tools.create<DestinationData & Record<string, unknown>>(
      'trip_destinations',
      destRecord as DestinationData & Record<string, unknown>,
      destId,
    )
    createdDestinations.push({ id: destId, ...destRecord })
  }

  if (createdDestinations.length > 0) {
    await seedHotelAndTravelStops({
      tools,
      tripId,
      userId,
      editors,
      totalDays,
      startDate: tripData.startDate,
      destinations: createdDestinations,
    })
  }

  return { success: true, data: { tripId, trip: tripData } }
}

export const updateTripDetails: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const patch: Partial<TripData> = {}
  if (typeof params.title === 'string' && params.title.trim()) patch.title = params.title.trim().slice(0, 140)
  if (params.pace === 'relaxed' || params.pace === 'balanced' || params.pace === 'packed') patch.pace = params.pace
  if (params.budgetTier === 'budget' || params.budgetTier === 'moderate' || params.budgetTier === 'luxury') patch.budgetTier = params.budgetTier
  if (params.transportPreference === 'walk' || params.transportPreference === 'transit' || params.transportPreference === 'drive') {
    patch.transportPreference = params.transportPreference
  }
  if (typeof params.summaryNotes === 'string') patch.summaryNotes = params.summaryNotes.slice(0, 4000)
  if (Array.isArray(params.interests)) {
    patch.interests = params.interests.filter((v): v is string => typeof v === 'string')
  }

  const nextStartRaw =
    typeof params.startDate === 'string' ? params.startDate || undefined : access.trip.data.startDate
  const nextEndRaw =
    typeof params.endDate === 'string' ? params.endDate || undefined : access.trip.data.endDate
  const endChanged =
    typeof params.endDate === 'string' && (params.endDate || undefined) !== access.trip.data.endDate
  const startChanged =
    typeof params.startDate === 'string' &&
    (params.startDate || undefined) !== access.trip.data.startDate
  const explicitTotalChanged =
    typeof params.totalDays === 'number' &&
    params.totalDays >= 1 &&
    Math.round(params.totalDays) !== access.trip.data.totalDays

  if (startChanged || endChanged || explicitTotalChanged) {
    const reconciled = reconcileTripDatesAndDays({
      startDate: nextStartRaw,
      endDate: nextEndRaw,
      totalDays:
        typeof params.totalDays === 'number' && params.totalDays >= 1
          ? params.totalDays
          : access.trip.data.totalDays,
      preferTotalDays: explicitTotalChanged && !endChanged && !startChanged,
      fallbackDays: access.trip.data.totalDays ?? 5,
    })
    patch.startDate = reconciled.startDate
    patch.endDate = reconciled.endDate
    patch.totalDays = reconciled.totalDays
  }

  const res = await tools.update('trips', tripId, patch as Record<string, unknown>)
  if (!res.success) return fail(res.error ?? 'Update failed', { status: 500 })
  return { success: true, data: { tripId } }
}

/**
 * Clears custom stops and rebuilds transit estimates
 * and seeded lodging/travel blocks cleanly from its current settings & destinations.
 */
export const regenerateTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const tripPatch: Partial<TripData> = { mode: 'detailed' }
  if (typeof params.title === 'string' && params.title.trim()) tripPatch.title = params.title.trim().slice(0, 140)
  if (params.pace === 'relaxed' || params.pace === 'balanced' || params.pace === 'packed') {
    tripPatch.pace = params.pace
  }
  if (params.budgetTier === 'budget' || params.budgetTier === 'moderate' || params.budgetTier === 'luxury') {
    tripPatch.budgetTier = params.budgetTier
  }
  if (
    params.transportPreference === 'walk' ||
    params.transportPreference === 'transit' ||
    params.transportPreference === 'drive'
  ) {
    tripPatch.transportPreference = params.transportPreference
  }
  if (typeof params.travelers === 'number' && params.travelers >= 1) {
    tripPatch.travelers = Math.round(params.travelers)
  }
  if (typeof params.summaryNotes === 'string') tripPatch.summaryNotes = params.summaryNotes.slice(0, 4000)

  const regenStartRaw =
    typeof params.startDate === 'string' ? params.startDate || undefined : access.trip.data.startDate
  const regenEndRaw =
    typeof params.endDate === 'string' ? params.endDate || undefined : access.trip.data.endDate
  const regenEndChanged =
    typeof params.endDate === 'string' && (params.endDate || undefined) !== access.trip.data.endDate
  const regenStartChanged =
    typeof params.startDate === 'string' &&
    (params.startDate || undefined) !== access.trip.data.startDate
  const regenDaysChanged =
    typeof params.totalDays === 'number' &&
    params.totalDays >= 1 &&
    Math.round(params.totalDays) !== access.trip.data.totalDays
  const reconciledRegen = reconcileTripDatesAndDays({
    startDate: regenStartRaw,
    endDate: regenEndRaw,
    totalDays:
      typeof params.totalDays === 'number' && params.totalDays >= 1
        ? params.totalDays
        : access.trip.data.totalDays,
    preferTotalDays: regenDaysChanged && !regenEndChanged && !regenStartChanged,
    fallbackDays: access.trip.data.totalDays ?? 5,
  })
  tripPatch.startDate = reconciledRegen.startDate
  tripPatch.endDate = reconciledRegen.endDate
  tripPatch.totalDays = reconciledRegen.totalDays

  if (Object.keys(tripPatch).length > 0) {
    const updTrip = await tools.update('trips', tripId, tripPatch as Record<string, unknown>)
    if (!updTrip.success) return fail(updTrip.error ?? 'Failed to update trip settings', { status: 500 })
  }

  const trip = { ...access.trip.data, ...tripPatch }
  const totalDays = Math.max(1, trip.totalDays ?? 5)
  const destRes = await tools.query<DestinationData>('trip_destinations', {
    where: { tripId },
    limit: 50,
  })
  const destinations = destRes.success
    ? destRes.data.records
        .slice()
        .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
    : []

  // Repair missing coordinates and recompute intercity legs as on createTrip
  const seededDestinations: Array<DestinationData & { id: string }> = []
  for (let i = 0; i < destinations.length; i++) {
    const rec = destinations[i]
    const d = { ...rec.data }
    let changed = false

    const geo = await geocodePlaceName(tools, d.name, { countryHint: d.country })
    if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
      if (geo.lat !== d.lat || geo.lng !== d.lng) {
        d.lat = geo.lat
        d.lng = geo.lng
        changed = true
      }
      const nextCountry = resolveCountryIso(d.country) ?? geo.country
      if (nextCountry && nextCountry !== d.country) {
        d.country = nextCountry
        changed = true
      }
    }

    if (d.lodgingName || d.lodgingAddress) {
      const hGeo = await resolveHotelCoordinates(tools, {
        lodgingName: d.lodgingName,
        lodgingAddress: d.lodgingAddress,
        cityName: d.name,
        countryHint: d.country,
        cityLat: d.lat,
        cityLng: d.lng,
      })
      if (hGeo.lat !== d.lodgingLat || hGeo.lng !== d.lodgingLng) {
        d.lodgingLat = hGeo.lat
        d.lodgingLng = hGeo.lng
        changed = true
      }
    }

    const prev = i > 0 ? seededDestinations[seededDestinations.length - 1] : null
    const leg = estimateIntercityTransit(
      prev ? { lat: prev.lodgingLat ?? prev.lat, lng: prev.lodgingLng ?? prev.lng } : null,
      { lat: d.lodgingLat ?? d.lat, lng: d.lodgingLng ?? d.lng },
      i === 0 ? 'none' : d.transportFromPrev,
    )
    const nextTransport = i === 0 ? 'none' : leg.mode
    const nextHours = i === 0 ? 0 : leg.hours
    if (d.transportFromPrev !== nextTransport || d.transitHoursFromPrev !== nextHours) {
      d.transportFromPrev = nextTransport
      d.transitHoursFromPrev = nextHours
      changed = true
    }

    if (changed) {
      await tools.update('trip_destinations', rec.recordId, {
        lat: d.lat,
        lng: d.lng,
        country: d.country,
        lodgingLat: d.lodgingLat,
        lodgingLng: d.lodgingLng,
        transportFromPrev: d.transportFromPrev,
        transitHoursFromPrev: d.transitHoursFromPrev,
      })
    }
    seededDestinations.push({ id: rec.recordId, ...d })
  }

  // Clear all current stops and rebuild initial hotel/travel stops
  await deleteAllWhere(tools, 'trip_stops', { tripId })

  if (seededDestinations.length > 0) {
    await seedHotelAndTravelStops({
      tools,
      tripId,
      userId,
      editors: access.editors,
      totalDays,
      startDate: trip.startDate,
      destinations: seededDestinations,
    })
  }

  return { success: true, data: { tripId, regenerated: true } }
}

export const deleteTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  const childCols = [
    'trip_destinations',
    'trip_stops',
    'trip_checklists',
    'trip_invites',
  ]
  for (const col of childCols) {
    await deleteAllWhere(tools, col, { tripId })
  }
  await deleteAllWhere(tools, 'team_members', { teamId: tripId })
  await tools.remove('trips', tripId)

  return { success: true, data: { deleted: true } }
}

export const addDestination: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const name = typeof params.name === 'string' ? params.name.trim() : ''
  if (!name) return fail('Destination name is required', { status: 400 })

  const existing = await tools.query<DestinationData>('trip_destinations', {
    where: { tripId },
    limit: 100,
  })
  const existingRecords = existing.success
    ? existing.data.records.slice().sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
    : []
  const orderIndex =
    typeof params.orderIndex === 'number'
      ? params.orderIndex
      : existingRecords.length

  let lat = typeof params.lat === 'number' ? params.lat : undefined
  let lng = typeof params.lng === 'number' ? params.lng : undefined
  let country = typeof params.country === 'string' ? params.country.trim() : undefined

  if (lat === undefined || lng === undefined) {
    const geo = await geocodePlaceName(tools, name, { countryHint: country })
    lat = geo.lat
    lng = geo.lng
    if (geo.country) {
      country = resolveCountryIso(country) ?? geo.country
    } else if (country) {
      country = resolveCountryIso(country) ?? country
    }
  }

  const lodgingName = typeof params.lodgingName === 'string' ? params.lodgingName.trim() : undefined
  const lodgingAddress =
    typeof params.lodgingAddress === 'string' ? params.lodgingAddress.trim() : undefined
  let lodgingLat = typeof params.lodgingLat === 'number' ? params.lodgingLat : undefined
  let lodgingLng = typeof params.lodgingLng === 'number' ? params.lodgingLng : undefined
  if ((lodgingName || lodgingAddress) && (lodgingLat === undefined || lodgingLng === undefined)) {
    const hGeo = await resolveHotelCoordinates(tools, {
      lodgingName,
      lodgingAddress,
      cityName: name,
      countryHint: country,
      cityLat: lat,
      cityLng: lng,
    })
    lodgingLat = hGeo.lat
    lodgingLng = hGeo.lng
  }

  const prevDestRecord = existingRecords
    .filter((r) => (r.data.orderIndex ?? 0) < orderIndex)
    .slice(-1)[0]?.data
  const requestedTransport = normalizeIntercityInput(params.transportFromPrev)
  const intercity = estimateIntercityTransit(
    prevDestRecord
      ? {
          lat: prevDestRecord.lodgingLat ?? prevDestRecord.lat,
          lng: prevDestRecord.lodgingLng ?? prevDestRecord.lng,
        }
      : null,
    { lat: lodgingLat ?? lat, lng: lodgingLng ?? lng },
    orderIndex === 0 ? 'none' : requestedTransport,
  )

  const destId = `dest_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
  const newDestRecord: DestinationData = {
    tripId,
    ownerId: userId,
    editors: access.editors,
    name: name.slice(0, 140),
    country,
    lat,
    lng,
    arrivalDate: typeof params.arrivalDate === 'string' && params.arrivalDate ? params.arrivalDate : undefined,
    departureDate:
      typeof params.departureDate === 'string' && params.departureDate ? params.departureDate : undefined,
    lodgingName: lodgingName?.slice(0, 160),
    lodgingAddress: lodgingAddress?.slice(0, 300),
    lodgingLat: lodgingLat ?? lat,
    lodgingLng: lodgingLng ?? lng,
    checkInTime: normalizeTimeHHmm(params.checkInTime, '15:00'),
    checkOutTime: normalizeTimeHHmm(params.checkOutTime, '10:00'),
    orderIndex,
    transportFromPrev: orderIndex === 0 ? 'none' : intercity.mode,
    transitHoursFromPrev: orderIndex === 0 ? 0 : intercity.hours,
    notes: typeof params.notes === 'string' ? params.notes : undefined,
  }
  const res = await tools.create<DestinationData & Record<string, unknown>>(
    'trip_destinations',
    newDestRecord as DestinationData & Record<string, unknown>,
    destId,
  )
  if (!res.success) return fail(res.error ?? 'Failed to add destination', { status: 500 })

  // Seed hotel check-in & transit blocks when explicitly adding a stay with lodging or dates in detailed mode
  if (
    params.seedStops === true ||
    (access.trip.data.mode === 'detailed' &&
      params.seedStops !== false &&
      Boolean(lodgingName || (params.arrivalDate && prevDestRecord)))
  ) {
    const orderedForSeed: Array<DestinationData & { id: string }> = [
      ...(prevDestRecord && existingRecords.length > 0
        ? [{ ...prevDestRecord, id: existingRecords[existingRecords.length - 1].recordId }]
        : []),
      { ...newDestRecord, id: destId },
    ]
    const effectiveStart = resolveEffectiveTripStartDate(access.trip.data.startDate, [
      ...existingRecords.map((r) => ({ id: r.recordId, ...r.data })),
      { id: destId, ...newDestRecord },
    ])
    const totalDays = Math.max(1, access.trip.data.totalDays ?? existingRecords.length + 2)
    let seedDay = 1
    if (orderedForSeed.length > 1) {
      if (effectiveStart && newDestRecord.arrivalDate) {
        seedDay = Math.max(1, diffDaysInclusive(effectiveStart, newDestRecord.arrivalDate))
      } else {
        seedDay = Math.min(totalDays, orderIndex + 1)
      }
      const prevForSeed = orderedForSeed[0]
      const currForSeed = orderedForSeed[1]
      const prevHotel = prevForSeed.lodgingName?.trim() || `${prevForSeed.name} stay`
      const currHotel = currForSeed.lodgingName?.trim() || `${currForSeed.name} stay`
      const travelMinutes = Math.max(20, Math.round(intercity.hours * 60))
      const stopMode = mapIntercityToStopTransport(intercity.mode)
      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: prevForSeed.id,
        ownerId: userId,
        editors: access.editors,
        dayNumber: seedDay,
        orderIndex: 0,
        title: `Check out: ${prevHotel}`.slice(0, 180),
        category: 'lodging',
        address: prevForSeed.lodgingAddress || prevForSeed.name,
        lat: prevForSeed.lodgingLat ?? prevForSeed.lat,
        lng: prevForSeed.lodgingLng ?? prevForSeed.lng,
        startTime: normalizeTimeHHmm(prevForSeed.checkOutTime, '10:00'),
        durationMinutes: 20,
        fixedTime: true,
        preferredWindow: 'morning',
        transportMode: 'walk',
      })
      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: destId,
        ownerId: userId,
        editors: access.editors,
        dayNumber: seedDay,
        orderIndex: 1,
        title: `Travel: ${prevForSeed.name} → ${currForSeed.name}`.slice(0, 180),
        category: 'transit',
        address: `${prevForSeed.name} to ${currForSeed.name}`,
        lat: currForSeed.lodgingLat ?? currForSeed.lat,
        lng: currForSeed.lodgingLng ?? currForSeed.lng,
        durationMinutes: travelMinutes,
        fixedTime: false,
        preferredWindow: 'morning',
        transportMode: stopMode,
        transportOverridden: Boolean(requestedTransport),
        notes: `Estimated ~${intercity.hours}h via ${intercity.mode === 'bullet_train' ? 'bullet train' : intercity.mode}.`,
      })
      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: destId,
        ownerId: userId,
        editors: access.editors,
        dayNumber: seedDay,
        orderIndex: 2,
        title: `Check in: ${currHotel}`.slice(0, 180),
        category: 'lodging',
        address: currForSeed.lodgingAddress || currForSeed.name,
        lat: currForSeed.lodgingLat ?? currForSeed.lat,
        lng: currForSeed.lodgingLng ?? currForSeed.lng,
        startTime: newDestRecord.checkInTime ?? '15:00',
        durationMinutes: 25,
        fixedTime: true,
        preferredWindow: 'afternoon',
        transportMode: 'transit',
      })
      await recalculateAndPersistDay(tools, tripId, seedDay)
    } else if (lodgingName) {
      await tools.create<StopData & Record<string, unknown>>('trip_stops', {
        tripId,
        destinationId: destId,
        ownerId: userId,
        editors: access.editors,
        dayNumber: 1,
        orderIndex: 0,
        title: `Check in: ${lodgingName}`.slice(0, 180),
        category: 'lodging',
        address: lodgingAddress || name,
        lat: lodgingLat ?? lat,
        lng: lodgingLng ?? lng,
        startTime: newDestRecord.checkInTime ?? '15:00',
        durationMinutes: 25,
        fixedTime: true,
        preferredWindow: 'afternoon',
        transportMode: 'transit',
      })
      await recalculateAndPersistDay(tools, tripId, 1)
    }
  }

  return { success: true, data: { destinationId: destId } }
}

async function syncDownstreamIntercityLeg(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  tripId: string,
  prevDest: { recordId: string; data: DestinationData } | null,
  nextDest: { recordId: string; data: DestinationData },
): Promise<void> {
  const nextLat = nextDest.data.lodgingLat ?? nextDest.data.lat
  const nextLng = nextDest.data.lodgingLng ?? nextDest.data.lng
  const leg = estimateIntercityTransit(
    prevDest
      ? {
          lat: prevDest.data.lodgingLat ?? prevDest.data.lat,
          lng: prevDest.data.lodgingLng ?? prevDest.data.lng,
        }
      : null,
    { lat: nextLat, lng: nextLng },
    !prevDest
      ? 'none'
      : nextDest.data.transportFromPrev === 'none'
        ? undefined
        : nextDest.data.transportFromPrev,
  )
  const nextMode: IntercityTransport = !prevDest ? 'none' : leg.mode
  const nextHours = !prevDest ? 0 : leg.hours

  await tools.update('trip_destinations', nextDest.recordId, {
    transportFromPrev: nextMode,
    transitHoursFromPrev: nextHours,
  })

  const linkedStops = await tools.query<StopData>('trip_stops', {
    where: { tripId, destinationId: nextDest.recordId },
    limit: 200,
  })
  if (!linkedStops.success || linkedStops.data.records.length === 0) return

  const touchedDays = new Set<number>()
  for (const s of linkedStops.data.records) {
    if (s.data.category !== 'transit') continue
    if (!prevDest) {
      await tools.remove('trip_stops', s.recordId)
      touchedDays.add(s.data.dayNumber)
      continue
    }
    const modeLabel = nextMode === 'bullet_train' ? 'bullet train' : nextMode
    await tools.update('trip_stops', s.recordId, {
      title: `Travel: ${prevDest.data.name} → ${nextDest.data.name}`.slice(0, 180),
      transportMode: mapIntercityToStopTransport(nextMode),
      durationMinutes: Math.max(20, Math.round(nextHours * 60)),
      notes: `Estimated ~${nextHours}h via ${modeLabel}.`,
      ...(typeof nextLat === 'number' && typeof nextLng === 'number' ? { lat: nextLat, lng: nextLng } : {}),
    })
    touchedDays.add(s.data.dayNumber)
  }
  for (const d of touchedDays) {
    await recalculateAndPersistDay(tools, tripId, d)
  }
}

export const updateDestination: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const destinationId = typeof params.destinationId === 'string' ? params.destinationId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const existing = await tools.get<DestinationData>('trip_destinations', destinationId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return fail('Destination not found', { status: 404 })
  }

  const curr = existing.data.record.data
  const patch: Partial<DestinationData> = {}
  const clearLodging = params.clearLodging === true
  if (typeof params.name === 'string' && params.name.trim()) patch.name = params.name.trim().slice(0, 140)
  if (typeof params.country === 'string') patch.country = params.country.trim() || undefined
  if (typeof params.arrivalDate === 'string') patch.arrivalDate = params.arrivalDate || undefined
  if (typeof params.departureDate === 'string') patch.departureDate = params.departureDate || undefined
  if (clearLodging) {
    patch.lodgingName = ''
    patch.lodgingAddress = ''
    patch.lodgingLat = curr.lat
    patch.lodgingLng = curr.lng
  } else {
    if (typeof params.lodgingName === 'string') patch.lodgingName = params.lodgingName.trim().slice(0, 160) || undefined
    if (typeof params.lodgingAddress === 'string') patch.lodgingAddress = params.lodgingAddress.trim().slice(0, 300) || undefined
    if (typeof params.checkInTime === 'string') patch.checkInTime = normalizeTimeHHmm(params.checkInTime, '15:00')
    if (typeof params.checkOutTime === 'string') patch.checkOutTime = normalizeTimeHHmm(params.checkOutTime, '10:00')
  }

  const cityName = patch.name ?? curr.name
  const countryHint = patch.country !== undefined ? patch.country : curr.country
  const cityChanged =
    (patch.name !== undefined && patch.name !== curr.name) ||
    (patch.country !== undefined && patch.country !== curr.country) ||
    Boolean(params.refreshGeocode) ||
    typeof curr.lat !== 'number' ||
    typeof curr.lng !== 'number'

  let cityLat = curr.lat
  let cityLng = curr.lng
  if (cityChanged) {
    const cityGeo = await geocodePlaceName(tools, cityName, { countryHint })
    if (typeof cityGeo.lat === 'number' && typeof cityGeo.lng === 'number') {
      patch.lat = cityGeo.lat
      patch.lng = cityGeo.lng
      cityLat = cityGeo.lat
      cityLng = cityGeo.lng
      if (cityGeo.country) {
        patch.country = resolveCountryIso(countryHint) ?? cityGeo.country
      }
    }
  }

  const resolvedCountry = patch.country ?? countryHint
  const hotelName = clearLodging ? undefined : (patch.lodgingName ?? curr.lodgingName)
  const hotelAddress = clearLodging ? undefined : (patch.lodgingAddress ?? curr.lodgingAddress)
  if (!clearLodging && (cityChanged || patch.lodgingName !== undefined || patch.lodgingAddress !== undefined || Boolean(hotelName || hotelAddress))) {
    if (hotelName || hotelAddress) {
      const hGeo = await resolveHotelCoordinates(tools, {
        lodgingName: hotelName,
        lodgingAddress: hotelAddress,
        cityName,
        countryHint: resolvedCountry,
        cityLat,
        cityLng,
      })
      patch.lodgingLat = hGeo.lat
      patch.lodgingLng = hGeo.lng
    } else if (typeof cityLat === 'number' && typeof cityLng === 'number') {
      patch.lodgingLat = cityLat
      patch.lodgingLng = cityLng
    }
  }

  // Recompute intercity transit mode & hours when requested or coordinates changed
  const requestedMode = normalizeIntercityInput(params.transportFromPrev)
  const forceAutoTransport = params.transportFromPrev === 'auto'
  const allDestsRes = await tools.query<DestinationData>('trip_destinations', { where: { tripId }, limit: 50 })
  const prevDest = allDestsRes.success
    ? allDestsRes.data.records
        .filter((r) => (r.data.orderIndex ?? 0) < (curr.orderIndex ?? 0))
        .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
        .slice(-1)[0]?.data
    : undefined

  let updatedTransitMode: IntercityTransport | undefined
  let updatedTransitHours: number | undefined
  if (prevDest && (requestedMode || forceAutoTransport || cityChanged || patch.lodgingLat !== undefined)) {
    const nextLeg = estimateIntercityTransit(
      { lat: prevDest.lodgingLat ?? prevDest.lat, lng: prevDest.lodgingLng ?? prevDest.lng },
      { lat: patch.lodgingLat ?? cityLat, lng: patch.lodgingLng ?? cityLng },
      forceAutoTransport ? undefined : (requestedMode ?? curr.transportFromPrev),
    )
    patch.transportFromPrev = nextLeg.mode
    patch.transitHoursFromPrev = nextLeg.hours
    updatedTransitMode = nextLeg.mode
    updatedTransitHours = nextLeg.hours
  }

  const upd = await tools.update('trip_destinations', destinationId, patch as Record<string, unknown>)
  if (!upd.success) return fail(upd.error ?? 'Failed to update destination', { status: 500 })

  const nextLat = patch.lodgingLat ?? patch.lat ?? curr.lodgingLat ?? curr.lat
  const nextLng = patch.lodgingLng ?? patch.lng ?? curr.lodgingLng ?? curr.lng
  const allTripStops = await tools.query<StopData>('trip_stops', {
    where: { tripId },
    limit: 300,
  })
  const oldHotelTitle = curr.lodgingName?.trim().toLowerCase()
  const matchingStops = allTripStops.success
    ? allTripStops.data.records.filter((s) => {
        if (s.data.destinationId === destinationId) return true
        if (!s.data.destinationId && s.data.category === 'lodging') {
          const t = s.data.title.toLowerCase()
          if (oldHotelTitle && t.includes(oldHotelTitle)) return true
          if (hotelName && t.includes(hotelName.toLowerCase())) return true
        }
        return false
      })
    : []
  if (matchingStops.length > 0) {
    const touchedDays = new Set<number>()
    for (const s of matchingStops) {
      if (clearLodging && s.data.category === 'lodging') {
        await tools.remove('trip_stops', s.recordId)
        touchedDays.add(s.data.dayNumber)
        continue
      }

      const stopPatch: Partial<StopData> = {}
      if (!s.data.destinationId && s.data.category === 'lodging') {
        stopPatch.destinationId = destinationId
      }
      const matchesOld =
        (s.data.lat === curr.lat && s.data.lng === curr.lng) ||
        (s.data.lat === curr.lodgingLat && s.data.lng === curr.lodgingLng) ||
        s.data.category === 'lodging' ||
        s.data.category === 'transit'
      if (typeof nextLat === 'number' && typeof nextLng === 'number' && matchesOld) {
        if (s.data.lat !== nextLat || s.data.lng !== nextLng) {
          stopPatch.lat = nextLat
          stopPatch.lng = nextLng
        }
      }
      if (s.data.category === 'transit' && updatedTransitMode && updatedTransitHours !== undefined) {
        stopPatch.transportMode = mapIntercityToStopTransport(updatedTransitMode)
        stopPatch.transportOverridden = Boolean(requestedMode && !forceAutoTransport)
        stopPatch.durationMinutes = Math.max(20, Math.round(updatedTransitHours * 60))
        stopPatch.notes = `Estimated ~${updatedTransitHours}h via ${updatedTransitMode === 'bullet_train' ? 'bullet train' : updatedTransitMode}.`
      }
      if (s.data.category === 'lodging' && !clearLodging) {
        if (s.data.title.startsWith('Check in:')) {
          if (hotelName) stopPatch.title = `Check in: ${hotelName}`.slice(0, 180)
          if (patch.checkInTime) {
            stopPatch.startTime = patch.checkInTime
            stopPatch.fixedTime = true
          }
          if (hotelAddress) stopPatch.address = hotelAddress
        } else if (s.data.title.startsWith('Check out:')) {
          if (hotelName) stopPatch.title = `Check out: ${hotelName}`.slice(0, 180)
          if (patch.checkOutTime) {
            stopPatch.startTime = patch.checkOutTime
            stopPatch.fixedTime = true
          }
          if (hotelAddress) stopPatch.address = hotelAddress
        }
      }
      if (Object.keys(stopPatch).length > 0) {
        await tools.update('trip_stops', s.recordId, stopPatch as Record<string, unknown>)
        touchedDays.add(s.data.dayNumber)
      }
    }
    for (const d of touchedDays) {
      await recalculateAndPersistDay(tools, tripId, d)
    }
  }

  if (allDestsRes.success && (cityChanged || patch.lodgingLat !== undefined || clearLodging)) {
    const sortedDests = allDestsRes.data.records
      .slice()
      .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
    const currIdx = sortedDests.findIndex((r) => r.recordId === destinationId)
    if (currIdx >= 0 && currIdx + 1 < sortedDests.length) {
      const updatedCurr = {
        recordId: destinationId,
        data: { ...curr, ...patch },
      }
      await syncDownstreamIntercityLeg(tools, tripId, updatedCurr, sortedDests[currIdx + 1])
    }
  }

  return { success: true, data: { destinationId } }
}

export const removeDestination: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const destinationId = typeof params.destinationId === 'string' ? params.destinationId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const existing = await tools.get<DestinationData>('trip_destinations', destinationId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return fail('Destination not found', { status: 404 })
  }
  const removedOrder = existing.data.record.data.orderIndex ?? 0
  await tools.remove('trip_destinations', destinationId)

  // Clean up hotel/transit stops tied directly to the removed stay
  const linkedStops = await tools.query<StopData>('trip_stops', {
    where: { tripId, destinationId },
    limit: 200,
  })
  if (linkedStops.success && linkedStops.data.records.length > 0) {
    const touchedDays = new Set<number>()
    for (const s of linkedStops.data.records) {
      if (s.data.category === 'lodging' || s.data.category === 'transit') {
        await tools.remove('trip_stops', s.recordId)
        touchedDays.add(s.data.dayNumber)
      }
    }
    for (const d of touchedDays) {
      await recalculateAndPersistDay(tools, tripId, d)
    }
  }

  // Re-index remaining stays sequentially and recompute the newly connected downstream leg
  const remainingRes = await tools.query<DestinationData>('trip_destinations', {
    where: { tripId },
    limit: 100,
  })
  if (remainingRes.success && remainingRes.data.records.length > 0) {
    const sorted = remainingRes.data.records
      .slice()
      .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
    let firstShiftedIdx: number | null = null
    for (let idx = 0; idx < sorted.length; idx++) {
      const rec = sorted[idx]
      const origOrder = rec.data.orderIndex ?? 0
      if (firstShiftedIdx === null && origOrder > removedOrder) {
        firstShiftedIdx = idx
      }
      if (origOrder !== idx) {
        await tools.update('trip_destinations', rec.recordId, { orderIndex: idx })
        rec.data.orderIndex = idx
      }
    }
    if (firstShiftedIdx !== null) {
      const prevRec = firstShiftedIdx > 0 ? sorted[firstShiftedIdx - 1] : null
      await syncDownstreamIntercityLeg(tools, tripId, prevRec, sorted[firstShiftedIdx])
    }
  }

  return { success: true, data: { removed: true } }
}

export const upsertTripStop: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const title = typeof params.title === 'string' ? params.title.trim() : ''
  if (!title) return fail('Stop title is required', { status: 400 })

  const dayNumber =
    typeof params.dayNumber === 'number' && params.dayNumber >= 1
      ? Math.round(params.dayNumber)
      : 1

  const category: StopCategory =
    params.category === 'must_see' ||
    params.category === 'restaurant' ||
    params.category === 'photo_spot' ||
    params.category === 'day_trip' ||
    params.category === 'hidden_gem' ||
    params.category === 'lodging' ||
    params.category === 'transit'
      ? params.category
      : 'must_see'

  const stopId = typeof params.stopId === 'string' && params.stopId ? params.stopId : null
  let existingRecord: StopData | null = null
  if (stopId) {
    const existing = await tools.get<StopData>('trip_stops', stopId)
    if (!existing.success || existing.data.record.data.tripId !== tripId) {
      return fail('Stop not found', { status: 404 })
    }
    existingRecord = existing.data.record.data
  }

  const explicitCoords = typeof params.lat === 'number' && typeof params.lng === 'number'
  const nextAddress =
    typeof params.address === 'string' ? params.address.trim() : existingRecord?.address
  const titleChanged = Boolean(existingRecord && title !== existingRecord.title)
  const addressChanged = Boolean(
    existingRecord &&
      typeof params.address === 'string' &&
      params.address.trim() !== (existingRecord.address ?? '').trim(),
  )
  const dayChanged = Boolean(existingRecord && dayNumber !== existingRecord.dayNumber)
  const isMovableStop =
    !existingRecord ||
    (existingRecord.category !== 'lodging' && existingRecord.category !== 'transit')

  let lat = explicitCoords ? (params.lat as number) : existingRecord?.lat
  let lng = explicitCoords ? (params.lng as number) : existingRecord?.lng
  if (
    !explicitCoords &&
    (Boolean(params.refreshGeocode) ||
      lat === undefined ||
      lng === undefined ||
      (isMovableStop && (titleChanged || addressChanged || dayChanged)))
  ) {
    let resolvedLodgingFromStay = false
    if (category === 'lodging' && !params.refreshGeocode) {
      const side = /^\s*check\s*out\b/i.test(title) ? 'departure' : 'arrival'
      const hotelOrigin = await resolveHotelOriginForDay(tools, tripId, dayNumber, side)
      if (hotelOrigin) {
        lat = hotelOrigin.lat
        lng = hotelOrigin.lng
        resolvedLodgingFromStay = true
      }
    }
    if (!resolvedLodgingFromStay) {
      const bias = await resolveTripGeocodeBias(tools, tripId, dayNumber)
      const geo = await resolveStopCoordinates(tools, {
        title,
        address: nextAddress,
        category,
        cityName: bias.cityName,
        countryHint: bias.countryHint,
        near: bias.near,
      })
      if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
        lat = geo.lat
        lng = geo.lng
      } else if (titleChanged || addressChanged || dayChanged) {
        // Drop stale coordinates from an old venue/city if the edited venue cannot yet be resolved
        lat = undefined
        lng = undefined
      }
    }
  }

  let validatedSourceUrl: string | undefined = existingRecord?.sourceUrl
  if (typeof params.sourceUrl === 'string') {
    const normalized = normalizeSafeHttpUrl(params.sourceUrl)
    if (normalized === null) {
      return fail('Source URL must start with http:// or https://', { status: 400 })
    }
    validatedSourceUrl = normalized || undefined
  }

  const payload: Partial<StopData> = {
    tripId,
    destinationId:
      typeof params.destinationId === 'string'
        ? params.destinationId
        : existingRecord?.destinationId,
    editors: access.editors,
    dayNumber,
    title: title.slice(0, 180),
    category,
    address:
      typeof params.address === 'string'
        ? params.address.slice(0, 300)
        : existingRecord?.address,
    lat,
    lng,
    startTime:
      typeof params.startTime === 'string' ? params.startTime : existingRecord?.startTime,
    durationMinutes:
      typeof params.durationMinutes === 'number'
        ? Math.max(15, Math.round(params.durationMinutes))
        : (existingRecord?.durationMinutes ?? 60),
    fixedTime:
      typeof params.fixedTime === 'boolean'
        ? params.fixedTime
        : Boolean(existingRecord?.fixedTime),
    preferredWindow:
      (params.preferredWindow as PreferredWindow | undefined) ??
      existingRecord?.preferredWindow ??
      'any',
    transportMode:
      params.transportMode === 'walk' ||
      params.transportMode === 'drive' ||
      params.transportMode === 'transit' ||
      params.transportMode === 'bullet_train' ||
      params.transportMode === 'flight'
        ? params.transportMode
        : (existingRecord?.transportMode ?? access.trip.data.transportPreference ?? 'transit'),
    transportOverridden:
      typeof params.transportOverridden === 'boolean'
        ? params.transportOverridden
        : existingRecord?.transportOverridden,
    estimatedCost:
      typeof params.estimatedCost === 'number'
        ? Math.max(0, params.estimatedCost)
        : existingRecord?.estimatedCost,
    rating: typeof params.rating === 'number' ? params.rating : existingRecord?.rating,
    photoTip:
      typeof params.photoTip === 'string'
        ? params.photoTip.slice(0, 600)
        : existingRecord?.photoTip,
    bestLightWindow:
      (params.bestLightWindow as LightWindow | undefined) ??
      existingRecord?.bestLightWindow ??
      'any',
    notes:
      typeof params.notes === 'string' ? params.notes.slice(0, 2000) : existingRecord?.notes,
    sourceUrl: validatedSourceUrl,
  }

  let finalStopId: string
  if (stopId) {
    const upd = await tools.update('trip_stops', stopId, payload as Record<string, unknown>)
    if (!upd.success) return fail(upd.error ?? 'Failed to update stop', { status: 500 })
    finalStopId = stopId
  } else {
    const dayStops = await tools.query<StopData>('trip_stops', {
      where: { tripId, dayNumber },
      limit: 200,
    })
    const nextOrder =
      typeof params.orderIndex === 'number'
        ? params.orderIndex
        : dayStops.success
          ? dayStops.data.records.length
          : 0
    finalStopId = `stop_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
    const crt = await tools.create(
      'trip_stops',
      {
        ...payload,
        ownerId: userId,
        orderIndex: nextOrder,
      } as Record<string, unknown>,
      finalStopId,
    )
    if (!crt.success) return fail(crt.error ?? 'Failed to create stop', { status: 500 })
  }

  await recalculateAndPersistDay(tools, tripId, dayNumber)
  return { success: true, data: { stopId: finalStopId, dayNumber } }
}

export const removeTripStop: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const stopId = typeof params.stopId === 'string' ? params.stopId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const existing = await tools.get<StopData>('trip_stops', stopId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return fail('Stop not found', { status: 404 })
  }
  const dayNumber = existing.data.record.data.dayNumber
  await tools.remove('trip_stops', stopId)
  await recalculateAndPersistDay(tools, tripId, dayNumber)

  return { success: true, data: { removed: true } }
}

export const moveTripStop: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const stopId = typeof params.stopId === 'string' ? params.stopId : ''
  const direction = params.direction === 'up' ? -1 : 1
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const target = await tools.get<StopData>('trip_stops', stopId)
  if (!target.success || target.data.record.data.tripId !== tripId) {
    return fail('Stop not found', { status: 404 })
  }

  const dayNumber = target.data.record.data.dayNumber
  const q = await tools.query<StopData>('trip_stops', {
    where: { tripId, dayNumber },
    limit: 200,
  })
  if (!q.success) return fail(q.error, { status: 500 })

  const ordered = q.data.records
    .slice()
    .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
  const idx = ordered.findIndex((r) => r.recordId === stopId)
  const swapIdx = idx + direction
  if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) {
    return { success: true, data: { moved: false } }
  }

  const a = ordered[idx]
  const b = ordered[swapIdx]
  await tools.update('trip_stops', a.recordId, { orderIndex: swapIdx })
  await tools.update('trip_stops', b.recordId, { orderIndex: idx })
  await recalculateAndPersistDay(tools, tripId, dayNumber)

  return { success: true, data: { moved: true } }
}

export const optimizeTripDay: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const dayNumber =
    typeof params.dayNumber === 'number' && params.dayNumber >= 1
      ? Math.round(params.dayNumber)
      : 1
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const result = await recalculateAndPersistDay(tools, tripId, dayNumber, {
    optimize: true,
    dayStartMinutes:
      typeof params.dayStartMinutes === 'number' ? params.dayStartMinutes : 9 * 60,
  })
  if (!result.success) return fail(result.error, { status: 500 })
  return { success: true, data: result }
}

export const refreshDestinationWeather: ActionHandler<Env> = async ({
  userId,
  params,
  tools,
}) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const destinationId = typeof params.destinationId === 'string' ? params.destinationId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'viewer')
  if (!access.ok) return fail(access.error, { status: access.status })

  const destRes = await tools.get<DestinationData>('trip_destinations', destinationId)
  if (!destRes.success || destRes.data.record.data.tripId !== tripId) {
    return fail('Destination not found', { status: 404 })
  }

  const dest = destRes.data.record.data
  const q = formatWeatherQuery(dest.name, dest.country)

  const [currRes, fcRes] = await Promise.all([
    tools.integration<{
      temp?: number
      description?: string
      sunrise?: number
      sunset?: number
    }>('openweathermap/current', { q, units: 'metric' }),
    tools.integration<
      Array<{ dt: number; temp: number; description: string }>
    >('openweathermap/forecast', { q, units: 'metric' }),
  ])

  if (!currRes.success) {
    return fail(currRes.error ?? 'Weather lookup failed', {
      code: currRes.code,
      status: currRes.status ?? 502,
    })
  }

  const dailyMap = new Map<string, { mins: number[]; maxs: number[]; desc: string }>()
  if (fcRes.success && Array.isArray(fcRes.data)) {
    for (const step of fcRes.data) {
      const dayKey = new Date(step.dt * 1000).toISOString().slice(0, 10)
      const bucket = dailyMap.get(dayKey) ?? { mins: [], maxs: [], desc: step.description }
      bucket.mins.push(step.temp)
      bucket.maxs.push(step.temp)
      dailyMap.set(dayKey, bucket)
    }
  }

  const weather: WeatherForecastSummary = {
    fetchedAt: new Date().toISOString(),
    tempC: Math.round(currRes.data.temp ?? 0),
    description: currRes.data.description ?? 'Clear',
    sunrise: currRes.data.sunrise,
    sunset: currRes.data.sunset,
    daily: Array.from(dailyMap.entries())
      .slice(0, 5)
      .map(([date, b]) => ({
        date,
        tempMinC: Math.round(Math.min(...b.mins)),
        tempMaxC: Math.round(Math.max(...b.maxs)),
        description: b.desc,
      })),
  }

  // Only update cached weather on the destination if caller has editor rights; viewers still receive it in response
  if (access.role === 'owner' || access.role === 'editor') {
    await tools.update('trip_destinations', destinationId, { weatherCache: weather })
  }

  return { success: true, data: { weather } }
}

export const toggleChecklistItem: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const itemId = typeof params.itemId === 'string' ? params.itemId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const existing = await tools.get<ChecklistData>('trip_checklists', itemId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return fail('Checklist item not found', { status: 404 })
  }
  const nextCompleted =
    typeof params.completed === 'boolean' ? params.completed : !existing.data.record.data.completed
  await tools.update('trip_checklists', itemId, { completed: nextCompleted })
  return { success: true, data: { completed: nextCompleted } }
}

export const addChecklistItem: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const label = typeof params.label === 'string' ? params.label.trim() : ''
  if (!label) return fail('Checklist label is required', { status: 400 })

  const category =
    params.category === 'booking' ||
    params.category === 'gear' ||
    params.category === 'documents' ||
    params.category === 'packing'
      ? params.category
      : 'packing'

  const itemId = `chk_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
  await tools.create(
    'trip_checklists',
    {
      tripId,
      ownerId: userId,
      editors: access.editors,
      category,
      label: label.slice(0, 240),
      completed: false,
    },
    itemId,
  )
  return { success: true, data: { itemId } }
}

export const removeChecklistItem: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const itemId = typeof params.itemId === 'string' ? params.itemId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const existing = await tools.get<ChecklistData>('trip_checklists', itemId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return fail('Checklist item not found', { status: 404 })
  }
  await tools.remove('trip_checklists', itemId)
  return { success: true, data: { removed: true } }
}

// ============================================================================
// Sharing & Per-Trip Viewer / Editor Role Management (Owner-only)
// ============================================================================

async function upsertTeamMembershipAndSync(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  params: {
    tripId: string
    trip: TripData
    targetUserId: string
    targetName: string
    targetImageUrl?: string
    role: 'viewer' | 'editor'
    actorUserId: string
  },
) {
  const { tripId, trip, targetUserId, targetName, targetImageUrl, role, actorUserId } = params
  const editorsSet = new Set(parseIdArray(trip.editors))
  const viewersSet = new Set(parseIdArray(trip.viewers))
  editorsSet.add(trip.ownerId)

  if (targetUserId === trip.ownerId) return

  if (role === 'editor') {
    editorsSet.add(targetUserId)
    viewersSet.delete(targetUserId)
  } else {
    viewersSet.add(targetUserId)
    editorsSet.delete(targetUserId)
  }

  const existingMember = await tools.query<TeamMemberData>('team_members', {
    where: { teamId: tripId, userId: targetUserId },
    limit: 1,
  })
  if (existingMember.success && existingMember.data.records.length > 0) {
    await tools.update('team_members', existingMember.data.records[0].recordId, {
      role,
      status: 'active',
      displayName: targetName,
      imageUrl: targetImageUrl,
    })
  } else {
    await tools.create<TeamMemberData & Record<string, unknown>>('team_members', {
      teamId: tripId,
      userId: targetUserId,
      role,
      status: 'active',
      displayName: targetName,
      imageUrl: targetImageUrl,
      addedBy: actorUserId,
    })
  }

  const nextEditors = Array.from(editorsSet)
  const nextViewers = Array.from(viewersSet)
  await tools.update('trips', tripId, { editors: nextEditors, viewers: nextViewers })
  await syncEditorsAcrossTripRecords(tools, tripId, nextEditors)
}

export const inviteTripMember: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  const role: 'viewer' | 'editor' = params.role === 'editor' ? 'editor' : 'viewer'
  const targetUserIdParam = typeof params.targetUserId === 'string' ? params.targetUserId.trim() : ''
  const emailParam = typeof params.email === 'string' ? params.email.trim().toLowerCase() : ''

  let matchedUser: { recordId: string; name?: string; email?: string; imageUrl?: string } | null = null

  if (targetUserIdParam) {
    const u = await tools.get<{ name?: string; email?: string; imageUrl?: string }>('users', targetUserIdParam)
    if (u.success && u.data?.record) {
      matchedUser = { recordId: u.data.record.recordId, ...u.data.record.data }
    }
  } else if (emailParam) {
    const directMatch = await tools.query<{ name?: string; email?: string; imageUrl?: string }>('users', {
      where: { email: emailParam },
      limit: 1,
    })
    if (directMatch.success && directMatch.data.records.length > 0) {
      const hit = directMatch.data.records[0]
      matchedUser = { recordId: hit.recordId, ...hit.data }
    }
  }

  if (matchedUser) {
    if (matchedUser.recordId === access.trip.data.ownerId) {
      return fail('You are already the owner of this trip.', { status: 400 })
    }
    await upsertTeamMembershipAndSync(tools, {
      tripId,
      trip: access.trip.data,
      targetUserId: matchedUser.recordId,
      targetName: matchedUser.name || matchedUser.email || 'Collaborator',
      targetImageUrl: matchedUser.imageUrl,
      role,
      actorUserId: userId,
    })
    return {
      success: true,
      data: {
        status: 'added',
        userId: matchedUser.recordId,
        role,
      },
    }
  }

  // User hasn't signed into Trippie yet — create an email-bound expiring invite token
  const token = `inv_${crypto.randomUUID().replace(/-/g, '')}`
  const inviteId = `invrec_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
  const expiresAt = Date.now() + INVITE_TTL_MS
  await tools.create<TripInviteData & Record<string, unknown>>(
    'trip_invites',
    {
      tripId,
      ownerId: userId,
      token,
      role,
      invitedEmail: emailParam || undefined,
      expiresAt,
      status: 'pending',
    },
    inviteId,
  )

  return {
    success: true,
    data: {
      status: 'link_created',
      token,
      role,
      expiresAt,
    },
  }
}

export const createTripInviteLink: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  const role: 'viewer' | 'editor' = params.role === 'editor' ? 'editor' : 'viewer'
  const token = `inv_${crypto.randomUUID().replace(/-/g, '')}`
  const expiresAt = Date.now() + INVITE_TTL_MS
  await tools.create<TripInviteData & Record<string, unknown>>('trip_invites', {
    tripId,
    ownerId: userId,
    token,
    role,
    expiresAt,
    status: 'pending',
  })

  return { success: true, data: { token, role, expiresAt } }
}

export const acceptTripInvite: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const token = typeof params.token === 'string' ? params.token.trim() : ''
  if (!token) return fail('Invite token is required', { status: 400 })

  const q = await tools.query<TripInviteData>('trip_invites', {
    where: { token },
    limit: 1,
  })
  if (!q.success || q.data.records.length === 0) {
    return fail('Invite link is invalid or has been revoked.', { status: 404 })
  }
  const invite = q.data.records[0]
  if (invite.data.status !== 'pending') {
    return fail('Invite link is no longer active.', { status: 400 })
  }
  if (typeof invite.data.expiresAt === 'number' && Date.now() > invite.data.expiresAt) {
    return fail('Invite link has expired.', { status: 400 })
  }

  const tripRes = await tools.get<TripData>('trips', invite.data.tripId)
  if (!tripRes.success || !tripRes.data?.record) {
    return fail('Trip no longer exists.', { status: 404 })
  }

  const callerUserRes = await tools.get<{ name?: string; email?: string; imageUrl?: string }>('users', userId)
  const callerRecord = callerUserRes.success ? callerUserRes.data?.record?.data : undefined
  if (invite.data.invitedEmail) {
    const callerEmail = (callerRecord?.email ?? '').trim().toLowerCase()
    const targetEmail = invite.data.invitedEmail.trim().toLowerCase()
    if (!callerEmail || callerEmail !== targetEmail) {
      return fail('This invite link is restricted to the invited email address.', { status: 403 })
    }
  }

  const callerName = callerRecord?.name || callerRecord?.email || 'Traveler'
  await upsertTeamMembershipAndSync(tools, {
    tripId: invite.data.tripId,
    trip: tripRes.data.record.data,
    targetUserId: userId,
    targetName: callerName,
    targetImageUrl: callerRecord?.imageUrl,
    role: invite.data.role,
    actorUserId: invite.data.ownerId ?? tripRes.data.record.data.ownerId,
  })

  await tools.update('trip_invites', invite.recordId, { status: 'accepted' })

  return {
    success: true,
    data: { tripId: invite.data.tripId, role: invite.data.role },
  }
}

export const listTripInvites: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  const q = await tools.query<TripInviteData>('trip_invites', {
    where: { tripId, status: 'pending' },
    limit: 100,
  })
  const now = Date.now()
  const invites = q.success
    ? q.data.records
        .filter((r) => typeof r.data.expiresAt !== 'number' || r.data.expiresAt > now)
        .map((r) => ({
          inviteId: r.recordId,
          role: r.data.role,
          invitedEmail: r.data.invitedEmail ?? null,
          expiresAt: r.data.expiresAt ?? null,
          token: r.data.token,
        }))
    : []

  return { success: true, data: { invites } }
}

export const revokeTripInvite: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const inviteId = typeof params.inviteId === 'string' ? params.inviteId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  if (!inviteId) return fail('Invite ID is required', { status: 400 })
  const existing = await tools.get<TripInviteData>('trip_invites', inviteId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return fail('Invite not found', { status: 404 })
  }

  await tools.update('trip_invites', inviteId, { status: 'revoked' })
  return { success: true, data: { revoked: true, inviteId } }
}

export const setTripMemberRole: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const targetUserId = typeof params.targetUserId === 'string' ? params.targetUserId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  if (!targetUserId || targetUserId === access.trip.data.ownerId) {
    return fail('Cannot change the trip owner role.', { status: 400 })
  }

  const role: 'viewer' | 'editor' = params.role === 'editor' ? 'editor' : 'viewer'
  const memberQ = await tools.query<TeamMemberData>('team_members', {
    where: { teamId: tripId, userId: targetUserId },
    limit: 1,
  })
  const existingName = memberQ.success ? memberQ.data.records[0]?.data.displayName : undefined

  await upsertTeamMembershipAndSync(tools, {
    tripId,
    trip: access.trip.data,
    targetUserId,
    targetName: existingName || 'Collaborator',
    role,
    actorUserId: userId,
  })

  return { success: true, data: { targetUserId, role } }
}

export const removeTripMember: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const targetUserId = typeof params.targetUserId === 'string' ? params.targetUserId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  if (!targetUserId || targetUserId === access.trip.data.ownerId) {
    return fail('Cannot remove the trip owner.', { status: 400 })
  }

  const editors = parseIdArray(access.trip.data.editors).filter((id) => id !== targetUserId)
  const viewers = parseIdArray(access.trip.data.viewers).filter((id) => id !== targetUserId)
  if (!editors.includes(access.trip.data.ownerId)) editors.unshift(access.trip.data.ownerId)

  const memberQ = await tools.query<TeamMemberData>('team_members', {
    where: { teamId: tripId, userId: targetUserId },
    limit: 1,
  })
  if (memberQ.success && memberQ.data.records.length > 0) {
    await tools.remove('team_members', memberQ.data.records[0].recordId)
  }

  await tools.update('trips', tripId, { editors, viewers })
  await syncEditorsAcrossTripRecords(tools, tripId, editors)

  return { success: true, data: { removed: true } }
}
