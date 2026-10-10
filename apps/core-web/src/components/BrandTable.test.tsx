import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandTable } from './BrandTable'
import type { Brand } from '@/api/types'

vi.mock('@/api/brands', () => ({
  useDeleteBrand: () => ({ mutateAsync: vi.fn() }),
}))

const brand = (overrides: Partial<Brand>): Brand => ({
  id: 1,
  name: 'Acme',
  isVehicleMake: true,
  isPartManufacturer: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('BrandTable row actions', () => {
  afterEach(() => {
    cleanup()
  })

  it('names the edit and delete icon buttons after the brand they act on', () => {
    render(<BrandTable brands={[brand({ name: 'Acme' })]} onEdit={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Edit brand Acme/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete brand Acme/ })).toBeInTheDocument()
  })

  it('keeps the action names distinct for each row', () => {
    render(
      <BrandTable
        brands={[
          brand({ id: 1, name: 'Acme' }),
          brand({ id: 2, name: 'Bosch', isVehicleMake: false, isPartManufacturer: true }),
        ]}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Edit brand Bosch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete brand Bosch' })).toBeInTheDocument()
  })

  it('opens the editor for the brand whose edit button was clicked', () => {
    const onEdit = vi.fn()
    const acme = brand({ name: 'Acme' })
    render(<BrandTable brands={[acme]} onEdit={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: /Edit brand Acme/ }))

    expect(onEdit).toHaveBeenCalledWith(acme)
  })
})
