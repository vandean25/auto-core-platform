/**
 * One-shot migration script: adds teardownTestApp import and replaces
 * `await app.close()` calls in e2e spec afterAll hooks.
 *
 * Run from: apps/core-api/
 *   node scripts/migrate-teardown.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', 'test');

// Specs already migrated or exempt (no INestApplication)
const SKIP = new Set([
  'mechanic-voice-note.e2e-spec.ts',
  'security.e2e-spec.ts',
  'app.e2e-spec.ts',
  'multi-tenant-foundation.e2e-spec.ts',
  'test-lifecycle.ts',
  'tenant-test-utils.ts',
  'jest-e2e.json',
]);

const files = readdirSync(testDir).filter(
  (f) => f.endsWith('.e2e-spec.ts') && !SKIP.has(f),
);

for (const file of files) {
  const filePath = join(testDir, file);
  let content = readFileSync(filePath, 'utf8');

  // Skip if already migrated
  if (content.includes("from './test-lifecycle'")) {
    console.log(`SKIP (already migrated): ${file}`);
    continue;
  }

  // Skip if no app.close() call
  if (!content.includes('await app.close();')) {
    console.log(`SKIP (no app.close): ${file}`);
    continue;
  }

  // 1. Add import after the last existing import line from './...'
  // Insert after the last line that starts with "import"
  const importInsertPoint = content.lastIndexOf("\nfrom './tenant-test-utils';");
  if (importInsertPoint !== -1) {
    const insertAfter = importInsertPoint + "\nfrom './tenant-test-utils';".length;
    content =
      content.slice(0, insertAfter) +
      "\nimport { teardownTestApp } from './test-lifecycle';" +
      content.slice(insertAfter);
  } else {
    // Fallback: find last import statement and insert after it
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) lastImportIdx = i;
    }
    if (lastImportIdx === -1) {
      console.error(`WARN: Could not find import insertion point in ${file}`);
      continue;
    }
    lines.splice(lastImportIdx + 1, 0, "import { teardownTestApp } from './test-lifecycle';");
    content = lines.join('\n');
  }

  // 2. Replace `await app.close();` with `await teardownTestApp(app, prisma);`
  // In afterAll context — use prisma if it exists in the file
  const hasPrisma = content.includes('let prisma:');
  const replacement = hasPrisma
    ? 'await teardownTestApp(app, prisma);'
    : 'await teardownTestApp(app);';

  content = content.replace(/await app\.close\(\);/g, replacement);

  writeFileSync(filePath, content, 'utf8');
  console.log(`MIGRATED: ${file} (prisma: ${hasPrisma})`);
}

console.log('\nDone.');
