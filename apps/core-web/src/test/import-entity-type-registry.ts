import { readFileSync } from 'node:fs'

import type { ImportEntityTypeEntry } from '@/api/imports'

type OpenApiDocument = {
  components: {
    schemas: {
      ImportEntityTypeListResponseDto: { properties: { data: { example: ImportEntityTypeEntry[] } } }
    }
  }
}

/** Registry entries as core-api publishes them in the committed OpenAPI document. */
export function readImportEntityTypeRegistry(): ImportEntityTypeEntry[] {
  const document = JSON.parse(
    readFileSync('../core-api/openapi/openapi.json', 'utf8'),
  ) as OpenApiDocument
  return document.components.schemas.ImportEntityTypeListResponseDto.properties.data.example
}
