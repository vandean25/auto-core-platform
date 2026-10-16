import type { UiLanguage } from './constants'

export function syncDocumentLang(language: UiLanguage): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.lang = language
}
