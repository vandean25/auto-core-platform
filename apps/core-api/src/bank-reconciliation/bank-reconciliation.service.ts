import { BadRequestException, Injectable } from '@nestjs/common';
import { BankTransactionStatus, Prisma } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  GLOBAL_LIST_LIMIT_MAX,
  LIST_CURSOR_ENDPOINT,
  fetchKeysetListPage,
} from '../common/list-cursor/index.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  resolveCurrentUser,
} from '../site/site.authorization.js';
import type {
  BankStatementImportResponseDto,
  BankTransactionItemDto,
  ListBankTransactionsQueryDto,
} from './bank-reconciliation.dto.js';
import {
  normalizeIban,
  parseCamt053,
  type ParsedCamt053Entry,
  type ParsedCamt053Statement,
} from './camt053.parser.js';

const DEFAULT_LIST_LIMIT = 50;

function computeIbanFingerprint(
  tenantId: string,
  normalizedIban: string,
): string {
  const secret =
    process.env.BANK_RECONCILIATION_IBAN_HMAC_SECRET ||
    process.env.JWT_SECRET ||
    'acp-bank-reconciliation-iban-hmac-dev-key';
  return createHmac('sha256', secret)
    .update(`${tenantId}:${normalizedIban}`)
    .digest('hex');
}

