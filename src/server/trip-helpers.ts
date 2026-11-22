import {
  apiWorkerFetch,
  normalizeApiError,
  splitIntegrationEndpoint,
} from 'deepspace/worker'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker.js'
import {
  expandAddressQueries,
  parseLocationQuery,
  pickBestGeocodeCandidate,
  resolveCountryIso,
  type GeocodeCandidate,
} from '../lib/location-query.js'
import {
  computeDaySchedule,
  optimizeDayRoute,
  resolveDayContext,
  type HotelOrigin,
} from '../lib/route-optimizer.js'
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

export async function resolveHotelOriginForDay(
  tools: ActionTools,
  tripId: string,
  dayNumber: number,
  movingDaySide: 'departure' | 'arrival' = 'departure',
): Promise<HotelOrigin | undefined> {
  const [tripRes, destRes] = await Promise.all([
    tools.get<TripData>('trips', tripId),
    tools.query<DestinationData>('trip_destinations', { where: { tripId }, limit: 50 }),
  ])
  if (!tripRes.success || !destRes.success) return undefined

  const trip = tripRes.data.record.data
  const destinations = destRes.data.records.map((r) => ({ id: r.recordId, ...r.data }))
  const ctx = resolveDayContext(dayNumber, trip.totalDays ?? 5, trip.startDate, destinations)
  const sourceDest = ctx.isLocationChange
    ? movingDaySide === 'arrival'
      ? ctx.destination ?? ctx.previousDestination
      : ctx.previousDestination ?? ctx.destination
    : ctx.destination
  if (!sourceDest) return undefined

  const lat = sourceDest.lodgingLat ?? sourceDest.lat
  const lng = sourceDest.lodgingLng ?? sourceDest.lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined
  return {
    name: sourceDest.lodgingName || sourceDest.name,
    lat,
    lng,
  }
}

/**
 * Recomputes travel times & scheduled start times for all stops on a given day
 * (factoring in active lodging coordinates when available) and persists updated fields.
 */
