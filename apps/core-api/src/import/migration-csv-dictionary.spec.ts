import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIGRATION_CSV_FILE_SPECS,
  expectedHeadersForFile,
} from './migration-csv-dictionary.js';

const specDir = join(
  process.cwd(),
  '../../docs/internal/02-Feature-Specs/Platform',
);

function columnNamesFromSpecTable(markdown: string, fileName: string): string[] {
  const markers = [
    `## \`${fileName}\``,
    `## Exact \`${fileName}\` dictionary`,
  ];
  let section: string | undefined;
  for (const marker of markers) {
    section = markdown.split(marker)[1];
    if (section) {
      break;
    }
  }
  if (!section) {
    throw new Error(`section for ${fileName} not found`);
  }
  const lines = section.split('\n');
  const columns: string[] = [];
  for (const line of lines) {
    if (line.startsWith('### ') || line.startsWith('## ')) {
      if (columns.length > 0) {
        break;
      }
      continue;
    }
    const match = /^\| ([a-z_0-9]+) \|/.exec(line);
    if (!match) {
      continue;
    }
    const name = match[1];
    if (name === 'Column' || name === 'Property' || name === 'Type') {
      continue;
    }
    columns.push(name);
  }
  return columns;
}

describe('migration-csv-dictionary vs normative specs', () => {
  it('tyre_sets.csv columns match migration-csv-tyres.md order', () => {
    const md = readFileSync(join(specDir, 'migration-csv-tyres.md'), 'utf8');
    const expected = columnNamesFromSpecTable(md, 'tyre_sets.csv');
    expect(expectedHeadersForFile('tyre_sets.csv')).toEqual(expected);
  });

  it('open order files match migration-csv-open-orders.md order', () => {
    const md = readFileSync(
      join(specDir, 'migration-csv-open-orders.md'),
      'utf8',
    );
    for (const fileName of [
      'open_orders.csv',
      'open_order_tasks.csv',
      'open_order_lines.csv',
    ] as const) {
      const expected = columnNamesFromSpecTable(md, fileName);
      expect(expectedHeadersForFile(fileName)).toEqual(expected);
    }
  });

  it('history files match migration-csv-history.md order', () => {
    const md = readFileSync(join(specDir, 'migration-csv-history.md'), 'utf8');
    for (const fileName of [
      'legacy_documents.csv',
      'legacy_document_lines.csv',
      'open_items.csv',
    ] as const) {
      const expected = columnNamesFromSpecTable(md, fileName);
      expect(expectedHeadersForFile(fileName)).toEqual(expected);
    }
  });

  it('legacy_document_lines includes EXTERNAL_SERVICE', () => {
    const lineType = MIGRATION_CSV_FILE_SPECS['legacy_document_lines.csv']
      .columns.find((column) => column.name === 'line_type');
    expect(lineType?.enumValues).toContain('EXTERNAL_SERVICE');
  });
});
