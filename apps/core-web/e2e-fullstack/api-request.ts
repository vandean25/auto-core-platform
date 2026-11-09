import { type Page } from '@playwright/test'

export async function apiGetStatus(page: Page, path: string, token?: string) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return page.request.get(path, { headers })
}
