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
import { buildBaselineOverview } from '../lib/overview-planner.js'
import type {
  DestinationData,
  LightWindow,
  OverviewData,
  PreferredWindow,
  StopCategory,
  StopData,
  TransportMode,
  TripData,
} from '../lib/trip-types.js'
import {
  assertTripAccess,
  createServerRecordTools,
  geocodePlaceName,
  recalculateAndPersistDay,
} from '../server/trip-helpers.js'

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
    '- Always consider realistic travel times and geography between consecutive stops so days flow cleanly without zigzagging.',
    '- When recommending sightseeing, restaurants, day trips, hidden gems, or photography spots, use `places_search`, `weather_lookup`, and `events_search` when live data helps, and call `trip_add_stop` to place them into the trip.',
    '- For photography spots (`category: "photo_spot"`), always include `bestLightWindow` (sunrise, golden_hour, blue_hour, night) and a concrete `photoTip` (vantage point, framing, or crowd-timing tip).',
    '- Use `trip_optimize_day` after adding or rearranging multiple stops on a day so transit legs and times update cleanly.',
    '- In Broad Overview Mode, use `trip_generate_overview` to evaluate stay durations, transit overhead, and feasibility.',
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
      'Fetch full details of a trip including destinations, scheduled stops, broad overview plan, and user access role.',
    inputSchema: z.object({
      tripId: z.string().describe('The trip recordId'),
    }),
    execute: async ({ tripId }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'viewer')
      if (!access.ok) return { success: false, error: access.error }

      const [destRes, stopsRes, ovRes, chkRes] = await Promise.all([
        serverTools.query<DestinationData>('trip_destinations', { where: { tripId }, limit: 100 }),
        serverTools.query<StopData>('trip_stops', { where: { tripId }, limit: 300 }),
        serverTools.query<OverviewData>('trip_overviews', { where: { tripId }, limit: 1 }),
        serverTools.query('trip_checklists', { where: { tripId }, limit: 100 }),
      ])

      return {
        success: true,
        role: access.role,
        trip: { recordId: access.trip.recordId, ...access.trip.data },
        destinations: destRes.success
          ? destRes.data.records
              .map((r) => ({ recordId: r.recordId, ...r.data }))
              .sort((a, b) => a.orderIndex - b.orderIndex)
          : [],
        stops: stopsRes.success
          ? stopsRes.data.records
              .map((r) => ({ recordId: r.recordId, ...r.data }))
              .sort((a, b) => a.dayNumber - b.dayNumber || a.orderIndex - b.orderIndex)
          : [],
        overview: ovRes.success ? ovRes.data.records[0]?.data ?? null : null,
        checklistsCount: chkRes.success ? chkRes.data.records.length : 0,
      }
    },
  })

  tools.trip_add_stop = tool({
    description:
      'Add a sightseeing landmark, restaurant, photo spot, day trip, or hidden gem to a trip day and recompute travel times.',
    inputSchema: z.object({
      tripId: z.string(),
      dayNumber: z.number().int().min(1),
      title: z.string(),
      category: z.enum([
        'must_see',
        'restaurant',
        'photo_spot',
        'day_trip',
        'hidden_gem',
        'lodging',
        'transit',
      ]),
      address: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      durationMinutes: z.number().int().min(15).max(720).optional(),
      preferredWindow: z
        .enum([
          'any',
          'sunrise',
          'morning',
          'lunch',
          'afternoon',
          'golden_hour',
          'dinner',
          'night',
        ])
        .optional(),
      startTime: z.string().optional().describe('Optional HH:mm 24h time'),
      fixedTime: z.boolean().optional(),
      transportMode: z.enum(['walk', 'transit', 'drive']).optional(),
      estimatedCost: z.number().min(0).optional(),
      rating: z.number().min(0).max(5).optional(),
      bestLightWindow: z
        .enum(['any', 'sunrise', 'golden_hour', 'blue_hour', 'midday', 'night'])
        .optional(),
      photoTip: z.string().optional(),
      notes: z.string().optional(),
    }),
    execute: async (input) => {
      const access = await assertTripAccess(serverTools, input.tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      let lat = input.lat
      let lng = input.lng
      if (lat === undefined || lng === undefined) {
        const geo = await geocodePlaceName(serverTools, input.address ?? input.title)
        lat = geo.lat
        lng = geo.lng
      }

      const existing = await serverTools.query<StopData>('trip_stops', {
        where: { tripId: input.tripId, dayNumber: input.dayNumber },
        limit: 200,
      })
      const orderIndex = existing.success ? existing.data.records.length : 0
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

      const schedule = await recalculateAndPersistDay(
        serverTools,
        input.tripId,
        input.dayNumber,
      )
      return { success: true, stopId, dayNumber: input.dayNumber, schedule }
    },
  })

  tools.trip_update_stop = tool({
    description:
      'Modify an existing stop (change day, duration, notes, light window, photoTip, time, or swap title/location).',
    inputSchema: z.object({
      tripId: z.string(),
      stopId: z.string(),
      title: z.string().optional(),
      dayNumber: z.number().int().min(1).optional(),
      durationMinutes: z.number().int().min(15).optional(),
      preferredWindow: z
        .enum([
          'any',
          'sunrise',
          'morning',
          'lunch',
          'afternoon',
          'golden_hour',
          'dinner',
          'night',
        ])
        .optional(),
      startTime: z.string().optional(),
      fixedTime: z.boolean().optional(),
      transportMode: z.enum(['walk', 'transit', 'drive']).optional(),
      photoTip: z.string().optional(),
      bestLightWindow: z
        .enum(['any', 'sunrise', 'golden_hour', 'blue_hour', 'midday', 'night'])
        .optional(),
      notes: z.string().optional(),
    }),
    execute: async (input) => {
      const access = await assertTripAccess(serverTools, input.tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const existing = await serverTools.get<StopData>('trip_stops', input.stopId)
      if (!existing.success || existing.data.record.data.tripId !== input.tripId) {
        return { success: false, error: 'Stop not found in this trip' }
      }

      const prevDay = existing.data.record.data.dayNumber
      const { tripId: _t, stopId: _s, ...patch } = input
      const upd = await serverTools.update('trip_stops', input.stopId, patch)
      if (!upd.success) return { success: false, error: upd.error }

      await recalculateAndPersistDay(serverTools, input.tripId, prevDay)
      if (input.dayNumber && input.dayNumber !== prevDay) {
        await recalculateAndPersistDay(serverTools, input.tripId, input.dayNumber)
      }
      return { success: true, stopId: input.stopId }
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

      return recalculateAndPersistDay(serverTools, tripId, dayNumber, { optimize: true })
    },
  })

  tools.trip_generate_overview = tool({
    description:
      'Compute stay durations, transit overhead, and feasibility assessment for a trip in Broad Overview Mode.',
    inputSchema: z.object({
      tripId: z.string(),
      totalDays: z.number().int().min(1).max(60).optional(),
    }),
    execute: async ({ tripId, totalDays }) => {
      const access = await assertTripAccess(serverTools, tripId, context.userId, 'editor')
      if (!access.ok) return { success: false, error: access.error }

      const destRes = await serverTools.query<DestinationData>('trip_destinations', {
        where: { tripId },
        limit: 50,
      })
      if (!destRes.success || destRes.data.records.length === 0) {
        return { success: false, error: 'No destinations found in this trip' }
      }

      const destinations = destRes.data.records
        .slice()
        .sort((a, b) => a.data.orderIndex - b.data.orderIndex)

      const baseline = buildBaselineOverview({
        tripId,
        locations: destinations.map((d) => ({
          name: d.data.name,
          country: d.data.country,
          lat: d.data.lat,
          lng: d.data.lng,
        })),
        totalDays: totalDays ?? access.trip.data.totalDays ?? 6,
        pace: access.trip.data.pace ?? 'balanced',
        interests: access.trip.data.interests,
      })

      const ovRes = await serverTools.query<OverviewData>('trip_overviews', {
        where: { tripId },
        limit: 1,
      })
      if (ovRes.success && ovRes.data.records.length > 0) {
        await serverTools.update('trip_overviews', ovRes.data.records[0].recordId, {
          ...baseline,
          editors: access.editors,
        })
      } else {
        await serverTools.create('trip_overviews', {
          ...baseline,
          ownerId: context.userId,
          editors: access.editors,
        })
      }

      return { success: true, overview: baseline }
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
      if (!res.success) return { success: false, error: res.error, code: res.code }
      const places = (res.data.local_results ?? []).slice(0, 8).map((p) => ({
        title: p.title,
        address: p.address,
        rating: p.rating,
        type: p.type,
        lat: p.gps_coordinates?.latitude,
        lng: p.gps_coordinates?.longitude,
      }))
      return { success: true, places }
    },
  })

  tools.weather_lookup = tool({
    description:
      'Look up current weather, sunrise/sunset times, and 5-day forecast for a city.',
    inputSchema: z.object({
      location: z.string().describe('City name, e.g. "Kyoto,JP" or "Lisbon"'),
    }),
    execute: async ({ location }) => {
      const [curr, fc] = await Promise.all([
        serverTools.integration('openweathermap/current', { q: location, units: 'metric' }),
        serverTools.integration('openweathermap/forecast', { q: location, units: 'metric' }),
      ])
      if (!curr.success) return { success: false, error: curr.error, code: curr.code }
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
      if (!res.success) return { success: false, error: res.error, code: res.code }
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
