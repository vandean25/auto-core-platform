export const CATALOGUE_SOURCE_KIND_LABELS: Record<string, string> = {
  STATUTORY_REFERENCE: 'Gesetzliche Referenz',
  TEST_ONLY: 'Nur Test',
}

export const CATALOGUE_COVERAGE_LABELS: Record<string, string> = {
  SUBSET: 'Teilmenge',
  COMPLETE: 'Vollständig',
}

export function formatCatalogueSourceKind(value: string): string {
  return CATALOGUE_SOURCE_KIND_LABELS[value] ?? value
}

export function formatCatalogueCoverage(value: string): string {
  return CATALOGUE_COVERAGE_LABELS[value] ?? value
}
