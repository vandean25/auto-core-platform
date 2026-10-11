import type { ImportEntityType } from '@prisma/client';
import { withSpan } from '../common/observability/trace.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { DryRunRowResult } from './import.types.js';

/**
 * Spans for the three import stages. Each span records the entity type and row counts. Its duration
 * is the span's own. Cell values, names, emails, file names and error text never reach a span.
 */

export function traceImportParse(
  entityType: ImportEntityType,
  parse: () => ParsedCsv,
): ParsedCsv {
  return withSpan(
    'Parse import file',
    'import.parse',
    { entity_type: entityType },
    (span) => {
      const parsed = parse();
      span.setAttribute('row_count', parsed.rows.length);
      return parsed;
    },
  );
}

export function traceImportValidate(
  entityType: ImportEntityType,
  plan: () => Promise<DryRunRowResult[]>,
): Promise<DryRunRowResult[]> {
  return withSpan(
    'Validate import rows',
    'import.validate',
    { entity_type: entityType },
    async (span) => {
      const rows = await plan();
      span.setAttributes({
        row_count: rows.length,
        error_row_count: rows.filter((row) => row.errors.length > 0).length,
      });
      return rows;
    },
  );
}

export function traceImportCommit<T>(
  entityType: ImportEntityType,
  rowCount: number,
  commit: () => Promise<T>,
): Promise<T> {
  return withSpan(
    'Commit import rows',
    'import.commit',
    { entity_type: entityType, row_count: rowCount },
    () => commit(),
  );
}
