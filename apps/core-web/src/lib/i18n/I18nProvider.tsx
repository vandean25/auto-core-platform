import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { initI18n, i18n } from './init-i18n'
import type { InitI18nOptions } from './init-i18n'

type I18nProviderProps = {
  children: ReactNode
  initOptions?: InitI18nOptions
}

export function I18nProvider({ children, initOptions }: I18nProviderProps) {
  const [ready, setReady] = useState(i18n.isInitialized)

  useEffect(() => {
    if (i18n.isInitialized) {
      setReady(true)
      return
    }
    void initI18n(initOptions).then(() => setReady(true))
  }, [initOptions])

  if (!ready) {
    return null
  }

  return (
    <I18nextProvider i18n={i18n}>
      <Suspense fallback={null}>{children}</Suspense>
    </I18nextProvider>
  )
}
