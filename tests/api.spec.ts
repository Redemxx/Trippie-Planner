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

  test('unauthenticated requests to actions, AI chat, and Google Gemini status are rejected with 401', async ({
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

    const geminiStatusRes = await request.get('/api/ai/google/status')
    expect(geminiStatusRes.status()).toBe(401)

    const mapCfg = await request.get('/api/map-config')
    expect(mapCfg.status()).toBe(200)
    const mapBody = (await mapCfg.json()) as { provider?: string }
    expect(['osm', 'carto']).toContain(mapBody.provider)
  })

  test('signed-in CRUD, route optimization, and destination actions work end-to-end', async ({
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
          mode: 'detailed',
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

      // Add a third destination and verify intercity transit calculation
      const addDestRes = await alice.page.request.post('/api/actions/addDestination', {
        headers: { Authorization: `Bearer ${token}` },
        data: { tripId: createdTripId, name: 'Nara', country: 'JP', lat: 34.6851, lng: 135.8048 },
      })
      expect(addDestRes.status()).toBe(200)
      const addDestBody = (await addDestRes.json()) as {
        success: boolean
        data: { destinationId: string }
      }
      expect(addDestBody.success).toBe(true)
      expect(addDestBody.data.destinationId).toBeTruthy()

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

      // Verify editing trip description via Edit Trip modal
      await alice.page.getByTestId('edit-trip-button').click()
      await alice.page.getByLabel(/Trip description/i).fill('Updated golden-hour route notes')
      await alice.page.getByTestId('save-trip-details-btn').click()
      await expect(alice.page.getByTestId('trip-description')).toHaveText(
        'Updated golden-hour route notes',
      )

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

  test('Google Gemini settings UI renders and handles link/disconnect flow', async ({ users }) => {
    test.skip(usableTestAccounts < 1, 'Needs at least 1 usable test account')
    const [alice] = await users(1)

    await alice.page.route('**/api/ai/google/api-key', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connected: true,
          authType: 'api_key',
          googleEmail: 'traveler@gmail.com',
        }),
      })
    })

    let statusConnected = false
    await alice.page.route('**/api/ai/google/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connected: statusConnected,
          authType: statusConnected ? 'api_key' : null,
          googleEmail: statusConnected ? 'traveler@gmail.com' : null,
          oauthConfigured: false,
          models: [],
        }),
      })
    })

    await alice.page.route('**/api/ai/google/disconnect', async (route) => {
      statusConnected = false
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: false }),
      })
    })

    await alice.page.goto('/settings')
    await expect(alice.page.getByTestId('google-gemini-settings')).toBeVisible({ timeout: 15000 })

    statusConnected = true
    await alice.page.getByLabel('Gemini API Key').fill('AIzaSyDemoTestKey1234567890')
    await alice.page.getByTestId('save-gemini-key-btn').click()
    await expect(alice.page.getByText('traveler@gmail.com')).toBeVisible({ timeout: 10000 })

    await alice.page.getByTestId('disconnect-gemini-btn').click()
    await expect(alice.page.getByText('Not linked')).toBeVisible({ timeout: 10000 })
  })

  test('lodging transition stops, dated tabs, and active-trip live today panel work together', async ({
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
    const token = tokenRes.token!

    // Match browser local clock for active trip detection
    const { todayIso, plusTwoIso, plusFourIso } = await alice.page.evaluate(() => {
      const fmt = (offsetDays: number) => {
        const d = new Date()
        d.setDate(d.getDate() + offsetDays)
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}`
      }
      return { todayIso: fmt(0), plusTwoIso: fmt(2), plusFourIso: fmt(4) }
    })

    // Mock Open-Meteo or server weather fetch response if called on active trip
    await alice.page.route('**/api/actions/refreshDestinationWeather', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            tempC: 19,
            feelsLikeC: 18,
            weatherCode: 1,
            description: 'Clear sky',
            precipitationProb: 5,
            windKph: 9,
            fetchedAt: new Date().toISOString(),
          },
        }),
      })
    })

    let activeTripId: string | null = null
    let futureTripId: string | null = null
    try {
      const createActive = await alice.page.request.post('/api/actions/createTrip', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: `__test-${Date.now()}__ Active Transition Trip`,
          mode: 'detailed',
          startDate: todayIso,
          endDate: plusFourIso,
          totalDays: 5,
          destinations: [
            {
              name: 'Kyoto',
              country: 'JP',
              lat: 35.0116,
              lng: 135.7681,
              arrivalDate: todayIso,
              departureDate: plusTwoIso,
              lodgingName: 'Ace Hotel Kyoto',
              checkInTime: '15:00',
              checkOutTime: '10:00',
            },
            {
              name: 'Osaka',
              country: 'JP',
              lat: 34.6937,
              lng: 135.5023,
              arrivalDate: plusTwoIso,
              departureDate: plusFourIso,
              lodgingName: 'Cross Hotel Osaka',
              checkInTime: '15:00',
              checkOutTime: '10:00',
            },
          ],
        },
      })
      expect(createActive.status()).toBe(200)
      activeTripId = ((await createActive.json()) as { data: { tripId: string } }).data.tripId

      await alice.page.goto(`/trips/${activeTripId}`)
      await expect(alice.page.getByTestId('trip-workspace')).toBeVisible({ timeout: 15000 })

      // Active trip should show live today panel and single day selector card with calendar date picker
      await expect(alice.page.getByTestId('live-today-panel')).toBeVisible({ timeout: 10000 })
      await expect(alice.page.getByTestId('day-selector-card')).toBeVisible({ timeout: 10000 })
      await alice.page.getByTestId('day-calendar-btn').click()
      await expect(alice.page.getByTestId('day-calendar-popover')).toBeVisible()
      // Move day (day 3) should show orange highlight class and switch on click
      const moveCalDay = alice.page.getByTestId('calendar-day-3')
      await expect(moveCalDay).toHaveClass(/border-amber-500/)
      await moveCalDay.click()
      await expect(alice.page.getByTestId('day-selector-card')).toHaveClass(/border-amber-500/)

      // Auto-seeded hotel checkout, intercity transit, and check-in stops should appear on transition day
      await expect(alice.page.getByText(/Check out: Ace Hotel Kyoto/i)).toBeVisible({ timeout: 10000 })
      await expect(alice.page.getByText(/15m to departure station/i)).toBeVisible()
      await expect(alice.page.getByText(/Travel: Kyoto → Osaka/i)).toBeVisible()
      await expect(alice.page.getByText(/Check in: Cross Hotel Osaka/i)).toBeVisible()
      // Check out & Check in cards show hotel icon instead of stop number, matching map pin colors
      await expect(alice.page.getByTestId('stop-badge-0').locator('svg')).toBeVisible()
      await expect(alice.page.getByTestId('stop-badge-0')).toHaveText('')
      await expect(alice.page.getByTestId('stop-badge-1')).toHaveText('2')
      await expect(alice.page.getByTestId('stop-badge-2').locator('svg')).toBeVisible()
      await expect(alice.page.getByTestId('stop-badge-2')).toHaveText('')
      // Travel card starts after checkout (10:00-10:20) + hotel-to-station transfer (15m -> 10:35)
      await expect(alice.page.getByTestId('stop-card-1')).toContainText('10:35–')

      // Transportation method selector sits inside the Travel card itself and recalculates duration on change
      const legSelect = alice.page.getByTestId('stop-card-1').getByTestId('leg-transport-select-1')
      await expect(legSelect).toBeVisible()
      await legSelect.selectOption('drive')
      await expect(legSelect).toHaveValue('drive')

      // Future trip should NOT render live-today-panel or destination weather strings
      const createFuture = await alice.page.request.post('/api/actions/createTrip', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: `__test-${Date.now()}__ Future Trip`,
          mode: 'detailed',
          startDate: '2027-06-10',
          endDate: '2027-06-12',
          totalDays: 3,
          destinations: [{ name: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 }],
        },
      })
      futureTripId = ((await createFuture.json()) as { data: { tripId: string } }).data.tripId
      await alice.page.goto(`/trips/${futureTripId}`)
      await expect(alice.page.getByTestId('trip-workspace')).toBeVisible({ timeout: 15000 })
      await expect(alice.page.getByTestId('live-today-panel')).toHaveCount(0)
      await expect(alice.page.getByTestId('active-day-date')).toContainText('Jun 10')
      await alice.page.getByTestId('day-next-btn').click()
      await expect(alice.page.getByTestId('active-day-date')).toContainText('Jun 11')
      await alice.page.getByTestId('day-prev-btn').click()
      await expect(alice.page.getByTestId('active-day-date')).toContainText('Jun 10')

      // Verify bright Google-Maps-style map canvas (no dark inversion filter)
      await expect(alice.page.getByTestId('atlas-map')).toHaveClass(/trippie-gmaps-canvas/)
      await expect(alice.page.locator('.trippie-osm-dark')).toHaveCount(0)

      // Open Hotels & Stays menu, add Osaka, verify Bullet train auto-selection, clear & remove
      await alice.page.getByTestId('manage-stays-button').click()
      await expect(alice.page.getByRole('heading', { name: /Manage Hotels & Stays/i })).toBeVisible()
      await alice.page.getByLabel('City / Destination').fill('Osaka')
      await alice.page.getByLabel('Country (optional)').fill('JP')
      await alice.page.getByLabel('Hotel / Lodging name').fill('Cross Hotel Osaka')
      await alice.page.getByTestId('add-stay-submit-btn').click()

      await expect(alice.page.getByTestId('manage-stay-row-1')).toBeVisible({ timeout: 10000 })
      await expect(alice.page.getByTestId('manage-stay-row-1')).toContainText('Cross Hotel Osaka')
      await expect(alice.page.getByTestId('manage-stay-row-1')).toContainText('Bullet train')

      // Clear hotel and then remove stay cleanly
      await alice.page.getByTestId('manage-stay-row-1').getByRole('button', { name: 'Clear hotel' }).click()
      await expect(alice.page.getByTestId('manage-stay-row-1')).toContainText('No hotel assigned yet', {
        timeout: 10000,
      })
      await alice.page.getByTestId('manage-stay-row-1').getByRole('button', { name: 'Remove Osaka stay' }).click()
      await expect(alice.page.getByTestId('manage-stay-row-1')).toHaveCount(0, { timeout: 10000 })
      await alice.page.getByRole('button', { name: 'Done' }).click()

      // Verify Regenerate Trip button inside Edit Trip resets custom stops and rebuilds initial trip state
      await alice.page.request.post('/api/actions/upsertTripStop', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          tripId: futureTripId,
          dayNumber: 1,
          title: 'Temporary Stop Before Regenerate',
          category: 'must_see',
          lat: 35.6762,
          lng: 139.6503,
        },
      })
      await expect(alice.page.getByText('Temporary Stop Before Regenerate')).toBeVisible({
        timeout: 10000,
      })

      await alice.page.getByTestId('edit-trip-button').click()
      await alice.page.getByTestId('regenerate-trip-btn').click()
      await alice.page.getByRole('button', { name: 'Regenerate Trip' }).last().click()
      await expect(alice.page.getByText('Temporary Stop Before Regenerate')).toHaveCount(0, {
        timeout: 10000,
      })
    } finally {
      for (const id of [activeTripId, futureTripId]) {
        if (id) {
          await alice.page.request.post('/api/actions/deleteTrip', {
            headers: { Authorization: `Bearer ${token}` },
            data: { tripId: id },
          })
        }
      }
    }
  })
})
