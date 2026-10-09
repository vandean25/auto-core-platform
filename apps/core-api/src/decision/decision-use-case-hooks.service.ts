import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DECISION_USE_CASES,
  type DocumentSortType,
} from './decision.constants.js';
import { DecisionShadowService } from './decision-shadow.service.js';
import {
  classifyDocumentTextHeuristic,
  documentSortChoices,
  extractDocumentSortSignals,
} from './document-sort.heuristic.js';
import type { DryRunRowResult } from '../import/import.types.js';
import { customerNameKey } from '../import/customer-import.logic.js';
import type { NormalizedCustomerRow } from '../import/import.types.js';

const MAX_SHADOW_ROWS_PER_IMPORT = 50;
const MAX_CANDIDATES_PER_ROW = 5;
const CREATE_NEW_CHOICE = 'create_new';

export type ImportRowMatchingCandidate = {
  id: string;
  identity: CustomerIdentity;
  source: 'customer' | 'same_file';
};

type CustomerIdentity = Pick<
  NormalizedCustomerRow,
  | 'type'
  | 'company_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'vat_id'
>;

type MatchFeature = { kind: string; token: string | null };

/**
 * One ambiguous (IMPORT_POSSIBLE_DUPLICATE) dry-run row. `input` and `choices`
 * are unredacted; callers must pass them through `redactShadowParams` before
 * they reach a provider or a log.
 */
export type ImportRowMatchingCase = {
  row: DryRunRowResult;
  input: {
    row: {
      type: NormalizedCustomerRow['type'];
      match_features: MatchFeature[];
    };
    candidates: Array<{ choice: string; match_features: MatchFeature[] }>;
  };
  choices: string[];
  /** entityId is null for candidates from the same file, which have no customer id yet. */
  candidateTargets: Array<{ choice: string; entityId: string | null }>;
  createChoice: string;
  /** Deterministic (rules) outcome for this row. */
  actualChoice: string;
};

export type DocumentSortCase = {
  input: { signals: DocumentSortType[] };
  choices: DocumentSortType[];
  /** Deterministic (heuristic) outcome for this text. */
  actualType: DocumentSortType;
};

@Injectable()
export class DecisionUseCaseHooksService {
  constructor(
    private readonly shadow: DecisionShadowService,
    private readonly prisma: PrismaService,
  ) {}

  scheduleImportRowMatchingForDryRun(params: {
    tenantId: string;
    traceId?: string;
    row: DryRunRowResult;
    normalizedRow: NormalizedCustomerRow;
    customers: Customer[];
    identitySalt: Buffer;
    sameFileRows: DryRunRowResult[];
  }): void {
    const matchingCase = buildImportRowMatchingCase(params);
    if (!matchingCase) {
      return;
    }

    this.shadow.scheduleShadow({
      tenantId: params.tenantId,
      traceId: this.shadow.resolveTraceId(params.traceId),
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      input: matchingCase.input,
      choices: matchingCase.choices,
      actualOutcome: {
        choice: matchingCase.actualChoice,
        source: 'import_dry_run',
      },
    });
  }

  scheduleDocumentSortForText(params: {
    tenantId: string;
    traceId?: string;
    text: string;
  }): void {
    const documentCase = buildDocumentSortCase(params.text);
    if (!documentCase) {
      return;
    }
    this.shadow.scheduleShadow({
      tenantId: params.tenantId,
      traceId: this.shadow.resolveTraceId(params.traceId),
      useCase: DECISION_USE_CASES.DOCUMENT_SORT,
      input: documentCase.input,
      choices: documentCase.choices,
      actualOutcome: {
        choice: documentCase.actualType,
        source: 'heuristic_classifier',
      },
    });
  }

  classifyDocumentTextForOutcome(text: string): DocumentSortType {
    return classifyDocumentTextHeuristic(text);
  }

  async scheduleCustomerImportDryRunShadows(
    tenantId: string,
    traceId: string | undefined,
    rows: DryRunRowResult[],
  ): Promise<void> {
    if (!this.shadow.isShadowEnabled()) {
      return;
    }
    const matchingCases = await this.buildCustomerImportMatchingCases(
      tenantId,
      rows,
    );
    for (const matchingCase of matchingCases) {
      this.shadow.scheduleShadow({
        tenantId,
        traceId: this.shadow.resolveTraceId(traceId),
        useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
        input: matchingCase.input,
        choices: matchingCase.choices,
        actualOutcome: {
          choice: matchingCase.actualChoice,
          source: 'import_dry_run',
        },
      });
    }
  }

