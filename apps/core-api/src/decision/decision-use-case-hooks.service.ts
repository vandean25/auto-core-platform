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

export type ImportRowMatchingCandidate = {
  id: string;
  identity: CustomerIdentity;
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
    const ambiguous = params.row.warnings.some(
      (warning) => warning.code === 'IMPORT_POSSIBLE_DUPLICATE',
    );
    if (!ambiguous) {
      return;
    }

    const nameKey = customerNameKey(params.normalizedRow);
    const candidates = [
      ...buildCustomerCandidates(nameKey, params.customers),
      ...buildSameFileCandidates(nameKey, params.sameFileRows),
    ].slice(0, 5);
    if (candidates.length === 0) {
      return;
    }

    const candidateChoices = candidates.map(
      (_candidate, index) => `choice_${index + 1}`,
    );
    const createChoice = 'create_new';
    const selectedCandidateIndex = candidates.findIndex(
      (candidate) => candidate.id === params.row.entity_id,
    );
    const actualChoice =
      selectedCandidateIndex >= 0
        ? candidateChoices[selectedCandidateIndex]
        : params.row.action === 'CREATE'
          ? createChoice
          : candidateChoices[0];

    this.shadow.scheduleShadow({
      tenantId: params.tenantId,
      traceId: this.shadow.resolveTraceId(params.traceId),
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
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
      actualOutcome: {
        choice: actualChoice,
        source: 'import_dry_run',
      },
    });
  }

  scheduleDocumentSortForText(params: {
    tenantId: string;
    traceId?: string;
    text: string;
  }): void {
    const trimmed = params.text.trim();
    if (!trimmed) {
      return;
    }
    const actualType = classifyDocumentTextHeuristic(trimmed);
    this.shadow.scheduleShadow({
      tenantId: params.tenantId,
      traceId: this.shadow.resolveTraceId(params.traceId),
      useCase: DECISION_USE_CASES.DOCUMENT_SORT,
      input: { signals: extractDocumentSortSignals(trimmed) },
      choices: documentSortChoices(),
      actualOutcome: {
        choice: actualType,
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
      return;
    }
    const customers = await this.loadCustomers(tenantId);
    const identitySalt = randomBytes(32);
    for (const row of ambiguousRows) {
      const normalizedRow = row.normalized as NormalizedCustomerRow;
      this.scheduleImportRowMatchingForDryRun({
        tenantId,
        traceId,
        row,
        normalizedRow,
        customers,
        identitySalt,
        sameFileRows: rows.filter(
          (candidate) =>
            candidate.row_no < row.row_no &&
            candidate.action === 'CREATE' &&
            candidate.normalized !== null,
        ),
      });
    }
  }

  private loadCustomers(tenantId: string): Promise<Customer[]> {
    return this.prisma.customer.findMany({
      where: { tenant_id: tenantId },
    });
  }
}

function buildCustomerCandidates(
  nameKey: string,
  customers: Customer[],
): ImportRowMatchingCandidate[] {
  const matches = customers
    .filter((customer) => customerNameKeyFromRecord(customer) === nameKey)
    .slice(0, 5);
  return matches.map((customer) => ({
    id: customer.id,
    identity: customer,
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
    }));
}

function buildMatchFeatures(
  identity: CustomerIdentity,
  salt: Buffer,
): Array<{ kind: string; token: string | null }> {
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
