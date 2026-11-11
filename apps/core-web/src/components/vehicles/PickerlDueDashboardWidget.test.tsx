import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as vehiclesApi from '@/api/vehicles'
import { PickerlDueDashboardWidget } from './PickerlDueDashboardWidget'

vi.mock('@/api/vehicles')

function renderWidget() {
  return render(
    <MemoryRouter><PickerlDueDashboardWidget window={30} /></MemoryRouter>,
  )
}

describe('PickerlDueDashboardWidget', () => {
  // Regression: the count was replaced by a rotating spinner while loading.
  it('WHEN the Pickerl due count is loading THEN a Skeleton is shown instead of a spinner', async () => {
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: undefined,
      isPending: true,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)
    const { container, findByText } = renderWidget()

    await findByText(/Pickerl/)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('shows the total of the due list once loaded', async () => {
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: { meta: { total: 7 } },
      isPending: false,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)
    const { container, findByText } = renderWidget()

    expect(await findByText('7')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
