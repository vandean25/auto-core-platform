import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PageContainer } from './PageContainer'

afterEach(cleanup)

describe('PageContainer breadcrumbs', () => {
  it('renders the breadcrumb trail above the page content', () => {
    render(
      <MemoryRouter>
        <PageContainer
          breadcrumbs={[{ label: 'Customers', to: '/customers' }, { label: 'Jane Smith' }]}
        >
          <h1>Jane Smith</h1>
        </PageContainer>
      </MemoryRouter>,
    )

    const landmark = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Jane Smith' })

    expect(landmark.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no breadcrumb landmark when no trail is given', () => {
    render(
      <MemoryRouter>
        <PageContainer>
          <h1>Customers</h1>
        </PageContainer>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  })

  it('renders no breadcrumb landmark for an empty trail', () => {
    render(
      <MemoryRouter>
        <PageContainer breadcrumbs={[]}>
          <h1>Customers</h1>
        </PageContainer>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  })
})
