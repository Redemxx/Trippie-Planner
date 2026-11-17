import type { DestinationData, OverviewData, StopData, TripData } from './trip-types'

export function itineraryToMarkdown(params: {
  trip: TripData
  destinations: DestinationData[]
  stops: StopData[]
  overview?: OverviewData | null
}): string {
  const { trip, destinations, stops, overview } = params
  const lines: string[] = []
  lines.push(`# ${trip.title}`)
  lines.push('')
  const metaParts: string[] = []
  if (trip.startDate && trip.endDate) metaParts.push(`${trip.startDate} → ${trip.endDate}`)
  else if (trip.totalDays) metaParts.push(`${trip.totalDays} days`)
  if (trip.pace) metaParts.push(`Pace: ${trip.pace}`)
  if (trip.budgetTier) metaParts.push(`Budget: ${trip.budgetTier}`)
  if (metaParts.length > 0) {
    lines.push(metaParts.join(' · '))
    lines.push('')
  }
  if (trip.summaryNotes) {
    lines.push(trip.summaryNotes)
    lines.push('')
  }

  if (destinations.length > 0) {
    lines.push('## Destinations')
    for (const d of destinations.slice().sort((a, b) => a.orderIndex - b.orderIndex)) {
      const dateStr =
        d.arrivalDate && d.departureDate ? ` (${d.arrivalDate} – ${d.departureDate})` : ''
      lines.push(`- **${d.name}**${d.country ? `, ${d.country}` : ''}${dateStr}`)
    }
    lines.push('')
  }

  if (overview && overview.allocations.length > 0) {
    lines.push(`## Broad Overview (${overview.feasibilityStatus.toUpperCase()} · ${overview.feasibilityScore}/100)`)
    lines.push(overview.summary)
    lines.push('')
    for (const alloc of overview.allocations) {
      lines.push(
        `- **${alloc.destinationName}**: ${alloc.recommendedDays} days recommended (min ${alloc.minDays}d) — ${alloc.rationale}`,
      )
    }
    lines.push('')
  }

  const byDay = new Map<number, StopData[]>()
  for (const s of stops) {
    const arr = byDay.get(s.dayNumber) ?? []
    arr.push(s)
    byDay.set(s.dayNumber, arr)
  }

  const dayNumbers = Array.from(byDay.keys()).sort((a, b) => a - b)
  if (dayNumbers.length > 0) {
    lines.push('## Daily Itinerary')
    for (const day of dayNumbers) {
      lines.push(`### Day ${day}`)
      const dayStops = (byDay.get(day) ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex)
      for (const s of dayStops) {
        const time = s.startTime ? `${s.startTime} ` : ''
        const leg =
          s.travelMinutesFromPrev && s.travelMinutesFromPrev > 0
            ? ` _(via ${s.transportMode ?? 'transit'}, ~${s.travelMinutesFromPrev} min from prev)_`
            : ''
        lines.push(`- **${time}${s.title}** [${s.category}]${leg}`)
        if (s.address) lines.push(`  - Address: ${s.address}`)
        if (s.photoTip) lines.push(`  - Photo tip (${s.bestLightWindow ?? 'any'}): ${s.photoTip}`)
        if (s.notes) lines.push(`  - Notes: ${s.notes}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