export async function recalculateAndPersistDay(
  tools: ActionTools,
  tripId: string,
  dayNumber: number,
  options?: { optimize?: boolean; dayStartMinutes?: number },
) {
  const [q, hotelOrigin] = await Promise.all([
    tools.query<StopData>('trip_stops', {
      where: { tripId, dayNumber },
      limit: 200,
    }),
    resolveHotelOriginForDay(tools, tripId, dayNumber),
  ])
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
    const opt = optimizeDayRoute(mapped, options.dayStartMinutes, hotelOrigin)
    ordered = opt.stops
    minutesSaved = opt.minutesSaved
    distanceSavedKm = opt.distanceSavedKm
    beforeTravelMinutes = opt.beforeTravelMinutes
    afterTravelMinutes = opt.afterTravelMinutes
  } else {
    const sched = computeDaySchedule(mapped, options?.dayStartMinutes, hotelOrigin)
    ordered = sched.items.map((item, idx) => ({
      ...item.stop,
      orderIndex: idx,
      startTime: item.stop.fixedTime ? item.stop.startTime : item.startTime,
      durationMinutes:
        item.stop.category === 'transit'
          ? item.endMinutes - item.startMinutes
          : item.stop.durationMinutes,
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
      ...(typeof item.fixedTime === 'boolean' ? { fixedTime: item.fixedTime } : {}),
      ...(typeof item.durationMinutes === 'number' ? { durationMinutes: item.durationMinutes } : {}),
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

export interface GeocodePlaceOptions {
  countryHint?: string
  near?: { lat: number; lng: number }
  maxDistanceKm?: number
  cityBias?: string
  expectedAddress?: string
  /** Skip city-centroid OpenWeatherMap geocoder; resolve street addresses & hotels via Places/OSM. */
  preferPoi?: boolean
}

interface NominatimHit {
  name?: string
  display_name?: string
  lat?: string
  lon?: string
  type?: string
  class?: string
  importance?: number
  address?: {
    city?: string
    town?: string
    village?: string
    city_district?: string
    country_code?: string
    state?: string
  }
}

interface PhotonResponse {
  features?: Array<{
    geometry?: { coordinates?: [number, number] }
    properties?: {
      name?: string
      street?: string
      housenumber?: string
      district?: string
      city?: string
      county?: string
      state?: string
      countrycode?: string
      osm_key?: string
      osm_value?: string
    }
  }>
}

function geoDeltaFromRadius(maxDistanceKm?: number): number {
  const km = typeof maxDistanceKm === 'number' && maxDistanceKm > 0 ? maxDistanceKm : 45
  return Math.min(1.1, Math.max(0.25, km / 85))
}

async function querySerpApiPlacesCandidates(
  tools: ActionTools,
  q: string,
  options?: GeocodePlaceOptions,
): Promise<GeocodeCandidate[]> {
  try {
    const res = await tools.integration<{
      local_results?: Array<{
        title?: string
        address?: string
        type?: string
        gps_coordinates?: { latitude?: number; longitude?: number }
      }>
      place_results?: {
        title?: string
        address?: string
        type?: string
        gps_coordinates?: { latitude?: number; longitude?: number }
      }
    }>('serpapi/places-search', {
      q,
      ...(options?.cityBias ? { location: options.cityBias } : {}),
    })
    if (!res.success || !res.data) return []

    const rawItems = [
      ...(res.data.place_results ? [res.data.place_results] : []),
      ...(Array.isArray(res.data.local_results) ? res.data.local_results.slice(0, 6) : []),
    ]
    const candidates: GeocodeCandidate[] = []
    for (const item of rawItems) {
      const latNum = item.gps_coordinates?.latitude
      const lngNum = item.gps_coordinates?.longitude
      if (typeof latNum !== 'number' || typeof lngNum !== 'number') continue
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) continue
      candidates.push({
        name: item.title || q,
        displayName: item.address,
        placeType: item.type,
        lat: latNum,
        lng: lngNum,
        importance: 0.9,
      })
    }
    return candidates
  } catch {
    return []
  }
}

async function queryPhotonCandidates(
  q: string,
  parsed: ReturnType<typeof parseLocationQuery>,
  options?: GeocodePlaceOptions,
): Promise<GeocodeCandidate[]> {
  try {
    const url = new URL('https://photon.komoot.io/api/')
    url.searchParams.set('q', q)
    url.searchParams.set('limit', '6')
    if (options?.near) {
      url.searchParams.set('lat', String(options.near.lat))
      url.searchParams.set('lon', String(options.near.lng))
      const delta = geoDeltaFromRadius(options.maxDistanceKm)
      url.searchParams.set(
        'bbox',
        `${options.near.lng - delta},${options.near.lat - delta},${options.near.lng + delta},${options.near.lat + delta}`,
      )
    }
    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'TrippiePlanner/1.0 (https://app.space)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3500),
    })
    if (!resp.ok) return []
    const data = (await resp.json()) as PhotonResponse
    if (!Array.isArray(data.features) || data.features.length === 0) return []

    const candidates: GeocodeCandidate[] = []
    for (const f of data.features) {
      const coords = f.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) continue
      const [lngNum, latNum] = coords
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) continue
      const props = f.properties ?? {}
      const parts = [props.name, props.housenumber, props.street, props.district, props.city]
        .filter(Boolean)
        .join(' ')
      candidates.push({
        name: props.name || props.street || props.city || parsed.primaryName,
        displayName: parts || undefined,
        country: props.countrycode?.toUpperCase(),
        city: props.city || props.county || props.district,
        state: props.state,
        placeType: props.osm_value || props.osm_key,
        lat: latNum,
        lng: lngNum,
      })
    }
    return candidates
  } catch {
    return []
  }
}

