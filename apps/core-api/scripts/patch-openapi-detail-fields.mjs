import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOpenApiDetailFieldPatches } from './openapi-detail-field-patches.mjs';

const openapiPath = join(process.cwd(), 'openapi', 'openapi.json');
const document = JSON.parse(readFileSync(openapiPath, 'utf8'));
applyOpenApiDetailFieldPatches(document);
writeFileSync(openapiPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
