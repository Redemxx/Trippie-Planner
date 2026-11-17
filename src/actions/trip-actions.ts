import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { buildBaselineOverview } from '../lib/overview-planner.js'
import { SAMPLE_TRIP } from '../lib/sample-trip.js'
import type {
  BudgetTier,
  ChecklistData,
  DestinationData,
  IntercityTransport,
  LightWindow,
  OverviewData,
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
  syncEditorsAcrossTripRecords,
} from '../server/trip-helpers.js'

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

function diffDaysInclusive(start?: string, end?: string): number {
  if (!start || !end) return 0
  const s = Date.parse(start)
  const e = Date.parse(end)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
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

export const createTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const title = typeof params.title === 'string' ? params.title.trim() : ''
  if (!title) return fail('Trip title is required', { code: 'invalid_input', status: 400 })

  const mode: TripMode = params.mode === 'overview' ? 'overview' : 'detailed'
  const pace: TripPace =
    params.pace === 'relaxed' || params.pace === 'packed' ? params.pace : 'balanced'
  const budgetTier: BudgetTier =
    params.budgetTier === 'budget' || params.budgetTier === 'luxury' ? params.budgetTier : 'moderate'
  const transportPreference: TransportMode =
    params.transportPreference === 'walk' || params.transportPreference === 'drive'
      ? params.transportPreference
      : 'transit'

  const startDate = typeof params.startDate === 'string' && params.startDate ? params.startDate : undefined
  const endDate = typeof params.endDate === 'string' && params.endDate ? params.endDate : undefined
  const dateDays = diffDaysInclusive(startDate, endDate)
  const totalDays =
    typeof params.totalDays === 'number' && params.totalDays >= 1
      ? Math.min(60, Math.round(params.totalDays))
      : dateDays || 5

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

  const overviewInputs: Array<{ name: string; country?: string; lat?: number; lng?: number }> = []

  for (let i = 0; i < rawDests.length; i++) {
    const item = rawDests[i]
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue

    let lat = typeof item.lat === 'number' ? item.lat : undefined
    let lng = typeof item.lng === 'number' ? item.lng : undefined
    let country = typeof item.country === 'string' ? item.country : undefined

    if (lat === undefined || lng === undefined) {
      const geo = await geocodePlaceName(tools, country ? `${name}, ${country}` : name)
      lat = geo.lat
      lng = geo.lng
      if (!country && geo.country) country = geo.country
    }

    overviewInputs.push({ name, country, lat, lng })

    await tools.create<DestinationData & Record<string, unknown>>('trip_destinations', {
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
      orderIndex: i,
      transportFromPrev:
        (item.transportFromPrev as IntercityTransport | undefined) ?? (i === 0 ? 'none' : 'train'),
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    })
  }

  if (overviewInputs.length > 0) {
    const baseline = buildBaselineOverview({
      tripId,
      locations: overviewInputs,
      totalDays,
      pace,
      interests: tripData.interests,
    })
    await tools.create<OverviewData & Record<string, unknown>>('trip_overviews', {
      ...baseline,
      ownerId: userId,
      editors,
    })
  }

  return { success: true, data: { tripId, trip: tripData } }
}

export const cloneSampleTrip: ActionHandler<Env> = async ({ userId, tools }) => {
  const tripId = `trip_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const editors = [userId]

  const tripData: TripData = {
    ...SAMPLE_TRIP.trip,
    ownerId: userId,
    teamId: tripId,
    editors,
    viewers: [],
  }

  const created = await tools.create('trips', tripData as unknown as Record<string, unknown>, tripId)
  if (!created.success) return fail(created.error ?? 'Failed to clone sample trip', { status: 500 })

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

  const destIdMap = new Map<string, string>()
  for (const dest of SAMPLE_TRIP.destinations) {
    const newDestId = `dest_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
    destIdMap.set(dest.id, newDestId)
    const { id: _id, ...rest } = dest
    await tools.create('trip_destinations', {
      ...rest,
      tripId,
      ownerId: userId,
      editors,
    }, newDestId)
  }

  for (const stop of SAMPLE_TRIP.stops) {
    const { id: _id, ...rest } = stop
    await tools.create('trip_stops', {
      ...rest,
      tripId,
      destinationId: rest.destinationId ? destIdMap.get(rest.destinationId) : undefined,
      ownerId: userId,
      editors,
    })
  }

  await tools.create('trip_overviews', {
    ...SAMPLE_TRIP.overview,
    tripId,
    ownerId: userId,
    editors,
  })

  for (const item of SAMPLE_TRIP.checklists) {
    const { id: _id, ...rest } = item
    await tools.create('trip_checklists', {
      ...rest,
      tripId,
      ownerId: userId,
      editors,
    })
  }

  return { success: true, data: { tripId } }
}

