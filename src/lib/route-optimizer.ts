import type { PreferredWindow, StopData, TransportMode } from './trip-types'

export interface LatLng {
  lat: number
  lng: number
}

export interface LegEstimate {
  distanceKm: number
  minutes: number
  mode: TransportMode
}

export interface ScheduleWarning {
  type: 'tight_transition' | 'overpacked_day' | 'long_transfer' | 'missing_coords'
  message: string
  stopIndex?: number
}

export interface ScheduledStop<T extends StopData = StopData> {
  stop: T
  startMinutes: number
  endMinutes: number
  startTime: string
  endTime: string
  travelMinutesFromPrev: number
  travelDistanceKmFromPrev: number
}

export interface DayScheduleResult<T extends StopData = StopData> {
  items: ScheduledStop<T>[]
  totalTravelMinutes: number
  totalDistanceKm: number
  totalActivityMinutes: number
  warnings: ScheduleWarning[]
}

export interface OptimizeResult<T extends StopData = StopData> {
  stops: T[]
  beforeTravelMinutes: number
  afterTravelMinutes: number
  minutesSaved: number
  beforeDistanceKm: number
  afterDistanceKm: number
  distanceSavedKm: number
}

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function hasCoords(stop: { lat?: number; lng?: number }): stop is { lat: number; lng: number } {
  return (
    typeof stop.lat === 'number' &&
    typeof stop.lng === 'number' &&
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng)
  )
}

/**
 * Realistic urban travel time estimate between two points.
 * Applies a 1.3x street-grid detour factor over straight-line Haversine distance
 * plus mode-specific speed and transfer/parking overhead.
 */
export function estimateLegTravel(
  from: { lat?: number; lng?: number },
  to: { lat?: number; lng?: number },
  mode: TransportMode = 'transit',
): LegEstimate {
  if (!hasCoords(from) || !hasCoords(to)) {
    return { distanceKm: 0, minutes: 12, mode }
  }

  const straightKm = haversineKm(from, to)
  const routeKm = Math.round(straightKm * 1.3 * 100) / 100
  if (routeKm < 0.08) {
    return { distanceKm: 0.05, minutes: 2, mode }
  }

  // Auto-prefer walk for short hops under 0.9 km unless explicitly driving.
  const effectiveMode: TransportMode = routeKm <= 0.9 && mode !== 'drive' ? 'walk' : mode

  let minutes: number
  if (effectiveMode === 'walk') {
    // 4.5 km/h walking speed + 2 min crossing buffer
    minutes = Math.round((routeKm / 4.5) * 60 + 2)
  } else if (effectiveMode === 'drive') {
    // 28 km/h urban driving + 6 min parking/pickup buffer
    minutes = Math.round((routeKm / 28) * 60 + 6)
  } else {
    // 22 km/h urban transit + 8 min station walk/wait
    minutes = Math.round((routeKm / 22) * 60 + 8)
  }

  return {
    distanceKm: routeKm,
    minutes: Math.max(3, minutes),
    mode: effectiveMode,
  }
}

export function parseTimeToMinutes(hhmm?: string): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null
  }
  return h * 60 + m
}

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const WINDOW_TARGET_MINUTES: Record<PreferredWindow, number> = {
  sunrise: 6 * 60 + 15,
  morning: 9 * 60 + 30,
  lunch: 12 * 60 + 30,
  afternoon: 14 * 60 + 30,
  golden_hour: 17 * 60 + 15,
  dinner: 19 * 60,
  night: 20 * 60 + 45,
  any: 13 * 60,
}

function roundToFive(mins: number): number {
  return Math.round(mins / 5) * 5
}

