import { ImportRowAction } from '@prisma/client';
import { recordsEqual } from './customer-import.logic.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { parseGermanNumber } from './number-parse.util.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportRowIssue,
  NormalizedLaborFitmentRow,
  NormalizedLaborOperationRow,
} from './import.types.js';

export type LaborOperationSnapshot = {
  code: string;
  description: string;
  standard_aw: number;
  hourly_rate: number;
  internal_cost: number | null;
  category_id: string | null;
  fitments: NormalizedLaborFitmentRow[];
};

export type LaborMatchContext = {
  mappingByExternalId: Map<string, string>;
  operationByCode: Map<string, string>;
  operationById: Map<string, LaborOperationSnapshot>;
  categoryByName: Map<string, string>;
  externalIdSeenInFile: Map<string, number>;
  codeSeenInFile: Map<string, number>;
};

function cellValue(
  record: Record<string, string>,
  mapping: Record<string, string>,
  field: string,
): string {
  const column = mapping[field];
  if (!column) {
    return '';
  }
  return record[column]?.trim() ?? '';
}

function parseYear(raw: string): number | null {
  if (!raw.trim()) {
    return null;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) {
    return null;
  }
  return parsed;
}

function parseFitmentYear(
  raw: string,
  field: string,
  warnings: ImportRowIssue[],
): number | null | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  const parsed = parseYear(raw);
  if (parsed === null) {
    warnings.push({
      code: 'IMPORT_YEAR_INVALID',
      message: `${field} must be a valid model year`,
      field,
    });
    return undefined;
  }
  return parsed;
}

function parseRequiredDecimal(
  raw: string,
  field: string,
  code: string,
  message: string,
): { value: number | null; issues: ImportRowIssue[] } {
  const parsed = parseGermanNumber(raw);
  if (parsed === null || parsed < 0) {
    return {
      value: null,
      issues: [{ code, message, field }],
    };
  }
  return { value: parsed, issues: [] };
}

function normalizeFitment(
  record: Record<string, string>,
  mapping: Record<string, string>,
): {
  fitment: NormalizedLaborFitmentRow | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
} {
  const make = cellValue(record, mapping, 'fitment_make');
  const model = cellValue(record, mapping, 'fitment_model');
  const yearFromRaw = cellValue(record, mapping, 'fitment_year_from');
  const yearToRaw = cellValue(record, mapping, 'fitment_year_to');
  const engineCode = cellValue(record, mapping, 'fitment_engine_code') || null;

  const hasAnyFitmentColumn =
    Boolean(mapping.fitment_make) ||
    Boolean(mapping.fitment_model) ||
    Boolean(mapping.fitment_year_from) ||
    Boolean(mapping.fitment_year_to) ||
    Boolean(mapping.fitment_engine_code);

  if (!hasAnyFitmentColumn) {
    return { fitment: null, issues: [], warnings: [] };
  }

  if (!make && !model && !yearFromRaw && !yearToRaw && !engineCode) {
    return { fitment: null, issues: [], warnings: [] };
  }

  if (!make || !model) {
    return {
      fitment: null,
      warnings: [],
      issues: [
        {
          code: IMPORT_ERROR_CODES.LABOR_FITMENT_MAKE_MODEL_REQUIRED,
          message:
            'fitment_make and fitment_model are required when fitment data is provided',
          field: 'fitment_make',
        },
      ],
    };
  }

  const warnings: ImportRowIssue[] = [];
  const yearFrom = parseFitmentYear(yearFromRaw, 'fitment_year_from', warnings);
  const yearTo = parseFitmentYear(yearToRaw, 'fitment_year_to', warnings);

  const fitment: NormalizedLaborFitmentRow = {
    make,
    model,
    engine_code: engineCode,
  };
  if (yearFrom !== undefined) {
    fitment.year_from = yearFrom;
  }
  if (yearTo !== undefined) {
    fitment.year_to = yearTo;
  }

  return {
    fitment,
    issues: [],
    warnings,
  };
}

function fitmentYearValue(
  fitment: NormalizedLaborFitmentRow,
  field: 'year_from' | 'year_to',
): number | null | undefined {
  if (!(field in fitment)) {
    return undefined;
  }
  return fitment[field] ?? null;
}

export function resolveLaborCategoryId(
  categoryName: string | null,
  context: LaborMatchContext,
  warnings: ImportRowIssue[],
): string | null {
  if (!categoryName) {
    return null;
  }
  const key = categoryName.trim().toLowerCase();
  const categoryId = context.categoryByName.get(key);
  if (!categoryId) {
    warnings.push({
      code: 'LABOR_CATEGORY_UNKNOWN',
      message: `Labor category "${categoryName}" was not found; imported without category`,
      field: 'category_name',
    });
    return null;
  }
  return categoryId;
}

