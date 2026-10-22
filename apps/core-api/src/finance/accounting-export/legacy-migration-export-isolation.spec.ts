import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const exportDir = import.meta.dirname;

describe('accounting export ignores legacy migration documents', () => {
  it('does not reference LegacyDocument models or tables in export code', () => {
    const files = readdirSync(exportDir).filter((name) =>
      /\.(ts|js)$/.test(name),
    );
    const forbidden = /legacy_documents|legacy_document_lines|LegacyDocument/i;
    for (const file of files) {
      if (file === 'legacy-migration-export-isolation.spec.ts') continue;
      const source = readFileSync(join(exportDir, file), 'utf8');
      expect(source).not.toMatch(forbidden);
    }
  });
});
