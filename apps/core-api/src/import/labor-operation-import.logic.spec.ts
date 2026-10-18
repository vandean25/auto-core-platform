import { ImportRowAction } from '@prisma/client';
import {
  normalizeLaborOperationRow,
  planLaborOperationDryRunRow,
  resolveLaborCategoryId,
} from './labor-operation-import.logic.js';

const mapping = {
  external_id: 'Arbeitswert-Nr',
  code: 'AW-Code',
  description: 'Beschreibung',
  standard_aw: 'AW',
  hourly_rate: 'Stundensatz',
  category_name: 'Kategorie',
  fitment_make: 'Marke',
  fitment_model: 'Modell',
};

function emptyContext() {
  return {
    mappingByExternalId: new Map<string, string>(),
    operationByCode: new Map<string, string>(),
    operationById: new Map(),
    categoryByName: new Map([['mechanik', 'cat-1']]),
    externalIdSeenInFile: new Map<string, number>(),
    codeSeenInFile: new Map<string, number>(),
  };
}

describe('labor-operation-import.logic', () => {
  it('requires external_id and code', () => {
    const result = normalizeLaborOperationRow(
      { 'AW-Code': 'AW1', Beschreibung: 'Oil change', AW: '1,0', Stundensatz: '80' },
      mapping,
      emptyContext(),
    );
    expect(result.row).toBeNull();
    expect(result.issues.some((issue) => issue.field === 'external_id')).toBe(
      true,
    );
  });

  it('warns when category name is unknown', () => {
    const warnings: { code: string }[] = [];
    const categoryId = resolveLaborCategoryId('Unknown', emptyContext(), warnings);
    expect(categoryId).toBeNull();
    expect(warnings.some((warning) => warning.code === 'LABOR_CATEGORY_UNKNOWN')).toBe(
      true,
    );
  });

  it('plans CREATE for a new labor operation', () => {
    const context = emptyContext();
    const normalized = normalizeLaborOperationRow(
      {
        'Arbeitswert-Nr': '100',
        'AW-Code': 'AW-100',
        Beschreibung: 'Oil change',
        AW: '1,5',
        Stundensatz: '85,00',
        Kategorie: 'Mechanik',
        Marke: 'VW',
        Modell: 'Golf',
      },
      mapping,
      context,
    ).row!;
    const planned = planLaborOperationDryRunRow(
      1,
      normalized,
      context,
      { update_existing: true },
      [],
    );
    expect(planned.action).toBe(ImportRowAction.CREATE);
    expect(planned.normalized?.category_id).toBe('cat-1');
    expect(planned.normalized?.fitment).toMatchObject({ make: 'VW', model: 'Golf' });
  });

  it('errors on duplicate code in file', () => {
    const context = emptyContext();
    context.codeSeenInFile.set('aw-100', 1);
    const row = normalizeLaborOperationRow(
      {
        'Arbeitswert-Nr': '101',
        'AW-Code': 'AW-100',
        Beschreibung: 'Duplicate',
        AW: '1',
        Stundensatz: '80',
      },
      mapping,
      context,
    ).row!;
    const planned = planLaborOperationDryRunRow(2, row, context, {}, []);
    expect(planned.action).toBe(ImportRowAction.ERROR);
    expect(
      planned.errors.some((error) => error.code === 'IMPORT_DUPLICATE_CODE_IN_FILE'),
    ).toBe(true);
  });

  it('skips existing operations when update_existing is false', () => {
    const context = emptyContext();
    context.operationByCode.set('aw-200', 'op-1');
    context.operationById.set('op-1', {
      code: 'AW-200',
      description: 'Existing',
      standard_aw: 1,
      hourly_rate: 80,
      internal_cost: null,
      category_id: null,
      fitments: [],
    });
    const row = normalizeLaborOperationRow(
      {
        'Arbeitswert-Nr': '200',
        'AW-Code': 'AW-200',
        Beschreibung: 'Changed',
        AW: '2',
        Stundensatz: '90',
      },
      mapping,
      context,
    ).row!;
    const planned = planLaborOperationDryRunRow(1, row, context, {}, []);
    expect(planned.action).toBe(ImportRowAction.SKIP);
  });
});
