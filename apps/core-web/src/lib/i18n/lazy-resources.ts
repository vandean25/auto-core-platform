import type { AppNamespace } from './constants'

const localeModules = import.meta.glob('../../../../../locales/*/*.json') as Record<
  string,
  () => Promise<{ default: Record<string, unknown> }>
>

function resourcePath(language: string, namespace: AppNamespace): string {
  return `../../../../../locales/${language}/${namespace}.json`
}

export async function loadNamespace(language: string, namespace: AppNamespace): Promise<Record<string, unknown>> {
  const loader = localeModules[resourcePath(language, namespace)]
  if (!loader) {
    throw new Error(`Missing locale resource: ${language}/${namespace}`)
  }
  const module = await loader()
  return module.default
}
