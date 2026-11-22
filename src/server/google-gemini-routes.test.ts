import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Env } from '../../worker.js'
import { encryptCredentialSecret } from '../lib/credential-crypto.js'

const mockQuery = vi.fn()
const mockUpdate = vi.fn()

vi.mock('./trip-helpers.js', () => ({
  createServerRecordTools: () => ({
    query: mockQuery,
    update: mockUpdate,
  }),
}))

import { getUserGeminiCredential } from './google-gemini-routes.js'

describe('google-gemini-routes credential security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses to decrypt credentials using public DEEPSPACE_APP_ID when encryption secrets are absent', async () => {
    const enc = await encryptCredentialSecret('AIzaTestSecretKey123456', 'real-secret', 'user_1')
    mockQuery.mockResolvedValue({
      success: true,
      data: {
        records: [
          {
            recordId: 'cred_1',
            data: { userId: 'user_1', provider: 'google_gemini', authType: 'api_key', apiKey: enc },
          },
        ],
      },
    })

    const res = await getUserGeminiCredential(
      { DEEPSPACE_APP_ID: 'app_public_id' } as unknown as Env,
      'user_1',
    )
    expect(res).toBeNull()
  })

  it('never returns an expired OAuth accessToken when refresh is unavailable', async () => {
    const encAccess = await encryptCredentialSecret('expired-tok', 'real-secret', 'user_1')
    mockQuery.mockResolvedValue({
      success: true,
      data: {
        records: [
          {
            recordId: 'cred_2',
            data: {
              userId: 'user_1',
              provider: 'google_gemini',
              authType: 'oauth',
              accessToken: encAccess,
              expiresAt: Date.now() - 5_000,
            },
          },
        ],
      },
    })

    const res = await getUserGeminiCredential(
      {
        DEEPSPACE_APP_ID: 'app_public_id',
        USER_CREDENTIALS_ENCRYPTION_KEY: 'real-secret',
      } as unknown as Env,
      'user_1',
    )
    expect(res).toBeNull()
  })
})
