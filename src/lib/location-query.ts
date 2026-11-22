import { haversineKm } from './route-optimizer'

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'u.s.a': 'US',
  'u.s.a.': 'US',
  us: 'US',
  'u.s.': 'US',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'u.k.': 'GB',
  'united kingdom': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'great britain': 'GB',
  'south korea': 'KR',
  korea: 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  japan: 'JP',
  nippon: 'JP',
  uae: 'AE',
  'united arab emirates': 'AE',
  'czech republic': 'CZ',
  czechia: 'CZ',
  russia: 'RU',
  'russian federation': 'RU',
  taiwan: 'TW',
  'hong kong': 'HK',
  macau: 'MO',
  vietnam: 'VN',
  'viet nam': 'VN',
  netherlands: 'NL',
  'the netherlands': 'NL',
  holland: 'NL',
  turkey: 'TR',
  turkiye: 'TR',
  'new zealand': 'NZ',
  'costa rica': 'CR',
  'south africa': 'ZA',
  'sri lanka': 'LK',
  'dominican republic': 'DO',
  'saudi arabia': 'SA',
  'puerto rico': 'PR',
}

let cachedRegionMap: Map<string, string> | null = null

function getCountryNameMap(): Map<string, string> {
  if (cachedRegionMap) return cachedRegionMap
  const map = new Map<string, string>(Object.entries(COUNTRY_ALIASES))
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const display = new Intl.DisplayNames(['en'], { type: 'region' })
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      for (let i = 0; i < letters.length; i++) {
        for (let j = 0; j < letters.length; j++) {
          const code = `${letters[i]}${letters[j]}`
          const name = display.of(code)
          if (name && name !== code && !/unknown region/i.test(name)) {
            const key = name.trim().toLowerCase()
            if (!map.has(key)) {
              map.set(key, code)
            }
          }
        }
      }
    }
  } catch {
    // Fallback to static aliases if Intl.DisplayNames is unavailable
  }
  cachedRegionMap = map
  return map
}

export function normalizePlaceToken(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveCountryIso(raw?: string): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  const map = getCountryNameMap()
  const direct = map.get(trimmed.toLowerCase())
  if (direct) return direct
  const normalized = normalizePlaceToken(trimmed)
  return map.get(normalized)
}

export interface ParsedLocationQuery {
  raw: string
  placeCore: string
  primaryName: string
  countryIso?: string
  owmQueries: string[]
  nominatimQuery: string
}

export function parseLocationQuery(rawPlace: string, explicitCountry?: string): ParsedLocationQuery {
  const raw = rawPlace.trim()
  let countryIso = resolveCountryIso(explicitCountry)

  let placeCore = raw
  if (raw.includes(',')) {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length > 1) {
      const tail = parts[parts.length - 1]
      const tailIso = resolveCountryIso(tail)
      if (tailIso) {
        if (!countryIso) countryIso = tailIso
        placeCore = parts.slice(0, -1).join(', ')
      }
    }
  } else {
    // Handle space-separated city + country like "Osaka Japan" or "New York United States"
    const words = raw.split(/\s+/).filter(Boolean)
    const map = getCountryNameMap()
    for (let take = Math.min(4, words.length - 1); take >= 1; take--) {
      const tailTokens = words.slice(words.length - take)
      const tailJoined = tailTokens.join(' ')
      let matchedIso: string | undefined
      if (take === 1 && /^[A-Z]{2}$/.test(tailTokens[0])) {
        matchedIso = tailTokens[0]
      } else {
        matchedIso = map.get(tailJoined.toLowerCase()) ?? map.get(normalizePlaceToken(tailJoined))
      }
      if (matchedIso) {
        if (!countryIso) countryIso = matchedIso
        placeCore = words.slice(0, words.length - take).join(' ')
        break
      }
    }
  }

  const cleanCore = placeCore.trim() || raw
  const primaryName = cleanCore.split(',')[0]?.trim() || cleanCore

  if (
    !countryIso &&
    (/[\u3040-\u30ff]/.test(raw) || /\bch[oō]me\b/i.test(raw)) &&
    (/\b\d{3}-\d{4}\b/.test(raw) || /\b(tokyo|osaka|kyoto|yokohama|sapporo|nagoya|fukuoka)\b/i.test(raw))
  ) {
    countryIso = 'JP'
  }

  const owmQueries: string[] = []
  const pushQuery = (q: string) => {
    const trimmed = q.trim()
    if (trimmed && !owmQueries.includes(trimmed)) owmQueries.push(trimmed)
  }

  if (countryIso) {
    pushQuery(`${cleanCore},${countryIso}`)
    if (primaryName !== cleanCore) {
      pushQuery(`${primaryName},${countryIso}`)
    }
  }
  pushQuery(cleanCore)
  if (primaryName !== cleanCore) pushQuery(primaryName)

  return {
    raw,
    placeCore: cleanCore,
    primaryName,
    countryIso,
    owmQueries,
    nominatimQuery: cleanCore,
  }
}

