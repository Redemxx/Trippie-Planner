import { haversineKm, hasCoords } from './route-optimizer'
import type {
  IntercityTransport,
  OverviewAllocation,
  OverviewData,
  OverviewDayBlock,
  TripPace,
} from './trip-types'

export interface OverviewLocationInput {
  name: string
  country?: string
  lat?: number
  lng?: number
}

const PACE_CAPACITY: Record<TripPace, { stopsPerDay: number; minBaseDays: number }> = {
  relaxed: { stopsPerDay: 3, minBaseDays: 3 },
  balanced: { stopsPerDay: 4, minBaseDays: 2 },
  packed: { stopsPerDay: 6, minBaseDays: 1 },
}

function estimateIntercityTransit(
  prev: OverviewLocationInput | null,
  curr: OverviewLocationInput,
): { mode: IntercityTransport; hours: number } {
  if (!prev) return { mode: 'none', hours: 0 }
  if (!hasCoords(prev) || !hasCoords(curr)) {
    return { mode: 'train', hours: 3 }
  }
  const km = haversineKm(prev, curr)
  if (km < 40) return { mode: 'drive', hours: 1 }
  if (km < 260) return { mode: 'train', hours: Math.max(1.5, Math.round((km / 100) * 10) / 10) }
  if (km < 650) return { mode: 'train', hours: Math.max(2.5, Math.round((km / 140) * 10) / 10) }
  // Long-haul flight including airport transfer + security overhead
  const flightHours = Math.round((km / 750 + 3) * 10) / 10
  return { mode: 'flight', hours: Math.min(16, flightHours) }
}

/**
 * Generates a generalized, feasibility-checked broad overview blueprint
 * telling travelers how long to stay at each location and how much they can
 * reasonably accomplish within their timeframe.
 */