export const updateTripDetails: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const patch: Partial<TripData> = {}
  if (typeof params.title === 'string' && params.title.trim()) patch.title = params.title.trim().slice(0, 140)
  if (params.mode === 'detailed' || params.mode === 'overview') patch.mode = params.mode
  if (params.pace === 'relaxed' || params.pace === 'balanced' || params.pace === 'packed') patch.pace = params.pace
  if (params.budgetTier === 'budget' || params.budgetTier === 'moderate' || params.budgetTier === 'luxury') patch.budgetTier = params.budgetTier
  if (params.transportPreference === 'walk' || params.transportPreference === 'transit' || params.transportPreference === 'drive') {
    patch.transportPreference = params.transportPreference
  }
  if (typeof params.startDate === 'string') patch.startDate = params.startDate || undefined
  if (typeof params.endDate === 'string') patch.endDate = params.endDate || undefined
  if (typeof params.totalDays === 'number' && params.totalDays >= 1) patch.totalDays = Math.min(60, Math.round(params.totalDays))
  if (typeof params.travelers === 'number' && params.travelers >= 1) patch.travelers = Math.round(params.travelers)
  if (typeof params.summaryNotes === 'string') patch.summaryNotes = params.summaryNotes.slice(0, 4000)
  if (Array.isArray(params.interests)) {
    patch.interests = params.interests.filter((v): v is string => typeof v === 'string')
  }

  const res = await tools.update('trips', tripId, patch as Record<string, unknown>)
  if (!res.success) return fail(res.error ?? 'Update failed', { status: 500 })
  return { success: true, data: { tripId } }
}