export function formatWeatherQuery(name: string, country?: string): string {
  const parsed = parseLocationQuery(name, country)
  return parsed.countryIso ? `${parsed.primaryName},${parsed.countryIso}` : parsed.primaryName
}

/**
 * Generates ordered, geocoder-friendly fallback queries for street addresses pasted from
 * Google Maps / booking sites (stripping apartment/unit numbers, normalizing macrons and
 * Japanese chōme notation, and falling back to neighborhood + postcode + district).
 */
export function expandAddressQueries(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  // Strip embedded CJK building+room strings (e.g. サンプルマンション101) BEFORE normalizing ー -> -
  let withoutCjkUnit = trimmed
  if (/[a-zA-Z]{2,}/.test(trimmed)) {
    withoutCjkUnit = trimmed.replace(
      /[\u3040-\u30ff\u4e00-\u9faf\u3400-\u4dbfー－]+\s*[\d０-９]+[A-Za-z0-9-]*/g,
      ' ',
    )
  }

  const ascii = withoutCjkUnit
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[ー－−]/g, '-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const noUnit = ascii
    .replace(/\b(?:apt|apartment|suite|ste|unit|floor|fl|rm|room|bldg|building)\b\.?\s*#?[a-z0-9-]+/gi, ' ')
    .replace(/#\s*[a-z0-9-]+/gi, ' ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s+/g, ' ')

  const postalMatch = ascii.match(/\b\d{3}-\d{4}\b/) ?? ascii.match(/\b\d{5}(?:-\d{4})?\b/)
  const normalizedStreet = noUnit
    .replace(/(\d+)\s*[-\s]*chome[-\s]*(\d+[-\d]*)/gi, '$1-$2')
    .replace(/\b\d{3}-\d{4}\b/g, '')
    .replace(/\b([A-Z][a-z]+)\s+City\b/g, '$1')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s+/g, ' ')

  const noLeadingNum = normalizedStreet
    .replace(/^[\d-]+(?:\s*[-\s]*chome[-\s]*[\d-]+)?\s+/i, '')
    .trim()

  const parts = noLeadingNum
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const wardCity = parts.length >= 2 ? parts.slice(-2).join(', ') : ''
  const lastPart = parts.length >= 1 ? parts[parts.length - 1] : ''

  const out: string[] = []
  const add = (q: string) => {
    const clean = q.trim()
    if (clean && !out.includes(clean)) out.push(clean)
  }

  if (/\d/.test(trimmed) || trimmed.split(',').length >= 3) {
    add(normalizedStreet)
    add(noUnit)
    if (noLeadingNum && noLeadingNum !== normalizedStreet) add(noLeadingNum)
    if (postalMatch && lastPart && !lastPart.includes(postalMatch[0])) {
      add(`${postalMatch[0]} ${lastPart}`)
    }
    if (wardCity && wardCity !== noLeadingNum) add(wardCity)
  }
  add(trimmed)

  return out
}

export interface GeocodeCandidate {
  name: string
  displayName?: string
  country?: string
  state?: string
  city?: string
  placeType?: string
  lat: number
  lng: number
  localNamesCount?: number
  importance?: number
  alternativeNames?: string[]
}

const POI_FILLER_TOKENS = new Set([
  'the',
  'a',
  'an',
  'at',
  'of',
  'in',
  'on',
  'by',
  'and',
  'for',
  'city',
  'ward',
  'ku',
  'prefecture',
  'chome',
])

const POI_COMMON_WORDS = new Set([
  ...POI_FILLER_TOKENS,
  'hotel',
  'hotels',
  'resort',
  'inn',
  'suites',
  'suite',
  'stay',
  'st',
  'street',
  'rd',
  'road',
  'ave',
  'avenue',
  'blvd',
  'station',
  'eki',
])

const HIGHWAY_OR_ROUTE_RE =
  /\b(expressway|motorway|highway|freeway|tollway|interchange|junction|parking\s*lot)\b|高速|停車場線|有料道路|駐車場/i
const NON_ADDRESS_SHOP_RE = /^(convenience|supermarket|kiosk|vending_machine)$/i
const ADMIN_CENTROID_TYPE_RE = /^(administrative|state|country|city|town|village)$/i

function extractTokens(input: string, extraStopWords?: Set<string>): string[] {
  const words = normalizePlaceToken(input).split(' ').filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    if (POI_FILLER_TOKENS.has(w)) continue
    if (extraStopWords?.has(w)) continue
    out.push(w)
  }
  return out
}