export function laborComparableForUpdate(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const comparable: Record<string, unknown> = {
    code: payload.code,
    description: payload.description,
    standard_aw: payload.standard_aw,
    hourly_rate: payload.hourly_rate,
    internal_cost: payload.internal_cost,
    category_id: payload.category_id,
  };
  return Object.fromEntries(
    Object.entries(comparable).filter(
      ([, value]) => value !== null && value !== '',
    ),
  );
}

function fitmentsEqual(
  existing: NormalizedLaborFitmentRow[],
  desired: NormalizedLaborFitmentRow | null,
  fillEmptyOnly: boolean,
): boolean {
  if (!desired) {
    return true;
  }
  const match = existing.find(
    (fitment) =>
      fitment.make.toLowerCase() === desired.make.toLowerCase() &&
      fitment.model.toLowerCase() === desired.model.toLowerCase(),
  );
  if (!match) {
    return false;
  }
  const desiredYearFrom = fitmentYearValue(desired, 'year_from');
  const desiredYearTo = fitmentYearValue(desired, 'year_to');
  const desiredEngine =
    'engine_code' in desired ? (desired.engine_code ?? null) : undefined;

  if (fillEmptyOnly) {
    const yearFromOk =
      desiredYearFrom === undefined ||
      match.year_from !== null ||
      desiredYearFrom === null;
    const yearToOk =
      desiredYearTo === undefined ||
      match.year_to !== null ||
      desiredYearTo === null;
    const engineOk =
      desiredEngine === undefined ||
      match.engine_code !== null ||
      desiredEngine === null;
    return yearFromOk && yearToOk && engineOk;
  }

  const yearFromOk =
    desiredYearFrom === undefined || match.year_from === desiredYearFrom;
  const yearToOk =
    desiredYearTo === undefined || match.year_to === desiredYearTo;
  const engineOk =
    desiredEngine === undefined ||
    (match.engine_code ?? '').toLowerCase() ===
      (desiredEngine ?? '').toLowerCase();
  return yearFromOk && yearToOk && engineOk;
}

export function laborRecordsEqual(
  existing: LaborOperationSnapshot,
  desired: Record<string, unknown>,
  fillEmptyOnly: boolean,
): boolean {
  const scalarDesired = laborComparableForUpdate(desired);
  const baseEqual = recordsEqual(
    {
      code: existing.code,
      description: existing.description,
      standard_aw: existing.standard_aw,
      hourly_rate: existing.hourly_rate,
      internal_cost: existing.internal_cost,
      category_id: existing.category_id,
    },
    scalarDesired,
    fillEmptyOnly,
  );
  if (!baseEqual) {
    return false;
  }
  const desiredFitment = desired.fitment as NormalizedLaborFitmentRow | null;
  return fitmentsEqual(existing.fitments, desiredFitment, fillEmptyOnly);
}

export function normalizeLaborOperationRow(
  record: Record<string, string>,
  mapping: Record<string, string>,
  context: LaborMatchContext,
): {
  row: NormalizedLaborOperationRow | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
} {
  const issues: ImportRowIssue[] = [];
  const warnings: ImportRowIssue[] = [];

  const externalId = cellValue(record, mapping, 'external_id');
  if (!externalId) {
    issues.push({
      code: 'IMPORT_EXTERNAL_ID_REQUIRED',
      message: 'external_id is required',
      field: 'external_id',
    });
    return { row: null, issues, warnings };
  }

  const code = cellValue(record, mapping, 'code');
  if (!code) {
    issues.push({
      code: IMPORT_ERROR_CODES.LABOR_CODE_REQUIRED,
      message: 'code is required',
      field: 'code',
    });
    return { row: null, issues, warnings };
  }

  const description = cellValue(record, mapping, 'description');
  if (!description) {
    issues.push({
      code: IMPORT_ERROR_CODES.LABOR_DESCRIPTION_REQUIRED,
      message: 'description is required',
      field: 'description',
    });
    return { row: null, issues, warnings };
  }

  const standardAwResult = parseRequiredDecimal(
    cellValue(record, mapping, 'standard_aw'),
    'standard_aw',
    IMPORT_ERROR_CODES.INVALID_STANDARD_AW,
    'standard_aw must be a non-negative number',
  );
  issues.push(...standardAwResult.issues);

  const hourlyRateResult = parseRequiredDecimal(
    cellValue(record, mapping, 'hourly_rate'),
    'hourly_rate',
    IMPORT_ERROR_CODES.INVALID_HOURLY_RATE,
    'hourly_rate must be a non-negative number',
  );
  issues.push(...hourlyRateResult.issues);

  const internalCostRaw = cellValue(record, mapping, 'internal_cost');
  let internalCost: number | null = null;
  if (internalCostRaw) {
    const parsed = parseGermanNumber(internalCostRaw);
    if (parsed === null || parsed < 0) {
      issues.push({
        code: IMPORT_ERROR_CODES.INVALID_INTERNAL_COST,
        message: 'internal_cost must be a non-negative number',
        field: 'internal_cost',
      });
    } else {
      internalCost = parsed;
    }
  }

  const fitmentResult = normalizeFitment(record, mapping);
  issues.push(...fitmentResult.issues);
  warnings.push(...fitmentResult.warnings);

  if (issues.length > 0) {
    return { row: null, issues, warnings };
  }

  const categoryName = cellValue(record, mapping, 'category_name') || null;
  const categoryId = resolveLaborCategoryId(categoryName, context, warnings);

  const row: NormalizedLaborOperationRow = {
    external_id: externalId,
    code,
    description,
    standard_aw: standardAwResult.value as number,
    hourly_rate: hourlyRateResult.value as number,
    internal_cost: internalCost,
    category_name: categoryName,
    category_id: categoryId,
    fitment: fitmentResult.fitment,
  };

  return { row, issues, warnings };
}