export function buildBaselineOverview(params: {
  tripId: string
  locations: OverviewLocationInput[]
  totalDays: number
  pace?: TripPace
  interests?: string[]
}): OverviewData {
  const pace = params.pace ?? 'balanced'
  const locations = params.locations.filter((l) => l.name.trim().length > 0)
  const totalDays = Math.max(1, Math.round(params.totalDays))
  const capacity = PACE_CAPACITY[pace]

  if (locations.length === 0) {
    return {
      tripId: params.tripId,
      feasibilityStatus: 'comfortable',
      feasibilityScore: 100,
      totalTransitHours: 0,
      summary: 'Add candidate locations to compute stay durations and feasibility.',
      allocations: [],
      dailyOutline: [],
    }
  }

  // Estimate intercity transit legs
  const legs = locations.map((loc, i) =>
    estimateIntercityTransit(i > 0 ? locations[i - 1] : null, loc),
  )
  const totalTransitHours = Math.round(legs.reduce((sum, l) => sum + l.hours, 0) * 10) / 10
  const transitDaysLost = totalTransitHours / 8

  // Distribute integer days proportionally (every stop gets at least 1 day when possible)
  const baseDays = new Array<number>(locations.length).fill(1)
  let remaining = Math.max(0, totalDays - locations.length)
  let idx = 0
  while (remaining > 0) {
    baseDays[idx % locations.length]++
    remaining--
    idx++
  }

  const minRecommendedTotal = locations.length * capacity.minBaseDays + Math.ceil(transitDaysLost * 0.6)
  const effectiveExplorationDays = Math.max(0.5, totalDays - transitDaysLost)
  const ratio = effectiveExplorationDays / Math.max(1, locations.length * capacity.minBaseDays)

  let feasibilityStatus: OverviewData['feasibilityStatus']
  let feasibilityScore: number
  if (totalDays < locations.length || ratio < 0.75) {
    feasibilityStatus = 'overpacked'
    feasibilityScore = Math.max(25, Math.min(54, Math.round(ratio * 60)))
  } else if (ratio < 1.1) {
    feasibilityStatus = 'ambitious'
    feasibilityScore = Math.max(55, Math.min(78, Math.round(55 + (ratio - 0.75) * 65)))
  } else {
    feasibilityStatus = 'comfortable'
    feasibilityScore = Math.max(80, Math.min(98, Math.round(78 + (ratio - 1.1) * 20)))
  }

  const interestsLabel = params.interests?.length
    ? params.interests.slice(0, 3).join(', ')
    : 'sightseeing, local food, and scenic photography'

  const allocations: OverviewAllocation[] = locations.map((loc, i) => {
    const leg = legs[i]
    const assigned = totalDays >= locations.length ? baseDays[i] : 1
    const minDays = capacity.minBaseDays
    const rationale =
      assigned >= minDays + 1
        ? `Allows ${capacity.stopsPerDay}–${capacity.stopsPerDay + 1} anchors/day plus a relaxed golden-hour session and nearby day trip.`
        : assigned >= minDays
          ? `Covers ${loc.name}'s core must-sees and evening dining at a ${pace} pace.`
          : `Tight window: prioritize 1–2 headline neighborhoods near your transit hub.`

    return {
      destinationName: loc.name,
      country: loc.country,
      lat: loc.lat,
      lng: loc.lng,
      recommendedDays: assigned,
      minDays,
      transitHoursFromPrev: leg.hours,
      transportMode: leg.mode,
      rationale,
      mustSeeHighlights: [
        `${loc.name} historic core & signature landmark`,
        `Neighborhood walk & local market district`,
      ],
      photoSpots: [
        `${loc.name} sunrise or golden-hour panoramic overlook`,
        `Blue-hour architectural / waterfront reflection spot`,
      ],
      dayTripIdeas: assigned >= 3 ? [`Half-day regional excursion from ${loc.name}`] : [],
    }
  })

  // Build generalized Day 1..totalDays outline
  const dailyOutline: OverviewDayBlock[] = []
  let dayCursor = 1
  for (let i = 0; i < allocations.length && dayCursor <= totalDays; i++) {
    const alloc = allocations[i]
    const daysHere = Math.min(alloc.recommendedDays, totalDays - dayCursor + 1)
    for (let d = 0; d < daysHere; d++) {
      const isArrivalLeg = i > 0 && d === 0 && alloc.transitHoursFromPrev >= 2
      dailyOutline.push({
        dayNumber: dayCursor,
        location: alloc.destinationName,
        theme: isArrivalLeg
          ? `Transit & ${alloc.destinationName} Arrival`
          : d === 0
            ? `${alloc.destinationName} Core Icons`
            : d === daysHere - 1 && daysHere >= 3
              ? `Day Trip & Hidden Gems`
              : `${alloc.destinationName} Neighborhoods & Dining`,
        morning: isArrivalLeg
          ? `Travel to ${alloc.destinationName} (~${alloc.transitHoursFromPrev}h via ${alloc.transportMode}); check in & drop bags.`
          : `Early start at flagship must-see in ${alloc.destinationName} before midday crowds.`,
        afternoon: `Explore cultural district + local lunch; focus on ${interestsLabel}.`,
        evening: `Golden-hour photo overlook followed by neighborhood dinner.`,
        photoMoment:
          d === 0
            ? `Golden hour skyline / landmark vista in ${alloc.destinationName}`
            : `Morning street light or blue-hour reflections`,
      })
      dayCursor++
    }
  }

  const summary =
    feasibilityStatus === 'overpacked'
      ? `${locations.length} destinations in ${totalDays} days is tight (~${totalTransitHours}h in transit). Consider ${minRecommendedTotal} days or trimming to ${Math.max(1, Math.floor(totalDays / capacity.minBaseDays))} stops.`
      : feasibilityStatus === 'ambitious'
        ? `${locations.length} destinations in ${totalDays} days is doable at a brisk ${pace} pace (~${totalTransitHours}h transit). Anchor mornings early to protect afternoons.`
        : `${totalDays} days fits ${locations.length} destinations comfortably with ~${totalTransitHours}h total transit, leaving room for golden-hour photography and unhurried meals.`

  return {
    tripId: params.tripId,
    feasibilityStatus,
    feasibilityScore,
    totalTransitHours,
    summary,
    allocations,
    dailyOutline,
  }
}
