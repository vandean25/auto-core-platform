/// <reference types="node" />

import * as fs from 'node:fs';
import * as path from 'node:path';

export function lintPrismaTenantSchema(schemaContent: string): void {
  const modelRegex = /model\s+([A-Z]\w+)\s*{([\s\S]*?)}/g;

  for (const match of schemaContent.matchAll(modelRegex)) {
    const modelName = match[1];
    const modelBody = match[2];
    const hasTenantId = /^\s+tenant_id\s+/m.test(modelBody);

    if (!hasTenantId) {
      continue;
    }

    const fieldUniqueRegex = /^\s+(\w+)\s+[^\n@]*@unique\b/gm;
    for (const fieldMatch of modelBody.matchAll(fieldUniqueRegex)) {
      const fieldName = fieldMatch[1];
      if (fieldName !== 'tenant_id') {
        throw new Error(
          `[Lint Error] Model '${modelName}' uses field-level @unique on '${fieldName}'. This violates multi-tenant isolation. Use @@unique([tenant_id, ${fieldName}]) instead.`,
        );
      }
    }

    const blockUniqueRegex = /@@unique\(\[([^\]]+)\]/g;
    for (const blockMatch of modelBody.matchAll(blockUniqueRegex)) {
      const fields = blockMatch[1]
        .split(',')
        .map((field) => field.trim().replace(/["']/g, ''));

      if (fields[0] !== 'tenant_id') {
        throw new Error(
          `[Lint Error] Model '${modelName}' has @@unique constraint [${fields.join(', ')}] that does not start with 'tenant_id'.`,
        );
      }
    }
  }
}

function main() {
  const schemaPath =
    process.argv[2] ?? path.join(process.cwd(), 'prisma', 'schema.prisma');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`[Error] Schema file not found at: ${schemaPath}`);
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  lintPrismaTenantSchema(schemaContent);
  console.log('[Success] Prisma schema passed tenant isolation linting.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}