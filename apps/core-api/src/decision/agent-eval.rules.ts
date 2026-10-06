import { ImportRowAction } from '@prisma/client';
import {
  normalizeCustomerRow,
  planCustomerDryRunRow,
  type CustomerMatchContext,
} from '../import/customer-import.logic.js';
import {
  normalizeVehicleRow,
  planVehicleDryRunRow,
  type VehicleMatchContext,
} from '../import/vehicle-import.logic.js';
import type {
  NormalizedCustomerRow,
  NormalizedVehicleRow,
} from '../import/import.types.js';
import { DECISION_USE_CASES } from './decision.constants.js';
import {
  classifyDocumentTextHeuristic,
  extractDocumentSortSignals,
} from './document-sort.heuristic.js';

export type AgentEvalExample = {
  id: string;
  use_case: string;
  difficulty: string;
  label: string;
  choices: string[];
  input: unknown;
  tags?: string[];
};

export type AgentEvalRuleDecision = {
  choice: string;
  confidence: number;
  ambiguous: boolean;
};

type Candidate = Record<string, unknown> & { id: string };

type ImportEvalInput = {
  entity_type: 'customer' | 'vehicle';
  row: Record<string, unknown>;
  candidates: Candidate[];
};

const CREATE_NEW = '__create_new__';
const AMBIGUOUS_CONFIDENCE = 0.5;
const CONFIDENT_CONFIDENCE = 1;

export function evaluateExampleWithRules(
  example: AgentEvalExample,
): AgentEvalRuleDecision {
  if (example.use_case === DECISION_USE_CASES.DOCUMENT_SORT) {
    return classifyDocumentExample(example.input);
  }
  if (example.use_case === DECISION_USE_CASES.IMPORT_ROW_MATCHING) {
    return classifyImportExample(example.input);
  }
  throw new Error(`Unsupported evaluation use case: ${example.use_case}`);
}

function classifyDocumentExample(input: unknown): AgentEvalRuleDecision {
  const text = stringProperty(input, 'text');
  const signals = extractDocumentSortSignals(text);
  const ambiguous = signals.length !== 1;
  return {
    choice: classifyDocumentTextHeuristic(text),
    confidence: ambiguous ? AMBIGUOUS_CONFIDENCE : CONFIDENT_CONFIDENCE,
    ambiguous,
  };
}

function classifyImportExample(input: unknown): AgentEvalRuleDecision {
  const record = objectValue(input);
  const importInput = record as ImportEvalInput;
  const candidates = candidateList(importInput.candidates);
  const choice =
    importInput.entity_type === 'vehicle'
      ? planVehicleMatch(importInput.row, candidates)
      : importInput.entity_type === 'customer'
        ? planCustomerMatch(importInput.row, candidates)
        : CREATE_NEW;
  const ambiguous = choice === CREATE_NEW;
  return {
    choice,
    confidence: ambiguous ? AMBIGUOUS_CONFIDENCE : CONFIDENT_CONFIDENCE,
    ambiguous,
  };
}

function planCustomerMatch(
  rawRow: Record<string, unknown>,
  candidates: Candidate[],
): string {
  const row = stringRecord(rawRow);
  const mapping = Object.fromEntries(Object.keys(row).map((key) => [key, key]));
  const normalized = normalizeCustomerRow(row, mapping, {});
  if (!normalized.row) {
    return CREATE_NEW;
  }
  const planned = planCustomerDryRunRow(
    1,
    normalized.row,
    createCustomerContext(normalized.row, candidates),
    { update_existing: false },
    normalized.warnings,
  );
  return planned.action === ImportRowAction.SKIP && planned.entity_id
    ? planned.entity_id
    : CREATE_NEW;
}

function planVehicleMatch(
  rawRow: Record<string, unknown>,
  candidates: Candidate[],
): string {
  const row = stringRecord(rawRow);
  const mapping = Object.fromEntries(Object.keys(row).map((key) => [key, key]));
  const normalized = normalizeVehicleRow(row, mapping, {
    allow_missing_vin: true,
  });
  if (!normalized.row) {
    return CREATE_NEW;
  }
  const planned = planVehicleDryRunRow(
    1,
    normalized.row,
    createVehicleContext(normalized.row, candidates),
    { update_existing: false },
    normalized.warnings,
  );
  return planned.action === ImportRowAction.SKIP && planned.entity_id
    ? planned.entity_id
    : CREATE_NEW;
}

function createCustomerContext(
  row: NormalizedCustomerRow,
  candidates: Candidate[],
): CustomerMatchContext {
  const candidatesByEmail = new Map<
    string,
    { id: string; record: Record<string, unknown> }
  >();
  const candidatesById = new Map<string, Record<string, unknown>>();
  const mappingByExternalId = new Map<string, string>();
  for (const candidate of candidates) {
    candidatesById.set(candidate.id, candidate);
    const email = optionalString(candidate.email)?.toLowerCase();
    if (email) {
      candidatesByEmail.set(email, { id: candidate.id, record: candidate });
    }
    if (candidate.external_id === row.external_id) {
      mappingByExternalId.set(row.external_id, candidate.id);
    }
  }
  return {
    mappingByExternalId,
    customerByEmail: candidatesByEmail,
    customerById: candidatesById,
    duplicateNameKeys: new Set(),
    externalIdSeenInFile: new Map(),
    emailSeenInFile: new Map(),
  };
}

function createVehicleContext(
  row: NormalizedVehicleRow,
  candidates: Candidate[],
): VehicleMatchContext {
  const mappingByExternalId = new Map<string, string>();
  const vehicleByVin = new Map<string, string>();
  const vehicleByPlate = new Map<string, string>();
  const vehicleById = new Map<string, Record<string, unknown>>();
  for (const candidate of candidates) {
    vehicleById.set(candidate.id, candidate);
    if (candidate.external_id === row.external_id) {
      mappingByExternalId.set(row.external_id, candidate.id);
    }
    if (typeof candidate.vin === 'string') {
      vehicleByVin.set(candidate.vin.trim().toUpperCase(), candidate.id);
    }
    if (typeof candidate.plate === 'string') {
      vehicleByPlate.set(
        candidate.plate.trim().toUpperCase().replace(/\s+/g, ''),
        candidate.id,
      );
    }
  }
  return {
    mappingByExternalId,
    vehicleByVin,
    vehicleByPlate,
    vehicleById,
    customerExternalToEntityId: new Map(),
    vinSeenInFile: new Map(),
    externalIdSeenInFile: new Map(),
  };
}

function candidateList(value: unknown): Candidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const candidates: Candidate[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string') {
      continue;
    }
    candidates.push({ ...candidate, id: candidate.id });
  }
  return candidates;
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, stringValue(entry)]),
  );
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function stringProperty(value: unknown, key: string): string {
  const property = objectValue(value)[key];
  return typeof property === 'string' ? property : '';
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
