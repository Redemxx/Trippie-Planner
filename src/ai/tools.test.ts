import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'

let activeMockTools: ActionTools

vi.mock('../server/trip-helpers.js', async () => {
  const actual = await vi.importActual<typeof import('../server/trip-helpers.js')>(
    '../server/trip-helpers.js',
  )
  return {
    ...actual,
    createServerRecordTools: () => activeMockTools,
  }
})

import { buildTools } from './tools.js'

async function callTool<T>(toolDef: unknown, args: unknown): Promise<T> {
  const fn = (toolDef as { execute: (input: unknown, opts: unknown) => Promise<T> }).execute
  return fn(args, { toolCallId: 'tc_1', messages: [] })
}

function makeMemoryTools(
  seed: Record<string, Array<{ recordId: string; data: Record<string, unknown> }>>,
): {
  tools: ActionTools
  store: Record<string, Map<string, Record<string, unknown>>>
} {
  const store: Record<string, Map<string, Record<string, unknown>>> = {}
  for (const [col, rows] of Object.entries(seed)) {
    store[col] = new Map(rows.map((r) => [r.recordId, structuredClone(r.data)]))
  }
  const ensure = (col: string) => (store[col] ??= new Map())
  let seq = 0

  const tools: ActionTools = {
    async create(col, data, recordId) {
      const id = recordId ?? `${col}_${++seq}`
      const saved = structuredClone(data) as Record<string, unknown>
      ensure(col).set(id, saved)
      return { success: true, data: { recordId: id, data: saved } }
    },
    async update(col, recordId, data) {
      const prev = ensure(col).get(recordId)
      if (!prev) return { success: false, error: 'Not found' }
      const next = { ...prev, ...structuredClone(data) }
      ensure(col).set(recordId, next)
      return { success: true, data: { recordId, data: next } }
    },
    async remove(col, recordId) {
      ensure(col).delete(recordId)
      return { success: true, data: { recordId, deleted: true } }
    },
    async deleteWhere() {
      return { success: true, data: { deleted: 0 } }
    },
    async get(col, recordId) {
      const data = ensure(col).get(recordId)
      if (!data) return { success: false, error: 'Not found' }
      return { success: true, data: { record: { recordId, data: structuredClone(data) } } } as never
    },
    async query(col, options) {
      const where = options?.where ?? {}
      const matches = Array.from(ensure(col).entries())
        .filter(([, data]) => Object.entries(where).every(([k, v]) => data[k] === v))
        .slice(0, options?.limit ?? 100)
        .map(([recordId, data]) => ({ recordId, data: structuredClone(data) }))
      return { success: true, data: { records: matches, total: matches.length } } as never
    },
    integration: vi.fn(async () => ({ success: false as const, error: 'mocked' })) as ActionTools['integration'],
    registerUser: vi.fn(async () => ({
      success: true as const,
      data: { user: { id: 'u_owner', name: 'Owner', email: 'o@example.com', role: 'member' } },
    })),
  }
  return { tools, store }
}