function buildNormalizedPayload(
  row: NormalizedLaborOperationRow,
): Record<string, unknown> {
  return {
    external_id: row.external_id,
    code: row.code,
    description: row.description,
    standard_aw: row.standard_aw,
    hourly_rate: row.hourly_rate,
    internal_cost: row.internal_cost,
    category_id: row.category_id,
    category_name: row.category_name,
    fitment: row.fitment,
  };
}

export function planLaborOperationDryRunRow(
  rowNo: number,
  row: NormalizedLaborOperationRow,
  context: LaborMatchContext,
  options: ImportJobOptions,
  warnings: ImportRowIssue[],
): DryRunRowResult {
  const priorExternalRow = context.externalIdSeenInFile.get(row.external_id);
  if (priorExternalRow !== undefined && priorExternalRow !== rowNo) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: [
        {
          code: IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
          message: `Duplicate external_id in file (first seen on row ${priorExternalRow})`,
          field: 'external_id',
        },
      ],
      warnings,
      normalized: null,
    };
  }
  context.externalIdSeenInFile.set(row.external_id, rowNo);

  const codeKey = row.code.toLowerCase();
  const priorCodeRow = context.codeSeenInFile.get(codeKey);
  if (priorCodeRow !== undefined && priorCodeRow !== rowNo) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: [
        {
          code: IMPORT_ERROR_CODES.DUPLICATE_CODE_IN_FILE,
          message: `Duplicate code in file (first seen on row ${priorCodeRow})`,
          field: 'code',
        },
      ],
      warnings,
      normalized: null,
    };
  }
  context.codeSeenInFile.set(codeKey, rowNo);

  const payload = buildNormalizedPayload(row);
  const mappingEntityId =
    context.mappingByExternalId.get(row.external_id) ?? null;
  const codeEntityId = context.operationByCode.get(codeKey) ?? null;

  if (mappingEntityId && codeEntityId && mappingEntityId !== codeEntityId) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: [
        {
          code: IMPORT_ERROR_CODES.LABOR_CODE_CONFLICT,
          message:
            'external_id mapping and existing code refer to different labor operations',
          field: 'code',
        },
      ],
      warnings,
      normalized: null,
    };
  }

  const entityId = mappingEntityId ?? codeEntityId;
  const updateExisting = options.update_existing === true;

  if (!entityId) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.CREATE,
      entity_id: null,
      errors: [],
      warnings,
      normalized: payload,
    };
  }

  const existing = context.operationById.get(entityId);
  if (!updateExisting) {
    if (existing && !laborRecordsEqual(existing, payload, false)) {
      warnings.push({
        code: 'IMPORT_EXISTING_NOT_UPDATED',
        message:
          'Existing labor operation matched but update_existing is false',
      });
    }
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.SKIP,
      entity_id: entityId,
      errors: [],
      warnings,
      normalized: payload,
    };
  }

  if (existing) {
    const unchanged = laborRecordsEqual(
      existing,
      payload,
      options.fill_empty_only === true,
    );
    if (unchanged) {
      return {
        row_no: rowNo,
        external_id: row.external_id,
        action: ImportRowAction.SKIP,
        entity_id: entityId,
        errors: [],
        warnings,
        normalized: payload,
      };
    }
  }

  return {
    row_no: rowNo,
    external_id: row.external_id,
    action: ImportRowAction.UPDATE,
    entity_id: entityId,
    errors: [],
    warnings,
    normalized: payload,
  };
}
