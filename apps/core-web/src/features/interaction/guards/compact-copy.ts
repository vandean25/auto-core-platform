import { analyzeSource } from './source-text'

/**
 * Compact copy guard (AUT-1036, Kompakte Texte).
 *
 * Flags page header subtitles (`</h1>` followed by `<p>`), subtitle/description/hint i18n keys,
 * and visible `<DialogDescription>` / `<SheetDescription>` blocks so leftover explanatory copy
 * cannot land without updating the explicit allowlist.
 */

const NON_PRODUCTION_FILE = /\.(?:test|spec|stories|testUtils)\.|(?:^|\/)__tests__\//
const EXCLUDED_PATH = /^components\/ui\//

const PAGE_HEADER_SUBTITLE = /<\/h1>\s*<p[\s>]/g
const SUBTITLE_OR_DESCRIPTION_KEY =
  /\bt\(\s*['"]([^'"]+\.(?:subtitle|description|hint|Subtitle|Description|Hint))['"]/g
const DIALOG_DESCRIPTION = /<(?:DialogDescription|SheetDescription)\b([^>]*)>/g

function isScannedFile(path: string): boolean {
  return path.endsWith('.tsx') && !EXCLUDED_PATH.test(path) && !NON_PRODUCTION_FILE.test(path)
}

function isTableColumnKey(key: string): boolean {
  return key.includes('.columns.') || key.includes('.lineItemsTable.')
}

function fileEntries(path: string, source: string): string[] {
  const analyzed = analyzeSource(source)
  const text = analyzed.masked
  const entries: string[] = []

  entries.push(
    ...Array.from(
      text.matchAll(PAGE_HEADER_SUBTITLE),
      () => `${path}::page-header-subtitle`,
    ),
  )

  for (const match of source.matchAll(SUBTITLE_OR_DESCRIPTION_KEY)) {
    const key = match[1]
    if (key && !isTableColumnKey(key)) {
      entries.push(`${path}::key:${key}`)
    }
  }

  for (const match of source.matchAll(DIALOG_DESCRIPTION)) {
    const attrs = match[1] ?? ''
    if (!attrs.includes('sr-only')) {
      entries.push(`${path}::dialog-description`)
    }
  }

  return entries
}

export function evaluateCompactCopyGuard(
  sources: Readonly<Record<string, string>>,
): { entries: string[] } {
  const entries = Object.entries(sources)
    .filter(([path]) => isScannedFile(path))
    .flatMap(([path, source]) => fileEntries(path, source))
    .sort()
  return { entries }
}