describe('AI concierge planning & map-hotel parity tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trip_get_itinerary exposes mapHotelPin and dayHotelPins separately from cityCenter', async () => {
    const { tools } = makeMemoryTools({
      trips: [
        {
          recordId: 'trip_1',
          data: { title: 'Japan', ownerId: 'u_owner', teamId: 'trip_1', editors: ['u_owner'], totalDays: 3 },
        },
      ],
      trip_destinations: [
        {
          recordId: 'd_tokyo',
          data: {
            tripId: 'trip_1',
            name: 'Tokyo',
            orderIndex: 0,
            lat: 35.6762,
            lng: 139.6503,
            lodgingName: 'Kita-Tokyo Stay',
            lodgingAddress: '1-1-1 Akabane, Kita, Tokyo',
            lodgingLat: 35.7745,
            lodgingLng: 139.7568,
          },
        },
      ],
      trip_stops: [],
      trip_checklists: [],
    })
    activeMockTools = tools

    const toolSet = buildTools(async () => ({}), {
      env: {} as Env,
      userId: 'u_owner',
      request: new Request('https://app.test', { headers: { Authorization: 'Bearer jwt' } }),
    })

    const res = await callTool<{
      success: boolean
      destinations: Array<{ cityCenter: { lat: number; lng: number }; mapHotelPin: { lat: number; lng: number } }>
      dayHotelPins: Array<{ dayNumber: number; startHotel: { lat: number; lng: number } }>
    }>(toolSet.trip_get_itinerary, {
      tripId: 'trip_1',
    })

    expect(res.success).toBe(true)
    expect(res.destinations[0].cityCenter).toEqual({ lat: 35.6762, lng: 139.6503 })
    expect(res.destinations[0].mapHotelPin).toEqual({ name: 'Kita-Tokyo Stay', lat: 35.7745, lng: 139.7568 })
    expect(res.dayHotelPins).toHaveLength(3)
    expect(res.dayHotelPins[0].startHotel).toEqual({ name: 'Kita-Tokyo Stay', lat: 35.7745, lng: 139.7568 })
  })

  it('trip_batch_plan_stops and trip_batch_update_stops plan multiple days in single tool calls', async () => {
    const { tools, store } = makeMemoryTools({
      trips: [
        {
          recordId: 'trip_1',
          data: { title: 'Japan', ownerId: 'u_owner', teamId: 'trip_1', editors: ['u_owner'], totalDays: 4 },
        },
      ],
      trip_destinations: [
        {
          recordId: 'd_tokyo',
          data: {
            tripId: 'trip_1',
            name: 'Tokyo',
            orderIndex: 0,
            lat: 35.6762,
            lng: 139.6503,
            lodgingName: 'Kita-Tokyo Stay',
            lodgingLat: 35.7745,
            lodgingLng: 139.7568,
          },
        },
      ],
      trip_stops: [],
    })
    activeMockTools = tools

    const toolSet = buildTools(async () => ({}), {
      env: {} as Env,
      userId: 'u_owner',
      request: new Request('https://app.test', { headers: { Authorization: 'Bearer jwt' } }),
    })

    const batchPlanRes = await callTool<{
      success: boolean
      createdCount: number
      createdStopIds: string[]
      daysUpdated: number[]
    }>(toolSet.trip_batch_plan_stops, {
      tripId: 'trip_1',
      stops: [
        { dayNumber: 1, title: 'Senso-ji', category: 'must_see', lat: 35.7148, lng: 139.7967 },
        { dayNumber: 2, title: 'Shibuya Sky', category: 'photo_spot', lat: 35.6584, lng: 139.7022 },
        { dayNumber: 3, title: 'Tokyo National Museum', category: 'must_see', lat: 35.7188, lng: 139.7765 },
        { dayNumber: 4, title: 'Evening Return', category: 'lodging' },
      ],
      optimizeTouchedDays: true,
    })

    expect(batchPlanRes.success).toBe(true)
    expect(batchPlanRes.createdCount).toBe(4)
    expect(batchPlanRes.daysUpdated).toEqual([1, 2, 3, 4])

    const lodgingStopId = batchPlanRes.createdStopIds[3]
    expect(store.trip_stops.get(lodgingStopId)?.lat).toBeCloseTo(35.7745, 3)
    expect(store.trip_stops.get(lodgingStopId)?.lng).toBeCloseTo(139.7568, 3)

    const batchUpdateRes = await callTool<{
      success: boolean
      updatedCount: number
      daysUpdated: number[]
    }>(toolSet.trip_batch_update_stops, {
      tripId: 'trip_1',
      updates: [
        { stopId: batchPlanRes.createdStopIds[0], durationMinutes: 90, notes: 'Early visit' },
        { stopId: batchPlanRes.createdStopIds[1], durationMinutes: 75, preferredWindow: 'golden_hour' },
      ],
      optimizeTouchedDays: true,
    })

    expect(batchUpdateRes.success).toBe(true)
    expect(batchUpdateRes.updatedCount).toBe(2)
    expect(batchUpdateRes.daysUpdated).toEqual([1, 2])
    expect(store.trip_stops.get(batchPlanRes.createdStopIds[0])?.notes).toBe('Early visit')
  })

  it('anchors moving-day luggage drop-off lodging stops to the arriving hotel, not departure hotel', async () => {
    const { tools, store } = makeMemoryTools({
      trips: [
        {
          recordId: 'trip_move',
          data: {
            title: 'Kyoto to Tokyo',
            ownerId: 'u_owner',
            teamId: 'trip_move',
            editors: ['u_owner'],
            totalDays: 5,
            startDate: '2026-12-17',
          },
        },
      ],
      trip_destinations: [
        {
          recordId: 'd_kyoto',
          data: {
            tripId: 'trip_move',
            name: 'Kyoto',
            orderIndex: 0,
            arrivalDate: '2026-12-17',
            departureDate: '2026-12-19',
            lat: 35.0116,
            lng: 135.7681,
            lodgingName: 'Kyoto Stay',
            lodgingLat: 35.0116,
            lodgingLng: 135.7681,
          },
        },
        {
          recordId: 'd_tokyo',
          data: {
            tripId: 'trip_move',
            name: 'Tokyo',
            orderIndex: 1,
            arrivalDate: '2026-12-19',
            departureDate: '2026-12-21',
            lat: 35.6762,
            lng: 139.6503,
            lodgingName: 'Kita-Tokyo Stay',
            lodgingLat: 35.7745,
            lodgingLng: 139.7568,
          },
        },
      ],
      trip_stops: [],
    })
    activeMockTools = tools

    const toolSet = buildTools(async () => ({}), {
      env: {} as Env,
      userId: 'u_owner',
      request: new Request('https://app.test', { headers: { Authorization: 'Bearer jwt' } }),
    })

    // Day 3 (2026-12-19) is the moving day Kyoto -> Tokyo
    const res = await callTool<{ success: boolean; createdStopIds: string[] }>(
      toolSet.trip_batch_plan_stops,
      {
        tripId: 'trip_move',
        stops: [{ dayNumber: 3, title: 'Luggage drop-off at Kita-Tokyo Stay', category: 'lodging', durationMinutes: 20 }],
      },
    )
    expect(res.success).toBe(true)
    const bagStop = store.trip_stops.get(res.createdStopIds[0])
    expect(bagStop?.lat).toBeCloseTo(35.7745, 3)
    expect(bagStop?.lng).toBeCloseTo(139.7568, 3)
  })
})
