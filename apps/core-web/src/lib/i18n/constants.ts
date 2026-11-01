export const SUPPORTED_UI_LANGUAGES = ['de', 'en'] as const

export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number]

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'de'

export const UI_LANGUAGE_STORAGE_KEY = 'acp:ui-language'

export const FORMAT_LOCALE = 'de-AT'

export const DEFAULT_TIME_ZONE = 'Europe/Vienna'

export const PRELOAD_NAMESPACES = ['common', 'nav', 'errors', 'glossary', 'enums'] as const

export type PreloadNamespace = (typeof PRELOAD_NAMESPACES)[number]

export const LAZY_NAMESPACES = [
  'workshop',
  'sales',
  'finance',
  'inventory',
  'vehicles',
  'hr',
  'agent',
  'settings',
  'platform',
  'reports',
  'pdf',
  'email',
  'customers',
  'vehicleStock',
] as const

export type LazyNamespace = (typeof LAZY_NAMESPACES)[number]

export type AppNamespace = PreloadNamespace | LazyNamespace

export function isUiLanguage(value: string | null | undefined): value is UiLanguage {
  return value === 'de' || value === 'en'
}
