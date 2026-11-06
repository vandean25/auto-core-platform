import { describe, expect, it } from 'vitest'
import { isVehicleStockCursorMode, vehicleGewaehrleistungKeys } from './vehicle-stock'
import type { components } from './generated/openapi'

describe('vehicleGewaehrleistungKeys', () => {
  it('separates due-window caches while sharing a domain root', () => {
    expect(vehicleGewaehrleistungKeys.all).toEqual(['vehicle-gewaehrleistung'])
    expect(vehicleGewaehrleistungKeys.due(30)).not.toEqual(vehicleGewaehrleistungKeys.due(60))
    expect(vehicleGewaehrleistungKeys.due(30)).toEqual(['vehicle-gewaehrleistung', 'due', 30])
  })
})

it('exposes warranty notes as nullable strings in generated sale contracts', () => {
  const createNote: components['schemas']['CreateVehicleSaleDto']['gewaehrleistung_note'] = 'Notiz'
  const updateNote: components['schemas']['PatchVehicleSaleDto']['gewaehrleistung_note'] = null
  expect(createNote).toBe('Notiz')
  expect(updateNote).toBeNull()
})

describe('isVehicleStockCursorMode', () => {
  // Regression (AUT-890): the API refuses cursor paging without a status that excludes the merged draft purchases
  // (LIST_CURSOR_STOCK_FILTER_REQUIRED) and for non-whitelisted sorts, so those states must stay on offset paging.
  it.each([
    ['IN_STOCK', undefined, true],
    ['SOLD', 'make', true],
    ['RESERVED', 'updatedAt', true],
    [undefined, undefined, false],
    ['ON_ORDER', 'make', false],
    ['IN_STOCK', 'stock_status', false],
    ['unknown', 'make', false],
  ])('status %s + sortField %s -> cursor mode %s', (stockStatus, sortField, expected) => {
    expect(isVehicleStockCursorMode({ stockStatus, sortField })).toBe(expected)
  })
})
