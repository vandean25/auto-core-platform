import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import deInventory from '../../../../../locales/de/inventory.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { TyreSetActionDialog } from './TyreSetActionDialog'

const { mutateAsync, useLocations } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useLocations: vi.fn(() => ({ data: [
    { id: 'rack-1', code: 'Rack 1', type: 'customer_storage' },
    { id: 'rack-2', code: 'Rack 2', type: 'customer_storage' },
    { id: 'warehouse-1', code: 'Warehouse', type: 'warehouse' },
  ] })),
}))
vi.mock('@/api/locations', () => ({ useLocations }))
vi.mock('@/api/tyre-storage', () => ({
  useTyreSetAction: () => ({ mutateAsync, isPending: false }),
}))
registerGermanUiForTests()
afterEach(cleanup)
beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({})
  useLocations.mockClear()
})

function fillTreads() {
  for (const position of ['Vorne links', 'Vorne rechts', 'Hinten links', 'Hinten rechts']) {
    for (const point of ['Innen', 'Mitte', 'Außen']) {
      fireEvent.change(screen.getByLabelText(`${position} ${point}`), { target: { value: '5.25' } })
    }
  }
}

function renderDialog(action: 'check-in' | 'check-out' | 'move' | 'dispose' | 'inspect', vehicleId: string | null = 'vehicle-1') {
  const onOpenChange = vi.fn()
  render(<TyreSetActionDialog open onOpenChange={onOpenChange} tyreSetId="set-1" action={action} vehicleId={vehicleId} />)
  return onOpenChange
}

describe('TyreSetActionDialog', () => {
  it.each([
    ['check-in', true], ['move', true], ['check-out', false], ['dispose', false], ['inspect', false],
  ] as const)('enables location fetching only when needed for %s', async (action, enabled) => {
    renderDialog(action)
    await screen.findByRole('dialog')
    expect(useLocations).toHaveBeenCalledWith({ enabled })
    expect(Boolean(screen.queryByRole('combobox'))).toBe(enabled)
  })

  it('offers only customer storage racks other than the current location', async () => {
    render(<TyreSetActionDialog open onOpenChange={vi.fn()} tyreSetId="set-1" action="move" currentLocationId="rack-1" />)
    fireEvent.click(await screen.findByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'Rack 2' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Rack 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Warehouse' })).not.toBeInTheDocument()
  })

  it.each(['check-in', 'check-out', 'inspect'] as const)('offers optional measurements for %s without nested forms or hotel photos', async (action) => {
    renderDialog(action)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reifenmessung erfassen' }))
    expect(screen.getByLabelText('Vorne links Innen')).toHaveValue(null)
    expect(document.querySelectorAll('form')).toHaveLength(1)
    expect(document.querySelector('form form')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument()
    expect(screen.getByText('Reifenfotos sind bei Reifensatz-Ereignissen derzeit nicht verfügbar.')).toBeVisible()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('combines check-in readings with location, odometer, note and workshop order', async () => {
    const close = renderDialog('check-in')
    fireEvent.click(await screen.findByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Rack 1' }))
    fireEvent.change(screen.getByLabelText(deInventory.tyreStorage.actionDialog.odometer), { target: { value: '42000' } })
    fireEvent.change(screen.getByLabelText(deInventory.tyreStorage.actionDialog.note), { target: { value: 'Checked' } })
    fireEvent.change(screen.getByLabelText(deInventory.tyreStorage.actionDialog.workshopOrderId), { target: { value: 'order-1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reifenmessung erfassen' }))
    fillTreads()
    fireEvent.change(screen.getByLabelText('Gewichtsklasse'), { target: { value: 'OVER_3500_KG' } })
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'set-1', action: 'check-in', body: expect.objectContaining({
      locationId: 'rack-1', odometer: 42000, note: 'Checked', workshopOrderId: 'order-1', weightClass: 'OVER_3500_KG',
      wheels: expect.arrayContaining([expect.objectContaining({ position: 'FL', treadInnerMm: 5.25, treadMiddleMm: 5.25, treadOuterMm: 5.25 })]),
    }) }))
    expect(close).toHaveBeenCalledWith(false)
  })

  it.each(['check-out', 'inspect'] as const)('saves %s readings without a location', async (action) => {
    renderDialog(action)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reifenmessung erfassen' }))
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'set-1', action, body: expect.objectContaining({ locationId: undefined, wheels: expect.any(Array) }) }))
  })

  it('keeps server measurement errors inline and the dialog open', async () => {
    mutateAsync.mockRejectedValue({ status: 400, data: { code: 'TYRE_DOT_INVALID_WEEK', params: { position: 'FR' }, message: 'Bad Request Exception' } })
    const close = renderDialog('inspect')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reifenmessung erfassen' }))
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(screen.getByLabelText('Vorne rechts DOT')).toHaveAttribute('aria-invalid', 'true'))
    expect(close).not.toHaveBeenCalled()
    expect(screen.queryByText('Bad Request Exception')).not.toBeInTheDocument()
  })

  it('requires a location even when check-in measurement entry is enabled', async () => {
    renderDialog('check-in')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reifenmessung erfassen' }))
    expect(screen.getByRole('button', { name: 'Messung speichern' })).toBeDisabled()
  })

  it('restores the ordinary submit without readings when measurement is toggled off', async () => {
    renderDialog('check-out')
    const checkbox = await screen.findByRole('checkbox', { name: 'Reifenmessung erfassen' })
    fireEvent.click(checkbox)
    fillTreads()
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'set-1', action: 'check-out', body: { locationId: undefined, odometer: undefined, note: undefined, workshopOrderId: undefined } }))
  })

  it.each(['move', 'dispose'] as const)('does not offer measurements for %s', async (action) => {
    renderDialog(action)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('checkbox', { name: 'Reifenmessung erfassen' })).not.toBeInTheDocument()
  })

  it('does not offer measurement entry without a vehicle', async () => {
    renderDialog('check-out', null)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('checkbox', { name: 'Reifenmessung erfassen' })).not.toBeInTheDocument()
  })
})
