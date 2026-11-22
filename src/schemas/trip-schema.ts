import type { CollectionSchema } from 'deepspace/schema'

const PRIVATE_ROLE_DENIED = {
  read: false,
  create: false,
  update: false,
  delete: false,
} as const

/**
 * Required by DeepSpace's `'team'` permission level.
 * Holds every invited trip participant (both `'viewer'` and `'editor'`),
 * managed exclusively via owner-verified server actions.
 */
export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'role',
      storage: 'text',
      interpretation: { kind: 'select', options: ['owner', 'editor', 'viewer'] },
      required: true,
    },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['active', 'revoked'] },
      required: true,
    },
    { name: 'displayName', storage: 'text', interpretation: 'plain' },
    { name: 'imageUrl', storage: 'text', interpretation: 'plain' },
    { name: 'addedBy', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['teamId', 'userId'],
  teamField: 'teamId',
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}

export const tripsSchema: CollectionSchema = {
  name: 'trips',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 140 },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'editors', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'viewers', storage: 'text', interpretation: { kind: 'json' } },
    {
      name: 'mode',
      storage: 'text',
      interpretation: { kind: 'select', options: ['detailed'] },
      required: true,
    },
    { name: 'startDate', storage: 'text', interpretation: { kind: 'date' } },
    { name: 'endDate', storage: 'text', interpretation: { kind: 'date' } },
    { name: 'totalDays', storage: 'number', interpretation: 'plain' },
    { name: 'travelers', storage: 'number', interpretation: 'plain' },
    {
      name: 'pace',
      storage: 'text',
      interpretation: { kind: 'select', options: ['relaxed', 'balanced', 'packed'] },
    },
    {
      name: 'budgetTier',
      storage: 'text',
      interpretation: { kind: 'select', options: ['budget', 'moderate', 'luxury'] },
    },
    { name: 'currency', storage: 'text', interpretation: 'plain' },
    {
      name: 'transportPreference',
      storage: 'text',
      interpretation: { kind: 'select', options: ['walk', 'transit', 'drive'] },
    },
    { name: 'interests', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'coverDestination', storage: 'text', interpretation: 'plain' },
    { name: 'summaryNotes', storage: 'text', interpretation: 'plain', maxLength: 4000 },
  ],
  ownerField: 'ownerId',
  collaboratorsField: 'editors',
  teamField: 'teamId',
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: { read: 'team', create: false, update: 'own', delete: 'own' },
    admin: { read: 'team', create: false, update: 'own', delete: 'own' },
  },
}

export const tripDestinationsSchema: CollectionSchema = {
  name: 'trip_destinations',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'editors', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 140 },
    { name: 'country', storage: 'text', interpretation: 'plain', maxLength: 100 },
    { name: 'lat', storage: 'number', interpretation: 'plain' },
    { name: 'lng', storage: 'number', interpretation: 'plain' },
    { name: 'arrivalDate', storage: 'text', interpretation: { kind: 'date' } },
    { name: 'departureDate', storage: 'text', interpretation: { kind: 'date' } },
    { name: 'lodgingName', storage: 'text', interpretation: 'plain', maxLength: 160 },
    { name: 'lodgingAddress', storage: 'text', interpretation: 'plain', maxLength: 300 },
    { name: 'lodgingLat', storage: 'number', interpretation: 'plain' },
    { name: 'lodgingLng', storage: 'number', interpretation: 'plain' },
    { name: 'checkInTime', storage: 'text', interpretation: 'plain' },
    { name: 'checkOutTime', storage: 'text', interpretation: 'plain' },
    { name: 'orderIndex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'suggestedDays', storage: 'number', interpretation: 'plain' },
    { name: 'minDays', storage: 'number', interpretation: 'plain' },
    {
      name: 'transportFromPrev',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['bullet_train', 'flight', 'train', 'drive', 'ferry', 'bus', 'none'],
      },
    },
    { name: 'transitHoursFromPrev', storage: 'number', interpretation: 'plain' },
    { name: 'weatherCache', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'notes', storage: 'text', interpretation: 'plain', maxLength: 2000 },
  ],
  ownerField: 'ownerId',
  collaboratorsField: 'editors',
  teamField: 'tripId',
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: { read: 'team', create: false, update: 'collaborator', delete: 'collaborator' },
    admin: { read: 'team', create: false, update: 'collaborator', delete: 'collaborator' },
  },
}

