import { beforeEach } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'

/** Use in specs that assert German shell copy while the default Vitest locale is English. */
export function useGermanUiInTests() {
  beforeEach(async () => {
    await changeUiLanguage('de')
  })
}
