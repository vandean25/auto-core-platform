import { beforeEach } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'

/** Register a beforeEach hook that switches Vitest to German UI for specs that assert DE copy. */
export function registerGermanUiForTests() {
  beforeEach(async () => {
    await changeUiLanguage('de')
  })
}
