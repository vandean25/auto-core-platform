import { translateEnumOptions } from '@/lib/i18n'

export const SOURCE_LANGUAGE_CODES = [
  'de-DE',
  'en-US',
  'pl-PL',
  'hr-HR',
  'sr-RS',
  'bs-BA',
  'tr-TR',
  'it-IT',
  'fr-FR',
  'es-ES',
  'cs-CZ',
  'sk-SK',
  'hu-HU',
  'ro-RO',
  'uk-UA',
] as const

export const TARGET_LANGUAGE_CODES = ['de', 'en', 'pl', 'hr', 'sr', 'bs', 'tr', 'it', 'fr', 'es', 'cs', 'sk', 'hu', 'ro', 'uk'] as const

/** Name of a spoken-language code in the UI language (`enums:voiceSourceLanguage.*`); an unknown code shows as it is. */
export function formatSourceLanguage(code: string): string {
  return translateEnumOptions(['voiceSourceLanguage', code], { defaultValue: code })
}

/** Name of a translation target language in the UI language (`enums:voiceTargetLanguage.*`). */
export function formatTargetLanguage(code: string): string {
  return translateEnumOptions(['voiceTargetLanguage', code], { defaultValue: code })
}