async function queryNominatimCandidates(
  q: string,
  parsed: ReturnType<typeof parseLocationQuery>,
  options?: GeocodePlaceOptions,
): Promise<GeocodeCandidate[]> {
  try {
    const searchUrl = new URL('https://nominatim.openstreetmap.org/search')
    searchUrl.searchParams.set('format', 'jsonv2')
    searchUrl.searchParams.set('addressdetails', '1')
    searchUrl.searchParams.set('limit', '6')
    searchUrl.searchParams.set('q', q)
    if (parsed.countryIso) {
      searchUrl.searchParams.set('countrycodes', parsed.countryIso.toLowerCase())
    }
    if (options?.near) {
      const delta = geoDeltaFromRadius(options.maxDistanceKm)
      searchUrl.searchParams.set(
        'viewbox',
        `${options.near.lng - delta},${options.near.lat + delta},${options.near.lng + delta},${options.near.lat - delta}`,
      )
      if (options.maxDistanceKm && options.maxDistanceKm <= 80) {
        searchUrl.searchParams.set('bounded', '1')
      }
    }

    const resp = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'TrippiePlanner/1.0 (https://app.space)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3500),
    })

    if (!resp.ok) return []
    const hits = (await resp.json()) as NominatimHit[]
    if (!Array.isArray(hits) || hits.length === 0) return []

    const candidates: GeocodeCandidate[] = []
    for (const hit of hits) {
      const latNum = hit.lat ? Number(hit.lat) : NaN
      const lngNum = hit.lon ? Number(hit.lon) : NaN
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) continue
      const countryIso = hit.address?.country_code?.toUpperCase()
      const primaryTitle =
        hit.name ||
        hit.address?.city ||
        hit.address?.town ||
        hit.display_name?.split(',')[0]?.trim() ||
        parsed.primaryName
      candidates.push({
        name: primaryTitle,
        displayName: hit.display_name,
        country: countryIso,
        city:
          hit.address?.city ||
          hit.address?.town ||
          hit.address?.village ||
          hit.address?.city_district,
        state: hit.address?.state,
        placeType: hit.type || hit.class,
        lat: latNum,
        lng: lngNum,
        importance: hit.importance,
      })
    }
    return candidates
  } catch {
    return []
  }
}

export async function geocodePlaceName(
  tools: ActionTools,
  placeName: string,
  options?: GeocodePlaceOptions,
): Promise<{ lat?: number; lng?: number; country?: string; resolvedName?: string }> {
  const trimmed = placeName.trim()
  if (!trimmed) return {}

  const parsed = parseLocationQuery(trimmed, options?.countryHint)
  const looksLikeAddress = /\d/.test(trimmed) || trimmed.split(',').length >= 3
  const preferSpecificPoi = Boolean(options?.preferPoi || looksLikeAddress)

  if (!preferSpecificPoi) {
    try {
      for (const owmQuery of parsed.owmQueries) {
        const res = await tools.integration<
          Array<{
            name?: string
            country?: string
            state?: string
            lat?: number
            lon?: number
            local_names?: Record<string, string>
          }>
        >('openweathermap/geocoding', { q: owmQuery, limit: 10 })

        if (!res.success || !Array.isArray(res.data) || res.data.length === 0) continue

        const candidates: Array<GeocodeCandidate & { state?: string; country?: string }> = []
        for (const hit of res.data) {
          if (typeof hit.lat !== 'number' || typeof hit.lon !== 'number') continue
          const altNames = hit.local_names ? Object.values(hit.local_names) : []
          candidates.push({
            name: hit.name ?? parsed.primaryName,
            country: hit.country,
            state: hit.state,
            lat: hit.lat,
            lng: hit.lon,
            localNamesCount: altNames.length,
            alternativeNames: altNames,
          })
        }

        const best = pickBestGeocodeCandidate(candidates, parsed, {
          near: options?.near,
          maxDistanceKm: options?.maxDistanceKm,
        })
        if (best) {
          return {
            lat: best.lat,
            lng: best.lng,
            country: best.country,
            resolvedName: best.name,
          }
        }
      }
    } catch {
      // Graceful fallback if OWM geocoding is unavailable or caller lacks credits
    }
  } else {
    const serpCandidates = await querySerpApiPlacesCandidates(tools, parsed.nominatimQuery, options)
    if (serpCandidates.length > 0) {
      const serpBest = pickBestGeocodeCandidate(serpCandidates, parsed, {
        near: options?.near,
        maxDistanceKm: options?.maxDistanceKm,
        allowLooseSimilarity: true,
        cityBias: options?.cityBias,
        expectedAddress: options?.expectedAddress,
        preferSpecificPoi: true,
      })
      if (serpBest) {
        return {
          lat: serpBest.lat,
          lng: serpBest.lng,
          country: serpBest.country ?? parsed.countryIso,
          resolvedName: serpBest.name,
        }
      }
    }
  }

  // Try normalized/stripped address variants first when the query contains street numbers or units
  const osmQueries = looksLikeAddress
    ? expandAddressQueries(parsed.nominatimQuery)
    : [parsed.nominatimQuery]

  for (const osmQuery of osmQueries) {
    const stepParsed = parseLocationQuery(osmQuery, parsed.countryIso ?? options?.countryHint)
    const [nomCandidates, photonCandidates] = await Promise.all([
      queryNominatimCandidates(stepParsed.nominatimQuery, stepParsed, options),
      queryPhotonCandidates(stepParsed.nominatimQuery, stepParsed, options),
    ])
    const bestOsm = pickBestGeocodeCandidate([...nomCandidates, ...photonCandidates], stepParsed, {
      near: options?.near,
      maxDistanceKm: options?.maxDistanceKm,
      allowLooseSimilarity: true,
      cityBias: options?.cityBias,
      expectedAddress: options?.expectedAddress,
      preferSpecificPoi,
    })
    if (bestOsm) {
      return {
        lat: bestOsm.lat,
        lng: bestOsm.lng,
        country: bestOsm.country ?? stepParsed.countryIso,
        resolvedName: bestOsm.name,
      }
    }
  }

  return {}
}

