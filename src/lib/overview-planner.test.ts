import { describe, expect, it } from 'vitest'
import { buildBaselineOverview } from './overview-planner'

describe('overview-planner', () => {
  it('allocates proportional days and marks comfortable pacing', () => {
    const overview = buildBaselineOverview({
      tripId: 't-overview',
      totalDays: 8,
      pace: 'balanced',
      locations: [
        { name: 'Kyoto', country: 'Japan', lat: 35.0116, lng: 135.7681 },
        { name: 'Osaka', country: 'Japan', lat: 34.6937, lng: 135.5023 },
      ],
    })
    expect(overview.feasibilityStatus).toBe('comfortable')
    expect(overview.allocations).toHaveLength(2)
    expect(overview.allocations.reduce((s, a) => s + a.recommendedDays, 0)).toBe(8)
    expect(overview.dailyOutline).toHaveLength(8)
  })

  it('flags overpacked trips when too many distant cities share too few days', () => {
    const overview = buildBaselineOverview({
      tripId: 't-tight',
      totalDays: 4,
      pace: 'relaxed',
      locations: [
        { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
        { name: 'Kyoto', lat: 35.0116, lng: 135.7681 },
        { name: 'Hiroshima', lat: 34.3853, lng: 132.4553 },
        { name: 'Sapporo', lat: 43.0618, lng: 141.3545 },
      ],
    })
    expect(overview.feasibilityStatus).toBe('overpacked')
    expect(overview.totalTransitHours).toBeGreaterThan(5)
  })
})
