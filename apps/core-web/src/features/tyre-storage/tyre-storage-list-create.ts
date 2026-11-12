import type { TFunction } from 'i18next'

export type TyreSetCreateGate = {
  customerId?: string
  openCreate: () => void
  showSelectCustomer: (message: string) => void
}

/** Opens the create dialog when a customer is selected; otherwise shows the existing toast. */
export function requestTyreSetCreate(gate: TyreSetCreateGate, t: TFunction<'inventory'>): void {
  if (!gate.customerId) {
    gate.showSelectCustomer(t('tyreStorage.list.selectCustomerToCreate'))
    return
  }
  gate.openCreate()
}
