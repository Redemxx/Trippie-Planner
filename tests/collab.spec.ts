import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })
    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('owner shares trip with viewer (read-only enforced) then promotes to editor for live co-editing', async ({
  users,
}) => {
  const [owner, guest] = await users(2)
  await Promise.all([owner.page.goto('/home'), guest.page.goto('/home')])
  await expect(owner.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })
  await expect(guest.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

  const ownerToken = (
    (await owner.page.evaluate(async () => {
      const r = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      return r.json()
    })) as { token: string }
  ).token
  const guestToken = (
    (await guest.page.evaluate(async () => {
      const r = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      return r.json()
    })) as { token: string }
  ).token

  let tripId: string | null = null
  try {
    const tripTitle = `__test-${Date.now()}__ Shared Lisbon Atlas`
    const createRes = await owner.page.request.post('/api/actions/createTrip', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        title: tripTitle,
        mode: 'detailed',
        totalDays: 3,
        destinations: [{ name: 'Lisbon', country: 'PT', lat: 38.7223, lng: -9.1393 }],
      },
    })
    expect(createRes.status()).toBe(200)
    tripId = ((await createRes.json()) as { data: { tripId: string } }).data.tripId

    // Owner invites guest as a VIEWER via inviteTripMember (by email)
    const inviteRes = await owner.page.request.post('/api/actions/inviteTripMember', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        tripId,
        email: guest.email,
        role: 'viewer',
      },
    })
    expect(inviteRes.status()).toBe(200)
    const inviteBody = (await inviteRes.json()) as {
      success: boolean
      data: { status: string; role: string; userId?: string }
    }
    expect(inviteBody.data.status).toBe('added')
    expect(inviteBody.data.role).toBe('viewer')
    const guestId = inviteBody.data.userId ?? guest.userId ?? ''

    // Guest opens the shared trip and sees Viewer (Read-only) + banner
    await guest.page.goto(`/trips/${tripId}`)
    await expect(guest.page.getByTestId('trip-title')).toHaveText(tripTitle, { timeout: 15_000 })
    await expect(guest.page.getByTestId('trip-role-badge')).toContainText('Viewer')
    await expect(guest.page.getByTestId('viewer-readonly-banner')).toBeVisible()
    await expect(guest.page.getByTestId('add-stop-button')).toHaveCount(0)

    // Server-side RBAC: Viewer attempting a write action must get 403 Forbidden
    const deniedWrite = await guest.page.request.post('/api/actions/upsertTripStop', {
      headers: { Authorization: `Bearer ${guestToken}` },
      data: {
        tripId,
        dayNumber: 1,
        title: 'Unauthorized Stop',
        category: 'must_see',
      },
    })
    expect(deniedWrite.status()).toBe(403)

    // Owner opens trip and adds a stop — Guest (viewer) sees it appear live
    await owner.page.goto(`/trips/${tripId}`)
    await expect(owner.page.getByTestId('trip-title')).toHaveText(tripTitle, { timeout: 15_000 })

    await owner.page.request.post('/api/actions/upsertTripStop', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {
        tripId,
        dayNumber: 1,
        title: 'Alfama Miradouro Sunrise',
        category: 'photo_spot',
        lat: 38.7117,
        lng: -9.1303,
      },
    })
    await expect(guest.page.getByText('Alfama Miradouro Sunrise')).toBeVisible({ timeout: 15_000 })

    // Owner promotes Guest to EDITOR
    const guestUserId = (
      (await owner.page.request.post('/api/actions/setTripMemberRole', {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: {
          tripId,
          targetUserId: guestId,
          role: 'editor',
        },
      }))
    )
    expect(guestUserId.status()).toBe(200)

    // Guest's UI updates in real time to Editor and allows adding a stop
    await expect(guest.page.getByTestId('trip-role-badge')).toContainText('Editor', {
      timeout: 15_000,
    })
    await expect(guest.page.getByTestId('add-stop-button')).toBeVisible({ timeout: 15_000 })

    const editorStopRes = await guest.page.request.post('/api/actions/upsertTripStop', {
      headers: { Authorization: `Bearer ${guestToken}` },
      data: {
        tripId,
        dayNumber: 1,
        title: 'Time Out Market Lunch',
        category: 'restaurant',
        lat: 38.7071,
        lng: -9.1459,
      },
    })
    expect(editorStopRes.status()).toBe(200)

    // Owner sees Guest's edit appear live without reload
    await expect(owner.page.getByText('Time Out Market Lunch')).toBeVisible({ timeout: 15_000 })
  } finally {
    if (tripId) {
      await owner.page.request.post('/api/actions/deleteTrip', {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { tripId },
      })
    }
  }
})
