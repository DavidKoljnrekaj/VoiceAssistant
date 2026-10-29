// The smoke: the built shell loads, the login form renders in Croatian, the manifest and the
// service worker are served; with E2E_EMAIL / E2E_PASSWORD set, a sign-in reaches the composer.
// Nothing here sends a chat turn, so no API and no model key are needed (docs/OPS.md → CI).
import { expect, test } from '@playwright/test'

test('E01: the login page renders with the manifest and the service worker', async ({ page }) => {
  await page.goto('/login')
  await expect(page).toHaveTitle('Asistent')
  await expect(page.getByRole('heading', { name: 'Asistent' })).toBeVisible()
  await expect(page.getByText('Prijavite se svojim računom tvrtke.')).toBeVisible()
  await expect(page.getByLabel('E-pošta')).toBeVisible()
  await expect(page.getByLabel('Lozinka')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prijavi se' })).toBeVisible()

  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect((await manifest.json()).name).toBe('Asistent')
  const sw = await page.request.get('/sw.js')
  expect(sw.ok()).toBe(true)
  expect(sw.headers()['content-type']).toContain('javascript')
})

test('E02: a protected route sends a signed-out visitor to the login page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('E03: signing in shows the composer', async ({ page }) => {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  test.skip(!email || !password, 'E2E_EMAIL and E2E_PASSWORD are not set')
  await page.goto('/login')
  await page.getByLabel('E-pošta').fill(email!)
  await page.getByLabel('Lozinka').fill(password!)
  await page.getByRole('button', { name: 'Prijavi se' }).click()
  await expect(page.getByLabel('Pošaljite poruku…')).toBeVisible()
})
