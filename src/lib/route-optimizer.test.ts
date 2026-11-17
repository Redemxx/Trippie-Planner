import { describe, expect, it } from 'vitest'
import { computeDaySchedule, estimateLegTravel, optimizeDayRoute } from './route-optimizer'
import type { StopData } from './trip-types'

function makeStop(partial: Partial<StopData> & { title: string; lat: number; lng: number }): StopData {
  return {
    tripId: 't1',
    dayNumber: 1,
    orderIndex: 0,
    category: 'must_see',
    durationMinutes: 60,
    transportMode: 'walk',
    ...partial,
  }
}

describe('route-optimizer', () => {
  it('estimates shorter walk time for nearby points than distant transit', () => {
    const near = estimateLegTravel(
      { lat: 34.9949, lng: 135.785 },
      { lat: 34.9985, lng: 135.7793 },
      'walk',
    )
    const far = estimateLegTravel(
      { lat: 34.9949, lng: 135.785 },
      { lat: 35.0171, lng: 135.6713 },
      'transit',
    )
    expect(near.minutes).toBeLessThan(20)
    expect(far.minutes).toBeGreaterThan(near.minutes)
    expect(far.distanceKm).toBeGreaterThan(8)
  })

  it('reduces travel time on a zigzagged day while preserving fixed anchors', () => {
    // East -> West -> East -> West zigzag
    const stops: StopData[] = [
      makeStop({ title: 'Dawn Overlook', lat: 35.0, lng: 135.78, preferredWindow: 'sunrise' }),
      makeStop({ title: 'Far West Garden', lat: 35.02, lng: 135.67, orderIndex: 1 }),
      makeStop({ title: 'East Shrine', lat: 34.998, lng: 135.782, orderIndex: 2 }),
      makeStop({ title: 'West Temple', lat: 35.015, lng: 135.675, orderIndex: 3 }),
      makeStop({
        title: 'Sunset Ridge',
        lat: 34.967,
        lng: 135.772,
        orderIndex: 4,
        preferredWindow: 'golden_hour',
      }),
    ]

    const result = optimizeDayRoute(stops, 6 * 60 + 30)
    expect(result.stops[0].title).toBe('Dawn Overlook')
    expect(result.stops[result.stops.length - 1].title).toBe('Sunset Ridge')
    expect(result.afterTravelMinutes).toBeLessThan(result.beforeTravelMinutes)
    expect(result.minutesSaved).toBeGreaterThan(0)
  })

  it('flags tight transitions when fixed reservations conflict with travel', () => {
    const stops: StopData[] = [
      makeStop({
        title: 'Morning Start',
        lat: 35.0,
        lng: 135.78,
        durationMinutes: 120,
      }),
      makeStop({
        title: 'Far Fixed Lunch',
        lat: 35.02,
        lng: 135.67,
        fixedTime: true,
        startTime: '10:00',
        transportMode: 'walk',
      }),
    ]
    const schedule = computeDaySchedule(stops, 9 * 60)
    expect(schedule.warnings.some((w) => w.type === 'tight_transition')).toBe(true)
  })
})
