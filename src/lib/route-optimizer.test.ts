import { describe, expect, it } from 'vitest'
import {
  buildDayMapGeometry,
  computeDaySchedule,
  computeDestinationDaySpans,
  estimateIntercityTransit,
  estimateLegTravel,
  optimizeDayRoute,
  reconcileTripDatesAndDays,
  resolveActiveDayHotels,
  resolveDayContext,
  stopInvolvesHotel,
} from './route-optimizer'
import type { DestinationData, StopData } from './trip-types'

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

  it('computes first leg travel from hotelOrigin when coordinates exist', () => {
    const stops: StopData[] = [
      makeStop({
        title: 'Arashiyama Bamboo Grove',
        lat: 35.0171,
        lng: 135.6713,
        transportMode: 'transit',
      }),
    ]
    const hotelOrigin = {
      name: 'Kyoto Station Hotel',
      lat: 34.9858,
      lng: 135.7588,
    }
    const schedule = computeDaySchedule(stops, 9 * 60, hotelOrigin)
    expect(schedule.items[0].fromHotelOrigin).toBe(true)
    expect(schedule.items[0].travelMinutesFromPrev).toBeGreaterThan(10)
    expect(schedule.items[0].startMinutes).toBeGreaterThan(9 * 60)
    expect(schedule.totalTravelMinutes).toBe(schedule.items[0].travelMinutesFromPrev)
  })

  it('resolves calendar dates and detects location/hotel transition days', () => {
    const destinations: Array<DestinationData & { id?: string }> = [
      {
        id: 'd1',
        tripId: 't1',
        name: 'Kyoto',
        orderIndex: 0,
        arrivalDate: '2026-05-01',
        departureDate: '2026-05-03',
        lodgingName: 'Ace Hotel Kyoto',
        checkOutTime: '10:00',
      },
      {
        id: 'd2',
        tripId: 't1',
        name: 'Osaka',
        orderIndex: 1,
        arrivalDate: '2026-05-03',
        departureDate: '2026-05-05',
        lodgingName: 'Cross Hotel Osaka',
        checkInTime: '15:00',
      },
    ]

    const day1 = resolveDayContext(1, 5, '2026-05-01', destinations)
    expect(day1.isoDate).toBe('2026-05-01')
    expect(day1.shortDateLabel).toContain('May')
    expect(day1.isLocationChange).toBe(false)
    expect(day1.isHotelChange).toBe(false)
    expect(day1.destination?.name).toBe('Kyoto')

    const day3 = resolveDayContext(3, 5, '2026-05-01', destinations)
    expect(day3.isoDate).toBe('2026-05-03')
    expect(day3.destination?.name).toBe('Osaka')
    expect(day3.previousDestination?.name).toBe('Kyoto')
    expect(day3.isLocationChange).toBe(true)
    expect(day3.isHotelChange).toBe(true)
  })

  it('avoids double-counting transit before transit cards and lets mode override recompute card duration', () => {
    const osakaCheckout = makeStop({
      title: 'Check out: Osaka Stay',
      category: 'lodging',
      lat: 34.6937,
      lng: 135.5015,
      fixedTime: true,
      startTime: '10:00',
      durationMinutes: 20,
    })
    const tokyoTransitCard = makeStop({
      title: 'Travel: Osaka → Tokyo',
      category: 'transit',
      lat: 35.6762,
      lng: 139.6503,
      transportMode: 'bullet_train',
      durationMinutes: 147,
    })
    const tokyoCheckin = makeStop({
      title: 'Check in: Tokyo Stay',
      category: 'lodging',
      lat: 35.6762,
      lng: 139.6503,
      fixedTime: true,
      startTime: '15:00',
      durationMinutes: 25,
    })

    const autoSched = computeDaySchedule([osakaCheckout, tokyoTransitCard, tokyoCheckin], 9 * 60)
    // Includes realistic ~15m hotel -> departure station transfer without double-counting the 400km corridor
    expect(autoSched.items[1].travelMinutesFromPrev).toBe(15)
    expect(autoSched.items[1].startTime).toBe('10:35')
    expect(autoSched.items[1].endTime).toBe('13:02')
    expect(autoSched.items[1].effectiveTransportMode).toBe('bullet_train')
    expect(autoSched.totalTravelMinutes).toBe(15 + 147)

    const driveOverrideSched = computeDaySchedule(
      [
        osakaCheckout,
        {
          ...tokyoTransitCard,
          transportMode: 'drive',
          transportOverridden: true,
        },
        tokyoCheckin,
      ],
      9 * 60,
    )
    expect(driveOverrideSched.items[1].travelMinutesFromPrev).toBe(0)
    expect(driveOverrideSched.items[1].effectiveTransportMode).toBe('drive')
    expect(driveOverrideSched.totalTravelMinutes).toBeGreaterThan(350)
  })

  it('keeps Check out -> Travel in position and ignores bogus 00:00 when AI fills and optimizes the day', () => {
    const checkOut = makeStop({
      title: 'Check out: Osaka Stay',
      category: 'lodging',
      lat: 34.6937,
      lng: 135.5015,
      fixedTime: true,
      startTime: '10:00',
      durationMinutes: 20,
    })
    const travelCard = makeStop({
      title: 'Travel: Osaka → Tokyo',
      category: 'transit',
      lat: 35.6762,
      lng: 139.6503,
      transportMode: 'bullet_train',
      durationMinutes: 147,
      preferredWindow: 'morning',
      fixedTime: true,
      startTime: '00:00',
    })
    const checkIn = makeStop({
      title: 'Check in: Tokyo Stay',
      category: 'lodging',
      lat: 35.6762,
      lng: 139.6503,
      fixedTime: true,
      startTime: '15:00',
      durationMinutes: 25,
    })
    const sunriseStop = makeStop({
      title: 'Osaka Castle Sunrise Spot',
      category: 'photo_spot',
      lat: 34.6873,
      lng: 135.5262,
      preferredWindow: 'sunrise',
      durationMinutes: 45,
    })
    const eveningSpot = makeStop({
      title: 'Shibuya Sky Golden Hour',
      category: 'photo_spot',
      lat: 35.6584,
      lng: 139.7022,
      preferredWindow: 'golden_hour',
      durationMinutes: 60,
    })

    const opt = optimizeDayRoute([travelCard, eveningSpot, sunriseStop, checkIn, checkOut], 9 * 60)
    const titles = opt.stops.map((s) => s.title)
    const coIdx = titles.indexOf('Check out: Osaka Stay')
    const trIdx = titles.indexOf('Travel: Osaka → Tokyo')
    const ciIdx = titles.indexOf('Check in: Tokyo Stay')

    expect(coIdx).toBeGreaterThan(titles.indexOf('Osaka Castle Sunrise Spot'))
    expect(trIdx).toBe(coIdx + 1)
    expect(ciIdx).toBeGreaterThan(trIdx)
    expect(opt.stops[trIdx].startTime).toBe('10:35')
    expect(opt.stops[trIdx].startTime).not.toBe('00:00')
  })

  it('keeps travel time before regular transit hubs like train stations while skipping before Travel: cards', () => {
    const hotelCheckout = makeStop({
      title: 'Check out: Ace Hotel Kyoto',
      category: 'lodging',
      lat: 35.0085,
      lng: 135.7595,
      fixedTime: true,
      startTime: '10:00',
      durationMinutes: 20,
    })
    const kyotoStation = makeStop({
      title: 'Kyoto Station Shinkansen Platform',
      category: 'transit',
      lat: 34.9858,
      lng: 135.7588,
      durationMinutes: 20,
      transportMode: 'transit',
    })
    const sched = computeDaySchedule([hotelCheckout, kyotoStation], 9 * 60)
    expect(sched.items[1].travelMinutesFromPrev).toBeGreaterThan(5)
    expect(sched.items[1].travelDistanceKmFromPrev).toBeGreaterThan(1)
  })

  it('connects first and final activities to the hotel unless stops involve the hotel itself', () => {
    const kyotoHotel = { name: 'Ace Hotel Kyoto', lat: 35.0085, lng: 135.7595 }
    const osakaHotel = { name: 'Cross Hotel Osaka', lat: 34.6697, lng: 135.5008 }

    // Regular day: Activity 1 -> Activity 2 connects Hotel -> A1 -> A2 -> Hotel
    const a1 = makeStop({ title: 'Kiyomizu-dera', lat: 34.9949, lng: 135.785, category: 'must_see' })
    const a2 = makeStop({ title: 'Gion Dinner', lat: 35.0037, lng: 135.7785, category: 'restaurant' })
    const normalGeom = buildDayMapGeometry(
      [a1 as typeof a1 & { lat: number; lng: number }, a2 as typeof a2 & { lat: number; lng: number }],
      kyotoHotel,
      kyotoHotel,
    )
    expect(normalGeom.hotels).toHaveLength(1)
    expect(normalGeom.routePoints).toEqual([
      [kyotoHotel.lat, kyotoHotel.lng],
      [a1.lat, a1.lng],
      [a2.lat, a2.lng],
      [kyotoHotel.lat, kyotoHotel.lng],
    ])

    // Moving day: Check out (hotel) -> Travel -> Check in (hotel) keeps both hotels plotted, no extra hotel tail
    const checkout = makeStop({ title: 'Check out: Ace Hotel Kyoto', lat: kyotoHotel.lat, lng: kyotoHotel.lng, category: 'lodging' })
    const travel = makeStop({ title: 'Travel: Kyoto → Osaka', lat: osakaHotel.lat, lng: osakaHotel.lng, category: 'transit' })
    const checkin = makeStop({ title: 'Check in: Cross Hotel Osaka', lat: osakaHotel.lat, lng: osakaHotel.lng, category: 'lodging' })
    expect(stopInvolvesHotel(checkout)).toBe(true)
    expect(stopInvolvesHotel(a1)).toBe(false)

    const moveGeom = buildDayMapGeometry(
      [
        checkout as typeof checkout & { lat: number; lng: number },
        travel as typeof travel & { lat: number; lng: number },
        checkin as typeof checkin & { lat: number; lng: number },
      ],
      kyotoHotel,
      osakaHotel,
    )
    expect(moveGeom.hotels).toHaveLength(2)
    expect(moveGeom.routePoints).toEqual([
      [checkout.lat, checkout.lng],
      [travel.lat, travel.lng],
      [checkin.lat, checkin.lng],
    ])
  })

  it('reconciles inclusive trip date spans and estimates metro-crossing rail transit around ~1.5h for Kamakura to northern Tokyo', () => {
    expect(
      reconcileTripDatesAndDays({
        startDate: '2026-12-17',
        endDate: '2026-12-29',
        totalDays: 12,
      }),
    ).toEqual({
      startDate: '2026-12-17',
      endDate: '2026-12-29',
      totalDays: 13,
    })

    expect(
      reconcileTripDatesAndDays({
        startDate: '2026-12-17',
        endDate: '2026-12-29',
        totalDays: 12,
        preferTotalDays: true,
      }),
    ).toEqual({
      startDate: '2026-12-17',
      endDate: '2026-12-28',
      totalDays: 12,
    })

    const kamakuraToNorthTokyo = estimateLegTravel(
      { lat: 35.3192, lng: 139.5467 },
      { lat: 35.7698, lng: 139.7683 },
      'transit',
    )
    expect(kamakuraToNorthTokyo.minutes).toBeGreaterThanOrEqual(85)
    expect(kamakuraToNorthTokyo.minutes).toBeLessThanOrEqual(105)

    // Intercity mode selection & regional rail speed match
    const osaka = { lat: 34.6937, lng: 135.5015 }
    const tokyo = { lat: 35.6762, lng: 139.6503 }
    const shinkansen = estimateIntercityTransit(osaka, tokyo)
    expect(shinkansen.mode).toBe('bullet_train')
    expect(shinkansen.hours).toBeLessThan(3)
    const driveLeg = estimateIntercityTransit(osaka, tokyo, 'drive')
    expect(driveLeg.mode).toBe('drive')
    expect(driveLeg.hours).toBeGreaterThan(shinkansen.hours * 2)

    const kamakuraIntercity = estimateIntercityTransit(
      { lat: 35.3192, lng: 139.5467 },
      { lat: 35.7698, lng: 139.7683 },
    )
    expect(kamakuraIntercity.mode).toBe('train')
    expect(kamakuraIntercity.hours).toBeGreaterThanOrEqual(1.4)

    // Date-aligned destination spans for multi-city itinerary
    const spans = computeDestinationDaySpans(
      13,
      [
        { arrivalDate: '2026-12-17', departureDate: '2026-12-19' },
        { arrivalDate: '2026-12-19', departureDate: '2026-12-22' },
        { arrivalDate: '2026-12-22', departureDate: '2026-12-25' },
        { arrivalDate: '2026-12-25', departureDate: '2026-12-29' },
      ],
      '2026-12-17',
    )
    expect(spans).toEqual([
      { index: 0, startDay: 1, days: 2 },
      { index: 1, startDay: 3, days: 3 },
      { index: 2, startDay: 6, days: 3 },
      { index: 3, startDay: 9, days: 5 },
    ])
  })

  it('resolveActiveDayHotels returns lodgingLat/lodgingLng even when trip.startDate is omitted', () => {
    const dests: DestinationData[] = [
      {
        tripId: 't1',
        name: 'Osaka',
        orderIndex: 0,
        lat: 34.6937,
        lng: 135.5023,
        arrivalDate: '2026-12-17',
        departureDate: '2026-12-19',
        lodgingName: 'Cross Hotel Osaka',
        lodgingLat: 34.6701,
        lodgingLng: 135.5011,
      },
      {
        tripId: 't1',
        name: 'Tokyo',
        orderIndex: 1,
        lat: 35.6762,
        lng: 139.6503,
        arrivalDate: '2026-12-19',
        departureDate: '2026-12-22',
        lodgingName: 'Kita-Tokyo Stay',
        lodgingLat: 35.7745,
        lodgingLng: 139.7568,
      },
    ]

    // Day 3 (2026-12-19) is moving day Osaka -> Tokyo
    const moveDay = resolveActiveDayHotels(3, 6, undefined, dests)
    expect(moveDay.startHotel).toEqual({ name: 'Cross Hotel Osaka', lat: 34.6701, lng: 135.5011 })
    expect(moveDay.endHotel).toEqual({ name: 'Kita-Tokyo Stay', lat: 35.7745, lng: 139.7568 })

    // Day 4 stays at Kita-Tokyo hotel (northern Tokyo, NOT Tokyo city centroid 35.6762)
    const tokyoDay = resolveActiveDayHotels(4, 6, undefined, dests)
    expect(tokyoDay.startHotel).toEqual({ name: 'Kita-Tokyo Stay', lat: 35.7745, lng: 139.7568 })
    expect(tokyoDay.endHotel).toEqual({ name: 'Kita-Tokyo Stay', lat: 35.7745, lng: 139.7568 })
  })

  it('orders Luggage drop-off immediately after Travel and slots pre-check-in activities before Check in', () => {
    const checkOut = makeStop({
      title: 'Check out: Kyoto Hotel',
      category: 'lodging',
      lat: 35.0116,
      lng: 135.7681,
      fixedTime: true,
      startTime: '10:00',
      durationMinutes: 20,
    })
    const travel = makeStop({
      title: 'Travel: Kyoto → Osaka',
      category: 'transit',
      lat: 34.6701,
      lng: 135.5011,
      transportMode: 'transit',
      durationMinutes: 40,
      preferredWindow: 'morning',
    })
    const bagDrop = makeStop({
      title: 'Luggage drop-off at Osaka Hotel',
      category: 'lodging',
      lat: 34.6701,
      lng: 135.5011,
      durationMinutes: 20,
    })
    const preCheckinLunch = makeStop({
      title: 'Kuromon Market Lunch',
      category: 'restaurant',
      lat: 34.6654,
      lng: 135.5065,
      preferredWindow: 'lunch',
      durationMinutes: 60,
    })
    const checkIn = makeStop({
      title: 'Check in: Osaka Hotel',
      category: 'lodging',
      lat: 34.6701,
      lng: 135.5011,
      fixedTime: true,
      startTime: '15:00',
      durationMinutes: 25,
    })

    const opt = optimizeDayRoute([checkIn, preCheckinLunch, bagDrop, checkOut, travel], 9 * 60)
    expect(opt.stops.map((s) => s.title)).toEqual([
      'Check out: Kyoto Hotel',
      'Travel: Kyoto → Osaka',
      'Luggage drop-off at Osaka Hotel',
      'Kuromon Market Lunch',
      'Check in: Osaka Hotel',
    ])
  })
})
