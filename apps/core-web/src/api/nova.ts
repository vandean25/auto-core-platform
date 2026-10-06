import { useMutation } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components, operations } from './generated/openapi'

export type NovaCalculateRequest =
  operations['VehicleController_calculateNova']['requestBody']['content']['application/json']
export type NovaCalculateResponse = components['schemas']['NovaCalculateResponseDto']
export type NovaCalculationErrorCode = components['schemas']['NovaCalculationErrorResponseDto']['code']
export type NovaCalculationError = Error & { code?: NovaCalculationErrorCode }

export const novaKeys = {
  all: ['nova'] as const,
  calculate: () => [...novaKeys.all, 'calculate'] as const,
}

async function calculateNova(
  input: NovaCalculateRequest,
): Promise<NovaCalculateResponse> {
  const response = await fetchWithAuth('/api/vehicles/nova/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      code?: NovaCalculationErrorCode
      message?: string | string[]
    }
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : payload.message || 'NoVA-Berechnung fehlgeschlagen'
    throw Object.assign(new Error(message), { code: payload.code }) as NovaCalculationError
  }
  return (await response.json()) as NovaCalculateResponse
}

export function useNovaCalculate() {
  return useMutation({
    mutationKey: novaKeys.calculate(),
    mutationFn: calculateNova,
  })
}
