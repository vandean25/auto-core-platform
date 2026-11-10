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

function sortOperationParameters(operation) {
  if (
    operation &&
    typeof operation === 'object' &&
    Array.isArray(operation.parameters)
  ) {
    operation.parameters.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }
}

export function stabilizeOpenApiParameterOrder(document) {
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const operation of Object.values(pathItem)) {
      sortOperationParameters(operation);
    }
  }
}
