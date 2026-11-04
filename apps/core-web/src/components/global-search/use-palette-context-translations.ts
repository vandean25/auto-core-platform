import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

export type PaletteContextTranslations = {
  nav: TFunction<'nav'>
  workshop: TFunction<'workshop'>
  customers: TFunction<'customers'>
  vehicles: TFunction<'vehicles'>
  finance: TFunction<'finance'>
}

export function usePaletteContextTranslations(): PaletteContextTranslations {
  const { t: nav } = useTranslation('nav')
  const { t: workshop } = useTranslation('workshop')
  const { t: customers } = useTranslation('customers')
  const { t: vehicles } = useTranslation('vehicles')
  const { t: finance } = useTranslation('finance')

  return useMemo(
    () => ({ nav, workshop, customers, vehicles, finance }),
    [nav, workshop, customers, vehicles, finance],
  )
}
