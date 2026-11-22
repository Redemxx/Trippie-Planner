import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import {
  acceptTripInvite,
  deleteTrip,
  regenerateTrip,
  removeDestination,
  updateDestination,
  upsertTripStop,
} from './trip-actions.js'

const dummyEnv = {} as Env

function makeInMemoryTools(seed: Record<string, Array<{ recordId: string; data: Record<string, unknown> }>>): {
  tools: ActionTools
  store: Record<string, Map<string, Record<string, unknown>>>
  deleteWhereCalls: Array<{ collection: string; where: Record<string, unknown>; limit?: number }>
} {
  const store: Record<string, Map<string, Record<string, unknown>>> = {}
  for (const [col, rows] of Object.entries(seed)) {
    store[col] = new Map(rows.map((r) => [r.recordId, structuredClone(r.data)]))
  }
  const deleteWhereCalls: Array<{ collection: string; where: Record<string, unknown>; limit?: number }> = []
  let seq = 0

  const ensureCol = (col: string) => {
    if (!store[col]) store[col] = new Map()
    return store[col]
  }

  const tools: ActionTools = {
    async create(collection, data, recordId) {
      const id = recordId ?? `${collection}_${++seq}`
      const saved = structuredClone(data) as Record<string, unknown>
      ensureCol(collection).set(id, saved)
      return { success: true, data: { recordId: id, data: saved } }
    },
    async update(collection, recordId, data) {
      const col = ensureCol(collection)
      const prev = col.get(recordId)
      if (!prev) return { success: false, error: 'Record not found' }
      const next = { ...prev, ...structuredClone(data) }
      col.set(recordId, next)
      return { success: true, data: { recordId, data: next } }
    },
    async remove(collection, recordId) {
      ensureCol(collection).delete(recordId)
      return { success: true, data: { recordId, deleted: true } }
    },
    async deleteWhere(collection, where, limit = 100) {
      deleteWhereCalls.push({ collection, where, limit })
      const col = ensureCol(collection)
      let deleted = 0
      for (const [id, data] of col.entries()) {
        if (deleted >= limit) break
        const matches = Object.entries(where).every(([k, v]) => data[k] === v)
        if (matches) {
          col.delete(id)
          deleted += 1
        }
      }
      return { success: true, data: { deleted } }
    },
    async get(collection, recordId) {
      const data = ensureCol(collection).get(recordId)
      if (!data) return { success: false, error: 'Record not found' }
      return { success: true, data: { record: { recordId, data: structuredClone(data) } } } as never
    },
    async query(collection, options) {
      const col = ensureCol(collection)
      const where = options?.where ?? {}
      const matches = Array.from(col.entries())
        .filter(([, data]) => Object.entries(where).every(([k, v]) => data[k] === v))
        .slice(0, options?.limit ?? 100)
        .map(([recordId, data]) => ({ recordId, data: structuredClone(data) }))
      return { success: true, data: { records: matches, total: matches.length } } as never
    },
    integration: vi.fn(async () => ({ success: false as const, error: 'mocked' })) as ActionTools['integration'],
    registerUser: vi.fn(async () => ({
      success: true as const,
      data: { user: { id: 'u_1', name: 'Test', email: 'test@example.com', role: 'member' } },
    })),
  }

  return { tools, store, deleteWhereCalls }
}

