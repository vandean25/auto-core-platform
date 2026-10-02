import type { ImportFieldDefinition } from './import-field-labels'

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

function headerMatchesAlias(header: string, alias: string): boolean {
  const normalizedHeader = normalizeHeader(header)
  const normalizedAlias = normalizeHeader(alias)
  return (
    normalizedHeader === normalizedAlias ||
    normalizedHeader.replace(/\s/g, '') === normalizedAlias.replace(/\s/g, '')
  )
}

function findHeaderForAlias(
  csvHeaders: string[],
  usedHeaders: Set<string>,
  alias: string,
): string | undefined {
  return csvHeaders.find((header) => {
    if (usedHeaders.has(header)) return false
    return headerMatchesAlias(header, alias)
  })
}

function matchFieldToHeader(
  csvHeaders: string[],
  usedHeaders: Set<string>,
  field: ImportFieldDefinition,
): string | undefined {
  const labelCandidates = [field.labelDe, field.labelEn]
  for (const label of labelCandidates) {
    const match = findHeaderForAlias(csvHeaders, usedHeaders, label)
    if (match) return match
  }

  for (const alias of field.headerAliases ?? []) {
    const match = findHeaderForAlias(csvHeaders, usedHeaders, alias)
    if (match) return match
  }

  return undefined
}

export function suggestColumnMapping(
  csvHeaders: string[],
  fields: ImportFieldDefinition[],
): Record<string, string> {
  const usedHeaders = new Set<string>()
  const mapping: Record<string, string> = {}

  for (const field of fields) {
    const match = matchFieldToHeader(csvHeaders, usedHeaders, field)
    if (match) {
      mapping[field.key] = match
      usedHeaders.add(match)
    }
  }

  return mapping
}

export function constrainMappingToCsvHeaders(
  mapping: Record<string, string>,
  csvHeaders: string[],
): Record<string, string> {
  const headerSet = new Set(csvHeaders)
  const constrained: Record<string, string> = {}
  for (const [key, column] of Object.entries(mapping)) {
    const trimmed = column?.trim()
    if (trimmed && headerSet.has(trimmed)) {
      constrained[key] = trimmed
    }
  }
  return constrained
}

export function validateRequiredMappings(
  mapping: Record<string, string>,
  fields: ImportFieldDefinition[],
): string[] {
  const missing: string[] = []
  for (const field of fields) {
    if (!field.required) continue
    const column = mapping[field.key]?.trim()
    if (!column) {
      missing.push(field.key)
    }
  }
  return missing
}
