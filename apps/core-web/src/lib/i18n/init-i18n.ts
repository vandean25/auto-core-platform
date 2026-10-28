import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  DEFAULT_UI_LANGUAGE,
  LAZY_NAMESPACES,
  PRELOAD_NAMESPACES,
  type AppNamespace,
  type UiLanguage,
} from './constants'
import { loadNamespace } from './lazy-resources'
import { applyZodLocale } from './zod-locale'
import { resolveInitialUiLanguage } from './storage'
import { syncDocumentLang } from './sync-document-lang'
import { refreshMountedFormValidations } from './form-validation-refresh'

export type InitI18nOptions = {
  language?: UiLanguage
}

/** Every namespace the app can render. A switch has to cover all of them, not only the ones loaded so far. */
const APP_NAMESPACES: readonly AppNamespace[] = [...PRELOAD_NAMESPACES, ...LAZY_NAMESPACES]

async function loadBundle(language: UiLanguage, namespace: AppNamespace): Promise<void> {
  if (i18n.hasResourceBundle(language, namespace)) {
    return
  }
  const resources = await loadNamespace(language, namespace)
  i18n.addResourceBundle(language, namespace, resources, true, true)
}

async function preloadNamespaces(language: UiLanguage): Promise<void> {
  await Promise.all(PRELOAD_NAMESPACES.map((namespace) => loadBundle(language, namespace)))
}

export async function initI18n(options: InitI18nOptions = {}): Promise<typeof i18n> {
  const language = options.language ?? resolveInitialUiLanguage()

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: DEFAULT_UI_LANGUAGE,
      supportedLngs: ['de', 'en'],
      ns: [...PRELOAD_NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: true },
      returnNull: false,
      // Lazy namespaces are added after first render; re-render on 'added' so their keys are not left raw.
      react: { useSuspense: true, bindI18nStore: 'added' },
      partialBundledLanguages: true,
      load: 'languageOnly',
    })
  } else {
    await i18n.changeLanguage(language)
  }

  await preloadNamespaces(language)
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

/**
 * Adds one lazily loaded namespace. When the language changes while the bundle is in flight, the
 * bundle for the new language is loaded as well; otherwise that namespace would keep rendering the
 * fallback language (German) until the page is reloaded.
 */
export async function ensureNamespaceLoaded(namespace: AppNamespace): Promise<void> {
  const requestedLanguage = i18n.language as UiLanguage
  await loadBundle(requestedLanguage, namespace)

  const activeLanguage = i18n.language as UiLanguage
  if (activeLanguage !== requestedLanguage) {
    await loadBundle(activeLanguage, namespace)
  }
}

export async function changeUiLanguage(nextLanguage: UiLanguage): Promise<void> {
  const current = i18n.language as UiLanguage
  if (current === nextLanguage) {
    return
  }

  // Every namespace, not only the loaded ones: pages mount their bundle before rendering, so a
  // namespace that was not loaded yet would otherwise stay in the fallback language.
  const namespacesToLoad = new Set<AppNamespace>([...APP_NAMESPACES, ...listLoadedNamespaces(current)])

  await Promise.all([...namespacesToLoad].map((namespace) => loadBundle(nextLanguage, namespace)))

  await i18n.changeLanguage(nextLanguage)
  syncDocumentLang(nextLanguage)
  applyZodLocale(nextLanguage)
  await refreshMountedFormValidations()
}

export { i18n }