export function computeDaySchedule<T extends StopData>(
  stops: T[],
  dayStartMinutes = 9 * 60,
): DayScheduleResult<T> {
  const items: ScheduledStop<T>[] = []
  const warnings: ScheduleWarning[] = []
  let cursor = dayStartMinutes
  let totalTravelMinutes = 0
  let totalDistanceKm = 0
  let totalActivityMinutes = 0

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    const prev = i > 0 ? stops[i - 1] : null
    const leg = prev
      ? estimateLegTravel(prev, stop, stop.transportMode ?? prev.transportMode ?? 'transit')
      : { distanceKm: 0, minutes: 0, mode: stop.transportMode ?? 'transit' }

    if (prev && (!hasCoords(prev) || !hasCoords(stop))) {
      warnings.push({
        type: 'missing_coords',
        stopIndex: i,
        message: `Estimated transit to "${stop.title}" (exact coordinates missing).`,
      })
    }

    if (leg.minutes >= 45) {
      warnings.push({
        type: 'long_transfer',
        stopIndex: i,
        message: `${leg.minutes} min transfer to "${stop.title}" (${leg.distanceKm.toFixed(1)} km).`,
      })
    }

    const earliestArrival = prev ? cursor + leg.minutes : dayStartMinutes
    const parsedFixed = stop.fixedTime ? parseTimeToMinutes(stop.startTime) : null

    let startMinutes: number
    if (parsedFixed !== null) {
      if (prev && earliestArrival > parsedFixed) {
        warnings.push({
          type: 'tight_transition',
          stopIndex: i,
          message: `Tight timing: arriving around ${formatMinutesToTime(earliestArrival)} for fixed ${stop.startTime} "${stop.title}".`,
        })
      }
      startMinutes = parsedFixed
    } else if (i === 0 && stop.preferredWindow === 'sunrise') {
      startMinutes = WINDOW_TARGET_MINUTES.sunrise
    } else {
      startMinutes = roundToFive(earliestArrival)
    }

    const duration = Math.max(20, stop.durationMinutes ?? (stop.category === 'photo_spot' ? 45 : 75))
    const endMinutes = startMinutes + duration

    items.push({
      stop,
      startMinutes,
      endMinutes,
      startTime: formatMinutesToTime(startMinutes),
      endTime: formatMinutesToTime(endMinutes),
      travelMinutesFromPrev: leg.minutes,
      travelDistanceKmFromPrev: leg.distanceKm,
    })

    cursor = endMinutes
    totalTravelMinutes += leg.minutes
    totalDistanceKm += leg.distanceKm
    totalActivityMinutes += duration
  }

  if (totalActivityMinutes + totalTravelMinutes > 11 * 60) {
    warnings.push({
      type: 'overpacked_day',
      message: `Heavy day: ${Math.round((totalActivityMinutes + totalTravelMinutes) / 60)}h total including transit. Consider moving 1–2 stops.`,
    })
  }

  return {
    items,
    totalTravelMinutes,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    totalActivityMinutes,
    warnings,
  }
}

function windowSortRank(stop: StopData): number {
  if (stop.fixedTime) {
    const parsed = parseTimeToMinutes(stop.startTime)
    if (parsed !== null) return parsed
  }
  const win = stop.preferredWindow ?? 'any'
  return WINDOW_TARGET_MINUTES[win]
}

function isAnchor(stop: StopData): boolean {
  if (stop.fixedTime && parseTimeToMinutes(stop.startTime) !== null) return true
  const w = stop.preferredWindow
  return w === 'sunrise' || w === 'lunch' || w === 'golden_hour' || w === 'dinner' || w === 'night'
}

/**
 * Anchor-preserving route optimization:
 * 1. Keeps time-locked reservations & lighting/meal anchors sorted chronologically.
 * 2. Places flexible stops into the time segment closest to their preferred window,
 *    then orders each segment via Nearest-Neighbor + 2-opt refinement between its
 *    bounding anchors so backtracking is minimized.
 */