function tokenMatchesList(token: string, candidates: string[]): boolean {
  for (const c of candidates) {
    if (c === token) return true
    if (token.length >= 4 && c.length >= 4) {
      if (c.startsWith(token) || token.startsWith(c)) return true
      const dist = levenshteinDistance(c, token)
      if (dist <= (token.length <= 5 ? 1 : 2)) return true
    }
  }
  return false
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const saved = prev[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost)
      diag = saved
    }
  }
  return prev[b.length]
}

export function pickBestGeocodeCandidate<T extends GeocodeCandidate>(
  candidates: T[],
  query: ParsedLocationQuery,
  options?: {
    near?: { lat: number; lng: number }
    maxDistanceKm?: number
    allowLooseSimilarity?: boolean
    cityBias?: string
    expectedAddress?: string
    preferSpecificPoi?: boolean
  },
): T | null {
  const targetNorm = normalizePlaceToken(query.primaryName)
  const fullTargetNorm = normalizePlaceToken(query.placeCore)
  if (!targetNorm) return null

  const cityStopWords = new Set<string>(
    options?.cityBias ? normalizePlaceToken(options.cityBias).split(' ').filter(Boolean) : [],
  )
  const cityBiasNorm = options?.cityBias ? normalizePlaceToken(options.cityBias) : ''
  const targetTokens = extractTokens(query.primaryName, cityStopWords)
  const effectiveTargetTokens =
    targetTokens.length > 0 ? targetTokens : extractTokens(query.primaryName)
  const addrTokens = options?.expectedAddress
    ? extractTokens(options.expectedAddress, cityStopWords).filter((t) => !POI_COMMON_WORDS.has(t))
    : []
  const queryAsksHighway = HIGHWAY_OR_ROUTE_RE.test(query.raw)

  let best: { candidate: T; score: number } | null = null

  for (let idx = 0; idx < candidates.length; idx++) {
    const hit = candidates[idx]
    if (
      !Number.isFinite(hit.lat) ||
      !Number.isFinite(hit.lng) ||
      Math.abs(hit.lat) > 90 ||
      Math.abs(hit.lng) > 180 ||
      (hit.lat === 0 && hit.lng === 0)
    ) {
      continue
    }

    const hitCountry = hit.country?.toUpperCase()
    if (query.countryIso && hitCountry && hitCountry !== query.countryIso) {
      continue
    }

    let distanceKm = 0
    if (options?.near) {
      distanceKm = haversineKm(options.near, { lat: hit.lat, lng: hit.lng })
      if (options.maxDistanceKm && distanceKm > options.maxDistanceKm) {
        continue
      }
    }

    // Reject expressways/motorways/parking lots unless the query explicitly asked for one
    if (options?.preferSpecificPoi && !queryAsksHighway) {
      const typeStr = hit.placeType ?? ''
      if (HIGHWAY_OR_ROUTE_RE.test(hit.name) || HIGHWAY_OR_ROUTE_RE.test(typeStr)) {
        continue
      }
    }
    const shopPenalty =
      options?.preferSpecificPoi && hit.placeType && NON_ADDRESS_SHOP_RE.test(hit.placeType)
        ? -140
        : 0

    const candidateNames = [hit.name, ...(hit.alternativeNames ?? [])]
      .filter(Boolean)
      .map((n) => normalizePlaceToken(n))
    const displayNorm = hit.displayName ? normalizePlaceToken(hit.displayName) : ''
    const displayWords = displayNorm ? displayNorm.split(' ').filter(Boolean) : []

    let nameScore = -1000
    for (const cNorm of candidateNames) {
      if (!cNorm) continue
      if (cNorm === targetNorm || cNorm === fullTargetNorm) {
        nameScore = Math.max(nameScore, 1000)
      } else if (cNorm.startsWith(`${targetNorm} `) || cNorm.startsWith(targetNorm)) {
        nameScore = Math.max(nameScore, 420)
      } else if (cNorm.includes(targetNorm)) {
        nameScore = Math.max(nameScore, 300)
      } else if (targetNorm.includes(cNorm) && cNorm.length >= 4 && cNorm !== cityBiasNorm) {
        nameScore = Math.max(nameScore, 180)
      } else if (targetNorm.length >= 4) {
        const dist = levenshteinDistance(cNorm, targetNorm)
        const maxAllowed = targetNorm.length <= 5 ? 1 : 2
        if (dist <= maxAllowed) {
          nameScore = Math.max(nameScore, 80 - dist * 25)
        }
      }
    }

    // Evaluate Latin-script word overlap to catch unrelated hotel/POI substitutions
    // (e.g. "Grand Regis" for "St. Regis Osaka" or "Haya Dotonbori" for "1-7-1 Dotonbori")
    const hasLatinCandidateWords = /[a-z]{2,}/i.test(hit.name)
    let tokenBonus = 0
    if (effectiveTargetTokens.length > 0 && hasLatinCandidateWords) {
      const cWords = extractTokens(hit.name, cityStopWords)
      const searchableWords = [...cWords, ...displayWords]
      const matchedTargetCount = effectiveTargetTokens.filter((t) =>
        tokenMatchesList(t, cWords),
      ).length
      const matchedDisplayCount = effectiveTargetTokens.filter((t) =>
        tokenMatchesList(t, searchableWords),
      ).length
      const bestMatched = Math.max(matchedTargetCount, matchedDisplayCount)
      const coverage = bestMatched / effectiveTargetTokens.length
      const distinctiveTarget = effectiveTargetTokens.filter((t) => !POI_COMMON_WORDS.has(t))
      const extraCandWords = cWords.filter(
        (w) =>
          w.length >= 2 &&
          !POI_COMMON_WORDS.has(w) &&
          !tokenMatchesList(w, effectiveTargetTokens),
      )

      if (nameScore < 300) {
        if (coverage === 1 && extraCandWords.length === 0) {
          nameScore = Math.max(nameScore, 520)
        } else if (coverage >= 0.75) {
          tokenBonus += Math.round(coverage * 260) - extraCandWords.length * 40
        } else if (
          options?.preferSpecificPoi &&
          extraCandWords.length > 0 &&
          coverage < 0.65 &&
          distinctiveTarget.length > 0
        ) {
          continue
        } else if (coverage >= 0.5) {
          tokenBonus += Math.round(coverage * 140)
        } else if (!options?.allowLooseSimilarity) {
          continue
        }
      }
      // Penalize missing distinctive words even if substring matched (e.g. missing "stream")
      const missingDistinctive = distinctiveTarget.filter(
        (t) => !tokenMatchesList(t, searchableWords),
      ).length
      tokenBonus -= missingDistinctive * 120
    } else if (nameScore < 0 && displayNorm.includes(targetNorm)) {
      nameScore = 140
    }

    // Reject clear phonetic false-positives (e.g., "Orsk" for "Osaka")
    if (nameScore < 0 && tokenBonus <= 0 && !options?.allowLooseSimilarity) {
      continue
    }

    let score = Math.max(0, nameScore) + tokenBonus + shopPenalty
    if (query.countryIso && hitCountry === query.countryIso) {
      score += 600
    }
    if (cityBiasNorm) {
      const hitCityNorm = hit.city ? normalizePlaceToken(hit.city) : ''
      const hitStateNorm = hit.state ? normalizePlaceToken(hit.state) : ''
      if (
        hitCityNorm === cityBiasNorm ||
        hitStateNorm === cityBiasNorm ||
        displayNorm.includes(cityBiasNorm)
      ) {
        score += 140
      }
      // Demote bare city/admin centroid hits when looking for a specific POI inside that city
      if (options?.preferSpecificPoi) {
        const hitNameNorm = normalizePlaceToken(hit.name)
        if (
          hitNameNorm === cityBiasNorm ||
          (hit.placeType && ADMIN_CENTROID_TYPE_RE.test(hit.placeType) && nameScore < 300)
        ) {
          score -= 280
        }
      }
    }
    if (addrTokens.length > 0 && displayWords.length > 0) {
      const matchedAddr = addrTokens.filter((t) => tokenMatchesList(t, displayWords)).length
      score += Math.min(180, matchedAddr * 45)
    }
    if (hit.localNamesCount && hit.localNamesCount > 0) {
      score += Math.min(80, hit.localNamesCount * 2)
    }
    if (typeof hit.importance === 'number' && Number.isFinite(hit.importance)) {
      score += Math.min(80, hit.importance * 80)
    }
    if (options?.allowLooseSimilarity) {
      // Preserve native geocoder relevance order when comparing street addresses / non-Latin POIs
      score += Math.max(0, (6 - idx) * 18)
    }
    if (options?.near) {
      score += Math.max(0, 40 - distanceKm * 0.3)
    }

    if (!best || score > best.score) {
      best = { candidate: hit, score }
    }
  }

  return best?.candidate ?? null
}
