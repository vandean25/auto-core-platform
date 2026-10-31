import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Tenant Isolation Raw SQL Audit', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url));
  const coreApiRoot = fileURLToPath(new URL('../..', import.meta.url));
  const schemaPath = path.resolve(coreApiRoot, 'prisma/schema.prisma');

  function getTenantScopedTables(): Set<string> {
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const modelBlocks = schemaContent.split('model ');
    const tenantTables = new Set<string>();

    for (let i = 1; i < modelBlocks.length; i++) {
      const block = modelBlocks[i];
      const modelName = block.split(/\s+/)[0];
      if (block.includes('tenant_id') || block.includes('tenantId')) {
        const mapMatch = block.match(/@@map\("([^"]+)"\)/);
        const tableName = mapMatch ? mapMatch[1] : modelName;
        tenantTables.add(tableName.toLowerCase());
      }
    }
    return tenantTables;
  }

  function getSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getSourceFiles(fullPath));
      } else if (
        entry.isFile() &&
        fullPath.endsWith('.ts') &&
        !fullPath.endsWith('.spec.ts') &&
        !fullPath.endsWith('.e2e-spec.ts') &&
        !fullPath.endsWith('.test.ts') &&
        !fullPath.includes('fixtures') &&
        !fullPath.includes('spec.support.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  function auditRawQuery(
    queryBlock: string,
    tenantTables: Set<string>,
  ): { referencedTables: string[]; isValid: boolean } {
    const normalizedBlock = queryBlock
      .replace(/["`]/g, '')
      .replace(/\bpublic\./gi, '');
    const referencedTables: string[] = [];
    for (const table of tenantTables) {
      const regex = new RegExp(
        `\\b(from|join|update|into)\\s+${table}\\b`,
        'i',
      );
      if (regex.test(normalizedBlock)) {
        referencedTables.push(table);
      }
    }

    if (referencedTables.length === 0) {
      // Not referencing a tenant-scoped table (e.g. advisory lock, db ping, non-tenant table)
      return { referencedTables, isValid: true };
    }

    // Must explicitly include tenant_id
    const isValid = queryBlock.includes('tenant_id');
    return { referencedTables, isValid };
  }

  it('every raw query in application code on a tenant-scoped table includes tenant_id', () => {
    const tenantTables = getTenantScopedTables();
    expect(tenantTables.size).toBeGreaterThan(50);

    const files = getSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(100);

    const violations: Array<{
      file: string;
      line: number;
      tables: string[];
      query: string;
    }> = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (!content.includes('$queryRaw') && !content.includes('$executeRaw')) {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('$queryRaw') || line.includes('$executeRaw')) {
          const queryBlock = lines
            .slice(i, Math.min(i + 25, lines.length))
            .join('\n');
          const result = auditRawQuery(queryBlock, tenantTables);

          if (!result.isValid) {
            violations.push({
              file: path.relative(coreApiRoot, file),
              line: i + 1,
              tables: result.referencedTables,
              query: queryBlock.slice(0, 200),
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('adversarial check: raw query on tenant table without tenant_id is rejected by audit', () => {
    const tenantTables = new Set(['workshop_orders', 'invoices', 'vehicles']);

    const validQuery = `
      SELECT id, status FROM workshop_orders
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE
    `;
    const validResult = auditRawQuery(validQuery, tenantTables);
    expect(validResult.isValid).toBe(true);
    expect(validResult.referencedTables).toEqual(['workshop_orders']);

    const adversarialQuery = `
      SELECT id, status FROM workshop_orders
      WHERE id = $1
      FOR UPDATE
    `;
    const adversarialResult = auditRawQuery(adversarialQuery, tenantTables);
    expect(adversarialResult.isValid).toBe(false);
    expect(adversarialResult.referencedTables).toEqual(['workshop_orders']);
  });

  it('adversarial check: raw query with quoted identifiers without tenant_id is rejected by audit', () => {
    const tenantTables = new Set(['sites', 'customers', 'vehicles']);

    const validQuoted = `
      SELECT id FROM "sites"
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE
    `;
    const validResult = auditRawQuery(validQuoted, tenantTables);
    expect(validResult.isValid).toBe(true);
    expect(validResult.referencedTables).toEqual(['sites']);

    const adversarialQuoted = `
      SELECT id FROM "customers"
      WHERE id = $1
    `;
    const adversarialResult = auditRawQuery(adversarialQuoted, tenantTables);
    expect(adversarialResult.isValid).toBe(false);
    expect(adversarialResult.referencedTables).toEqual(['customers']);

    const updateQuoted = `
      UPDATE "vehicles" SET status = 'SOLD' WHERE id = $1
    `;
    const updateResult = auditRawQuery(updateQuoted, tenantTables);
    expect(updateResult.isValid).toBe(false);
    expect(updateResult.referencedTables).toEqual(['vehicles']);
  });
});