describe('trip-actions fixes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drains deleteWhere in batches of 200 on regenerateTrip and deleteTrip without leaving orphans', async () => {
    const manyStops = Array.from({ length: 245 }, (_, i) => ({
      recordId: `stop_${i}`,
      data: {
        tripId: 'trip_1',
        dayNumber: 1,
        orderIndex: i,
        title: `Stop ${i}`,
        category: 'must_see',
      },
    }))

    const { tools, store, deleteWhereCalls } = makeInMemoryTools({
      trips: [
        {
          recordId: 'trip_1',
          data: { title: 'Big Trip', ownerId: 'u_owner', teamId: 'trip_1', editors: ['u_owner'], totalDays: 3 },
        },
      ],
      trip_destinations: [],
      trip_stops: manyStops,
      trip_checklists: [{ recordId: 'chk_1', data: { tripId: 'trip_1', label: 'Passport', completed: false } }],
      trip_invites: [{ recordId: 'inv_1', data: { tripId: 'trip_1', token: 't1', role: 'viewer', status: 'pending' } }],
      team_members: [{ recordId: 'tm_1', data: { teamId: 'trip_1', userId: 'u_owner', role: 'owner', status: 'active' } }],
    })

    const regenRes = await regenerateTrip({
      userId: 'u_owner',
      params: { tripId: 'trip_1' },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(regenRes.success).toBe(true)
    expect(store.trip_stops.size).toBe(0)
    expect(deleteWhereCalls.filter((c) => c.collection === 'trip_stops')).toHaveLength(2)

    for (let i = 0; i < 210; i++) {
      store.trip_stops.set(`stop_re_${i}`, { tripId: 'trip_1', dayNumber: 1, orderIndex: i, title: `S${i}`, category: 'must_see' })
    }
    const delRes = await deleteTrip({
      userId: 'u_owner',
      params: { tripId: 'trip_1' },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(delRes.success).toBe(true)
    expect(store.trip_stops.size).toBe(0)
    expect(store.trips.size).toBe(0)
    expect(store.trip_checklists.size).toBe(0)
    expect(store.team_members.size).toBe(0)
  })

  it('re-indexes orderIndex and recalculates downstream Travel leg when removeDestination or updateDestination runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    const { tools, store } = makeInMemoryTools({
      trips: [
        {
          recordId: 'trip_1',
          data: { title: 'Japan', ownerId: 'u_owner', teamId: 'trip_1', editors: ['u_owner'], totalDays: 6 },
        },
      ],
      trip_destinations: [
        { recordId: 'd_kyoto', data: { tripId: 'trip_1', name: 'Kyoto', orderIndex: 0, lat: 35.0116, lng: 135.7681, transportFromPrev: 'none', transitHoursFromPrev: 0 } },
        { recordId: 'd_osaka', data: { tripId: 'trip_1', name: 'Osaka', orderIndex: 1, lat: 34.6937, lng: 135.5023, transportFromPrev: 'train', transitHoursFromPrev: 0.5 } },
        { recordId: 'd_tokyo', data: { tripId: 'trip_1', name: 'Tokyo', orderIndex: 2, lat: 35.6762, lng: 139.6503, transportFromPrev: 'bullet_train', transitHoursFromPrev: 3.3 } },
      ],
      trip_stops: [
        { recordId: 's_travel_osaka', data: { tripId: 'trip_1', destinationId: 'd_osaka', dayNumber: 2, orderIndex: 0, title: 'Travel: Kyoto → Osaka', category: 'transit', lat: 34.6937, lng: 135.5023 } },
        { recordId: 's_travel_tokyo', data: { tripId: 'trip_1', destinationId: 'd_tokyo', dayNumber: 4, orderIndex: 0, title: 'Travel: Osaka → Tokyo', category: 'transit', lat: 35.6762, lng: 139.6503 } },
      ],
    })

    const remRes = await removeDestination({
      userId: 'u_owner',
      params: { tripId: 'trip_1', destinationId: 'd_osaka' },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(remRes.success).toBe(true)
    expect(store.trip_destinations.get('d_tokyo')?.orderIndex).toBe(1)
    expect(store.trip_stops.get('s_travel_tokyo')?.title).toBe('Travel: Kyoto → Tokyo')

    const updRes = await updateDestination({
      userId: 'u_owner',
      params: {
        tripId: 'trip_1',
        destinationId: 'd_kyoto',
        lodgingName: 'Station Hotel Kyoto',
        lodgingAddress: 'Kyoto Station',
      },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(updRes.success).toBe(true)
  })

  it('rejects non-http(s) sourceUrl in upsertTripStop and enforces invite expiry + email binding in acceptTripInvite', async () => {
    const { tools } = makeInMemoryTools({
      users: [
        { recordId: 'u_bob', data: { name: 'Bob', email: 'bob@example.com' } },
      ],
      trips: [
        { recordId: 'trip_1', data: { title: 'Test', ownerId: 'u_owner', teamId: 'trip_1', editors: ['u_owner'], viewers: [] } },
      ],
      trip_invites: [
        {
          recordId: 'inv_expired',
          data: { tripId: 'trip_1', token: 'tok_exp', role: 'viewer', status: 'pending', expiresAt: Date.now() - 10_000 },
        },
        {
          recordId: 'inv_email',
          data: { tripId: 'trip_1', token: 'tok_email', role: 'editor', status: 'pending', invitedEmail: 'alice@example.com', expiresAt: Date.now() + 60_000 },
        },
      ],
    })

    const badStop = await upsertTripStop({
      userId: 'u_owner',
      params: {
        tripId: 'trip_1',
        dayNumber: 1,
        title: 'XSS Link',
        category: 'must_see',
        lat: 35.0,
        lng: 135.7,
        sourceUrl: 'javascript:alert(1)',
      },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(badStop.success).toBe(false)
    if (!badStop.success) expect(badStop.status).toBe(400)

    const expRes = await acceptTripInvite({
      userId: 'u_bob',
      params: { token: 'tok_exp' },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(expRes.success).toBe(false)
    if (!expRes.success) expect(expRes.status).toBe(400)

    const wrongEmailRes = await acceptTripInvite({
      userId: 'u_bob',
      params: { token: 'tok_email' },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(wrongEmailRes.success).toBe(false)
    if (!wrongEmailRes.success) expect(wrongEmailRes.status).toBe(403)
  })

  it('keeps Check in and Check out lodging stops synced with destination lodgingLat/lodgingLng', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url)
        if (u.includes('nominatim') || u.includes('photon')) {
          return new Response(
            JSON.stringify([
              {
                name: 'Kita-Tokyo Sample Hotel',
                display_name: '1-1-1 Akabane, Kita, Tokyo',
                lat: '35.7745',
                lon: '139.7568',
                address: { country_code: 'jp', city: 'Tokyo' },
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )

    const { tools, store } = makeInMemoryTools({
      trips: [
        {
          recordId: 'trip_1',
          data: { title: 'Japan', ownerId: 'u_owner', teamId: 'trip_1', editors: ['u_owner'], totalDays: 5 },
        },
      ],
      trip_destinations: [
        {
          recordId: 'd_tokyo',
          data: {
            tripId: 'trip_1',
            name: 'Tokyo',
            country: 'JP',
            orderIndex: 0,
            lat: 35.6762,
            lng: 139.6503,
            lodgingName: 'Old Center Hotel',
            lodgingLat: 35.6762,
            lodgingLng: 139.6503,
          },
        },
      ],
      trip_stops: [
        {
          recordId: 's_checkin',
          data: {
            tripId: 'trip_1',
            destinationId: 'd_tokyo',
            dayNumber: 1,
            orderIndex: 0,
            title: 'Check in: Old Center Hotel',
            category: 'lodging',
            fixedTime: true,
            startTime: '15:00',
            lat: 35.6762,
            lng: 139.6503,
          },
        },
        {
          recordId: 's_checkout_unlinked',
          data: {
            tripId: 'trip_1',
            // intentionally missing destinationId to prove orphaned hotel cards get re-linked & synced
            dayNumber: 5,
            orderIndex: 0,
            title: 'Check out: Old Center Hotel',
            category: 'lodging',
            fixedTime: true,
            startTime: '10:00',
            lat: 35.6762,
            lng: 139.6503,
          },
        },
      ],
    })

    const upd = await updateDestination({
      userId: 'u_owner',
      params: {
        tripId: 'trip_1',
        destinationId: 'd_tokyo',
        lodgingName: 'Kita-Tokyo Sample Hotel',
        lodgingAddress: '1-chome-1-1 Akabane, Kita City, Tokyo 115-0045',
        checkOutTime: '10:30',
      },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(upd.success).toBe(true)

    const dest = store.trip_destinations.get('d_tokyo')
    expect(dest?.lodgingLat).toBeCloseTo(35.7745, 3)
    expect(dest?.lodgingLng).toBeCloseTo(139.7568, 3)

    expect(store.trip_stops.get('s_checkin')?.lat).toBeCloseTo(35.7745, 3)
    expect(store.trip_stops.get('s_checkin')?.lng).toBeCloseTo(139.7568, 3)
    expect(store.trip_stops.get('s_checkout_unlinked')?.destinationId).toBe('d_tokyo')
    expect(store.trip_stops.get('s_checkout_unlinked')?.lat).toBeCloseTo(35.7745, 3)
    expect(store.trip_stops.get('s_checkout_unlinked')?.startTime).toBe('10:30')

    // Adding a lodging stop without explicit lat/lng anchors to the destination's lodging coordinates
    const addedLodging = await upsertTripStop({
      userId: 'u_owner',
      params: {
        tripId: 'trip_1',
        dayNumber: 2,
        title: 'Return to hotel',
        category: 'lodging',
      },
      tools,
      env: dummyEnv,
      callerJwt: 'jwt',
    })
    expect(addedLodging.success).toBe(true)
    if (addedLodging.success) {
      const createdId = (addedLodging.data as { stopId: string }).stopId
      expect(store.trip_stops.get(createdId)?.lat).toBeCloseTo(35.7745, 3)
      expect(store.trip_stops.get(createdId)?.lng).toBeCloseTo(139.7568, 3)
    }
  })
})
