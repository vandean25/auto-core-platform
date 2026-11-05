import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as consentApi from '@/api/customer-consent'
import { CustomerConsentPanel } from './CustomerConsentPanel'

vi.mock('@/api/customer-consent')

function mockQueries(
  preferences: { data?: unknown; isLoading: boolean },
  history: { data?: unknown; isLoading: boolean },
) {
  vi.mocked(consentApi.useCustomerCommunicationPreferences).mockReturnValue(
    preferences as unknown as ReturnType<typeof consentApi.useCustomerCommunicationPreferences>,
  )
  vi.mocked(consentApi.useCustomerCommunicationHistory).mockReturnValue(
    history as unknown as ReturnType<typeof consentApi.useCustomerCommunicationHistory>,
  )
}

describe('CustomerConsentPanel loading states (AUT-659)', () => {
  beforeEach(() => {
    vi.mocked(consentApi.useRecordCommunicationEvent).mockReturnValue(
      { mutateAsync: vi.fn(), isPending: false } as unknown as ReturnType<typeof consentApi.useRecordCommunicationEvent>,
    )
  })
  afterEach(cleanup)

  // Regression: the loading state was a bare "…" with no skeleton and no status for screen readers.
  it('WHEN the consent preferences are loading THEN a labelled Skeleton is shown instead of the dots', async () => {
    mockQueries({ data: undefined, isLoading: true }, { data: undefined, isLoading: true })
    const { container } = render(<CustomerConsentPanel customerId='cust-1' />)

    expect(await screen.findByRole('status')).toHaveTextContent('Laden')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText('…')).toBeNull()
  })

  // Regression: the history card showed a bare "…" while the history loaded.
  it('WHEN the communication history is loading THEN a labelled Skeleton is shown in the history card', async () => {
    mockQueries(
      { data: { preferences: [], controller_legal_entity_id: 'le-1', controller_legal_entity_name: null }, isLoading: false },
      { data: undefined, isLoading: true },
    )
    const { container } = render(<CustomerConsentPanel customerId='cust-1' />)

    expect(await screen.findByRole('status')).toHaveTextContent('Laden')
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1)
    expect(screen.queryByText('…')).toBeNull()
  })
})
