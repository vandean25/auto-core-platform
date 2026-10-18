import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  DEFAULT_UI_LANGUAGE,
  PRELOAD_NAMESPACES,
  type AppNamespace,
  type UiLanguage,
} from './constants'
import { loadNamespace } from './lazy-resources'
import { applyZodLocale } from './zod-locale'
import { resolveInitialUiLanguage } from './storage'
import { syncDocumentLang } from './sync-document-lang'
import { refreshMountedFormValidations } from './form-validation-refresh'
import { ensureCustomerSearchI18n } from '@/components/sales/customer-search-i18n'

export type InitI18nOptions = {
  language?: UiLanguage
}

/** CustomerSearch combobox copy must resolve on first paint (not lazy-only). */
const STARTUP_PRELOAD_NAMESPACES: readonly AppNamespace[] = [...PRELOAD_NAMESPACES, 'customers']

async function preloadNamespaces(language: UiLanguage): Promise<void> {
  const bundles = await Promise.all(
    STARTUP_PRELOAD_NAMESPACES.map(async (namespace) => [namespace, await loadNamespace(language, namespace)] as const),
  )
  for (const [namespace, resources] of bundles) {
    i18n.addResourceBundle(language, namespace, resources, true, true)
  }
}

export async function initI18n(options: InitI18nOptions = {}): Promise<typeof i18n> {
  const language = options.language ?? resolveInitialUiLanguage()

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: DEFAULT_UI_LANGUAGE,
      supportedLngs: ['de', 'en'],
      ns: [...STARTUP_PRELOAD_NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: true },
      returnNull: false,
      react: { useSuspense: true },
      partialBundledLanguages: true,
      load: 'languageOnly',
    })
  } else {
    await i18n.changeLanguage(language)
  }

  await preloadNamespaces(language)
  await ensureCustomerSearchI18n()
  syncDocumentLang(language)
  applyZodLocale(language)

  return i18n
}

function listLoadedNamespaces(forLanguage: string): AppNamespace[] {
  const bundle = i18n.services.resourceStore.data[forLanguage]
  if (!bundle) {
    return [...PRELOAD_NAMESPACES]
  }
  return Object.keys(bundle) as AppNamespace[]
}

export async function ensureNamespaceLoaded(namespace: AppNamespace): Promise<void> {
  const language = i18n.language
  if (i18n.hasResourceBundle(language, namespace)) {
    return
  }
  const resources = await loadNamespace(language, namespace)
  i18n.addResourceBundle(language, namespace, resources, true, true)
}

export async function changeUiLanguage(nextLanguage: UiLanguage): Promise<void> {
  const current = i18n.language as UiLanguage
  if (current === nextLanguage) {
    return
  }

  const namespacesToLoad = new Set<AppNamespace>([
    ...(i18n.options.ns ?? PRELOAD_NAMESPACES) as AppNamespace[],
    ...listLoadedNamespaces(current),
  ])

  for (const namespace of namespacesToLoad) {
    if (!i18n.hasResourceBundle(nextLanguage, namespace)) {
      const resources = await loadNamespace(nextLanguage, namespace)
      i18n.addResourceBundle(nextLanguage, namespace, resources, true, true)
    }
  }

  await i18n.changeLanguage(nextLanguage)
  syncDocumentLang(nextLanguage)
  applyZodLocale(nextLanguage)
  await refreshMountedFormValidations()
}

export { i18n }
