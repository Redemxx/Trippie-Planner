import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static landing loads without JS errors and shows minimal Trippie copy', async ({
    page,
  }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page.locator('h1')).toContainText('Chart every hour, not just flights.')
    await expect(page.locator('body')).not.toContainText('placeholder page')
    await expect(page.locator('body')).not.toContainText('$12')
    await expect(page.locator('body')).not.toContainText('Hanna Ostrowski')
    await expect(page.locator('body')).not.toContainText('14,200')
    expect(errors).toEqual([])
  })

  test('landing carries one title, one description, one canonical', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/Trippie/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: landing fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })

  test('dynamic /home shows interactive sample atlas preview when signed out', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
    await expect(page.getByTestId('sample-atlas-preview')).toBeVisible()
    await expect(page.getByText('Kiyomizu-dera Temple Terrace')).toBeVisible()
    await page.getByRole('button', { name: 'Day 2' }).click()
    await expect(page.getByText('Arashiyama Bamboo & Okochi Sanso')).toBeVisible()
  })

  test('protected routes prompt sign-in when signed out', async ({ page }) => {
    await page.goto('/trips/new')
    await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 15000 })
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })

  test('phone viewport (390x844) renders / and /home without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    const landingOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    )
    expect(landingOverflow).toBe(true)

    await page.goto('/home')
    await expect(page.getByTestId('sample-atlas-preview')).toBeVisible({ timeout: 15000 })
    const homeOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    )
    expect(homeOverflow).toBe(true)
  })
})