export function optimizeDayRoute<T extends StopData>(
  rawStops: T[],
  dayStartMinutes = 9 * 60,
): OptimizeResult<T> {
  if (rawStops.length <= 2) {
    const base = computeDaySchedule(rawStops, dayStartMinutes)
    const updated = base.items.map((item, idx) => ({
      ...item.stop,
      orderIndex: idx,
      startTime: item.stop.fixedTime ? item.stop.startTime : item.startTime,
      travelMinutesFromPrev: item.travelMinutesFromPrev,
      travelDistanceKmFromPrev: item.travelDistanceKmFromPrev,
    }))
    return {
      stops: updated,
      beforeTravelMinutes: base.totalTravelMinutes,
      afterTravelMinutes: base.totalTravelMinutes,
      minutesSaved: 0,
      beforeDistanceKm: base.totalDistanceKm,
      afterDistanceKm: base.totalDistanceKm,
      distanceSavedKm: 0,
    }
  }

  const before = computeDaySchedule(rawStops, dayStartMinutes)

  const anchors = rawStops.filter(isAnchor).sort((a, b) => windowSortRank(a) - windowSortRank(b))
  const flexible = rawStops.filter((s) => !isAnchor(s))

  let ordered: T[]
  if (anchors.length === 0) {
    ordered = nearestNeighborAndTwoOpt(flexible, null, null)
  } else {
    // Assign each flexible stop to the segment before the first anchor after its target rank,
    // or after the last anchor.
    const buckets: T[][] = Array.from({ length: anchors.length + 1 }, () => [])
    for (const stop of flexible) {
      const rank = windowSortRank(stop)
      const idx = anchors.findIndex((a) => windowSortRank(a) > rank)
      if (idx === -1) buckets[anchors.length].push(stop)
      else buckets[idx].push(stop)
    }

    ordered = []
    for (let i = 0; i < anchors.length; i++) {
      const prevAnchor = i > 0 ? anchors[i - 1] : null
      const nextAnchor = anchors[i]
      const seg = nearestNeighborAndTwoOpt(buckets[i], prevAnchor, nextAnchor)
      ordered.push(...seg, nextAnchor)
    }
    const tail = nearestNeighborAndTwoOpt(buckets[anchors.length], anchors[anchors.length - 1], null)
    ordered.push(...tail)
  }

  const after = computeDaySchedule(ordered, dayStartMinutes)
  const finalStops = after.items.map((item, idx) => ({
    ...item.stop,
    orderIndex: idx,
    startTime: item.stop.fixedTime ? item.stop.startTime : item.startTime,
    travelMinutesFromPrev: item.travelMinutesFromPrev,
    travelDistanceKmFromPrev: item.travelDistanceKmFromPrev,
  }))

  return {
    stops: finalStops,
    beforeTravelMinutes: before.totalTravelMinutes,
    afterTravelMinutes: after.totalTravelMinutes,
    minutesSaved: Math.max(0, before.totalTravelMinutes - after.totalTravelMinutes),
    beforeDistanceKm: before.totalDistanceKm,
    afterDistanceKm: after.totalDistanceKm,
    distanceSavedKm: Math.max(
      0,
      Math.round((before.totalDistanceKm - after.totalDistanceKm) * 100) / 100,
    ),
  }
}

function nearestNeighborAndTwoOpt<T extends StopData>(
  nodes: T[],
  startAnchor: T | null,
  endAnchor: T | null,
): T[] {
  if (nodes.length <= 1) return [...nodes]

  const remaining = [...nodes]
  const route: T[] = []
  let current: T | null = startAnchor

  while (remaining.length > 0) {
    let bestIdx = 0
    if (current && hasCoords(current)) {
      let bestCost = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i]
        const cost = hasCoords(cand)
          ? estimateLegTravel(current, cand, cand.transportMode ?? 'transit').minutes
          : 999
        if (cost < bestCost) {
          bestCost = cost
          bestIdx = i
        }
      }
    } else if (endAnchor && hasCoords(endAnchor) && remaining.length > 1) {
      // Pick node farthest from endAnchor to start cleanly moving toward endAnchor.
      let maxDist = -1
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i]
        const dist = hasCoords(cand) ? haversineKm(cand, endAnchor) : 0
        if (dist > maxDist) {
          maxDist = dist
          bestIdx = i
        }
      }
    }
    const [picked] = remaining.splice(bestIdx, 1)
    route.push(picked)
    current = picked
  }

  // 2-opt refinement preserving startAnchor and endAnchor bounds
  const segCost = (seq: T[]): number => {
    let sum = 0
    for (let i = 0; i < seq.length; i++) {
      const prev = i === 0 ? startAnchor : seq[i - 1]
      if (prev) sum += estimateLegTravel(prev, seq[i], seq[i].transportMode ?? 'transit').minutes
    }
    if (endAnchor && seq.length > 0) {
      sum += estimateLegTravel(seq[seq.length - 1], endAnchor, endAnchor.transportMode ?? 'transit').minutes
    }
    return sum
  }

  let bestCost = segCost(route)
  let improved = true
  let guard = 0
  while (improved && guard < 40) {
    improved = false
    guard++
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const candidate = [
          ...route.slice(0, i),
          ...route.slice(i, j + 1).reverse(),
          ...route.slice(j + 1),
        ]
        const cost = segCost(candidate)
        if (cost < bestCost) {
          route.splice(0, route.length, ...candidate)
          bestCost = cost
          improved = true
        }
      }
    }
  }

  return route
}
