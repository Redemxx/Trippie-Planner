import { describe, expect, it } from 'vitest'
import {
  expandAddressQueries,
  formatWeatherQuery,
  parseLocationQuery,
  pickBestGeocodeCandidate,
  resolveCountryIso,
} from './location-query'

describe('location-query', () => {
  it('parses space-separated city and country names like "Osaka Japan"', () => {
    const parsed = parseLocationQuery('Osaka Japan')
    expect(parsed.placeCore).toBe('Osaka')
    expect(parsed.countryIso).toBe('JP')
    expect(parsed.owmQueries[0]).toBe('Osaka,JP')
  })

  it('parses comma-separated multi-word countries like "New York, United States"', () => {
    const parsed = parseLocationQuery('New York, United States')
    expect(parsed.placeCore).toBe('New York')
    expect(parsed.countryIso).toBe('US')
    expect(parsed.owmQueries[0]).toBe('New York,US')
  })

  it('keeps single-token country input intact and resolves ISO aliases', () => {
    expect(resolveCountryIso('Japan')).toBe('JP')
    expect(resolveCountryIso('United Kingdom')).toBe('GB')
    expect(resolveCountryIso('jp')).toBe('JP')
    const onlyCountry = parseLocationQuery('Japan')
    expect(onlyCountry.placeCore).toBe('Japan')
  })

  it('rejects Orsk (RU) and selects Osaka (JP) from OpenWeatherMap-style candidates', () => {
    const parsed = parseLocationQuery('Osaka Japan')
    const winner = pickBestGeocodeCandidate(
      [
        {
          name: 'Orsk',
          country: 'RU',
          lat: 51.2305,
          lng: 58.4738,
          localNamesCount: 40,
        },
        {
          name: 'Osaka',
          country: 'JP',
          lat: 34.6938,
          lng: 135.5015,
          localNamesCount: 34,
        },
      ],
      parsed,
    )
    expect(winner?.name).toBe('Osaka')
    expect(winner?.country).toBe('JP')
  })

  it('rejects phonetic mismatch even when no country is supplied and prefers major city over village', () => {
    const parsed = parseLocationQuery('Osaka')
    const winner = pickBestGeocodeCandidate(
      [
        {
          name: 'Orsk',
          country: 'RU',
          lat: 51.2305,
          lng: 58.4738,
          localNamesCount: 45,
        },
        {
          name: 'Osaka',
          country: 'JP',
          lat: 35.2524,
          lng: 140.042,
          localNamesCount: 2,
        },
        {
          name: 'Osaka',
          country: 'JP',
          lat: 34.6938,
          lng: 135.5015,
          localNamesCount: 34,
        },
      ],
      parsed,
    )
    expect(winner?.lat).toBeCloseTo(34.6938, 3)
  })

  it('rejects hotel or stop candidates beyond maxDistanceKm from city bias', () => {
    const parsed = parseLocationQuery('Cross Hotel', 'Japan')
    const winner = pickBestGeocodeCandidate(
      [
        {
          name: 'Cross Hotel',
          country: 'JP',
          lat: 43.0621,
          lng: 141.3544, // Sapporo (~1050 km from Osaka)
        },
      ],
      parsed,
      { near: { lat: 34.6938, lng: 135.5015 }, maxDistanceKm: 120 },
    )
    expect(winner).toBeNull()
  })

  it('formats OWM weather queries cleanly for "Osaka Japan"', () => {
    expect(formatWeatherQuery('Osaka Japan')).toBe('Osaka,JP')
    expect(formatWeatherQuery('Kyoto', 'Japan')).toBe('Kyoto,JP')
    expect(formatWeatherQuery('Lisbon')).toBe('Lisbon')
  })

  it('preserves native POI relevance rank over closer city-center fallback hits', () => {
    const parsed = parseLocationQuery('Park Hyatt Tokyo, Tokyo', 'JP')
    const winner = pickBestGeocodeCandidate(
      [
        {
          name: 'パーク ハイアット 東京',
          displayName: 'パーク ハイアット 東京 西新宿 新宿区 東京都',
          country: 'JP',
          lat: 35.6851,
          lng: 139.6909, // 7 km from Tokyo city center
        },
        {
          name: '東京都',
          displayName: '東京都 千代田区',
          country: 'JP',
          lat: 35.6762,
          lng: 139.6503, // Closer to bias center
        },
      ],
      parsed,
      { near: { lat: 35.6762, lng: 139.6503 }, maxDistanceKm: 150, allowLooseSimilarity: true },
    )
    expect(winner?.lat).toBeCloseTo(35.6851, 3)
    expect(winner?.lng).toBeCloseTo(139.6909, 3)
  })

  it('rejects unrelated hotels/highways & prefers exact distinctive venue + address matches', () => {
    const regisParsed = parseLocationQuery('St. Regis Osaka, Osaka', 'JP')
    expect(
      pickBestGeocodeCandidate(
        [
          {
            name: 'Grand Regis',
            displayName: 'Grand Regis 今里筋 大阪市',
            country: 'JP',
            city: '大阪市',
            lat: 34.6696,
            lng: 135.5427,
          },
        ],
        regisParsed,
        {
          near: { lat: 34.6937, lng: 135.5023 },
          maxDistanceKm: 45,
          allowLooseSimilarity: true,
          cityBias: 'Osaka',
          preferSpecificPoi: true,
        },
      ),
    ).toBeNull()

    const addrParsed = parseLocationQuery('3-21-3 Shibuya, Tokyo', 'JP')
    expect(
      pickBestGeocodeCandidate(
        [
          {
            name: '首都高速3号渋谷線',
            country: 'JP',
            placeType: 'motorway',
            lat: 35.656,
            lng: 139.6967,
          },
        ],
        addrParsed,
        {
          near: { lat: 35.6762, lng: 139.6503 },
          maxDistanceKm: 45,
          allowLooseSimilarity: true,
          cityBias: 'Tokyo',
          preferSpecificPoi: true,
        },
      ),
    ).toBeNull()

    const excelParsed = parseLocationQuery('Shibuya Stream Excel Hotel Tokyu, Tokyo', 'JP')
    const excelWinner = pickBestGeocodeCandidate(
      [
        {
          name: 'Shibuya Excel Hotel Tokyu',
          displayName: 'Shibuya Excel Hotel Tokyu, Dogenzaka, Tokyo',
          country: 'JP',
          city: 'Tokyo',
          lat: 35.6586,
          lng: 139.6997,
        },
        {
          name: 'Shibuya Stream Excel Hotel Tokyu',
          displayName: 'Shibuya Stream Excel Hotel Tokyu, 3-21-3 Shibuya, Tokyo',
          country: 'JP',
          city: 'Tokyo',
          lat: 35.6572,
          lng: 139.7026,
        },
      ],
      excelParsed,
      {
        near: { lat: 35.6762, lng: 139.6503 },
        maxDistanceKm: 45,
        allowLooseSimilarity: true,
        cityBias: 'Tokyo',
        preferSpecificPoi: true,
      },
    )
    expect(excelWinner?.name).toBe('Shibuya Stream Excel Hotel Tokyu')
  })

  it('rejects candidates across nearby cities beyond tight 45km metro radius', () => {
    const parsed = parseLocationQuery('Hotel Nikko Kansai', 'JP')
    const winner = pickBestGeocodeCandidate(
      [
        {
          name: 'Hotel Nikko Kansai Airport',
          country: 'JP',
          lat: 34.437,
          lng: 135.2431, // ~47 km from Osaka? Kyoto -> 74 km
        },
      ],
      parsed,
      { near: { lat: 35.0116, lng: 135.7681 }, maxDistanceKm: 45, preferSpecificPoi: true },
    )
    expect(winner).toBeNull()
  })

  it('expands Google-style international apartment addresses & infers JP country', () => {
    const raw = '2-chōme-8-1 Nishi-Shinjuku, サンプルビル203 Shinjuku City, Tokyo 160-0023'
    const parsed = parseLocationQuery(raw)
    expect(parsed.countryIso).toBe('JP')

    const variants = expandAddressQueries(raw)
    expect(variants[0]).toBe('2-8-1 Nishi-Shinjuku, Shinjuku, Tokyo')
    expect(variants).toContain('Nishi-Shinjuku, Shinjuku, Tokyo')
    expect(variants).toContain('160-0023 Tokyo')
  })
})
