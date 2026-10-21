import { DEFAULT_UI_LANGUAGE, isUiLanguage, UI_LANGUAGE_STORAGE_KEY, type UiLanguage } from './constants'

export function readStoredUiLanguage(): UiLanguage | null {
  if (typeof window === 'undefined') {
    return null
  }
  const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)
  return isUiLanguage(stored) ? stored : null
}

export function writeStoredUiLanguage(language: UiLanguage): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language)
}

export function resolveInitialUiLanguage(): UiLanguage {
  return readStoredUiLanguage() ?? DEFAULT_UI_LANGUAGE
}
