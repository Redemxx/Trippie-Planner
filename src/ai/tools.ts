/**
 * AI Tool Definitions — converts DeepSpace BUILT_IN_TOOLS and adds Trippie
 * vacation-planning, route optimization, photography spot, and live places/weather tools.
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod/v4'
import { BUILT_IN_TOOLS, applyAiToolDefaults } from 'deepspace/worker'
import type { AgentToolContext, CollectionSchema, ToolSchema } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { formatWeatherQuery } from '../lib/location-query.js'
import {
  hotelPointFromDestination,
  resolveActiveDayHotels,
} from '../lib/route-optimizer.js'
import type {
  DestinationData,
  LightWindow,
  PreferredWindow,
  StopCategory,
  StopData,
  TransportMode,
  TripData,
} from '../lib/trip-types.js'
import {
  assertTripAccess,
  createServerRecordTools,
  recalculateAndPersistDay,
  resolveHotelOriginForDay,
  resolveStopCoordinates,
  resolveTripGeocodeBias,
} from '../server/trip-helpers.js'

const STOP_CATEGORIES = [
  'must_see',
  'restaurant',
  'photo_spot',
  'day_trip',
  'hidden_gem',
  'lodging',
  'transit',
] as const

const PREFERRED_WINDOWS = [
  'any',
  'sunrise',
  'morning',
  'lunch',
  'afternoon',
  'golden_hour',
  'dinner',
  'night',
] as const

const TRANSPORT_MODES = ['walk', 'transit', 'drive', 'bullet_train', 'flight'] as const
const LIGHT_WINDOWS = ['any', 'sunrise', 'golden_hour', 'blue_hour', 'midday', 'night'] as const

const stopPlanEntrySchema = z.object({
  dayNumber: z.number().int().min(1).max(60),
  title: z.string().max(180),
  category: z.enum(STOP_CATEGORIES),
  address: z.string().max(300).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  durationMinutes: z.number().int().min(15).max(720).optional(),
  preferredWindow: z.enum(PREFERRED_WINDOWS).optional(),
  startTime: z.string().max(16).optional().describe('Optional HH:mm 24h time'),
  fixedTime: z.boolean().optional(),
  transportMode: z.enum(TRANSPORT_MODES).optional(),
  estimatedCost: z.number().min(0).optional(),
  rating: z.number().min(0).max(5).optional(),
  bestLightWindow: z.enum(LIGHT_WINDOWS).optional(),
  photoTip: z.string().max(600).optional(),
  notes: z.string().max(2000).optional(),
})

const stopUpdateEntrySchema = z.object({
  stopId: z.string(),
  title: z.string().max(180).optional(),
  address: z.string().max(300).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  dayNumber: z.number().int().min(1).max(60).optional(),
  durationMinutes: z.number().int().min(15).max(720).optional(),
  preferredWindow: z.enum(PREFERRED_WINDOWS).optional(),
  startTime: z.string().max(16).optional(),
  fixedTime: z.boolean().optional(),
  transportMode: z.enum(TRANSPORT_MODES).optional(),
  photoTip: z.string().max(600).optional(),
  bestLightWindow: z.enum(LIGHT_WINDOWS).optional(),
  notes: z.string().max(2000).optional(),
})

type StopPlanEntry = z.infer<typeof stopPlanEntrySchema>
type StopUpdateEntry = z.infer<typeof stopUpdateEntrySchema>

async function resolveCoordsForNewStop(
  serverTools: ReturnType<typeof createServerRecordTools>,
  tripId: string,
  input: Pick<StopPlanEntry, 'dayNumber' | 'title' | 'address' | 'category' | 'lat' | 'lng'>,
  cache?: Map<string, { lat?: number; lng?: number }>,
): Promise<{ lat?: number; lng?: number }> {
  if (typeof input.lat === 'number' && typeof input.lng === 'number') {
    return { lat: input.lat, lng: input.lng }
  }
  const cacheKey = `${input.dayNumber}|${input.category}|${input.title.trim()}|${input.address?.trim() ?? ''}`
  const cached = cache?.get(cacheKey)
  if (cached) return cached

  let coords: { lat?: number; lng?: number } = {}
  if (input.category === 'lodging') {
    const side = /^\s*check\s*out\b/i.test(input.title) ? 'departure' : 'arrival'
    const hotel = await resolveHotelOriginForDay(serverTools, tripId, input.dayNumber, side)
    if (hotel) coords = { lat: hotel.lat, lng: hotel.lng }
  }
  if (coords.lat === undefined || coords.lng === undefined) {
    const bias = await resolveTripGeocodeBias(serverTools, tripId, input.dayNumber)
    coords = await resolveStopCoordinates(serverTools, {
      title: input.title,
      address: input.address,
      category: input.category,
      cityName: bias.cityName,
      countryHint: bias.countryHint,
      near: bias.near,
    })
  }
  cache?.set(cacheKey, coords)
  return coords
}

async function applySingleStopUpdate(
  serverTools: ReturnType<typeof createServerRecordTools>,
  tripId: string,
  maxDays: number,
  input: StopUpdateEntry,
): Promise<
  | { ok: true; stopId: string; touchedDays: number[] }
  | { ok: false; error: string }
> {
  if (typeof input.dayNumber === 'number' && input.dayNumber > maxDays) {
    return {
      ok: false,
      error: `Day ${input.dayNumber} exceeds this trip's total length (${maxDays} days).`,
    }
  }

  const existing = await serverTools.get<StopData>('trip_stops', input.stopId)
  if (!existing.success || existing.data.record.data.tripId !== tripId) {
    return { ok: false, error: `Stop "${input.stopId}" not found in this trip` }
  }

  const curr = existing.data.record.data
  const prevDay = curr.dayNumber
  const { stopId: _s, ...rawPatch } = input
  const patch: Record<string, unknown> = { ...rawPatch }
  if (curr.category === 'transit') {
    // Protect seeded intercity Travel cards from being pinned to 00:00 (12:00am) by AI updates
    if (patch.startTime === '00:00' || patch.startTime === '0:00') {
      delete patch.startTime
      patch.fixedTime = false
    }
  }

  const explicitCoords = typeof input.lat === 'number' && typeof input.lng === 'number'
  const titleChanged = typeof input.title === 'string' && input.title.trim() !== curr.title
  const addressChanged =
    typeof input.address === 'string' && input.address.trim() !== (curr.address ?? '').trim()
  const dayChanged = typeof input.dayNumber === 'number' && input.dayNumber !== prevDay
  const isMovableStop = curr.category !== 'lodging' && curr.category !== 'transit'
  if (!explicitCoords && isMovableStop && (titleChanged || addressChanged || dayChanged)) {
    const targetDay = input.dayNumber ?? prevDay
    const bias = await resolveTripGeocodeBias(serverTools, tripId, targetDay)
    const geo = await resolveStopCoordinates(serverTools, {
      title: input.title ?? curr.title,
      address: input.address ?? curr.address,
      category: curr.category,
      cityName: bias.cityName,
      countryHint: bias.countryHint,
      near: bias.near,
    })
    if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
      patch.lat = geo.lat
      patch.lng = geo.lng
    }
  }

  const upd = await serverTools.update('trip_stops', input.stopId, patch)
  if (!upd.success) return { ok: false, error: upd.error ?? 'Failed to update stop' }

  const touchedDays = [prevDay]
  if (input.dayNumber && input.dayNumber !== prevDay) {
    touchedDays.push(input.dayNumber)
  }
  return { ok: true, stopId: input.stopId, touchedDays }
}

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<unknown>

const ALLOWED_TOOL_NAMES = [
  'schema.list',
  'schema.describe',
  'records.query',
  'records.get',
  'user.current',
]

type Interpretation = CollectionSchema['columns'][number]['interpretation']

function interpretationLabel(interpretation: Interpretation): string {
  if (typeof interpretation === 'string') return interpretation
  const kind = interpretation.kind
  return typeof kind === 'string' ? kind : 'object'
}

export function buildSystemPrompt(appName: string, schemas: CollectionSchema[]): string {
  const schemaSummary = schemas
    .map((s) => {
      const cols = (s.columns ?? [])
        .map((c) => `${c.name}:${interpretationLabel(c.interpretation)}${c.required ? '!' : ''}`)
        .join(', ')
      return `- ${s.name}${cols ? ` (${cols})` : ''}`
    })
    .join('\n')

  return [
    `You are the AI Travel Concierge for "${appName}" on DeepSpace.`,
    'Your role is to craft practical, memorable itineraries tailored to the user’s preferences, pacing, and travel time between locations.',
    '',
    'Core travel-planning principles:',
    '- Always consider realistic travel times and geography between consecutive stops so days flow cleanly without zigzagging, accounting for hotel/Airbnb locations and 10:00 checkout / 15:00 check-in windows on moving days.',
    '- Account for Day 1 arrival & final-day departure: if Day 1 has no arrival/flight stop yet, schedule from the check-in window onward (or ask briefly once); on the final departure day, leave room for checkout & airport transit unless the user shares a late flight. When staying in an outer district (e.g., northern suburbs or outer residential wards), cluster central sights by transit corridor so legs back to home base stay reasonable.',
    '- Map hotel pins vs city coordinates: the map plots `H` hotel markers using `lodgingLat`/`lodgingLng` (`activeDayMapHotelPins` / `mapHotelPin`), NOT destination `lat`/`lng` (which are the city-center reference coordinates). Do NOT tell the user a hotel is pinned at city center just because destination `lat`/`lng` shows city coordinates; check `mapHotelPin`, `dayHotelPins`, or stop coordinates.',
    '- IMPORTANT on moving/travel days: inspect existing stops with `trip_get_itinerary`. NEVER delete, move before checkout, set to `00:00`, or alter `startTime`/`fixedTime` of existing seeded `Check out:`, `Travel:`, or `Check in:` cards. Schedule pre-checkout activities in the departing city and post-travel/afternoon/evening activities in the arriving city.',
    '- Avoid dead time before hotel check-in: when there is a meaningful gap (>= 60 minutes) between arrival (`Travel:` end time) and hotel `Check in:` (e.g. arriving ~11:00 with 15:00 check-in), schedule a brief `Luggage drop-off at <Arriving Hotel>` (`category: "lodging"`, `durationMinutes: 20`) immediately after `Travel:`, followed by lunch or nearby sightseeing until `Check in:`!',
    '- When filling out or reviewing multiple days or an entire trip, PREFER `trip_batch_plan_stops` (up to 30 stops per call with `optimizeTouchedDays: true`) and `trip_batch_update_stops` instead of calling `trip_add_stop`/`trip_update_stop`/`trip_optimize_day` one-by-one so you can plan the whole trip in one turn without running out of tool calls.',
    '- When adding a single sightseeing or day-trip stop, `trip_add_stop` automatically pairs a nearby scenic photography viewpoint unless a photo spot is already on that day, or you can add explicit `photo_spot` stops directly.',
    '- Silent, reliable execution: complete the itinerary directly with `trip_add_stop` and `trip_optimize_day`. If an optional external lookup tool (`places_search`, `events_search`, `weather_lookup`) returns empty or fallback status, do NOT mention integration quotas, search failures, geocoding retries, or internal tool issues to the user—simply add great curated stops using your destination knowledge and present only the finished day schedule cleanly.',
    '- For photography spots (`category: "photo_spot"`), always include `bestLightWindow` (sunrise, golden_hour, blue_hour, night) and a concrete `photoTip` (vantage point, framing, or crowd-timing tip).',
    '- Use `trip_optimize_day` after adding or rearranging multiple stops on a day so transit legs and times update cleanly.',
    '- Respect permissions: if a user only has `viewer` access to a trip, explain plainly that they have read-only access and cannot edit it.',
    '- Confirm before removing multiple stops or deleting large portions of an itinerary.',
    '',
    'Available collections:',
    schemaSummary || '(none)',
  ].join('\n')
}

export function buildTools(
  executor: ToolExecutor,
  context?: AgentToolContext<Env>,
): ToolSet {
  const tools: ToolSet = {}

  for (const def of BUILT_IN_TOOLS) {
    if (!ALLOWED_TOOL_NAMES.includes(def.name)) continue
    const safeName = def.name.replace('.', '_')
    tools[safeName] = tool({
      description: def.description,
      inputSchema: buildInputSchema(def),
      execute: async (params: Record<string, unknown>) =>
        executor(def.name, applyAiToolDefaults(def.name, params)),
    })
  }

  if (!context) return tools

  const authHeader = context.request.headers.get('Authorization') ?? ''
  const callerJwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const serverTools = createServerRecordTools(context.env, context.userId, callerJwt)

  tools.trip_get_itinerary = tool({
    description:
      'Fetch full details of a trip including destinations, scheduled stops, and user access role.',
    inputSchema: z.object({
      tripId: z.string().describe('The trip recordId'),
    }),
    execute: async ({ tripId }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'viewer')
      if (!access.ok) return { success: false, error: access.error }

      const [destRes, stopsRes, chkRes] = await Promise.all([
        serverTools.query<DestinationData>('trip_destinations', { where: { tripId }, limit: 100 }),
        serverTools.query<StopData>('trip_stops', { where: { tripId }, limit: 300 }),
        serverTools.query('trip_checklists', { where: { tripId }, limit: 100 }),
      ])

      const destinations = destRes.success
        ? destRes.data.records
          .map((r) => {
            const d = { recordId: r.recordId, id: r.recordId, ...r.data }
            const pin = hotelPointFromDestination(d)
            return {
              ...d,
              cityCenter:
                typeof d.lat === 'number' && typeof d.lng === 'number'
                  ? { lat: d.lat, lng: d.lng }
                  : null,
              mapHotelPin: pin,
            }
          })
          .sort((a, b) => a.orderIndex - b.orderIndex)
        : []

      const totalDays = Math.max(1, access.trip.data.totalDays ?? 5)
      const dayHotelPins = Array.from({ length: Math.min(60, totalDays) }, (_, idx) => {
        const dayNumber = idx + 1
        const hotels = resolveActiveDayHotels(
          dayNumber,
          totalDays,
          access.trip.data.startDate,
          destinations,
        )
        return { dayNumber, ...hotels }
      })

      return {
        success: true,
        role: access.role,
        trip: { recordId: access.trip.recordId, ...access.trip.data },
        destinations,
        dayHotelPins,
        stops: stopsRes.success
          ? stopsRes.data.records
            .map((r) => ({ recordId: r.recordId, ...r.data }))
            .sort((a, b) => a.dayNumber - b.dayNumber || a.orderIndex - b.orderIndex)
          : [],
        checklistsCount: chkRes.success ? chkRes.data.records.length : 0,
      }
    },
  })

  tools.trip_add_stop = tool({
    description:
      'Add a single stop (automatically pairs a nearby scenic viewpoint if helpful). For adding 2+ stops across a day or full trip, prefer trip_batch_plan_stops.',
    inputSchema: stopPlanEntrySchema.extend({
      tripId: z.string(),
      autoIncludeNearbyPhotoSpot: z
        .boolean()
        .optional()
        .describe('Defaults true for non-lodging sights; discovers and attaches a nearby photo spot on that day if none is yet near it.'),
    }),
    execute: async (input) => {
      const access = await assertTripAccess(serverTools, input.tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const maxDays = access.trip.data.totalDays ?? 60
      if (input.dayNumber > maxDays) {
        return {
          success: false,
          error: `Day ${input.dayNumber} exceeds this trip's total length (${maxDays} days).`,
        }
      }

      const { lat, lng } = await resolveCoordsForNewStop(serverTools, input.tripId, input)

      const existing = await serverTools.query<StopData>('trip_stops', {
        where: { tripId: input.tripId, dayNumber: input.dayNumber },
        limit: 200,
      })
      const existingRecords = existing.success ? existing.data.records : []
      const orderIndex = existingRecords.length
      const stopId = `stop_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`

      const created = await serverTools.create<StopData & Record<string, unknown>>(
        'trip_stops',
        {
          tripId: input.tripId,
          ownerId: context.userId,
          editors: access.editors,
          dayNumber: input.dayNumber,
          orderIndex,
          title: input.title.slice(0, 180),
          category: input.category as StopCategory,
          address: input.address?.slice(0, 300),
          lat,
          lng,
          startTime: input.startTime,
          durationMinutes: input.durationMinutes ?? (input.category === 'photo_spot' ? 45 : 75),
          fixedTime: Boolean(input.fixedTime),
          preferredWindow: (input.preferredWindow as PreferredWindow | undefined) ?? 'any',
          transportMode:
            (input.transportMode as TransportMode | undefined) ??
            access.trip.data.transportPreference ??
            'transit',
          estimatedCost: input.estimatedCost,
          rating: input.rating,
          bestLightWindow: (input.bestLightWindow as LightWindow | undefined) ?? 'any',
          photoTip: input.photoTip?.slice(0, 600),
          notes: input.notes?.slice(0, 2000),
        },
        stopId,
      )
      if (!created.success) return { success: false, error: created.error }

      // Automatically include a nearby photography/viewpoint stop when adding sightseeing or day-trip spots
      let autoPhotoTitle: string | null = null
      const shouldAutoPhoto =
        input.autoIncludeNearbyPhotoSpot !== false &&
        (input.category === 'must_see' || input.category === 'day_trip' || input.category === 'hidden_gem')
      const alreadyHasPhotoSpot = existingRecords.some((r) => r.data.category === 'photo_spot')

      if (shouldAutoPhoto && !alreadyHasPhotoSpot) {
        try {
          const searchRes = await serverTools.integration<{
            local_results?: Array<{
              title?: string
              address?: string
              rating?: number
              gps_coordinates?: { latitude?: number; longitude?: number }
            }>
          }>('serpapi/places-search', {
            q: `scenic viewpoint photography spot near ${input.title}`,
          })
          const hit = searchRes.success ? searchRes.data.local_results?.[0] : undefined
          const pLat = hit?.gps_coordinates?.latitude
          const pLng = hit?.gps_coordinates?.longitude
          if (
            hit?.title &&
            hit.title.toLowerCase() !== input.title.toLowerCase() &&
            typeof pLat === 'number' &&
            typeof pLng === 'number'
          ) {
            await serverTools.create<StopData & Record<string, unknown>>('trip_stops', {
              tripId: input.tripId,
              ownerId: context.userId,
              editors: access.editors,
              dayNumber: input.dayNumber,
              orderIndex: orderIndex + 1,
              title: hit.title.slice(0, 180),
              category: 'photo_spot',
              address: hit.address?.slice(0, 300) ?? input.address?.slice(0, 300),
              lat: pLat,
              lng: pLng,
              durationMinutes: 40,
              fixedTime: false,
              preferredWindow: 'golden_hour',
              transportMode: 'walk',
              rating: hit.rating,
              bestLightWindow: 'golden_hour',
              photoTip: `Auto-included nearby viewpoint near ${input.title}. Scout 20 min before sunset for side light.`,
            })
            autoPhotoTitle = hit.title
          }
        } catch {
          // Graceful no-op if external discovery integration lacks user billing credits
        }
      }

      const schedule = await recalculateAndPersistDay(
        serverTools,
        input.tripId,
        input.dayNumber,
        { optimize: Boolean(autoPhotoTitle) },
      )
      return {
        success: true,
        stopId,
        dayNumber: input.dayNumber,
        autoIncludedPhotoSpot: autoPhotoTitle,
        schedule,
      }
    },
  })

  tools.trip_batch_plan_stops = tool({
    description:
      'Add up to 30 stops across one or many trip days in a single call and optionally optimize each touched day. Always prefer this when planning or filling multiple days.',
    inputSchema: z.object({
      tripId: z.string(),
      stops: z.array(stopPlanEntrySchema).min(1).max(30),
      optimizeTouchedDays: z
        .boolean()
        .optional()
        .describe('Defaults true: optimizes and recalculates travel times for every touched day once at the end.'),
    }),
    execute: async ({ tripId, stops, optimizeTouchedDays }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const maxDays = access.trip.data.totalDays ?? 60
      for (const s of stops) {
        if (s.dayNumber > maxDays) {
          return {
            success: false,
            error: `Day ${s.dayNumber} exceeds this trip's total length (${maxDays} days).`,
          }
        }
      }

      const existingRes = await serverTools.query<StopData>('trip_stops', {
        where: { tripId },
        limit: 300,
      })
      const dayOrderCount = new Map<number, number>()
      if (existingRes.success) {
        for (const r of existingRes.data.records) {
          const d = r.data.dayNumber
          dayOrderCount.set(d, (dayOrderCount.get(d) ?? 0) + 1)
        }
      }

      const coordCache = new Map<string, { lat?: number; lng?: number }>()
      const createdStopIds: string[] = []
      const touchedDays = new Set<number>()
      const errors: string[] = []

      for (const entry of stops) {
        const { lat, lng } = await resolveCoordsForNewStop(serverTools, tripId, entry, coordCache)
        const orderIndex = dayOrderCount.get(entry.dayNumber) ?? 0
        dayOrderCount.set(entry.dayNumber, orderIndex + 1)

        const stopId = `stop_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
        const created = await serverTools.create<StopData & Record<string, unknown>>(
          'trip_stops',
          {
            tripId,
            ownerId: context.userId,
            editors: access.editors,
            dayNumber: entry.dayNumber,
            orderIndex,
            title: entry.title.slice(0, 180),
            category: entry.category as StopCategory,
            address: entry.address?.slice(0, 300),
            lat,
            lng,
            startTime: entry.startTime,
            durationMinutes: entry.durationMinutes ?? (entry.category === 'photo_spot' ? 45 : 75),
            fixedTime: Boolean(entry.fixedTime),
            preferredWindow: (entry.preferredWindow as PreferredWindow | undefined) ?? 'any',
            transportMode:
              (entry.transportMode as TransportMode | undefined) ??
              access.trip.data.transportPreference ??
              'transit',
            estimatedCost: entry.estimatedCost,
            rating: entry.rating,
            bestLightWindow: (entry.bestLightWindow as LightWindow | undefined) ?? 'any',
            photoTip: entry.photoTip?.slice(0, 600),
            notes: entry.notes?.slice(0, 2000),
          },
          stopId,
        )
        if (!created.success) {
          errors.push(`${entry.title}: ${created.error ?? 'create failed'}`)
          continue
        }
        createdStopIds.push(stopId)
        touchedDays.add(entry.dayNumber)
      }

      const shouldOptimize = optimizeTouchedDays !== false
      const sortedDays = Array.from(touchedDays).sort((a, b) => a - b)
      for (const d of sortedDays) {
        await recalculateAndPersistDay(serverTools, tripId, d, { optimize: shouldOptimize })
      }

      return {
        success: createdStopIds.length > 0 || errors.length === 0,
        createdCount: createdStopIds.length,
        createdStopIds,
        daysUpdated: sortedDays,
        ...(errors.length > 0 ? { errors } : {}),
      }
    },
  })

  tools.trip_update_stop = tool({
    description:
      'Modify an existing stop (change day, duration, notes, light window, photoTip, time, or swap title/location).',
    inputSchema: stopUpdateEntrySchema.extend({
      tripId: z.string(),
    }),
    execute: async (input) => {
      const access = await assertTripAccess(serverTools, input.tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const maxDays = access.trip.data.totalDays ?? 60
      const res = await applySingleStopUpdate(serverTools, input.tripId, maxDays, input)
      if (!res.ok) return { success: false, error: res.error }

      for (const d of new Set(res.touchedDays)) {
        await recalculateAndPersistDay(serverTools, input.tripId, d)
      }
      return { success: true, stopId: res.stopId }
    },
  })

  tools.trip_batch_update_stops = tool({
    description:
      'Modify up to 30 existing stops across the trip in a single call and recalculate/optionally optimize each touched day once.',
    inputSchema: z.object({
      tripId: z.string(),
      updates: z.array(stopUpdateEntrySchema).min(1).max(30),
      optimizeTouchedDays: z
        .boolean()
        .optional()
        .describe('Defaults false: recomputes schedules cleanly without reordering unless true.'),
    }),
    execute: async ({ tripId, updates, optimizeTouchedDays }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const maxDays = access.trip.data.totalDays ?? 60
      const updatedStopIds: string[] = []
      const touchedDays = new Set<number>()
      const errors: string[] = []

      for (const item of updates) {
        const res = await applySingleStopUpdate(serverTools, tripId, maxDays, item)
        if (!res.ok) {
          errors.push(res.error)
          continue
        }
        updatedStopIds.push(res.stopId)
        for (const d of res.touchedDays) touchedDays.add(d)
      }

      const sortedDays = Array.from(touchedDays).sort((a, b) => a - b)
      for (const d of sortedDays) {
        await recalculateAndPersistDay(serverTools, tripId, d, {
          optimize: Boolean(optimizeTouchedDays),
        })
      }

      return {
        success: updatedStopIds.length > 0 || errors.length === 0,
        updatedCount: updatedStopIds.length,
        updatedStopIds,
        daysUpdated: sortedDays,
        ...(errors.length > 0 ? { errors } : {}),
      }
    },
  })

  tools.trip_remove_stop = tool({
    description: 'Remove a stop from a trip itinerary and recompute travel times for that day.',
    inputSchema: z.object({
      tripId: z.string(),
      stopId: z.string(),
    }),
    execute: async ({ tripId, stopId }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const existing = await serverTools.get<StopData>('trip_stops', stopId)
      if (!existing.success || existing.data.record.data.tripId !== tripId) {
        return { success: false, error: 'Stop not found in this trip' }
      }
      const dayNumber = existing.data.record.data.dayNumber
      await serverTools.remove('trip_stops', stopId)
      await recalculateAndPersistDay(serverTools, tripId, dayNumber)
      return { success: true, removedStopId: stopId }
    },
  })

  tools.trip_optimize_day = tool({
    description:
      'Optimize stop order for a day to minimize travel time while honoring fixed reservations and sunrise/golden-hour/meal anchors.',
    inputSchema: z.object({
      tripId: z.string(),
      dayNumber: z.number().int().min(1),
    }),
    execute: async ({ tripId, dayNumber }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const maxDays = access.trip.data.totalDays ?? 60
      if (dayNumber > maxDays) {
        return {
          success: false,
          error: `Day ${dayNumber} exceeds this trip's total length (${maxDays} days).`,
        }
      }

      return recalculateAndPersistDay(serverTools, tripId, dayNumber, { optimize: true })
    },
  })

  tools.places_search = tool({
    description:
      'Search live Google Maps places (landmarks, restaurants, viewpoints, cafes, photo spots) with ratings and coordinates.',
    inputSchema: z.object({
      query: z.string().describe('e.g. "best ramen in Gion Kyoto" or "sunset viewpoint Lisbon"'),
    }),
    execute: async ({ query }) => {
      const res = await serverTools.integration<{
        local_results?: Array<{
          title?: string
          address?: string
          rating?: number
          type?: string
          gps_coordinates?: { latitude?: number; longitude?: number }
        }>
      }>('serpapi/places-search', { q: query })
      if (res.success && Array.isArray(res.data.local_results) && res.data.local_results.length > 0) {
        const places = res.data.local_results.slice(0, 8).map((p) => ({
          title: p.title,
          address: p.address,
          rating: p.rating,
          type: p.type,
          lat: p.gps_coordinates?.latitude,
          lng: p.gps_coordinates?.longitude,
        }))
        return { success: true, places }
      }

      // Free OpenStreetMap Nominatim fallback when SerpApi credits are exhausted or unavailable
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search')
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('limit', '6')
        url.searchParams.set('q', query)
        const osmRes = await fetch(url.toString(), {
          headers: { 'User-Agent': 'TrippiePlanner/1.0 (https://app.space)', Accept: 'application/json' },
          signal: AbortSignal.timeout(3500),
        })
        if (osmRes.ok) {
          const osmHits = (await osmRes.json()) as Array<{
            name?: string
            display_name?: string
            type?: string
            lat?: string
            lon?: string
          }>
          if (Array.isArray(osmHits) && osmHits.length > 0) {
            const places = osmHits.map((p) => ({
              title: p.name || p.display_name?.split(',')[0]?.trim() || query,
              address: p.display_name,
              type: p.type,
              lat: p.lat ? Number(p.lat) : undefined,
              lng: p.lon ? Number(p.lon) : undefined,
            }))
            return { success: true, places }
          }
        }
      } catch {
        // Silent graceful fallback
      }

      // Return neutral empty list so AI proceeds smoothly via destination knowledge + trip_add_stop
      return {
        success: true,
        places: [],
        note: 'Proceed directly with trip_add_stop using well-known venues and addresses.',
      }
    },
  })

  tools.weather_lookup = tool({
    description:
      'Look up current weather, sunrise/sunset times, and 5-day forecast for a city.',
    inputSchema: z.object({
      location: z.string().describe('City name, e.g. "Kyoto,JP" or "Lisbon"'),
    }),
    execute: async ({ location }) => {
      const q = formatWeatherQuery(location)
      const [curr, fc] = await Promise.all([
        serverTools.integration('openweathermap/current', { q, units: 'metric' }),
        serverTools.integration('openweathermap/forecast', { q, units: 'metric' }),
      ])
      if (!curr.success) {
        return {
          success: true,
          unavailable: true,
          note: 'Live weather forecast skipped; schedule itinerary normally.',
        }
      }
      return {
        success: true,
        current: curr.data,
        forecastSample: Array.isArray(fc.data) ? fc.data.slice(0, 12) : [],
      }
    },
  })

  tools.events_search = tool({
    description: 'Search local events, exhibitions, or festivals in a destination.',
    inputSchema: z.object({
      query: z.string().describe('e.g. "Kyoto festivals November"'),
      location: z.string().optional(),
    }),
    execute: async ({ query, location }) => {
      const res = await serverTools.integration<{ events_results?: unknown[] }>('serpapi/events', {
        q: query,
        ...(location ? { location } : {}),
      })
      if (!res.success) {
        return {
          success: true,
          events: [],
          note: 'Proceed with curated cultural or evening stops directly.',
        }
      }
      return {
        success: true,
        events: Array.isArray(res.data.events_results) ? res.data.events_results.slice(0, 8) : [],
      }
    },
  })

  tools.checklist_add = tool({
    description: 'Add a packing, camera gear, booking, or document item to the trip checklist.',
    inputSchema: z.object({
      tripId: z.string(),
      category: z.enum(['booking', 'gear', 'documents', 'packing']),
      label: z.string(),
    }),
    execute: async ({ tripId, category, label }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const itemId = `chk_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
      await serverTools.create(
        'trip_checklists',
        {
          tripId,
          ownerId: context.userId,
          editors: access.editors,
          category,
          label: label.slice(0, 240),
          completed: false,
        },
        itemId,
      )
      return { success: true, itemId }
    },
  })

  return tools
}

function buildInputSchema(def: ToolSchema) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [name, param] of Object.entries(def.params)) {
    let s: z.ZodTypeAny
    switch (param.type) {
      case 'string':
        s = z.string()
        break
      case 'number':
        s = z.number()
        break
      case 'boolean':
        s = z.boolean()
        break
      case 'object':
        s = z.record(z.string(), z.unknown())
        break
      case 'array':
        s = z.array(z.unknown())
        break
    }
    if (param.description) s = s.describe(param.description)
    if (!param.required) s = s.optional()
    shape[name] = s
  }

  const validator = z.object(shape)
  return jsonSchema<Record<string, unknown>>(
    z.toJSONSchema(validator) as Parameters<typeof jsonSchema>[0],
    {
      validate: async (value) => {
        const result = await validator.safeParseAsync(value)
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error }
      },
    },
  )
}
