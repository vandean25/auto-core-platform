import { z } from 'zod'
import de from 'zod/v4/locales/de.js'
import en from 'zod/v4/locales/en.js'
import type { UiLanguage } from './constants'

const zodLocaleByUiLanguage: Record<UiLanguage, () => ReturnType<typeof de>> = {
  de,
  en,
}

export function applyZodLocale(language: UiLanguage): void {
  z.config(zodLocaleByUiLanguage[language]())
}
