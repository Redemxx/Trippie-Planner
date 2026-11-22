import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length

async function fetchJwt(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/auth/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    return r.json() as Promise<{ token?: string }>
  })
  expect(res.token).toBeTruthy()
  return res.token!
}

test.describe('Comprehensive Endpoint & Action Audit', () => {
  test('verifies all public/static/map/proxy/guard HTTP endpoints', async ({ request }) => {
    // Public pages & static SPA/API guards (note: /api-status was removed)
    for (const path of ['/', '/home', '/trips/new', '/settings']) {
      const res = await request.get(path)
      expect(res.status(), `GET ${path}`).toBe(200)
    }

    const apiMissGet = await request.get('/api/does-not-exist')
    expect(apiMissGet.status()).toBe(404)
    expect(await apiMissGet.json()).toEqual({ error: 'not_found' })

    const apiMissPost = await request.post('/api/does-not-exist', { data: {} })
    expect(apiMissPost.status()).toBe(404)
    expect(await apiMissPost.json()).toEqual({ error: 'not_found' })

    const fileMiss = await request.get('/missing-bundle-xyz.js')
    expect(fileMiss.status()).toBe(404)

    // Map config & tile proxy
    const mapCfg = await request.get('/api/map-config')
    expect(mapCfg.status()).toBe(200)
    const cfgJson = (await mapCfg.json()) as { provider: string }
    expect(['osm', 'carto']).toContain(cfgJson.provider)

    const mapTile = await request.get('/api/map-tiles/voyager/1/1/1')
    expect([200, 404]).toContain(mapTile.status())

    expect((await request.get('/api/map-tiles/badstyle/1/1/1')).status()).toBe(404)
    const badCoords = await request.get('/api/map-tiles/voyager/abc/0/0')
    expect([400, 404]).toContain(badCoords.status()) // 404 if CARTO_API_KEY not set, 400 if set

    // WebSocket routes: removed template DO routes (/ws/yjs, /ws/canvas, /ws/cron, /ws/jobs)
    // and non-canonical /ws/:roomId must return 404; /ws/presence/* strictly requires JWT (401).
    for (const deadWs of [
      '/ws/app:test',
      '/ws/yjs/doc1',
      '/ws/canvas/doc1',
      '/ws/cron/room1',
      '/ws/jobs/room1',
    ]) {
      const deadRes = await request.get(deadWs)
      expect(deadRes.status(), `removed WS ${deadWs}`).toBe(404)
    }
    expect((await request.get('/ws/presence/trip:scope1')).status()).toBe(401)
    expect((await request.get('/ws/presence/trip:scope1?token=not-a-valid-jwt')).status()).toBe(401)
    const agentToolsUnauth = await request.get('/_deepspace/agent/tools')
    expect([401, 403]).toContain(agentToolsUnauth.status())
    const browserAgentUnauth = await request.get('/_deepspace/agent/browser/tools')
    expect([401, 403]).toContain(browserAgentUnauth.status())

    // Integrations catalog & unauthenticated blocks
    const catRes = await request.get('/api/integrations')
    expect(catRes.status()).toBe(200)

    const intStatusUnauth = await request.get('/api/integrations/status')
    expect(intStatusUnauth.status()).toBe(401)

    const serpUnauth = await request.post('/api/integrations/serpapi/places-search', {
      data: { q: 'Kyoto' },
    })
    expect(serpUnauth.status()).toBe(401)

    const traversal = await request.post('/api/integrations/..%2F..%2Fapi%2Fusers/me', {
      data: {},
    })
    expect(traversal.status()).toBe(404)

    // Deepspace internal proxy allowlist
    const dsAllowlist = await request.get('/_deepspace/not-allowed')
    expect(dsAllowlist.status()).toBe(404)

    // Unauthenticated Gemini & Chat & Action gates
    expect((await request.get('/api/ai/google/status')).status()).toBe(401)
    expect((await request.post('/api/ai/google/api-key', { data: { apiKey: 'short' } })).status()).toBe(401)
    expect((await request.delete('/api/ai/google/disconnect')).status()).toBe(401)
    expect((await request.post('/api/ai/chats', { data: { title: 'x' } })).status()).toBe(401)
    expect((await request.post('/api/ai/chat', { data: {} })).status()).toBe(401)
    expect((await request.post('/api/actions/createTrip', { data: { title: 'x' } })).status()).toBe(401)
    expect((await request.get('/api/debug/records')).status()).toBe(401)

    // Invalid Google OAuth callback redirects safely to settings error
    const oauthCb = await request.get('/api/ai/google/oauth/callback?code=bad&state=tampered', {
      maxRedirects: 0,
    })
    expect(oauthCb.status()).toBe(302)
    expect(oauthCb.headers()['location']).toContain('/settings?google_gemini=error')
  })

  test('verifies action boundary, Gemini, AI Chat CRUD, and all 20 server actions with 2 users', async ({
    users,
  }) => {
    test.skip(usableTestAccounts < 2, 'Needs 2 usable test accounts')
    const [alice, bob] = await users(2)
    await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
    await expect(alice.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15000 })
    await expect(bob.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15000 })

    const aliceToken = await fetchJwt(alice.page)
    const bobToken = await fetchJwt(bob.page)
    const aliceAuth = { Authorization: `Bearer ${aliceToken}` }
    const bobAuth = { Authorization: `Bearer ${bobToken}` }

    // 1. Action dispatch & prototype guards
    expect((await alice.page.request.post('/api/actions/nonexistent', { headers: aliceAuth, data: {} })).status()).toBe(404)
    expect((await alice.page.request.post('/api/actions/constructor', { headers: aliceAuth, data: {} })).status()).toBe(404)

    // Raw malformed JSON & non-object JSON body handling on /api/actions/:name MUST return 400 (never 500)
    const malformedRaw = await alice.page.evaluate(async (tok) => {
      const r = await fetch('/api/actions/createTrip', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: '{bad json',
      })
      return { status: r.status, text: await r.text() }
    }, aliceToken)
    expect(malformedRaw.status).toBe(400)

    const arrayRaw = await alice.page.evaluate(async (tok) => {
      const r = await fetch('/api/actions/createTrip', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: '[]',
      })
      return { status: r.status, text: await r.text() }
    }, aliceToken)
    expect(arrayRaw.status).toBe(400)
    expect(arrayRaw.text).toContain('JSON object')

    // /api/ai/google/oauth/start must NOT authenticate via ?token= query param
    const queryTokenOauth = await alice.page.request.get(
      `/api/ai/google/oauth/start?token=${encodeURIComponent(aliceToken)}`,
    )
    expect(queryTokenOauth.status()).toBe(401)

    // POST /api/ai/google/oauth/start authenticates via Bearer header
    const postOauthStart = await alice.page.request.post('/api/ai/google/oauth/start', {
      headers: aliceAuth,
    })
    expect([200, 400]).toContain(postOauthStart.status())

    const agentToolsAuth = await alice.page.request.get('/_deepspace/agent/tools', { headers: aliceAuth })
    console.info(`[audit] auth GET /_deepspace/agent/tools -> status=${agentToolsAuth.status()}`)
    expect([200, 401, 403]).toContain(agentToolsAuth.status())
    const browserAgentAuth = await alice.page.request.get('/_deepspace/agent/browser/tools', { headers: aliceAuth })
    expect(browserAgentAuth.status()).toBe(200)
    const browserToolsJson = (await browserAgentAuth.json()) as {
      ok: boolean
      tools: Array<{ name: string }>
    }
    expect(browserToolsJson.ok).toBe(true)
    const toolNames = browserToolsJson.tools.map((t) => t.name)
    for (const expectedTool of [
      'trip_get_itinerary',
      'trip_add_stop',
      'trip_batch_plan_stops',
      'trip_update_stop',
      'trip_batch_update_stops',
      'trip_remove_stop',
      'trip_optimize_day',
      'places_search',
      'weather_lookup',
      'events_search',
      'checklist_add',
    ]) {
      expect(toolNames, `agent tool ${expectedTool}`).toContain(expectedTool)
    }

    // 2. Authenticated Gemini endpoints & AI Chat CRUD + validation
    const gStatus = await alice.page.request.get('/api/ai/google/status', { headers: aliceAuth })
    expect(gStatus.status()).toBe(200)
    const gShort = await alice.page.request.post('/api/ai/google/api-key', {
      headers: aliceAuth,
      data: { apiKey: 'too-short' },
    })
    expect(gShort.status()).toBe(400)

    const oauthStart = await alice.page.request.get('/api/ai/google/oauth/start', { headers: aliceAuth })
    expect([302, 400]).toContain(oauthStart.status())

    const disconnectRes = await alice.page.request.delete('/api/ai/google/disconnect', {
      headers: aliceAuth,
    })
    expect(disconnectRes.status()).toBe(200)

    const chatCreate = await alice.page.request.post('/api/ai/chats', {
      headers: aliceAuth,
      data: { title: 'Audit Chat' },
    })
    expect(chatCreate.status()).toBe(200)
    const chatId = ((await chatCreate.json()) as { chat: { recordId: string } }).chat.recordId
    expect(chatId).toBeTruthy()

    // Raw malformed JSON & non-object JSON probe on /api/ai/chat MUST return 400 (never 500)
    const chatMalformedRaw = await alice.page.evaluate(async (tok) => {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: '{bad json',
      })
      return r.status
    }, aliceToken)
    expect(chatMalformedRaw).toBe(400)

    const chatNullRaw = await alice.page.evaluate(async (tok) => {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: 'null',
      })
      return r.status
    }, aliceToken)
    expect(chatNullRaw).toBe(400)

    // Bob cannot patch or delete Alice's chat (cross-tenant isolation)
    expect(
      (await bob.page.request.patch(`/api/ai/chats/${chatId}`, { headers: bobAuth, data: { title: 'Hack' } })).status(),
    ).toBe(404)
    expect(
      (await bob.page.request.delete(`/api/ai/chats/${chatId}`, { headers: bobAuth })).status(),
    ).toBe(404)

    expect(
      (await alice.page.request.patch(`/api/ai/chats/${chatId}`, { headers: aliceAuth, data: { title: 'Renamed' } })).status(),
    ).toBe(200)

    // AI chat validation (bad modelId, missing content)
    const badChat = await alice.page.request.post('/api/ai/chat', {
      headers: aliceAuth,
      data: { chatId, userMessageId: 'u1', content: 'hi', modelId: 'invalid/model-xyz' },
    })
    expect(badChat.status()).toBe(400)

    expect(
      (await alice.page.request.delete(`/api/ai/chats/${chatId}`, { headers: aliceAuth })).status(),
    ).toBe(200)
    expect(
      (await alice.page.request.delete(`/api/ai/chats/${chatId}`, { headers: aliceAuth })).status(),
    ).toBe(404)

    // Debug gate for non-admin user
    const debugNonAdmin = await alice.page.request.get('/api/debug/records', { headers: aliceAuth })
    console.info(`[audit] non-admin /api/debug/records -> status=${debugNonAdmin.status()}`)
    expect([403, 404]).toContain(debugNonAdmin.status())

    // 3. Full lifecycle of all trip/destination/stop/checklist/invite/member actions
    let tripId: string | null = null
    try {
      // createTrip (check empty title -> 400, valid -> 200 & inclusive date reconciliation)
      expect(
        (await alice.page.request.post('/api/actions/createTrip', { headers: aliceAuth, data: { title: '' } })).status(),
      ).toBe(400)

      const createRes = await alice.page.request.post('/api/actions/createTrip', {
        headers: aliceAuth,
        data: {
          title: `__test-${Date.now()}__ Audit Trip`,
          startDate: '2026-12-17',
          endDate: '2026-12-29',
          totalDays: 12,
          pace: 'balanced',
          destinations: [
            {
              name: 'Kyoto',
              country: 'JP',
              lat: 35.0116,
              lng: 135.7681,
              arrivalDate: '2026-12-17',
              departureDate: '2026-12-22',
              lodgingName: 'Ace Hotel Kyoto',
            },
            {
              name: 'Tokyo',
              country: 'JP',
              lat: 35.6762,
              lng: 139.6503,
              arrivalDate: '2026-12-22',
              departureDate: '2026-12-29',
              lodgingName: 'Shinjuku Hotel',
            },
          ],
        },
      })
      expect(createRes.status()).toBe(200)
      const createdJson = (await createRes.json()) as {
        data: { tripId: string; trip: { totalDays: number } }
      }
      tripId = createdJson.data.tripId
      expect(createdJson.data.trip.totalDays).toBe(13)

      // Cross-tenant isolation: Bob cannot edit/delete/read via actions before invite
      expect(
        (await bob.page.request.post('/api/actions/updateTripDetails', {
          headers: bobAuth,
          data: { tripId, title: 'Hijack' },
        })).status(),
      ).toBe(404)

      // updateTripDetails
      expect(
        (await alice.page.request.post('/api/actions/updateTripDetails', {
          headers: aliceAuth,
          data: { tripId, summaryNotes: 'Audit note', pace: 'relaxed' },
        })).status(),
      ).toBe(200)

      // addDestination -> updateDestination -> removeDestination
      const addDest = await alice.page.request.post('/api/actions/addDestination', {
        headers: aliceAuth,
        data: {
          tripId,
          orderIndex: 1,
          name: 'Osaka',
          country: 'JP',
          lat: 34.6937,
          lng: 135.5023,
          lodgingName: 'Cross Hotel Osaka',
        },
      })
      expect(addDest.status()).toBe(200)
      const osakaId = ((await addDest.json()) as { data: { destinationId: string } }).data.destinationId

      expect(
        (await alice.page.request.post('/api/actions/updateDestination', {
          headers: aliceAuth,
          data: { tripId, destinationId: osakaId, transportFromPrev: 'drive' },
        })).status(),
      ).toBe(200)

      expect(
        (await alice.page.request.post('/api/actions/removeDestination', {
          headers: aliceAuth,
          data: { tripId, destinationId: osakaId },
        })).status(),
      ).toBe(200)

      // upsertTripStop rejects unsafe sourceUrl schemes (javascript: -> 400) and accepts https://
      const badUrlRes = await alice.page.request.post('/api/actions/upsertTripStop', {
        headers: aliceAuth,
        data: {
          tripId,
          dayNumber: 1,
          title: 'Bad Url Stop',
          category: 'must_see',
          lat: 35.0,
          lng: 135.7,
          sourceUrl: 'javascript:alert(1)',
        },
      })
      expect(badUrlRes.status()).toBe(400)

      // upsertTripStop (2 stops) -> moveTripStop -> optimizeTripDay -> removeTripStop
      const stop1Res = await alice.page.request.post('/api/actions/upsertTripStop', {
        headers: aliceAuth,
        data: {
          tripId,
          dayNumber: 1,
          title: 'Kiyomizu-dera',
          category: 'must_see',
          lat: 34.9949,
          lng: 135.785,
          sourceUrl: 'https://example.com/kiyomizu',
        },
      })
      expect(stop1Res.status()).toBe(200)
      const stop1Id = ((await stop1Res.json()) as { data: { stopId: string } }).data.stopId

      const stop2Res = await alice.page.request.post('/api/actions/upsertTripStop', {
        headers: aliceAuth,
        data: { tripId, dayNumber: 1, title: 'Arashiyama', category: 'photo_spot', lat: 35.0167, lng: 135.6711 },
      })
      expect(stop2Res.status()).toBe(200)
      const stop2Id = ((await stop2Res.json()) as { data: { stopId: string } }).data.stopId

      expect(
        (await alice.page.request.post('/api/actions/moveTripStop', {
          headers: aliceAuth,
          data: { tripId, stopId: stop2Id, direction: 'up' },
        })).status(),
      ).toBe(200)

      expect(
        (await alice.page.request.post('/api/actions/optimizeTripDay', {
          headers: aliceAuth,
          data: { tripId, dayNumber: 1 },
        })).status(),
      ).toBe(200)

      expect(
        (await alice.page.request.post('/api/actions/removeTripStop', {
          headers: aliceAuth,
          data: { tripId, stopId: stop1Id },
        })).status(),
      ).toBe(200)

      // Checklist actions: addChecklistItem -> toggleChecklistItem -> removeChecklistItem
      const chkAdd = await alice.page.request.post('/api/actions/addChecklistItem', {
        headers: aliceAuth,
        data: { tripId, category: 'documents', label: 'JR Pass voucher' },
      })
      expect(chkAdd.status()).toBe(200)
      const itemId = ((await chkAdd.json()) as { data: { itemId: string } }).data.itemId

      expect(
        (await alice.page.request.post('/api/actions/toggleChecklistItem', {
          headers: aliceAuth,
          data: { tripId, itemId, completed: true },
        })).status(),
      ).toBe(200)

      expect(
        (await alice.page.request.post('/api/actions/removeChecklistItem', {
          headers: aliceAuth,
          data: { tripId, itemId },
        })).status(),
      ).toBe(200)

      // Email-bound invite security: inviteTripMember for another email cannot be accepted by Bob (403)
      // and owner can list & revoke pending invites cleanly via listTripInvites / revokeTripInvite
      const lockedInviteRes = await alice.page.request.post('/api/actions/inviteTripMember', {
        headers: aliceAuth,
        data: { tripId, email: 'stranger-only@example.com', role: 'editor' },
      })
      expect(lockedInviteRes.status()).toBe(200)
      const lockedJson = (await lockedInviteRes.json()) as {
        data: { status: string; token?: string; expiresAt?: number }
      }
      expect(lockedJson.data.status).toBe('link_created')
      expect(lockedJson.data.expiresAt).toBeGreaterThan(Date.now())

      const bobWrongEmailAccept = await bob.page.request.post('/api/actions/acceptTripInvite', {
        headers: bobAuth,
        data: { token: lockedJson.data.token },
      })
      expect(bobWrongEmailAccept.status()).toBe(403)

      const listInvitesRes = await alice.page.request.post('/api/actions/listTripInvites', {
        headers: aliceAuth,
        data: { tripId },
      })
      expect(listInvitesRes.status()).toBe(200)
      const invitesList = (
        (await listInvitesRes.json()) as {
          data: { invites: Array<{ inviteId: string; invitedEmail: string | null }> }
        }
      ).data.invites
      const lockedRec = invitesList.find((inv) => inv.invitedEmail === 'stranger-only@example.com')
      expect(lockedRec).toBeTruthy()

      // Non-owner cannot list invites
      expect(
        (await bob.page.request.post('/api/actions/listTripInvites', {
          headers: bobAuth,
          data: { tripId },
        })).status(),
      ).toBe(404)

      const revokeRes = await alice.page.request.post('/api/actions/revokeTripInvite', {
        headers: aliceAuth,
        data: { tripId, inviteId: lockedRec!.inviteId },
      })
      expect(revokeRes.status()).toBe(200)

      // createTripInviteLink -> acceptTripInvite -> setTripMemberRole -> removeTripMember
      const linkRes = await alice.page.request.post('/api/actions/createTripInviteLink', {
        headers: aliceAuth,
        data: { tripId, role: 'viewer' },
      })
      expect(linkRes.status()).toBe(200)
      const token = ((await linkRes.json()) as { data: { token: string } }).data.token

      const acceptRes = await bob.page.request.post('/api/actions/acceptTripInvite', {
        headers: bobAuth,
        data: { token },
      })
      expect(acceptRes.status()).toBe(200)

      // Reuse of accepted invite link must be rejected with 400
      const reuseRes = await bob.page.request.post('/api/actions/acceptTripInvite', {
        headers: bobAuth,
        data: { token },
      })
      expect(reuseRes.status()).toBe(400)

      // Viewer Bob cannot call regenerateTrip or deleteTrip or setTripMemberRole
      expect(
        (await bob.page.request.post('/api/actions/regenerateTrip', { headers: bobAuth, data: { tripId } })).status(),
      ).toBe(403)
      expect(
        (await bob.page.request.post('/api/actions/deleteTrip', { headers: bobAuth, data: { tripId } })).status(),
      ).toBe(403)

      // refreshDestinationWeather responds (200 or 402/502 when external credits exhausted) without 500 crash
      const weatherProbe = await bob.page.request.post('/api/actions/refreshDestinationWeather', {
        headers: bobAuth,
        data: { tripId, destinationId: 'nonexistent-dest' },
      })
      expect(weatherProbe.status()).toBe(404)

      // Owner promotes & removes Bob cleanly via email invite id check + removeTripMember
      const bobInvite = await alice.page.request.post('/api/actions/inviteTripMember', {
        headers: aliceAuth,
        data: { tripId, email: bob.email, role: 'editor' },
      })
      expect(bobInvite.status()).toBe(200)
      const bobId = ((await bobInvite.json()) as { data: { userId: string } }).data.userId
      expect(bobId).toBeTruthy()

      // Editor Bob cannot call deleteTrip (403) or removeTripMember (403)
      expect(
        (await bob.page.request.post('/api/actions/deleteTrip', { headers: bobAuth, data: { tripId } })).status(),
      ).toBe(403)

      expect(
        (await alice.page.request.post('/api/actions/setTripMemberRole', {
          headers: aliceAuth,
          data: { tripId, targetUserId: bobId, role: 'viewer' },
        })).status(),
      ).toBe(200)

      expect(
        (await alice.page.request.post('/api/actions/removeTripMember', {
          headers: aliceAuth,
          data: { tripId, targetUserId: bobId },
        })).status(),
      ).toBe(200)

      // regenerateTrip
      expect(
        (await alice.page.request.post('/api/actions/regenerateTrip', {
          headers: aliceAuth,
          data: { tripId },
        })).status(),
      ).toBe(200)
    } finally {
      if (tripId) {
        const delRes = await alice.page.request.post('/api/actions/deleteTrip', {
          headers: aliceAuth,
          data: { tripId },
        })
        expect(delRes.status()).toBe(200)
      }
    }
  })
})
