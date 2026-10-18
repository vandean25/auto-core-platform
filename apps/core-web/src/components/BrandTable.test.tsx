import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandTable } from './BrandTable'
import type { Brand } from '@/api/types'
import deSettings from '../../../../locales/de/settings.json'

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

const editLabel = (name: string) => deSettings.brands.table.editAria.replace('{{name}}', name)
const deleteLabel = (name: string) => deSettings.brands.table.deleteAria.replace('{{name}}', name)

describe('BrandTable row actions', () => {
  afterEach(() => {
    cleanup()
  })

  it('names the edit and delete icon buttons after the brand they act on', () => {
    render(<BrandTable brands={[brand({ name: 'Acme' })]} onEdit={vi.fn()} />)

    expect(screen.getByRole('button', { name: new RegExp(editLabel('Acme')) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(deleteLabel('Acme')) })).toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: editLabel('Bosch') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: deleteLabel('Bosch') })).toBeInTheDocument()
  })

  it('opens the editor for the brand whose edit button was clicked', () => {
    const onEdit = vi.fn()
    const acme = brand({ name: 'Acme' })
    render(<BrandTable brands={[acme]} onEdit={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(editLabel('Acme')) }))

    expect(onEdit).toHaveBeenCalledWith(acme)
  })
})