const GENERIC_LODGING_NAME_RE =
  /^(hotel|lodging|stay|my\s*stay|home|house|apartment|apt|airbnb|vrbo|condo|flat|villa|hostel|guesthouse|guest\s*house|room|accommodation|last\s*(?:stop|location)|stop\s*\d+|destination|location)$/i
const HOTEL_BRAND_RE =
  /\b(hotel|inn|ryokan|resort|suites?|hilton|marriott|hyatt|sheraton|regis|okura|prince|tokyu|nikko|apa|dormy|granvia|swissotel|toyoko|sotetsu|excel|westin|ritz|conrad|aman|intercontinental|crowne|holiday)\b/i

/**
 * Resolves exact building/address coordinates for a hotel stay using Google Places / OSM
 * (prioritizing specific numbered street addresses ahead of generic stay/Airbnb labels, while
 * prioritizing named hotel brands ahead of bare Japanese street numbers when OSM lacks house numbers).
 */
export async function resolveHotelCoordinates(
  tools: ActionTools,
  params: {
    lodgingName?: string
    lodgingAddress?: string
    cityName: string
    countryHint?: string
    cityLat?: number
    cityLng?: number
  },
): Promise<{ lat?: number; lng?: number }> {
  const { lodgingName, lodgingAddress, cityName, countryHint, cityLat, cityLng } = params
  const addr = lodgingAddress?.trim() || ''
  const name = lodgingName?.trim() || ''
  const city = cityName.trim()
  if (!addr && !name) {
    return { lat: cityLat, lng: cityLng }
  }

  const queries: string[] = []
  const addQ = (q: string) => {
    const clean = q.trim()
    if (clean && !queries.includes(clean)) queries.push(clean)
  }

  const cityInAddr = city ? addr.toLowerCase().includes(city.toLowerCase()) : true
  const cityInName = city ? name.toLowerCase().includes(city.toLowerCase()) : true
  const addrSuffix = cityInAddr || !city ? '' : `, ${city}`
  const nameQuery = name ? (cityInName || !city ? name : `${name}, ${city}`) : ''
  const addrQuery = addr ? `${addr}${addrSuffix}` : ''

  if (name && addr) {
    addQ(`${name}, ${addr}${addrSuffix}`)
    const preferNameOverStreet =
      !GENERIC_LODGING_NAME_RE.test(name) && (!/\d/.test(addr) || HOTEL_BRAND_RE.test(name))
    if (preferNameOverStreet) {
      if (nameQuery) addQ(nameQuery)
      if (addrQuery) addQ(addrQuery)
    } else {
      if (addrQuery) addQ(addrQuery)
      if (nameQuery && !GENERIC_LODGING_NAME_RE.test(name)) addQ(nameQuery)
    }
  } else if (nameQuery) {
    addQ(nameQuery)
  } else if (addrQuery) {
    addQ(addrQuery)
  }

  const near =
    typeof cityLat === 'number' && typeof cityLng === 'number'
      ? { lat: cityLat, lng: cityLng }
      : undefined

  for (const q of queries) {
    const geo = await geocodePlaceName(tools, q, {
      preferPoi: true,
      countryHint,
      near,
      maxDistanceKm: near ? 45 : undefined,
      cityBias: city || undefined,
      expectedAddress: addr || undefined,
    })
    if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
      return { lat: geo.lat, lng: geo.lng }
    }
  }

  return { lat: cityLat, lng: cityLng }
}

