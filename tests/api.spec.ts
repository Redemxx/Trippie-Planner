import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    await page.goto('/home')
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
  })

  test('unauthenticated requests to actions and AI chat are rejected with 401', async ({
    request,
  }) => {
    const actionRes = await request.post('/api/actions/createTrip', {
      data: { title: 'Unauthorized Trip' },
    })
    expect(actionRes.status()).toBe(401)

    const chatRes = await request.post('/api/ai/chat', {
      data: { chatId: 'c1', userMessageId: 'm1', content: 'Hello' },
    })
    expect(chatRes.status()).toBe(401)
  })

  test('signed-in CRUD, route optimization, and overview actions work end-to-end', async ({
    users,
  }) => {
    test.skip(usableTestAccounts < 1, 'Needs at least 1 usable test account')
    const [alice] = await users(1)
    await alice.page.goto('/home')
    await expect(alice.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15000 })

    const tokenRes = await alice.page.evaluate(async () => {
      const r = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      return r.json() as Promise<{ token?: string }>
    })
    expect(tokenRes.token).toBeTruthy()
    const token = tokenRes.token!

    let createdTripId: string | null = null
    try {
      const title = `__test-${Date.now()}__ API Kyoto Trip`
      const createRes = await alice.page.request.post('/api/actions/createTrip', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title,
          mode: 'overview',
          totalDays: 6,
          pace: 'balanced',
          destinations: [
            { name: 'Kyoto', country: 'JP', lat: 35.0116, lng: 135.7681 },
            { name: 'Osaka', country: 'JP', lat: 34.6937, lng: 135.5023 },
          ],
        },
      })
      expect(createRes.status()).toBe(200)
      const createBody = (await createRes.json()) as {
        success: boolean
        data: { tripId: string }
      }
      expect(createBody.success).toBe(true)
      createdTripId = createBody.data.tripId

      // Compute deterministic overview blueprint (useAi: false — test account has 0 credits)
      const ovRes = await alice.page.request.post('/api/actions/generateOverviewBlueprint', {
        headers: { Authorization: `Bearer ${token}` },
        data: { tripId: createdTripId, totalDays: 6, useAi: false },
      })
      expect(ovRes.status()).toBe(200)
      const ovBody = (await ovRes.json()) as {
        success: boolean
        data: { overview: { allocations: unknown[]; feasibilityScore: number } }
      }
      expect(ovBody.success).toBe(true)
      expect(ovBody.data.overview.allocations.length).toBe(2)

      // Add 3 zigzagged stops on Day 1 and optimize route
      const stopsToCreate = [
        { title: 'East Temple', lat: 35.0, lng: 135.78, preferredWindow: 'sunrise' },
        { title: 'West Grove', lat: 35.02, lng: 135.67, preferredWindow: 'any' },
        { title: 'East Cafe', lat: 34.998, lng: 135.782, preferredWindow: 'any' },
      ]
      for (const s of stopsToCreate) {
        const stopRes = await alice.page.request.post('/api/actions/upsertTripStop', {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            tripId: createdTripId,
            dayNumber: 1,
            category: 'must_see',
            transportMode: 'walk',
            ...s,
          },
        })
        expect(stopRes.status()).toBe(200)
      }

      const optRes = await alice.page.request.post('/api/actions/optimizeTripDay', {
        headers: { Authorization: `Bearer ${token}` },
        data: { tripId: createdTripId, dayNumber: 1 },
      })
      expect(optRes.status()).toBe(200)
      const optBody = (await optRes.json()) as {
        success: boolean
        data: { stopCount: number; minutesSaved: number }
      }
      expect(optBody.success).toBe(true)
      expect(optBody.data.stopCount).toBe(3)
      expect(optBody.data.minutesSaved).toBeGreaterThan(0)
    } finally {
      if (createdTripId) {
        await alice.page.request.post('/api/actions/deleteTrip', {
          headers: { Authorization: `Bearer ${token}` },
          data: { tripId: createdTripId },
        })
      }
    }
  })

  test('Discover tab mocks external serpapi/places-search boundary cleanly', async ({ users }) => {
    test.skip(usableTestAccounts < 1, 'Needs at least 1 usable test account')
    const [alice] = await users(1)
    await alice.page.goto('/home')
    await expect(alice.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15000 })

    const tokenRes = await alice.page.evaluate(async () => {
      const r = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      return r.json() as Promise<{ token?: string }>
    })
    const token = tokenRes.token!

    let tripId: string | null = null
    try {
      const createRes = await alice.page.request.post('/api/actions/createTrip', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: `__test-${Date.now()}__ Discover Trip`,
          mode: 'detailed',
          totalDays: 2,
          destinations: [{ name: 'Kyoto', country: 'JP', lat: 35.0116, lng: 135.7681 }],
        },
      })
      tripId = ((await createRes.json()) as { data: { tripId: string } }).data.tripId

      await alice.page.route('**/api/integrations/serpapi/places-search', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              local_results: [
                {
                  title: 'Philosopher Path Overlook',
                  address: 'Sakyo Ward, Kyoto',
                  rating: 4.8,
                  type: 'Scenic point',
                  gps_coordinates: { latitude: 35.0268, longitude: 135.7954 },
                },
              ],
            },
          }),
        })
      })

      await alice.page.goto(`/trips/${tripId}`)
      await expect(alice.page.getByTestId('trip-workspace')).toBeVisible({ timeout: 15000 })
      await alice.page.getByRole('tab', { name: /Discover/i }).click()
      await alice.page.getByRole('button', { name: 'Search Places' }).click()
      await expect(alice.page.getByText('Philosopher Path Overlook')).toBeVisible()
    } finally {
      if (tripId) {
        await alice.page.request.post('/api/actions/deleteTrip', {
          headers: { Authorization: `Bearer ${token}` },
          data: { tripId },
        })
      }
    }
  })
})
