import type {
  DestinationData,
  IntercityTransport,
  PreferredWindow,
  StopData,
  TransportMode,
} from './trip-types'

export interface LatLng {
  lat: number
  lng: number
}

export interface HotelOrigin {
  name?: string
  lat?: number
  lng?: number
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
  transitCardDistanceKm?: number
  effectiveTransportMode: TransportMode
  fromHotelOrigin?: boolean
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

export interface TripDayContext {
  dayNumber: number
  isoDate?: string
  shortDateLabel: string
  fullDateLabel: string
  destination?: DestinationData & { id?: string }
  previousDestination?: DestinationData & { id?: string }
  isLocationChange: boolean
  isHotelChange: boolean
}

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function isoAddDays(startIso: string, deltaDays: number): string {
  const d = new Date(`${startIso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return startIso
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export function diffDaysInclusive(start?: string, end?: string): number {
  if (!start || !end) return 0
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
}

/**
 * Keeps trip startDate, endDate, and totalDays synchronized on inclusive calendar boundaries
 * (e.g. Dec 17 to Dec 29 inclusive = 13 days).
 */
export function reconcileTripDatesAndDays(params: {
  startDate?: string
  endDate?: string
  totalDays?: number
  preferTotalDays?: boolean
  fallbackDays?: number
}): { startDate?: string; endDate?: string; totalDays: number } {
  const startDate = params.startDate?.trim() || undefined
  let endDate = params.endDate?.trim() || undefined
  const dateDays = diffDaysInclusive(startDate, endDate)
  const rawTotal =
    typeof params.totalDays === 'number' && Number.isFinite(params.totalDays) && params.totalDays >= 1
      ? Math.min(60, Math.round(params.totalDays))
      : undefined

  if (startDate && endDate && dateDays > 0) {
    if (params.preferTotalDays && rawTotal) {
      return {
        startDate,
        endDate: isoAddDays(startDate, rawTotal - 1),
        totalDays: rawTotal,
      }
    }
    return {
      startDate,
      endDate,
      totalDays: Math.min(60, dateDays),
    }
  }

  const totalDays = rawTotal ?? params.fallbackDays ?? 5
  if (startDate && !endDate) {
    endDate = isoAddDays(startDate, totalDays - 1)
  }
  return { startDate, endDate, totalDays }
}

export function formatIsoDateLabel(
  isoDate: string,
  style: 'short' | 'full' = 'short',
): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  if (style === 'full') {
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function resolveEffectiveTripStartDate(
  tripStartDate: string | undefined,
  destinations: Array<{ arrivalDate?: string }>,
): string | undefined {
  if (tripStartDate) return tripStartDate
  const dated = destinations
    .map((d) => d.arrivalDate)
    .filter((d): d is string => Boolean(d))
    .sort()
  return dated[0]
}

/**
 * Resolves calendar date, active destination, and hotel/city transition status for a day.
 */
export function resolveDayContext(
  dayNumber: number,
  totalDays: number,
  tripStartDate: string | undefined,
  destinations: Array<DestinationData & { id?: string }>,
): TripDayContext {
  const sorted = destinations.slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
  const effectiveStart = resolveEffectiveTripStartDate(tripStartDate, sorted)
  const isoDate = effectiveStart ? isoAddDays(effectiveStart, dayNumber - 1) : undefined
  const shortDateLabel = isoDate ? formatIsoDateLabel(isoDate, 'short') : `Day ${dayNumber}`
  const fullDateLabel = isoDate ? formatIsoDateLabel(isoDate, 'full') : `Day ${dayNumber}`

  if (sorted.length === 0) {
    return {
      dayNumber,
      isoDate,
      shortDateLabel,
      fullDateLabel,
      isLocationChange: false,
      isHotelChange: false,
    }
  }

  const findForDate = (targetIso: string) => {
    // Prefer exact arrival match on a transfer day so transition day belongs to the new stop.
    const exactArrival = sorted.find((d) => d.arrivalDate === targetIso)
    if (exactArrival) return exactArrival
    return sorted.find((d) => {
      if (!d.arrivalDate) return false
      if (!d.departureDate) return d.arrivalDate <= targetIso
      return targetIso >= d.arrivalDate && targetIso <= d.departureDate
    })
  }

  let destination: (DestinationData & { id?: string }) | undefined
  let previousDestination: (DestinationData & { id?: string }) | undefined

  if (isoDate && sorted.some((d) => Boolean(d.arrivalDate))) {
    destination = findForDate(isoDate) ?? sorted[sorted.length - 1]
    if (dayNumber > 1) {
      const prevIso = isoAddDays(effectiveStart!, dayNumber - 2)
      previousDestination = findForDate(prevIso)
    }
  } else {
    // Proportional mapping when dates aren't assigned yet
    const span = Math.max(1, totalDays / sorted.length)
    const idx = Math.min(sorted.length - 1, Math.floor((dayNumber - 1) / span))
    destination = sorted[idx]
    if (dayNumber > 1) {
      const prevIdx = Math.min(sorted.length - 1, Math.floor((dayNumber - 2) / span))
      previousDestination = sorted[prevIdx]
    }
  }

  const prevHotel = previousDestination?.lodgingName?.trim() || previousDestination?.name
  const currHotel = destination?.lodgingName?.trim() || destination?.name
  const isLocationChange = Boolean(
    previousDestination && destination && previousDestination.orderIndex !== destination.orderIndex,
  )
  const isHotelChange = Boolean(
    isLocationChange && prevHotel && currHotel && prevHotel.toLowerCase() !== currHotel.toLowerCase(),
  )

  return {
    dayNumber,
    isoDate,
    shortDateLabel,
    fullDateLabel,
    destination,
    previousDestination,
    isLocationChange,
    isHotelChange,
  }
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

export function formatMinutesHuman(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes))
  if (m < 60) return `${m}m`
  const hrs = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`
}

export function recommendLegTransport(routeKm: number): TransportMode {
  if (routeKm <= 1.0) return 'walk'
  if (routeKm <= 180) return 'transit'
  if (routeKm <= 680) return 'bullet_train'
  return 'flight'
}

/**
 * Realistic urban and intercity travel time estimate between two points.
 * Auto-selects the most reasonable mode when not explicitly overridden
 * (e.g. walking for <=0.9 km hops, bullet train for 180–680 km corridors like Osaka ↔ Tokyo).
 */
export function estimateLegTravel(
  from: { lat?: number; lng?: number },
  to: { lat?: number; lng?: number },
  mode?: TransportMode,
  explicitOverride = false,
): LegEstimate {
  const fallbackMode = mode ?? 'transit'
  if (!hasCoords(from) || !hasCoords(to)) {
    return { distanceKm: 0, minutes: 12, mode: fallbackMode }
  }

  const straightKm = haversineKm(from, to)
  const routeKm = Math.round(straightKm * 1.3 * 100) / 100
  if (routeKm < 0.08) {
    return { distanceKm: 0.05, minutes: 2, mode: 'walk' }
  }

  let effectiveMode: TransportMode = fallbackMode
  if (!mode) {
    effectiveMode = recommendLegTransport(routeKm)
  } else if (!explicitOverride) {
    if (routeKm <= 0.9 && mode !== 'drive') {
      effectiveMode = 'walk'
    } else if (mode === 'transit' && routeKm >= 180) {
      effectiveMode = routeKm > 680 ? 'flight' : 'bullet_train'
    }
  }

  let minutes: number
  if (effectiveMode === 'walk') {
    // 4.5 km/h walking speed + 2 min crossing buffer
    minutes = Math.round((routeKm / 4.5) * 60 + 2)
  } else if (effectiveMode === 'drive') {
    // 28 km/h urban driving or 78 km/h highway for long stretches
    const speedKph = routeKm > 45 ? 78 : 28
    const overhead = routeKm > 45 ? 15 : 6
    minutes = Math.round((routeKm / speedKph) * 60 + overhead)
  } else if (effectiveMode === 'bullet_train') {
    // High-speed rail (~230 km/h on rail corridor + 30 min station transfer)
    const railKm = straightKm * 1.15
    minutes = Math.round((railKm / 230) * 60 + 30)
  } else if (effectiveMode === 'flight') {
    // Commercial air (~750 km/h + 165 min airport check-in/security/baggage)
    minutes = Math.round((straightKm / 750) * 60 + 165)
  } else {
    // 22 km/h intra-city transit; ~60 km/h + 22 min transfer for regional rail (40–135 km); 95 km/h for long express
    const speedKph = routeKm > 135 ? 95 : routeKm > 40 ? 60 : 22
    const overhead = routeKm > 135 ? 25 : routeKm > 40 ? 22 : 8
    minutes = Math.round((routeKm / speedKph) * 60 + overhead)
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

export function isIntercityLegCard(stop: StopData): boolean {
  return stop.category === 'transit' && /^Travel:\s*/i.test(stop.title.trim())
}

export function computeDaySchedule<T extends StopData>(
  stops: T[],
  dayStartMinutes = 9 * 60,
  hotelOrigin?: HotelOrigin,
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
    // Only seeded intercity "Travel: City A -> City B" cards replace the leg from prev.
    // Traveling TO a regular station / transit hub (e.g. "Kyoto Station") keeps its travel leg.
    const isTransitCard = isIntercityLegCard(stop)

    const shouldUseHotelLeg =
      i === 0 &&
      Boolean(hotelOrigin && hasCoords(hotelOrigin)) &&
      stop.category !== 'lodging' &&
      !isTransitCard

    const explicitOverride = Boolean(stop.transportOverridden)
    const originForLeg = prev ?? (hotelOrigin && hasCoords(hotelOrigin) ? hotelOrigin : null)
    const leg = isTransitCard
      ? originForLeg
        ? estimateLegTravel(originForLeg, stop, stop.transportMode, explicitOverride)
        : { distanceKm: 0, minutes: stop.durationMinutes ?? 60, mode: stop.transportMode ?? 'transit' }
      : prev
        ? estimateLegTravel(prev, stop, stop.transportMode ?? prev.transportMode, explicitOverride)
        : shouldUseHotelLeg && hotelOrigin
          ? estimateLegTravel(hotelOrigin, stop, stop.transportMode, explicitOverride)
          : { distanceKm: 0, minutes: 0, mode: stop.transportMode ?? 'transit' }

    const suppressHotelAfterTransit =
      Boolean(prev && isIntercityLegCard(prev)) &&
      stop.category === 'lodging' &&
      leg.distanceKm <= 0.15

    // For a hotel -> "Travel: City A -> City B" card, model local access to the departure hub
    // (e.g. ~15m to train station, ~35m to airport) rather than 0m or double-counting the corridor.
    let preTravelMinutes = 0
    let preTravelDistanceKm = 0
    if (isTransitCard) {
      if (prev) {
        const extraFromPrevKm =
          hotelOrigin && hasCoords(hotelOrigin) && hasCoords(prev) && prev.category !== 'lodging'
            ? haversineKm(prev, hotelOrigin)
            : 0
        if (leg.mode === 'flight') {
          preTravelDistanceKm = Math.round((18 + extraFromPrevKm) * 10) / 10
          preTravelMinutes = 35 + Math.round(extraFromPrevKm * 3)
        } else if (leg.mode === 'drive') {
          preTravelDistanceKm = extraFromPrevKm > 0.2 ? Math.round(extraFromPrevKm * 10) / 10 : 0
          preTravelMinutes = extraFromPrevKm > 0.2 ? Math.round(extraFromPrevKm * 2.5 + 5) : 0
        } else if (leg.mode === 'walk') {
          preTravelDistanceKm = 0.9
          preTravelMinutes = 12
        } else {
          preTravelDistanceKm = Math.round((3.5 + extraFromPrevKm) * 10) / 10
          preTravelMinutes = 15 + Math.round(extraFromPrevKm * 3)
        }
      }
    } else if (!suppressHotelAfterTransit) {
      preTravelMinutes = leg.minutes
      preTravelDistanceKm = leg.distanceKm
    }

    if (prev && !isTransitCard && (!hasCoords(prev) || !hasCoords(stop))) {
      warnings.push({
        type: 'missing_coords',
        stopIndex: i,
        message: `Estimated transit to "${stop.title}" (exact coordinates missing).`,
      })
    }

    if (preTravelMinutes >= 45 && !isTransitCard) {
      warnings.push({
        type: 'long_transfer',
        stopIndex: i,
        message: `${preTravelMinutes} min transfer to "${stop.title}" (${preTravelDistanceKm.toFixed(1)} km).`,
      })
    }

    const earliestArrival = prev
      ? cursor + preTravelMinutes
      : shouldUseHotelLeg
        ? dayStartMinutes + preTravelMinutes
        : dayStartMinutes
    const rawStartParsed = parseTimeToMinutes(stop.startTime)
    // Guard against bogus 00:00 midnight times written onto transit/Travel cards
    const isBogusMidnightTransit = isTransitCard && rawStartParsed === 0
    const parsedFixed = stop.fixedTime && !isBogusMidnightTransit ? rawStartParsed : null

    let startMinutes: number
    if (parsedFixed !== null) {
      if (prev && !isTransitCard && earliestArrival > parsedFixed) {
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

    const duration = isTransitCard
      ? Math.max(
          15,
          explicitOverride && originForLeg && hasCoords(stop)
            ? leg.minutes
            : (stop.durationMinutes ?? leg.minutes ?? 60),
        )
      : Math.max(
          15,
          stop.durationMinutes ?? (stop.category === 'photo_spot' ? 45 : stop.category === 'lodging' ? 30 : 75),
        )
    const endMinutes = startMinutes + duration

    items.push({
      stop,
      startMinutes,
      endMinutes,
      startTime: formatMinutesToTime(startMinutes),
      endTime: formatMinutesToTime(endMinutes),
      travelMinutesFromPrev: preTravelMinutes,
      travelDistanceKmFromPrev: preTravelDistanceKm,
      transitCardDistanceKm: isTransitCard ? leg.distanceKm : undefined,
      effectiveTransportMode: leg.mode,
      fromHotelOrigin: shouldUseHotelLeg,
    })

    cursor = endMinutes
    if (isTransitCard) {
      totalTravelMinutes += preTravelMinutes + duration
      totalDistanceKm += preTravelDistanceKm + leg.distanceKm
    } else {
      totalTravelMinutes += preTravelMinutes
      totalDistanceKm += preTravelDistanceKm
      totalActivityMinutes += duration
    }
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

function isCheckOutStop(stop: StopData): boolean {
  return stop.category === 'lodging' && /^check out\b/i.test(stop.title.trim())
}

function isLuggageDropOffStop(stop: StopData): boolean {
  return (
    stop.category === 'lodging' &&
    /\b(luggage|baggage|bag)\s*(drop|storage|check|hold)\b/i.test(stop.title)
  )
}

function windowSortRank(
  stop: StopData,
  checkOutRank: number | null,
  travelRank: number | null,
): number {
  const parsed = parseTimeToMinutes(stop.startTime)
  if (isIntercityLegCard(stop)) {
    if (checkOutRank !== null) {
      return checkOutRank + 1
    }
    if (parsed !== null && parsed > 0) return parsed
    const win = stop.preferredWindow ?? 'morning'
    return WINDOW_TARGET_MINUTES[win]
  }
  if (isLuggageDropOffStop(stop) && travelRank !== null && !(stop.fixedTime && parsed !== null)) {
    // Keep bag drop right after arrival from Travel: and before pre-check-in activities
    return travelRank + 0.5
  }
  if (stop.fixedTime && parsed !== null) {
    return parsed
  }
  const win = stop.preferredWindow ?? 'any'
  return WINDOW_TARGET_MINUTES[win]
}

function isAnchor(stop: StopData): boolean {
  if (isIntercityLegCard(stop)) return true
  if (isLuggageDropOffStop(stop)) return true
  if (stop.fixedTime && parseTimeToMinutes(stop.startTime) !== null) return true
  const w = stop.preferredWindow
  return w === 'sunrise' || w === 'lunch' || w === 'golden_hour' || w === 'dinner' || w === 'night'
}

/**
 * Anchor-preserving route optimization:
 * 1. Keeps time-locked reservations, Check out -> Travel transitions, & lighting/meal anchors sorted chronologically.
 * 2. Places flexible stops into the time segment closest to their preferred window,
 *    then orders each segment via Nearest-Neighbor + 2-opt refinement between its
 *    bounding anchors (and optional hotel departure point) so backtracking is minimized.
 */
export function optimizeDayRoute<T extends StopData>(
  rawStops: T[],
  dayStartMinutes = 9 * 60,
  hotelOrigin?: HotelOrigin,
): OptimizeResult<T> {
  if (rawStops.length <= 2) {
    const base = computeDaySchedule(rawStops, dayStartMinutes, hotelOrigin)
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

  const before = computeDaySchedule(rawStops, dayStartMinutes, hotelOrigin)

  const checkOutStop = rawStops.find(isCheckOutStop)
  const checkOutRank = checkOutStop ? windowSortRank(checkOutStop, null, null) : null
  const travelStop = rawStops.find(isIntercityLegCard)
  const travelRank = travelStop ? windowSortRank(travelStop, checkOutRank, null) : null
  const rankOf = (s: StopData) => windowSortRank(s, checkOutRank, travelRank)

  const anchors = rawStops.filter(isAnchor).sort((a, b) => rankOf(a) - rankOf(b))
  const flexible = rawStops.filter((s) => !isAnchor(s))

  const hotelAnchor =
    hotelOrigin && hasCoords(hotelOrigin)
      ? ({ lat: hotelOrigin.lat, lng: hotelOrigin.lng, transportMode: 'transit' } as unknown as T)
      : null

  let ordered: T[]
  if (anchors.length === 0) {
    ordered = nearestNeighborAndTwoOpt(flexible, hotelAnchor, null)
  } else {
    const buckets: T[][] = Array.from({ length: anchors.length + 1 }, () => [])
    for (const stop of flexible) {
      const rank = rankOf(stop)
      let idx = anchors.findIndex((a) => rankOf(a) > rank)
      // Never squeeze flexible activities between a Check out anchor and its paired Travel card
      if (idx > 0 && isIntercityLegCard(anchors[idx]) && isCheckOutStop(anchors[idx - 1])) {
        idx = idx + 1 >= anchors.length ? -1 : idx + 1
      }
      if (idx === -1) buckets[anchors.length].push(stop)
      else buckets[idx].push(stop)
    }

    ordered = []
    for (let i = 0; i < anchors.length; i++) {
      const prevAnchor = i > 0 ? anchors[i - 1] : hotelAnchor
      const nextAnchor = anchors[i]
      const seg = nearestNeighborAndTwoOpt(buckets[i], prevAnchor, nextAnchor)
      ordered.push(...seg, nextAnchor)
    }
    const tail = nearestNeighborAndTwoOpt(buckets[anchors.length], anchors[anchors.length - 1], null)
    ordered.push(...tail)
  }

  const after = computeDaySchedule(ordered, dayStartMinutes, hotelOrigin)
  const finalStops = after.items.map((item, idx) => {
    const isTransitBogusMidnight =
      isIntercityLegCard(item.stop) && parseTimeToMinutes(item.stop.startTime) === 0
    return {
      ...item.stop,
      orderIndex: idx,
      ...(isTransitBogusMidnight ? { fixedTime: false } : {}),
      startTime:
        item.stop.fixedTime && !isTransitBogusMidnight ? item.stop.startTime : item.startTime,
      travelMinutesFromPrev: item.travelMinutesFromPrev,
      travelDistanceKmFromPrev: item.travelDistanceKmFromPrev,
    }
  })

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

export interface DestinationDaySpan {
  index: number
  startDay: number
  days: number
}

export function recommendIntercityTransport(
  prev: { lat?: number; lng?: number } | null,
  curr: { lat?: number; lng?: number },
): IntercityTransport {
  if (!prev) return 'none'
  if (!hasCoords(prev) || !hasCoords(curr)) return 'train'
  const km = haversineKm(prev, curr)
  if (km < 35) return 'drive'
  if (km < 220) return 'train'
  if (km <= 680) return 'bullet_train'
  return 'flight'
}

export function estimateIntercityTransit(
  prev: { lat?: number; lng?: number } | null,
  curr: { lat?: number; lng?: number },
  overrideMode?: IntercityTransport,
): { mode: IntercityTransport; hours: number } {
  if (!prev) return { mode: 'none', hours: 0 }
  const autoMode = recommendIntercityTransport(prev, curr)
  const mode: IntercityTransport =
    overrideMode && overrideMode !== 'none' ? overrideMode : autoMode

  if (!hasCoords(prev) || !hasCoords(curr)) {
    const fallbackHours =
      mode === 'bullet_train' ? 2.5 : mode === 'flight' ? 3.5 : mode === 'drive' ? 4 : 3
    return { mode, hours: fallbackHours }
  }

  const km = haversineKm(prev, curr)
  let hours: number
  switch (mode) {
    case 'bullet_train':
      hours = Math.max(0.8, Math.round(((km * 1.15) / 230 + 0.5) * 10) / 10)
      break
    case 'train':
      if (km < 110) {
        hours = Math.max(0.6, Math.round(((km * 1.25) / 60 + 0.4) * 10) / 10)
      } else {
        hours = Math.max(0.8, Math.round(((km * 1.2) / 95 + 0.35) * 10) / 10)
      }
      break
    case 'drive':
      hours = Math.max(0.4, Math.round(((km * 1.25) / 78 + 0.25) * 10) / 10)
      break
    case 'bus':
      hours = Math.max(0.7, Math.round(((km * 1.25) / 65 + 0.4) * 10) / 10)
      break
    case 'ferry':
      hours = Math.max(0.8, Math.round(((km * 1.15) / 35 + 0.75) * 10) / 10)
      break
    case 'flight':
      hours = Math.min(18, Math.max(2.5, Math.round((km / 750 + 2.8) * 10) / 10))
      break
    default:
      hours = Math.max(1, Math.round((km / 100) * 10) / 10)
  }

  return { mode, hours }
}

/**
 * Shared day-span allocator computing start day and stay duration per destination
 * from explicit arrival dates or proportional spacing across totalDays.
 */
export function computeDestinationDaySpans(
  totalDays: number,
  locations: Array<{ arrivalDate?: string; departureDate?: string }>,
  tripStartDate?: string,
): DestinationDaySpan[] {
  const count = locations.length
  const safeTotal = Math.max(1, Math.round(totalDays))
  if (count === 0) return []

  const effectiveStart = resolveEffectiveTripStartDate(
    tripStartDate,
    locations.map((l) => ({ arrivalDate: l.arrivalDate })),
  )
  const hasAnyArrival = Boolean(effectiveStart && locations.some((l) => Boolean(l.arrivalDate)))

  if (hasAnyArrival && effectiveStart) {
    const startDays = new Array<number>(count).fill(1)
    for (let i = 1; i < count; i++) {
      const prevStart = startDays[i - 1]
      const arr = locations[i].arrivalDate
      const explicitDay = arr ? diffDaysInclusive(effectiveStart, arr) : 0
      const fallbackDay = Math.min(
        safeTotal,
        prevStart + Math.max(1, Math.floor((safeTotal - prevStart + 1) / (count - i + 1))),
      )
      startDays[i] =
        explicitDay > prevStart && explicitDay <= safeTotal
          ? explicitDay
          : Math.min(safeTotal, Math.max(prevStart + 1, fallbackDay))
    }

    return startDays.map((startDay, i) => {
      const nextStart = i < count - 1 ? startDays[i + 1] : safeTotal + 1
      return {
        index: i,
        startDay,
        days: Math.max(1, nextStart - startDay),
      }
    })
  }

  const baseDays = new Array<number>(count).fill(1)
  let remaining = Math.max(0, safeTotal - count)
  let idx = 0
  while (remaining > 0) {
    baseDays[idx % count]++
    remaining--
    idx++
  }

  const spans: DestinationDaySpan[] = []
  let cursor = 1
  for (let i = 0; i < count; i++) {
    const days = safeTotal >= count ? baseDays[i] : 1
    spans.push({ index: i, startDay: cursor, days })
    cursor += days
  }
  return spans
}

export interface MapHotelInput {
  name: string
  lat: number
  lng: number
}

export interface MapHotelPoint extends MapHotelInput {
  id: string
  role: 'base' | 'checkout' | 'checkin'
}

export interface DayMapGeometry {
  hotels: MapHotelPoint[]
  routePoints: Array<[number, number]>
  boundsPoints: Array<[number, number]>
}

export function stopInvolvesHotel(stop: Pick<StopData, 'category' | 'title'>): boolean {
  if (stop.category === 'lodging') return true
  return /^\s*(check\s*(in|out)|hotel|lodging|stay\b)/i.test(stop.title)
}

export function isCheckInOrOutStop(stop: Pick<StopData, 'category' | 'title'>): boolean {
  return stop.category === 'lodging' && /^\s*check\s*(in|out)\b/i.test(stop.title)
}

export function hotelPointFromDestination(
  dest?: (DestinationData & { id?: string }) | null,
): MapHotelInput | null {
  if (!dest) return null
  const lat = dest.lodgingLat ?? dest.lat
  const lng = dest.lodgingLng ?? dest.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }
  return {
    name: dest.lodgingName?.trim() || `${dest.name} Stay`,
    lat,
    lng,
  }
}

/**
 * Single source of truth for which hotel pin(s) are plotted on AtlasMap for a day.
 * Used identically by the UI workspace and the AI concierge context/tools.
 */
export function resolveActiveDayHotels(
  dayNumber: number,
  totalDays: number,
  startDate: string | undefined,
  destinations: Array<DestinationData & { id?: string }>,
): { startHotel: MapHotelInput | null; endHotel: MapHotelInput | null } {
  const startDateRef = resolveEffectiveTripStartDate(startDate, destinations)
  const ctx = resolveDayContext(dayNumber, totalDays, startDateRef, destinations)
  const startDest = ctx.isLocationChange ? ctx.previousDestination ?? ctx.destination : ctx.destination
  const endDest = ctx.destination ?? ctx.previousDestination
  return {
    startHotel: hotelPointFromDestination(startDest),
    endHotel: hotelPointFromDestination(endDest),
  }
}

function sameGeoPoint(a: MapHotelInput, b: MapHotelInput): boolean {
  return (
    Math.abs(a.lat - b.lat) < 0.0005 &&
    Math.abs(a.lng - b.lng) < 0.0005 &&
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
  )
}

/**
 * Builds day hotel pin(s) and polyline connecting the first & final activity items
 * to the hotel unless the stop itself involves the hotel (Check out / Check in / lodging).
 */
export function buildDayMapGeometry(
  geoStops: Array<Pick<StopData, 'category' | 'title'> & { lat: number; lng: number }>,
  startHotel?: MapHotelInput | null,
  endHotel?: MapHotelInput | null,
): DayMapGeometry {
  const effectiveStart = startHotel ?? endHotel ?? null
  const effectiveEnd = endHotel ?? startHotel ?? null

  const hotels: MapHotelPoint[] = []
  if (effectiveStart && effectiveEnd && !sameGeoPoint(effectiveStart, effectiveEnd)) {
    hotels.push({ ...effectiveStart, id: 'hotel-checkout', role: 'checkout' })
    hotels.push({ ...effectiveEnd, id: 'hotel-checkin', role: 'checkin' })
  } else if (effectiveStart) {
    hotels.push({ ...effectiveStart, id: 'hotel-base', role: 'base' })
  }

  const routePoints: Array<[number, number]> = []
  if (geoStops.length > 0) {
    const first = geoStops[0]
    const last = geoStops[geoStops.length - 1]
    if (effectiveStart && !stopInvolvesHotel(first)) {
      routePoints.push([effectiveStart.lat, effectiveStart.lng])
    }
    for (const s of geoStops) {
      routePoints.push([s.lat, s.lng])
    }
    if (effectiveEnd && !stopInvolvesHotel(last)) {
      routePoints.push([effectiveEnd.lat, effectiveEnd.lng])
    }
  }

  const boundsPoints: Array<[number, number]> = [
    ...geoStops.map((s) => [s.lat, s.lng] as [number, number]),
    ...hotels.map((h) => [h.lat, h.lng] as [number, number]),
  ]

  return { hotels, routePoints, boundsPoints }
}