export const deleteTrip: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  const childCols = [
    'trip_destinations',
    'trip_stops',
    'trip_overviews',
    'trip_checklists',
    'trip_invites',
  ]
  for (const col of childCols) {
    await tools.deleteWhere(col, { tripId })
  }
  await tools.deleteWhere('team_members', { teamId: tripId })
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
  const orderIndex =
    typeof params.orderIndex === 'number'
      ? params.orderIndex
      : existing.success
        ? existing.data.records.length
        : 0

  let lat = typeof params.lat === 'number' ? params.lat : undefined
  let lng = typeof params.lng === 'number' ? params.lng : undefined
  let country = typeof params.country === 'string' ? params.country.trim() : undefined

  if (lat === undefined || lng === undefined) {
    const geo = await geocodePlaceName(tools, country ? `${name}, ${country}` : name)
    lat = geo.lat
    lng = geo.lng
    if (!country && geo.country) country = geo.country
  }

  const destId = `dest_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
  const res = await tools.create<DestinationData & Record<string, unknown>>(
    'trip_destinations',
    {
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
      orderIndex,
      transportFromPrev:
        (params.transportFromPrev as IntercityTransport | undefined) ?? (orderIndex === 0 ? 'none' : 'train'),
      notes: typeof params.notes === 'string' ? params.notes : undefined,
    },
    destId,
  )
  if (!res.success) return fail(res.error ?? 'Failed to add destination', { status: 500 })
  return { success: true, data: { destinationId: destId } }
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
  await tools.remove('trip_destinations', destinationId)
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

  let lat = typeof params.lat === 'number' ? params.lat : undefined
  let lng = typeof params.lng === 'number' ? params.lng : undefined
  if (lat === undefined || lng === undefined) {
    const queryStr = typeof params.address === 'string' && params.address ? params.address : title
    const geo = await geocodePlaceName(tools, queryStr)
    lat = geo.lat
    lng = geo.lng
  }

  const stopId = typeof params.stopId === 'string' && params.stopId ? params.stopId : null

  const payload: Partial<StopData> = {
    tripId,
    destinationId: typeof params.destinationId === 'string' ? params.destinationId : undefined,
    editors: access.editors,
    dayNumber,
    title: title.slice(0, 180),
    category,
    address: typeof params.address === 'string' ? params.address.slice(0, 300) : undefined,
    lat,
    lng,
    startTime: typeof params.startTime === 'string' ? params.startTime : undefined,
    durationMinutes:
      typeof params.durationMinutes === 'number' ? Math.max(15, Math.round(params.durationMinutes)) : 60,
    fixedTime: Boolean(params.fixedTime),
    preferredWindow: (params.preferredWindow as PreferredWindow | undefined) ?? 'any',
    transportMode:
      params.transportMode === 'walk' ||
      params.transportMode === 'drive' ||
      params.transportMode === 'transit'
        ? params.transportMode
        : access.trip.data.transportPreference ?? 'transit',
    estimatedCost: typeof params.estimatedCost === 'number' ? Math.max(0, params.estimatedCost) : undefined,
    rating: typeof params.rating === 'number' ? params.rating : undefined,
    photoTip: typeof params.photoTip === 'string' ? params.photoTip.slice(0, 600) : undefined,
    bestLightWindow: (params.bestLightWindow as LightWindow | undefined) ?? 'any',
    notes: typeof params.notes === 'string' ? params.notes.slice(0, 2000) : undefined,
    sourceUrl: typeof params.sourceUrl === 'string' ? params.sourceUrl : undefined,
  }

  let finalStopId: string
  if (stopId) {
    const existing = await tools.get<StopData>('trip_stops', stopId)
    if (!existing.success || existing.data.record.data.tripId !== tripId) {
      return fail('Stop not found', { status: 404 })
    }
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

export const generateOverviewBlueprint: ActionHandler<Env> = async ({
  userId,
  params,
  tools,
}) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const destRes = await tools.query<DestinationData>('trip_destinations', {
    where: { tripId },
    limit: 50,
  })
  if (!destRes.success) return fail(destRes.error, { status: 500 })

  const destinations = destRes.data.records
    .slice()
    .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))

  if (destinations.length === 0) {
    return fail('Add at least one destination before generating an overview.', { status: 400 })
  }

  const totalDays =
    typeof params.totalDays === 'number' && params.totalDays >= 1
      ? Math.round(params.totalDays)
      : access.trip.data.totalDays ?? 6
  const pace = access.trip.data.pace ?? 'balanced'

  const baseline = buildBaselineOverview({
    tripId,
    locations: destinations.map((d) => ({
      name: d.data.name,
      country: d.data.country,
      lat: d.data.lat,
      lng: d.data.lng,
    })),
    totalDays,
    pace,
    interests: access.trip.data.interests,
  })

  // Optional AI enrichment (user-billed) when useAi !== false; gracefully keeps baseline if AI fails or lacks credits
  let finalOverview = baseline
  if (params.useAi !== false) {
    const prompt = [
      `You are a practical travel strategist. Refine this ${totalDays}-day vacation overview (${pace} pace).`,
      `Interests: ${(access.trip.data.interests ?? []).join(', ') || 'sightseeing, food, photography'}.`,
      `Destinations & baseline allocations: ${JSON.stringify(
        baseline.allocations.map((a) => ({
          name: a.destinationName,
          recommendedDays: a.recommendedDays,
          transitHoursFromPrev: a.transitHoursFromPrev,
        })),
      )}.`,
      `Return ONLY valid JSON matching: { "summary": string, "allocations": [{ "destinationName": string, "recommendedDays": number, "rationale": string, "mustSeeHighlights": string[], "photoSpots": string[], "dayTripIdeas": string[] }], "dailyOutline": [{ "dayNumber": number, "location": string, "theme": string, "morning": string, "afternoon": string, "evening": string, "photoMoment": string }] }.`,
      `Ensure sum of recommendedDays equals ${totalDays}.`,
    ].join('\n')

    const aiRes = await tools.integration<{
      choices?: Array<{ message?: { content?: string } }>
    }>('openai/chat-completion', {
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    })

    if (aiRes.success && aiRes.data?.choices?.[0]?.message?.content) {
      try {
        const raw = aiRes.data.choices[0].message.content
          .replace(/^```json\s*/i, '')
          .replace(/```$/i, '')
          .trim()
        const parsed = JSON.parse(raw) as Partial<OverviewData>
        if (typeof parsed.summary === 'string' && Array.isArray(parsed.allocations)) {
          finalOverview = {
            ...baseline,
            summary: parsed.summary,
            allocations: baseline.allocations.map((baseAlloc, idx) => {
              const aiAlloc =
                parsed.allocations?.find(
                  (a) =>
                    a.destinationName?.toLowerCase() === baseAlloc.destinationName.toLowerCase(),
                ) ?? parsed.allocations?.[idx]
              if (!aiAlloc) return baseAlloc
              return {
                ...baseAlloc,
                recommendedDays:
                  typeof aiAlloc.recommendedDays === 'number' && aiAlloc.recommendedDays >= 1
                    ? Math.round(aiAlloc.recommendedDays)
                    : baseAlloc.recommendedDays,
                rationale: aiAlloc.rationale || baseAlloc.rationale,
                mustSeeHighlights: Array.isArray(aiAlloc.mustSeeHighlights)
                  ? aiAlloc.mustSeeHighlights.slice(0, 4)
                  : baseAlloc.mustSeeHighlights,
                photoSpots: Array.isArray(aiAlloc.photoSpots)
                  ? aiAlloc.photoSpots.slice(0, 3)
                  : baseAlloc.photoSpots,
                dayTripIdeas: Array.isArray(aiAlloc.dayTripIdeas)
                  ? aiAlloc.dayTripIdeas.slice(0, 3)
                  : baseAlloc.dayTripIdeas,
              }
            }),
            dailyOutline:
              Array.isArray(parsed.dailyOutline) && parsed.dailyOutline.length > 0
                ? parsed.dailyOutline
                : baseline.dailyOutline,
          }
        }
      } catch {
        // Keep deterministic baseline if LLM output wasn't clean JSON
      }
    }
  }

  // Upsert trip_overviews row
  const existingOverview = await tools.query<OverviewData>('trip_overviews', {
    where: { tripId },
    limit: 1,
  })
  if (existingOverview.success && existingOverview.data.records.length > 0) {
    await tools.update('trip_overviews', existingOverview.data.records[0].recordId, {
      ...finalOverview,
      editors: access.editors,
    })
  } else {
    await tools.create('trip_overviews', {
      ...finalOverview,
      ownerId: userId,
      editors: access.editors,
    })
  }

  // Also sync suggestedDays / minDays onto destinations
  for (let i = 0; i < destinations.length; i++) {
    const dest = destinations[i]
    const alloc = finalOverview.allocations[i]
    if (alloc) {
      await tools.update('trip_destinations', dest.recordId, {
        suggestedDays: alloc.recommendedDays,
        minDays: alloc.minDays,
        transitHoursFromPrev: alloc.transitHoursFromPrev,
        transportFromPrev: alloc.transportMode,
      })
    }
  }

  return { success: true, data: { overview: finalOverview } }
}

export const promoteOverviewToDetailed: ActionHandler<Env> = async ({
  userId,
  params,
  tools,
}) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'editor')
  if (!access.ok) return fail(access.error, { status: access.status })

  const [ovRes, destRes, stopsRes] = await Promise.all([
    tools.query<OverviewData>('trip_overviews', { where: { tripId }, limit: 1 }),
    tools.query<DestinationData>('trip_destinations', { where: { tripId }, limit: 50 }),
    tools.query<StopData>('trip_stops', { where: { tripId }, limit: 50 }),
  ])

  const overview = ovRes.success ? ovRes.data.records[0]?.data : null
  const destinations = destRes.success
    ? destRes.data.records.slice().sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))
    : []

  if (!overview || destinations.length === 0) {
    return fail('Generate an overview blueprint first.', { status: 400 })
  }

  const startDate =
    typeof params.startDate === 'string' && params.startDate
      ? params.startDate
      : access.trip.data.startDate ?? new Date().toISOString().slice(0, 10)

  let dayCursor = 0
  for (let i = 0; i < destinations.length; i++) {
    const dest = destinations[i]
    const alloc = overview.allocations[i]
    const stayDays = Math.max(1, alloc?.recommendedDays ?? dest.data.suggestedDays ?? 2)
    const arr = addDaysIso(startDate, dayCursor)
    const dep = addDaysIso(startDate, dayCursor + stayDays)
    dayCursor += stayDays

    await tools.update('trip_destinations', dest.recordId, {
      arrivalDate: arr,
      departureDate: dep,
    })
  }

  const endDate = addDaysIso(startDate, Math.max(1, dayCursor - 1))
  await tools.update('trips', tripId, {
    mode: 'detailed',
    startDate,
    endDate,
    totalDays: Math.max(1, dayCursor),
  })

  // Seed starter stops from overview outline if no stops exist yet
  if (stopsRes.success && stopsRes.data.records.length === 0) {
    for (const block of overview.dailyOutline) {
      const destMatch = destinations.find(
        (d) => d.data.name.toLowerCase() === block.location.toLowerCase(),
      )
      const baseLat = destMatch?.data.lat
      const baseLng = destMatch?.data.lng
      const seedStops: Array<Partial<StopData> & { title: string; category: StopCategory }> = [
        {
          title: `${block.location}: ${block.theme}`,
          category: 'must_see',
          preferredWindow: 'morning',
          durationMinutes: 120,
          notes: block.morning,
        },
        {
          title: `${block.location} Local Lunch & Walk`,
          category: 'restaurant',
          preferredWindow: 'lunch',
          durationMinutes: 75,
          notes: block.afternoon,
        },
        {
          title: block.photoMoment || `${block.location} Golden Hour Overlook`,
          category: 'photo_spot',
          preferredWindow: 'golden_hour',
          bestLightWindow: 'golden_hour',
          durationMinutes: 50,
          photoTip: block.evening,
        },
      ]

      for (let idx = 0; idx < seedStops.length; idx++) {
        const s = seedStops[idx]
        await tools.create('trip_stops', {
          tripId,
          destinationId: destMatch?.recordId,
          ownerId: userId,
          editors: access.editors,
          dayNumber: block.dayNumber,
          orderIndex: idx,
          title: s.title.slice(0, 180),
          category: s.category,
          lat: baseLat !== undefined ? baseLat + idx * 0.008 : undefined,
          lng: baseLng !== undefined ? baseLng + idx * 0.006 : undefined,
          durationMinutes: s.durationMinutes,
          preferredWindow: s.preferredWindow,
          bestLightWindow: s.bestLightWindow ?? 'any',
          transportMode: access.trip.data.transportPreference ?? 'transit',
          photoTip: s.photoTip,
          notes: s.notes,
        })
      }
      await recalculateAndPersistDay(tools, tripId, block.dayNumber)
    }
  }

  return { success: true, data: { mode: 'detailed', startDate, endDate } }
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
  const q = dest.country ? `${dest.name},${dest.country}` : dest.name

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
    const allUsers = await tools.query<{ name?: string; email?: string; imageUrl?: string }>('users', {
      limit: 500,
    })
    if (allUsers.success) {
      const hit = allUsers.data.records.find(
        (r) => (r.data.email ?? '').toLowerCase() === emailParam,
      )
      if (hit) matchedUser = { recordId: hit.recordId, ...hit.data }
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

  // User hasn't signed into Trippie yet — create a pending invite link token
  const token = `inv_${crypto.randomUUID().replace(/-/g, '')}`
  const inviteId = `invrec_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
  await tools.create<TripInviteData & Record<string, unknown>>(
    'trip_invites',
    {
      tripId,
      ownerId: userId,
      token,
      role,
      invitedEmail: emailParam || undefined,
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
    },
  }
}