  /**
   * Ambiguous customer rows from one dry-run, capped per import. Loads the
   * tenant's customers only when at least one row is ambiguous.
   */
  async buildCustomerImportMatchingCases(
    tenantId: string,
    rows: DryRunRowResult[],
  ): Promise<ImportRowMatchingCase[]> {
    const ambiguousRows = rows
      .filter(
        (row) =>
          row.normalized !== null &&
          row.warnings.some(
            (warning) => warning.code === 'IMPORT_POSSIBLE_DUPLICATE',
          ),
      )
      .slice(0, MAX_SHADOW_ROWS_PER_IMPORT);
    if (ambiguousRows.length === 0) {
      return [];
    }

    const customers = await this.loadCustomers(tenantId);
    const identitySalt = randomBytes(32);
    const matchingCases: ImportRowMatchingCase[] = [];
    for (const row of ambiguousRows) {
      const matchingCase = buildImportRowMatchingCase({
        row,
        normalizedRow: row.normalized as NormalizedCustomerRow,
        customers,
        identitySalt,
        sameFileRows: rows.filter(
          (candidate) =>
            candidate.row_no < row.row_no &&
            candidate.action === 'CREATE' &&
            candidate.normalized !== null,
        ),
      });
      if (matchingCase) {
        matchingCases.push(matchingCase);
      }
    }
    return matchingCases;
  }

  private loadCustomers(tenantId: string): Promise<Customer[]> {
    return this.prisma.customer.findMany({
      where: { tenant_id: tenantId },
    });
  }
}

export function buildImportRowMatchingCase(params: {
  row: DryRunRowResult;
  normalizedRow: NormalizedCustomerRow;
  customers: Customer[];
  identitySalt: Buffer;
  sameFileRows: DryRunRowResult[];
}): ImportRowMatchingCase | null {
  const ambiguous = params.row.warnings.some(
    (warning) => warning.code === 'IMPORT_POSSIBLE_DUPLICATE',
  );
  if (!ambiguous) {
    return null;
  }

  const nameKey = customerNameKey(params.normalizedRow);
  const candidates = [
    ...buildCustomerCandidates(nameKey, params.customers),
    ...buildSameFileCandidates(nameKey, params.sameFileRows),
  ].slice(0, MAX_CANDIDATES_PER_ROW);
  if (candidates.length === 0) {
    return null;
  }

  const candidateChoices = candidates.map(
    (_candidate, index) => `choice_${index + 1}`,
  );
  const createChoice = CREATE_NEW_CHOICE;
  const selectedCandidateIndex = candidates.findIndex(
    (candidate) => candidate.id === params.row.entity_id,
  );
  const actualChoice =
    selectedCandidateIndex >= 0
      ? candidateChoices[selectedCandidateIndex]
      : params.row.action === 'CREATE'
        ? createChoice
        : candidateChoices[0];

  return {
    row: params.row,
    input: {
      row: {
        type: params.normalizedRow.type,
        match_features: buildMatchFeatures(
          params.normalizedRow,
          params.identitySalt,
        ),
      },
      candidates: candidates.map((candidate, index) => ({
        choice: candidateChoices[index],
        match_features: buildMatchFeatures(
          candidate.identity,
          params.identitySalt,
        ),
      })),
    },
    choices: [...candidateChoices, createChoice],
    candidateTargets: candidates.map((candidate, index) => ({
      choice: candidateChoices[index],
      entityId: candidate.source === 'customer' ? candidate.id : null,
    })),
    createChoice,
    actualChoice,
  };
}

export function buildDocumentSortCase(text: string): DocumentSortCase | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return {
    input: { signals: extractDocumentSortSignals(trimmed) },
    choices: documentSortChoices(),
    actualType: classifyDocumentTextHeuristic(trimmed),
  };
}

function buildCustomerCandidates(
  nameKey: string,
  customers: Customer[],
): ImportRowMatchingCandidate[] {
  const matches = customers
    .filter((customer) => customerNameKeyFromRecord(customer) === nameKey)
    .slice(0, MAX_CANDIDATES_PER_ROW);
  return matches.map((customer) => ({
    id: customer.id,
    identity: customer,
    source: 'customer',
  }));
}

function buildSameFileCandidates(
  nameKey: string,
  rows: DryRunRowResult[],
): ImportRowMatchingCandidate[] {
  return rows
    .filter((row) => {
      const normalized = row.normalized as NormalizedCustomerRow | null;
      return normalized !== null && customerNameKey(normalized) === nameKey;
    })
    .map((row) => ({
      id: `import-row-${row.row_no}`,
      identity: row.normalized as NormalizedCustomerRow,
      source: 'same_file',
    }));
}

function buildMatchFeatures(
  identity: CustomerIdentity,
  salt: Buffer,
): MatchFeature[] {
  return [
    { kind: 'name', value: customerNameKeyFromRecord(identity) },
    { kind: 'email', value: identity.email },
    { kind: 'phone', value: identity.phone },
    { kind: 'vat', value: identity.vat_id },
  ].map(({ kind, value }) => ({
    kind,
    token: hashOptionalIdentity(kind, value, salt),
  }));
}

function hashIdentity(field: string, identity: string, salt: Buffer): string {
  return createHmac('sha256', salt)
    .update(field)
    .update('\0')
    .update(identity)
    .digest('hex');
}

function hashOptionalIdentity(
  field: string,
  identity: string | null,
  salt: Buffer,
): string | null {
  return identity?.trim()
    ? hashIdentity(field, identity.trim().toLowerCase(), salt)
    : null;
}

function customerNameKeyFromRecord(customer: CustomerIdentity): string {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return `company:${customer.company_name.trim().toLowerCase()}`;
  }
  return `person:${customer.first_name.trim().toLowerCase()}|${customer.last_name.trim().toLowerCase()}`;
}
