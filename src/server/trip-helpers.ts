import {
  apiWorkerFetch,
  normalizeApiError,
  splitIntegrationEndpoint,
} from 'deepspace/worker'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import { computeDaySchedule, optimizeDayRoute } from '../lib/route-optimizer.js'
import type {
  DestinationData,
  StopData,
  TeamMemberData,
  TripAccessRole,
  TripData,
} from '../lib/trip-types.js'

export interface TripRecordEnvelope {
  recordId: string
  data: TripData
}

export interface AccessCheckSuccess {
  ok: true
  trip: TripRecordEnvelope
  role: TripAccessRole
  editors: string[]
}

export interface AccessCheckFailure {
  ok: false
  status: 403 | 404
  error: string
}

export type TripAccessCheck = AccessCheckSuccess | AccessCheckFailure

export function parseIdArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
        : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Create privileged DO tools scoped to the app's primary RecordRoom.
 * Callers MUST invoke `assertTripAccess` before mutating or returning records.
 */
export function createServerRecordTools(
  env: Env,
  userId: string,
  callerJwt: string,
): ActionTools {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))

  async function execTool<TData>(
    tool: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult<TData>> {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return res.json() as Promise<ActionResult<TData>>
  }

  async function callIntegration<T>(endpoint: string, data?: unknown): Promise<ActionResult<T>> {
    const target = splitIntegrationEndpoint(endpoint)
    if (!target) {
      return {
        success: false,
        code: 'invalid_integration_endpoint',
        error: `Invalid integration endpoint: ${endpoint}`,
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${callerJwt}`,
    }
    if (env.APP_IDENTITY_TOKEN) {
      headers['x-app-identity-token'] = env.APP_IDENTITY_TOKEN
      headers['x-app-id'] = env.DEEPSPACE_APP_ID
    }
    const res = await apiWorkerFetch(env, target.path, {
      method: 'POST',
      headers,
      body: JSON.stringify(data ?? {}),
    })
    const payload = (await res.json()) as Record<string, unknown>
    if (!res.ok || payload.success === false) {
      return { success: false, ...normalizeApiError(res.status, payload) }
    }
    return payload as ActionResult<T>
  }

  return {
    create: (collection, data, recordId) =>
      execTool('records.create', { collection, data, recordId }),
    update: (collection, recordId, data) =>
      execTool('records.update', { collection, recordId, data }),
    remove: (collection, recordId) => execTool('records.delete', { collection, recordId }),
    deleteWhere: (collection, where, limit) =>
      execTool('records.deleteWhere', { collection, where, limit }),
    get: (collection, recordId) => execTool('records.get', { collection, recordId }),
    query: (collection, options) => execTool('records.query', { collection, ...options }),
    integration: callIntegration,
    registerUser: (options) => execTool('users.register', { ...options }),
  }
}

/**
 * Server-side authorization boundary for every trip mutation and private read.
 * - 'viewer' requires owner, editor, or active viewer membership.
 * - 'editor' requires owner or editor membership.
 * - 'owner' requires trip.ownerId === userId.
 */
export async function assertTripAccess(
  tools: ActionTools,
  tripId: string,
  userId: string,
  minimumRole: TripAccessRole,
): Promise<TripAccessCheck> {
  if (!tripId) return { ok: false, status: 404, error: 'Trip not found' }

  const tripRes = await tools.get<TripData>('trips', tripId)
  if (!tripRes.success || !tripRes.data?.record) {
    return { ok: false, status: 404, error: 'Trip not found' }
  }

  const trip = tripRes.data.record
  const editors = parseIdArray(trip.data.editors)
  const viewers = parseIdArray(trip.data.viewers)

  let role: TripAccessRole | null = null
  if (trip.data.ownerId === userId) {
    role = 'owner'
  } else if (editors.includes(userId)) {
    role = 'editor'
  } else if (viewers.includes(userId)) {
    role = 'viewer'
  } else {
    // Fallback check against team_members
    const memberRes = await tools.query<TeamMemberData>('team_members', {
      where: { teamId: tripId, userId, status: 'active' },
      limit: 1,
    })
    if (memberRes.success && memberRes.data.records.length > 0) {
      const mRole = memberRes.data.records[0].data.role
      if (mRole === 'owner' || mRole === 'editor' || mRole === 'viewer') {
        role = mRole
      }
    }
  }

  if (!role) {
    return { ok: false, status: 404, error: 'Trip not found' }
  }

  const rank: Record<TripAccessRole, number> = { viewer: 1, editor: 2, owner: 3 }
  if (rank[role] < rank[minimumRole]) {
    return {
      ok: false,
      status: 403,
      error: `View-only access: only trip ${minimumRole === 'owner' ? 'owners' : 'editors'} can perform this action.`,
    }
  }

  const normalizedEditors = Array.from(new Set([trip.data.ownerId, ...editors]))
  return { ok: true, trip, role, editors: normalizedEditors }
}

/**
 * Recomputes travel times & scheduled start times for all stops on a given day
 * and persists updated travelMinutesFromPrev / travelDistanceKmFromPrev / orderIndex.
 */
export async function recalculateAndPersistDay(
  tools: ActionTools,
  tripId: string,
  dayNumber: number,
  options?: { optimize?: boolean; dayStartMinutes?: number },
) {
  const q = await tools.query<StopData>('trip_stops', {
    where: { tripId, dayNumber },
    limit: 200,
  })
  if (!q.success) {
    return { success: false as const, error: q.error }
  }

  const sorted = q.data.records
    .slice()
    .sort((a, b) => (a.data.orderIndex ?? 0) - (b.data.orderIndex ?? 0))

  const mapped = sorted.map((r) => ({ ...r.data, _recordId: r.recordId }))

  let minutesSaved = 0
  let distanceSavedKm = 0
  let beforeTravelMinutes = 0
  let afterTravelMinutes = 0
  let ordered: typeof mapped

  if (options?.optimize) {
    const opt = optimizeDayRoute(mapped, options.dayStartMinutes)
    ordered = opt.stops
    minutesSaved = opt.minutesSaved
    distanceSavedKm = opt.distanceSavedKm
    beforeTravelMinutes = opt.beforeTravelMinutes
    afterTravelMinutes = opt.afterTravelMinutes
  } else {
    const sched = computeDaySchedule(mapped, options?.dayStartMinutes)
    ordered = sched.items.map((item, idx) => ({
      ...item.stop,
      orderIndex: idx,
      startTime: item.stop.fixedTime ? item.stop.startTime : item.startTime,
      travelMinutesFromPrev: item.travelMinutesFromPrev,
      travelDistanceKmFromPrev: item.travelDistanceKmFromPrev,
    }))
    beforeTravelMinutes = sched.totalTravelMinutes
    afterTravelMinutes = sched.totalTravelMinutes
  }

  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i]
    await tools.update<StopData>('trip_stops', item._recordId, {
      orderIndex: i,
      startTime: item.startTime,
      travelMinutesFromPrev: item.travelMinutesFromPrev ?? 0,
      travelDistanceKmFromPrev: item.travelDistanceKmFromPrev ?? 0,
    })
  }

  return {
    success: true as const,
    stopCount: ordered.length,
    beforeTravelMinutes,
    afterTravelMinutes,
    minutesSaved,
    distanceSavedKm,
  }
}

export async function geocodePlaceName(
  tools: ActionTools,
  placeName: string,
): Promise<{ lat?: number; lng?: number; country?: string; resolvedName?: string }> {
  if (!placeName.trim()) return {}
  try {
    const res = await tools.integration<Array<{ name?: string; country?: string; lat?: number; lon?: number }>>(
      'openweathermap/geocoding',
      { q: placeName.trim(), limit: 1 },
    )
    if (res.success && Array.isArray(res.data) && res.data.length > 0) {
      const hit = res.data[0]
      if (typeof hit.lat === 'number' && typeof hit.lon === 'number') {
        return {
          lat: hit.lat,
          lng: hit.lon,
          country: hit.country,
          resolvedName: hit.name,
        }
      }
    }
  } catch {
    // Graceful fallback if geocoding is unavailable or caller lacks credits
  }
  return {}
}

export async function syncEditorsAcrossTripRecords(
  tools: ActionTools,
  tripId: string,
  editors: string[],
): Promise<void> {
  const collections = ['trip_destinations', 'trip_stops', 'trip_overviews', 'trip_checklists']
  for (const col of collections) {
    const res = await tools.query<DestinationData | StopData>(col, {
      where: { tripId },
      limit: 500,
    })
    if (!res.success) continue
    for (const rec of res.data.records) {
      await tools.update(col, rec.recordId, { editors })
    }
  }
}