export const createTripInviteLink: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const tripId = typeof params.tripId === 'string' ? params.tripId : ''
  const access = await assertTripAccess(tools, tripId, userId, 'owner')
  if (!access.ok) return fail(access.error, { status: access.status })

  const role: 'viewer' | 'editor' = params.role === 'editor' ? 'editor' : 'viewer'
  const token = `inv_${crypto.randomUUID().replace(/-/g, '')}`
  await tools.create<TripInviteData & Record<string, unknown>>('trip_invites', {
    tripId,
    ownerId: userId,
    token,
    role,
    status: 'pending',
  })

  return { success: true, data: { token, role } }
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

  const tripRes = await tools.get<TripData>('trips', invite.data.tripId)
  if (!tripRes.success || !tripRes.data?.record) {
    return fail('Trip no longer exists.', { status: 404 })
  }

  const caller = await resolveCallerDisplay(tools, userId)
  await upsertTeamMembershipAndSync(tools, {
    tripId: invite.data.tripId,
    trip: tripRes.data.record.data,
    targetUserId: userId,
    targetName: caller.name,
    targetImageUrl: caller.imageUrl,
    role: invite.data.role,
    actorUserId: invite.data.ownerId ?? tripRes.data.record.data.ownerId,
  })

  await tools.update('trip_invites', invite.recordId, { status: 'accepted' })

  return {
    success: true,
    data: { tripId: invite.data.tripId, role: invite.data.role },
  }
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
