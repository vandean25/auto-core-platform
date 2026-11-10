import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const CLOSED_INVENTORY_PATCH_SCHEMAS = [
  'UpdateInventoryItemDto',
  'GuardedInventoryPricePatchDto',
  'GuardedPriceErrorDto',
];

function forbidAdditionalProperties(schema) {
  if (schema?.type === 'object') {
    schema.additionalProperties = false;
  }
}

function patchGuardedPriceErrorMessage(errorSchema) {
  if (!errorSchema?.properties?.message) {
    return;
  }
  errorSchema.properties.message = {
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  };
  errorSchema.required = (errorSchema.required ?? []).filter(
    (field) => field !== 'code',
  );
}

export function closeGuardedInventoryPatchOpenApiSchemas(document) {
  const schemas = document.components?.schemas;
  if (!schemas) {
    return;
  }
  for (const name of CLOSED_INVENTORY_PATCH_SCHEMAS) {
    forbidAdditionalProperties(schemas[name]);
  }
  patchGuardedPriceErrorMessage(schemas.GuardedPriceErrorDto);
}

export function writeOpenApiJson(document, cwd = process.cwd()) {
  const outputDir = join(cwd, 'openapi');
  const outputFile = join(outputDir, 'openapi.json');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return outputFile;
}

export function runOpenApiGeneratorCli(run) {
  run().catch((error) => {
    console.error('Failed to generate OpenAPI spec:');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
}
