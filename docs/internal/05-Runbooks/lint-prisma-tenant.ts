// CI Schema Governance: Prisma Linter for Row-Level Multi-Tenancy
// This script parses the schema.prisma file to ensure that any model 
// with a 'tenant_id' field correctly includes 'tenant_id' in all
// @@unique indices. Fails CI if constraints are violated.

import * as fs from 'fs';
import * as path from 'path';

// Usage: ts-node lint-prisma-tenant.ts [path-to-schema.prisma]
const schemaPath = process.argv[2] || path.join(__dirname, '../../schema.prisma');

function runLinter() {
  if (!fs.existsSync(schemaPath)) {
    console.error(`[Error] Schema file not found at: ${schemaPath}`);
    process.exit(1);
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  let hasErrors = false;

  // Split by models
  const modelRegex = /model\s+([A-Z]\w+)\s*{([^}]+)}/g;
  let match;

  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const modelBody = match[2];

    // Check if model has a tenant_id
    const hasTenantId = /^\s+tenant_id\s+/m.test(modelBody);

    if (hasTenantId) {
      // Find all unique constraints
      // Check for field-level @unique
      const fieldUniqueRegex = /^\s+(\w+)\s+[^@\n]+@unique/gm;
      let fieldMatch;
      while ((fieldMatch = fieldUniqueRegex.exec(modelBody)) !== null) {
        const fieldName = fieldMatch[1];
        if (fieldName !== 'tenant_id') {
          console.error(`[Lint Error] Model '${modelName}' uses field-level @unique on '${fieldName}'. This violates multi-tenant isolation. Use @@unique([tenant_id, ${fieldName}]) instead.`);
          hasErrors = true;
        }
      }

      // Check for block-level @@unique
      const blockUniqueRegex = /@@unique\(\[([^\]]+)\]/g;
      let blockMatch;
      while ((blockMatch = blockUniqueRegex.exec(modelBody)) !== null) {
        const fieldsStr = blockMatch[1];
        const fields = fieldsStr.split(',').map(f => f.trim().replace(/['"]/g, ''));
        
        // tenant_id must be the FIRST field in the unique constraint
        if (fields[0] !== 'tenant_id') {
          console.error(`[Lint Error] Model '${modelName}' has @@unique constraint [${fields.join(', ')}] that does not start with 'tenant_id'.`);
          hasErrors = true;
        }
      }
    }
  }

  if (hasErrors) {
    console.error('\n[Failed] Prisma schema failed tenant isolation linting. Please fix the above errors.');
    process.exit(1);
  } else {
    console.log('\n[Success] Prisma schema passed tenant isolation linting.');
    process.exit(0);
  }
}

runLinter();