const GENERIC_STOP_TITLE_RE =
  /^(breakfast|lunch|dinner|brunch|coffee|walk|stroll|explore|shopping|free\s*time|arrival|departure|home|house|apartment|apt|airbnb|stay|last\s*(?:stop|location)|stop\s*\d+)$/i

/**
 * Resolves accurate coordinates for an itinerary stop using title + address + city context.
 */
export async function resolveStopCoordinates(
  tools: ActionTools,
  params: {
    title: string
    address?: string
    category?: string
    cityName?: string
    countryHint?: string
    near?: { lat: number; lng: number }
  },
): Promise<{ lat?: number; lng?: number }> {
  const title = params.title.trim()
  const addr = params.address?.trim() || ''
  const city = params.cityName?.trim() || ''
  const maxDistanceKm = params.near
    ? params.category === 'day_trip'
      ? 160
      : params.category === 'transit'
        ? 80
        : 40
    : undefined

  const queries: string[] = []
  const addQ = (q: string) => {
    const clean = q.trim()
    if (clean && !queries.includes(clean)) queries.push(clean)
  }
  const withCity = (q: string) =>
    city && !q.toLowerCase().includes(city.toLowerCase()) ? `${q}, ${city}` : q

  if (title && addr) {
    if (GENERIC_STOP_TITLE_RE.test(title)) {
      addQ(withCity(addr))
      addQ(withCity(`${title}, ${addr}`))
    } else if (/\d/.test(addr) && /\d/.test(title) === false && title.split(/\s+/).length <= 2) {
      addQ(withCity(`${title}, ${addr}`))
      addQ(withCity(addr))
      addQ(withCity(title))
    } else {
      addQ(withCity(`${title}, ${addr}`))
      addQ(withCity(title))
      addQ(withCity(addr))
    }
  } else if (title) {
    addQ(withCity(title))
  } else if (addr) {
    addQ(withCity(addr))
  }

  for (const q of queries) {
    const geo = await geocodePlaceName(tools, q, {
      preferPoi: true,
      countryHint: params.countryHint,
      near: params.near,
      maxDistanceKm,
      cityBias: city || undefined,
      expectedAddress: addr || undefined,
    })
    if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
      return { lat: geo.lat, lng: geo.lng }
    }
  }

  return {}
}

export async function resolveTripGeocodeBias(
  tools: ActionTools,
  tripId: string,
  dayNumber?: number,
): Promise<GeocodePlaceOptions & { cityName?: string }> {
  const [tripRes, destRes] = await Promise.all([
    tools.get<TripData>('trips', tripId),
    tools.query<DestinationData>('trip_destinations', { where: { tripId }, limit: 50 }),
  ])
  if (!destRes.success || destRes.data.records.length === 0) return {}

  const destinations = destRes.data.records.map((r) => ({ id: r.recordId, ...r.data }))
  const totalDays = tripRes.success ? tripRes.data.record.data.totalDays ?? 5 : 5
  const startDate = tripRes.success ? tripRes.data.record.data.startDate : undefined
  const activeDest = dayNumber
    ? resolveDayContext(dayNumber, totalDays, startDate, destinations).destination
    : destinations[0]

  if (!activeDest) return {}
  const lat = activeDest.lat ?? activeDest.lodgingLat
  const lng = activeDest.lng ?? activeDest.lodgingLng
  return {
    cityName: activeDest.name,
    cityBias: activeDest.name,
    countryHint: resolveCountryIso(activeDest.country) ?? activeDest.country,
    near: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : undefined,
  }
}

export async function syncEditorsAcrossTripRecords(
  tools: ActionTools,
  tripId: string,
  editors: string[],
): Promise<void> {
  const collections = ['trip_destinations', 'trip_stops', 'trip_checklists']
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