export const tripStopsSchema: CollectionSchema = {
  name: 'trip_stops',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'destinationId', storage: 'text', interpretation: 'plain' },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'editors', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'dayNumber', storage: 'number', interpretation: 'plain', required: true },
    { name: 'orderIndex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 180 },
    {
      name: 'category',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['must_see', 'restaurant', 'photo_spot', 'day_trip', 'hidden_gem', 'lodging', 'transit'],
      },
      required: true,
    },
    { name: 'address', storage: 'text', interpretation: 'plain', maxLength: 300 },
    { name: 'lat', storage: 'number', interpretation: 'plain' },
    { name: 'lng', storage: 'number', interpretation: 'plain' },
    { name: 'startTime', storage: 'text', interpretation: 'plain' },
    { name: 'durationMinutes', storage: 'number', interpretation: 'plain' },
    { name: 'fixedTime', storage: 'number', interpretation: { kind: 'boolean' } },
    {
      name: 'preferredWindow',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['any', 'sunrise', 'morning', 'lunch', 'afternoon', 'golden_hour', 'dinner', 'night'],
      },
    },
    {
      name: 'transportMode',
      storage: 'text',
      interpretation: { kind: 'select', options: ['walk', 'transit', 'drive', 'bullet_train', 'flight'] },
    },
    { name: 'transportOverridden', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'travelMinutesFromPrev', storage: 'number', interpretation: 'plain' },
    { name: 'travelDistanceKmFromPrev', storage: 'number', interpretation: 'plain' },
    { name: 'estimatedCost', storage: 'number', interpretation: 'plain' },
    { name: 'rating', storage: 'number', interpretation: 'plain' },
    { name: 'photoTip', storage: 'text', interpretation: 'plain', maxLength: 600 },
    {
      name: 'bestLightWindow',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['any', 'sunrise', 'golden_hour', 'blue_hour', 'midday', 'night'],
      },
    },
    { name: 'notes', storage: 'text', interpretation: 'plain', maxLength: 2000 },
    { name: 'sourceUrl', storage: 'text', interpretation: { kind: 'url' } },
  ],
  ownerField: 'ownerId',
  collaboratorsField: 'editors',
  teamField: 'tripId',
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: { read: 'team', create: false, update: 'collaborator', delete: 'collaborator' },
    admin: { read: 'team', create: false, update: 'collaborator', delete: 'collaborator' },
  },
}

export const tripChecklistsSchema: CollectionSchema = {
  name: 'trip_checklists',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'editors', storage: 'text', interpretation: { kind: 'json' } },
    {
      name: 'category',
      storage: 'text',
      interpretation: { kind: 'select', options: ['booking', 'gear', 'documents', 'packing'] },
      required: true,
    },
    { name: 'label', storage: 'text', interpretation: 'plain', required: true, maxLength: 240 },
    { name: 'completed', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'assignedTo', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'ownerId',
  collaboratorsField: 'editors',
  teamField: 'tripId',
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: { read: 'team', create: false, update: 'collaborator', delete: 'collaborator' },
    admin: { read: 'team', create: false, update: 'collaborator', delete: 'collaborator' },
  },
}

export const tripInvitesSchema: CollectionSchema = {
  name: 'trip_invites',
  columns: [
    { name: 'tripId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'token', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'role',
      storage: 'text',
      interpretation: { kind: 'select', options: ['viewer', 'editor'] },
      required: true,
    },
    { name: 'invitedEmail', storage: 'text', interpretation: { kind: 'email' } },
    { name: 'expiresAt', storage: 'number', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['pending', 'accepted', 'revoked'] },
      required: true,
    },
  ],
  uniqueOn: ['token'],
  ownerField: 'ownerId',
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: { read: 'own', create: false, update: 'own', delete: 'own' },
    admin: { read: 'own', create: false, update: 'own', delete: 'own' },
  },
}

export const userAiCredentialsSchema: CollectionSchema = {
  name: 'user_ai_credentials',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'provider',
      storage: 'text',
      interpretation: { kind: 'select', options: ['google_gemini'] },
      required: true,
    },
    {
      name: 'authType',
      storage: 'text',
      interpretation: { kind: 'select', options: ['oauth', 'api_key'] },
      required: true,
    },
    { name: 'googleEmail', storage: 'text', interpretation: 'plain' },
    { name: 'apiKey', storage: 'text', interpretation: 'plain' },
    { name: 'accessToken', storage: 'text', interpretation: 'plain' },
    { name: 'refreshToken', storage: 'text', interpretation: 'plain' },
    { name: 'expiresAt', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['userId', 'provider'],
  permissions: {
    '*': PRIVATE_ROLE_DENIED,
    viewer: PRIVATE_ROLE_DENIED,
    member: PRIVATE_ROLE_DENIED,
    admin: PRIVATE_ROLE_DENIED,
  },
}

export const tripSchemas: CollectionSchema[] = [
  teamMembersSchema,
  tripsSchema,
  tripDestinationsSchema,
  tripStopsSchema,
  tripChecklistsSchema,
  tripInvitesSchema,
  userAiCredentialsSchema,
]