function toTransactionDto(row: {
  id: string;
  legal_entity_id: string;
  import_id: string;
  receiving_iban: string;
  booking_date: Date;
  value_date: Date | null;
  amount: Prisma.Decimal;
  currency: string;
  is_credit: boolean;
  non_eur: boolean;
  remitter_name: string | null;
  remitter_iban_last4: string | null;
  reference_text: string | null;
  bank_ref: string;
  status: BankTransactionStatus;
  version: number;
  createdAt: Date;
}): BankTransactionItemDto {
  return {
    id: row.id,
    legal_entity_id: row.legal_entity_id,
    import_id: row.import_id,
    receiving_iban: row.receiving_iban,
    booking_date: row.booking_date.toISOString().slice(0, 10),
    value_date: row.value_date
      ? row.value_date.toISOString().slice(0, 10)
      : null,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    is_credit: row.is_credit,
    non_eur: row.non_eur,
    remitter_name: row.remitter_name,
    remitter_iban_last4: row.remitter_iban_last4,
    reference_text: row.reference_text,
    bank_ref: row.bank_ref,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async importStatement(
    file: Express.Multer.File | undefined,
  ): Promise<BankStatementImportResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        'A non-empty camt.053 XML file is required.',
      );
    }

    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const parsed = parseCamt053(file.buffer);
    const { legalEntityId, receivingIban, statementId } =
      await this.resolveStatementOwnership(tenantId, parsed.statements);

    const allEntries = parsed.statements.flatMap((s) => s.entries);
    const creditEntries = allEntries.filter((e) => e.isCredit).length;
    const debitEntries = allEntries.length - creditEntries;
    const currentUser = await resolveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    return this.prisma.$transaction(async (tx) => {
      const existingImport = await tx.bankStatementImport.findFirst({
        where: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          file_sha256: fileSha256,
        },
      });
      if (existingImport) {
        return {
          importId: existingImport.id,
          legalEntityId: existingImport.legal_entity_id,
          receivingIban: existingImport.receiving_iban,
          statementId: existingImport.statement_id,
          format: existingImport.format,
          totalEntries: existingImport.total_entries,
          creditEntries: existingImport.credit_entries,
          debitEntries: existingImport.debit_entries,
          importedCount: 0,
          duplicateCount: existingImport.total_entries,
          deduplicated: true,
        };
      }

      const newEntries = await this.filterDuplicateEntries(
        tx,
        tenantId,
        legalEntityId,
        receivingIban,
        allEntries,
      );

      const createdImport = await tx.bankStatementImport.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          uploaded_by_user_id: currentUser?.id ?? null,
          file_name: file.originalname || 'statement.xml',
          file_sha256: fileSha256,
          receiving_iban: receivingIban,
          statement_id: statementId,
          format: 'camt.053',
          total_entries: allEntries.length,
          credit_entries: creditEntries,
          debit_entries: debitEntries,
          imported_count: newEntries.length,
          duplicate_count: allEntries.length - newEntries.length,
        },
      });

      if (newEntries.length > 0) {
        await tx.bankTransaction.createMany({
          data: newEntries.map((entry) => ({
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            import_id: createdImport.id,
            receiving_iban: receivingIban,
            booking_date: new Date(`${entry.bookingDate}T00:00:00.000Z`),
            value_date: entry.valueDate
              ? new Date(`${entry.valueDate}T00:00:00.000Z`)
              : null,
            amount: new Prisma.Decimal(entry.amount),
            currency: entry.currency,
            is_credit: entry.isCredit,
            non_eur: entry.nonEur,
            remitter_name: entry.remitterName,
            remitter_iban_fingerprint: entry.remitterIban
              ? computeIbanFingerprint(tenantId, entry.remitterIban)
              : null,
            remitter_iban_last4: entry.remitterIban
              ? entry.remitterIban.slice(-4)
              : null,
            reference_text: entry.referenceText,
            bank_ref: entry.bankRef,
            status: entry.isCredit
              ? BankTransactionStatus.UNMATCHED
              : BankTransactionStatus.IGNORED,
          })),
        });
      }

      return {
        importId: createdImport.id,
        legalEntityId,
        receivingIban,
        statementId,
        format: createdImport.format,
        totalEntries: allEntries.length,
        creditEntries,
        debitEntries,
        importedCount: newEntries.length,
        duplicateCount: allEntries.length - newEntries.length,
        deduplicated: false,
      };
    });
  }

  async listTransactions(query: ListBankTransactionsQueryDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = (await this.siteContext.findSiteId()) ?? '';
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1),
      GLOBAL_LIST_LIMIT_MAX,
    );
    const sortDirection = query.sortDirection === 'asc' ? 'asc' : 'desc';
    const baseWhere: Record<string, unknown> = {
      tenant_id: tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.legal_entity_id
        ? { legal_entity_id: query.legal_entity_id }
        : {}),
    };

    return fetchKeysetListPage(
      {
        endpoint: LIST_CURSOR_ENDPOINT.bankTransactions,
        tenantId,
        siteId,
        filterHashInput: {
          status: query.status ?? null,
          legal_entity_id: query.legal_entity_id ?? null,
        },
        sortField: 'booking_date',
        sortDirection,
        sortConfig: {
          prismaField: 'booking_date',
          valueKind: 'date',
          nullable: false,
        },
        cursor: query.cursor,
        limit,
        baseWhere,
      },
      {
        findMany: (where, orderBy, take) =>
          this.prisma.bankTransaction.findMany({
            where,
            orderBy,
            take,
          }),
        mapRow: toTransactionDto,
        readSortValue: (row, prismaField) =>
          row[prismaField as keyof typeof row],
      },
    );
  }

  private async buildIbanEntityMap(
    tenantId: string,
  ): Promise<Map<string, string[]>> {
    const entities = await this.prisma.legalEntity.findMany({
      where: { tenant_id: tenantId, is_active: true, iban: { not: null } },
      select: { id: true, iban: true },
    });
    const byIban = new Map<string, string[]>();
    for (const entity of entities) {
      if (!entity.iban) continue;
      const normalized = normalizeIban(entity.iban);
      const list = byIban.get(normalized) ?? [];
      list.push(entity.id);
      byIban.set(normalized, list);
    }
    return byIban;
  }

  private async resolveStatementOwnership(
    tenantId: string,
    statements: ParsedCamt053Statement[],
  ): Promise<{
    legalEntityId: string;
    receivingIban: string;
    statementId: string | null;
  }> {
    const byIban = await this.buildIbanEntityMap(tenantId);
    const resolvedEntityIds = new Set<string>();
    const receivingIbans = new Set<string>();

    for (const stmt of statements) {
      const matches = byIban.get(stmt.receivingIban) ?? [];
      if (matches.length !== 1) {
        const reason =
          matches.length === 0
            ? `Unknown receiving bank account IBAN "${stmt.receivingIban}".`
            : `Receiving IBAN "${stmt.receivingIban}" matches multiple active legal entities.`;
        throw new BadRequestException(reason);
      }
      resolvedEntityIds.add(matches[0]);
      receivingIbans.add(stmt.receivingIban);
    }

    if (resolvedEntityIds.size !== 1 || receivingIbans.size !== 1) {
      throw new BadRequestException(
        'Bank statement file must belong to a single receiving account and legal entity.',
      );
    }

    return {
      legalEntityId: [...resolvedEntityIds][0],
      receivingIban: [...receivingIbans][0],
      statementId: statements[0]?.statementId ?? null,
    };
  }

  private async filterDuplicateEntries(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legalEntityId: string,
    receivingIban: string,
    entries: ParsedCamt053Entry[],
  ): Promise<ParsedCamt053Entry[]> {
    if (entries.length === 0) return [];
    const refs = entries.map((e) => e.bankRef);
    const existing = await tx.bankTransaction.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        receiving_iban: receivingIban,
        bank_ref: { in: refs },
      },
      select: { bank_ref: true },
    });
    const seen = new Set(existing.map((r) => r.bank_ref));
    const uniqueNew: ParsedCamt053Entry[] = [];
    for (const entry of entries) {
      if (seen.has(entry.bankRef)) continue;
      seen.add(entry.bankRef);
      uniqueNew.push(entry);
    }
    return uniqueNew;
  }
}
