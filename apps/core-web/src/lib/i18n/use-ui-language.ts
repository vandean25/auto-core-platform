import { useCallback, useState } from 'react'
import { useTranslation } from './use-translation'
import type { UiLanguage } from './constants'
import { isUiLanguage } from './constants'
import { changeUiLanguage } from './init-i18n'
import { writeStoredUiLanguage } from './storage'

export function useUiLanguage() {
  const { i18n, t } = useTranslation('common')
  const language = isUiLanguage(i18n.language) ? i18n.language : 'de'
  const [isSwitching, setIsSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)

  const setLanguage = useCallback(
    async (next: UiLanguage) => {
      if (next === language) {
        return
      }
      setIsSwitching(true)
      setSwitchError(false)
      try {
        await changeUiLanguage(next)
        writeStoredUiLanguage(next)
      } catch {
        setSwitchError(true)
        await changeUiLanguage(language)
      } finally {
        setIsSwitching(false)
      }
    },
    [language],
  )

  return {
    language,
    setLanguage,
    isSwitching,
    switchError,
    labels: {
      de: t('language.de'),
      en: t('language.en'),
      section: t('language.label'),
      pending: t('language.switchPending'),
      error: t('language.switchError'),
    },
  }
}
