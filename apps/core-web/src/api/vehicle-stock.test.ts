import { describe, expect, it } from 'vitest'
import { vehicleGewaehrleistungKeys } from './vehicle-stock'
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
