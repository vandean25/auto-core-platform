import { Injectable } from '@nestjs/common';
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
} from './document-sort.heuristic.js';
import type { DryRunRowResult } from '../import/import.types.js';
import { customerNameKey } from '../import/customer-import.logic.js';
import type { NormalizedCustomerRow } from '../import/import.types.js';
import { pickCustomerAuditSnapshot } from '../import/import-audit.util.js';

export type ImportRowMatchingCandidate = {
  id: string;
  label: string;
  snapshot: Record<string, unknown>;
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
  }): void {
    const ambiguous = params.row.warnings.some(
      (warning) => warning.code === 'IMPORT_POSSIBLE_DUPLICATE',
    );
    if (!ambiguous) {
      return;
    }

    const nameKey = customerNameKey(params.normalizedRow);
    const candidates = buildCustomerCandidates(nameKey, params.customers);
    if (candidates.length < 1) {
      return;
    }

    const choiceIds = candidates.map((candidate) => candidate.id);
    const actualChoice =
      params.row.entity_id ??
      (params.row.action === 'CREATE' ? '__create_new__' : choiceIds[0]);

    this.shadow.scheduleShadow({
      tenantId: params.tenantId,
      traceId: this.shadow.resolveTraceId(params.traceId),
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      input: {
        row: redactCustomerRow(params.normalizedRow),
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
        })),
      },
      choices: [...choiceIds, '__create_new__'],
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
      input: { text: trimmed.slice(0, 8_000) },
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
    const customers = await this.loadCustomers(tenantId);
    for (const row of rows) {
      if (!row.normalized) {
        continue;
      }
      const normalizedRow = row.normalized as NormalizedCustomerRow;
      this.scheduleImportRowMatchingForDryRun({
        tenantId,
        traceId,
        row,
        normalizedRow,
        customers,
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
    label: formatCustomerLabel(customer),
    snapshot: pickCustomerAuditSnapshot(customer),
  }));
}

function customerNameKeyFromRecord(customer: Customer): string {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return `company:${customer.company_name.trim().toLowerCase()}`;
  }
  return `person:${customer.first_name.trim().toLowerCase()}|${customer.last_name.trim().toLowerCase()}`;
}

function formatCustomerLabel(customer: Customer): string {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return customer.company_name;
  }
  return `${customer.first_name} ${customer.last_name}`.trim();
}

function redactCustomerRow(
  row: NormalizedCustomerRow,
): Record<string, unknown> {
  return {
    external_id: row.external_id,
    type: row.type,
    company_name: row.company_name,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    vat_id: row.vat_id,
    address_city: row.address_city,
    address_country: row.address_country,
  };
}
