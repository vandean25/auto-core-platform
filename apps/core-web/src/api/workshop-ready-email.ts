import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'

export type WorkshopReadyEmailNotice = components['schemas']['WorkshopReadyEmailNoticeDto']

export async function resendWorkshopReadyEmail(orderId: string): Promise<WorkshopReadyEmailNotice> {
  const response = await fetchWithAuth(`/api/workshop/orders/${orderId}/ready-email/resend`, {
    method: 'POST',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw Object.assign(new Error('Ready email resend failed'), { status: response.status, body })
  }
  return (await response.json()) as WorkshopReadyEmailNotice
}
