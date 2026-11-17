export type TripMode = 'detailed' | 'overview'
export type TripPace = 'relaxed' | 'balanced' | 'packed'
export type BudgetTier = 'budget' | 'moderate' | 'luxury'
export type TransportMode = 'walk' | 'transit' | 'drive'
export type IntercityTransport = 'flight' | 'train' | 'drive' | 'ferry' | 'bus' | 'none'

export type StopCategory =
  | 'must_see'
  | 'restaurant'
  | 'photo_spot'
  | 'day_trip'
  | 'hidden_gem'
  | 'lodging'
  | 'transit'

export type PreferredWindow =
  | 'any'
  | 'sunrise'
  | 'morning'
  | 'lunch'
  | 'afternoon'
  | 'golden_hour'
  | 'dinner'
  | 'night'

export type LightWindow = 'any' | 'sunrise' | 'golden_hour' | 'blue_hour' | 'midday' | 'night'

export type TripAccessRole = 'owner' | 'editor' | 'viewer'

export type TripData = {
  title: string
  ownerId: string
  teamId: string
  editors: string[]
  viewers: string[]
  mode: TripMode
  startDate?: string
  endDate?: string
  totalDays?: number
  travelers?: number
  pace?: TripPace
  budgetTier?: BudgetTier
  currency?: string
  transportPreference?: TransportMode
  interests?: string[]
  coverDestination?: string
  summaryNotes?: string
}

export type WeatherForecastSummary = {
  fetchedAt: string
  tempC: number
  description: string
  sunrise?: number
  sunset?: number
  daily?: Array<{
    date: string
    tempMinC: number
    tempMaxC: number
    description: string
  }>
}

export type DestinationData = {
  tripId: string
  ownerId?: string
  editors?: string[]
  name: string
  country?: string
  lat?: number
  lng?: number
  arrivalDate?: string
  departureDate?: string
  orderIndex: number
  suggestedDays?: number
  minDays?: number
  transportFromPrev?: IntercityTransport
  transitHoursFromPrev?: number
  weatherCache?: WeatherForecastSummary
  notes?: string
}

export type StopData = {
  tripId: string
  destinationId?: string
  ownerId?: string
  editors?: string[]
  dayNumber: number
  orderIndex: number
  title: string
  category: StopCategory
  address?: string
  lat?: number
  lng?: number
  startTime?: string
  durationMinutes?: number
  fixedTime?: boolean
  preferredWindow?: PreferredWindow
  transportMode?: TransportMode
  travelMinutesFromPrev?: number
  travelDistanceKmFromPrev?: number
  estimatedCost?: number
  rating?: number
  photoTip?: string
  bestLightWindow?: LightWindow
  notes?: string
  sourceUrl?: string
}

export type OverviewAllocation = {
  destinationName: string
  country?: string
  lat?: number
  lng?: number
  recommendedDays: number
  minDays: number
  transitHoursFromPrev: number
  transportMode: IntercityTransport
  rationale: string
  mustSeeHighlights: string[]
  photoSpots: string[]
  dayTripIdeas: string[]
}

export type OverviewDayBlock = {
  dayNumber: number
  location: string
  theme: string
  morning: string
  afternoon: string
  evening: string
  photoMoment?: string
}

export type OverviewData = {
  tripId: string
  ownerId?: string
  editors?: string[]
  feasibilityStatus: 'comfortable' | 'ambitious' | 'overpacked'
  feasibilityScore: number
  totalTransitHours: number
  summary: string
  allocations: OverviewAllocation[]
  dailyOutline: OverviewDayBlock[]
}

export type ChecklistData = {
  tripId: string
  ownerId?: string
  editors?: string[]
  category: 'booking' | 'gear' | 'documents' | 'packing'
  label: string
  completed: boolean
  assignedTo?: string
}

export type TeamMemberData = {
  teamId: string
  userId: string
  role: TripAccessRole
  status: 'active' | 'revoked'
  displayName?: string
  imageUrl?: string
  addedBy?: string
}

export type TripInviteData = {
  tripId: string
  ownerId?: string
  token: string
  role: 'viewer' | 'editor'
  invitedEmail?: string
  status: 'pending' | 'accepted' | 'revoked'
}

export const CATEGORY_META: Record<
  StopCategory,
  { label: string; color: string; short: string }
> = {
  must_see: { label: 'Must-See', color: '#e5a93c', short: 'Sight' },
  restaurant: { label: 'Food & Dining', color: '#38bdf8', short: 'Food' },
  photo_spot: { label: 'Photo Spot', color: '#f97316', short: 'Photo' },
  day_trip: { label: 'Day Trip', color: '#10b981', short: 'Excursion' },
  hidden_gem: { label: 'Hidden Gem', color: '#a3e635', short: 'Gem' },
  lodging: { label: 'Lodging', color: '#94a3b8', short: 'Stay' },
  transit: { label: 'Transit Hub', color: '#64748b', short: 'Transit' },
}

export const LIGHT_WINDOW_LABELS: Record<LightWindow, string> = {
  any: 'Flexible light',
  sunrise: 'Sunrise light',
  golden_hour: 'Golden hour',
  blue_hour: 'Blue hour',
  midday: 'Midday sun',
  night: 'Night / Neon',
}
