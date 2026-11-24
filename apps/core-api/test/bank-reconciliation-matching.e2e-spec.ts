import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { bankFixture } from './support/bank-reconciliation-fixture.js';
import {
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Bank reconciliation matching (e2e)', () => {
  let app: INestApplication;
  let base: PrismaService;
  let prisma: PrismaService;
  let fixture: Awaited<ReturnType<typeof bankFixture>>;
  let admin: string;
  let sales: string;
  const path = (id: string) => `/api/bank-reconciliation/transactions/${id}`;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication()
      .setGlobalPrefix('api')
      .useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    base = app.get(PrismaService);
    const tenant = await createTestTenant(base, 'bank-matching');
    prisma = createTenantAwarePrisma(base, tenant.tenantId);
    fixture = await bankFixture(prisma, tenant.tenantId);
    admin = `Bearer ${createTestAuthToken(app.get(AuthService), tenant)}`;
    sales = await createMemberBearer(
      base,
      app.get(AuthService),
      tenant,
      'SALES',
    );
    await fixture.enable(true);
  });

  afterAll(async () => teardownTestApp(app, base));

  const confirm = (id: string, invoiceId: string, transactionVersion = 1) =>
    request(app.getHttpServer())
      .post(`${path(id)}/confirm`)
      .set('Authorization', admin)
      .send({ invoiceId, transactionVersion });

  const undo = (id: string, expectedVersion = 2, allocationId?: string) =>
    request(app.getHttpServer())
      .post(`${path(id)}/undo`)
      .set('Authorization', admin)
      .send({ expectedVersion, allocationId });

  it('ranks an invoice with an explicit reference and exact amount first', async () => {
    await fixture.invoice('RE-RANK-OTHER');
    const invoice = await fixture.invoice('RE-RANK');
    const transfer = await fixture.transfer('Payment RE-RANK');
    const response = await request(app.getHttpServer())
      .get(`${path(transfer.id)}/suggestions`)
      .set('Authorization', admin)
      .expect(200);
    expect(response.body.data[0]).toMatchObject({
      invoiceId: invoice.id,
      reasons: expect.arrayContaining([
        { code: 'AMOUNT_EXACT', value: '120.00' },
        { code: 'INVOICE_NO_IN_REFERENCE', value: 'RE-RANK' },
      ]),
    });
  });

  it('leaves the invoice untouched when importing a transfer and viewing suggestions', async () => {
    const invoice = await fixture.invoice('RE-IMPORT');
    await prisma.legalEntity.update({
      where: { id: fixture.site.legal_entity_id },
      data: { iban: fixture.receivingIban },
    });
    const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Id>bank-matching</Id><Acct><Id><IBAN>${fixture.receivingIban}</IBAN></Id></Acct>
      <Ntry><Amt Ccy="EUR">120.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
      <BookgDt><Dt>${fixture.date.toISOString().slice(0, 10)}</Dt></BookgDt><AcctSvcrRef>IMPORT-MATCH</AcctSvcrRef>
      <NtryDtls><TxDtls><RmtInf><Ustrd>RE-IMPORT</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      </Stmt></BkToCstmrStmt></Document>`;
    await request(app.getHttpServer())
      .post('/api/bank-reconciliation/imports')
      .set('Authorization', admin)
      .attach('file', Buffer.from(xml), 'fixture.xml')
      .expect(200);
    const transfer = await prisma.bankTransaction.findFirstOrThrow({
      where: { ...fixture.ownership, bank_ref: 'IMPORT-MATCH' },
    });
    await request(app.getHttpServer())
      .get(`${path(transfer.id)}/suggestions`)
      .set('Authorization', admin)
      .expect(200);
    expect(
      await prisma.invoice.findFirst({
        where: { ...fixture.ownership, id: invoice.id },
        select: { status: true, payments: { select: { id: true } } },
      }),
    ).toEqual({ status: 'ISSUED', payments: [] });
  });

  it('confirms a full bank payment once without a fiscal receipt', async () => {
    const invoice = await fixture.invoice('RE-FULL');
    const transfer = await fixture.transfer('RE-FULL');
    const result = await confirm(transfer.id, invoice.id).expect(200);
    const retry = await confirm(transfer.id, invoice.id).expect(200);
    expect(retry.body).toEqual(result.body);
    expect(result.body).toMatchObject({
      status: 'MATCHED',
      version: 2,
      unallocatedAmount: '0.00',
    });
    expect(
      await prisma.invoice.findFirst({
        where: { ...fixture.ownership, id: invoice.id },
        select: {
          status: true,
          payments: {
            select: { method: true, status: true, fiscal_receipts: true },
          },
        },
      }),
    ).toEqual({
      status: 'PAID',
      payments: [
        { method: 'BANK_TRANSFER', status: 'SETTLED', fiscal_receipts: [] },
      ],
    });
  });

  it('shows all bank allocations in invoice payment history without fiscal receipts', async () => {
    const invoice = await fixture.invoice('RE-HISTORY');
    const first = await fixture.transfer('RE-HISTORY', 40);
    const second = await fixture.transfer('RE-HISTORY', 80);
    await confirm(first.id, invoice.id).expect(200);
    await confirm(second.id, invoice.id).expect(200);

    const result = await request(app.getHttpServer())
      .get(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', admin)
      .expect(200);
    expect(result.body.payment.fiscalReceipts).toEqual([]);
    expect(result.body.bankPayments).toEqual([
      expect.objectContaining({
        amount: '40.00',
        method: 'BANK_TRANSFER',
        status: 'SETTLED',
      }),
      expect.objectContaining({
        amount: '80.00',
        method: 'BANK_TRANSFER',
        status: 'SETTLED',
      }),
    ]);
  });

  it('reopens an invoice on undo and retains its reversed payment', async () => {
    const invoice = await fixture.invoice('RE-UNDO');
    const transfer = await fixture.transfer('RE-UNDO');
    await confirm(transfer.id, invoice.id).expect(200);
    const result = await undo(transfer.id).expect(200);
    expect(result.body).toMatchObject({
      status: 'UNMATCHED',
      version: 3,
      unallocatedAmount: '120.00',
    });
    expect(
      await prisma.invoice.findFirst({
        where: { ...fixture.ownership, id: invoice.id },
        select: { status: true, payments: { select: { status: true } } },
      }),
    ).toEqual({ status: 'ISSUED', payments: [{ status: 'REVERSED' }] });
  });

  it('rejects undo atomically when the invoice was edited after confirm', async () => {
    const invoice = await fixture.invoice('RE-CONFLICT');
    const transfer = await fixture.transfer('RE-CONFLICT');
    await confirm(transfer.id, invoice.id).expect(200);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        internal_notes: 'Edited',
        updatedAt: new Date(fixture.date.getTime() + 86400000),
      },
    });
    await undo(transfer.id).expect(409);
    expect(
      await prisma.invoice.findFirst({
        where: { ...fixture.ownership, id: invoice.id },
        select: { status: true, payments: { select: { status: true } } },
      }),
    ).toEqual({ status: 'PAID', payments: [{ status: 'SETTLED' }] });
    expect(
      await prisma.bankTransaction.findFirst({
        where: { ...fixture.ownership, id: transfer.id },
        select: { status: true, version: true },
      }),
    ).toEqual({ status: 'MATCHED', version: 2 });
  });

  it('hides all routes when disabled and preserves the admin grant when enabled', async () => {
    const invoice = await fixture.invoice('RE-GRANT');
    const transfer = await fixture.transfer('RE-GRANT');
    const suggestions = (header: string) =>
      request(app.getHttpServer())
        .get(`${path(transfer.id)}/suggestions`)
        .set('Authorization', header);
    const ignore = (header: string, expectedVersion = 1) =>
      request(app.getHttpServer())
        .post(`${path(transfer.id)}/ignore`)
        .set('Authorization', header)
        .send({ expectedVersion, reason: 'Unrelated transfer' });
    await fixture.enable(false);
    try {
      await suggestions(admin).expect(404);
      await suggestions(sales).expect(404);
      await confirm(transfer.id, invoice.id).expect(404);
      await undo(transfer.id, 1).expect(404);
      await ignore(admin).expect(404);
    } finally {
      await fixture.enable(true);
    }
    await suggestions(sales).expect(403);
    await ignore(sales).expect(403);
    await suggestions(admin).expect(200);
    const ignored = await ignore(admin).expect(200);
    expect(ignored.body).toMatchObject({
      status: 'IGNORED',
      version: 2,
      allocations: [],
    });
    await ignore(admin).expect(409);
    const restored = await undo(transfer.id).expect(200);
    expect(restored.body).toMatchObject({
      status: 'UNMATCHED',
      version: 3,
      allocations: [],
    });
  });

  it('splits one transfer against net outstanding and leaves the partial invoice issued', async () => {
    const first = await fixture.invoice('RE-SPLIT-A');
    const second = await fixture.invoice('RE-SPLIT-B');
    await prisma.creditNote.create({
      data: {
        ...fixture.ownership,
        original_invoice_id: first.id,
        site_id: fixture.site.id,
        date: fixture.date,
        reason: 'Synthetic credit',
        status: 'FINALIZED',
        total_gross: 20,
      },
    });
    const transfer = await fixture.transfer('RE-SPLIT-A RE-SPLIT-B', 150);
    const result = await request(app.getHttpServer())
      .post(`${path(transfer.id)}/confirm`)
      .set('Authorization', admin)
      .send({
        transactionVersion: 1,
        allocations: [
          { invoiceId: first.id, amount: '100.00' },
          { invoiceId: second.id, amount: '50.00' },
        ],
      })
      .expect(200);
    expect(result.body.allocations).toHaveLength(2);
    const rows = await prisma.invoice.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { invoice_number: 'asc' },
      select: { status: true },
    });
    expect(rows.map(({ status }) => status)).toEqual(['PAID', 'ISSUED']);
    const selected = result.body.allocations.find(
      (allocation: { invoiceId: string }) => allocation.invoiceId === first.id,
    );
    const undone = await undo(transfer.id, 2, selected.id).expect(200);
    expect(undone.body).toMatchObject({
      status: 'MATCHED',
      unallocatedAmount: '100.00',
      allocations: [{ invoiceId: second.id, amount: '50.00' }],
    });
  });

  it('rejects competing confirmations that would collectively overpay an invoice', async () => {
    const invoice = await fixture.invoice('RE-COMPETING');
    const transfers = await Promise.all([
      fixture.transfer('RE-COMPETING', 80),
      fixture.transfer('RE-COMPETING', 80),
    ]);
    const responses = await Promise.all(
      transfers.map((transfer) =>
        request(app.getHttpServer())
          .post(`${path(transfer.id)}/confirm`)
          .set('Authorization', admin)
          .send({
            transactionVersion: 1,
            allocations: [{ invoiceId: invoice.id, amount: '80.00' }],
          }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await prisma.payment.count({
        where: {
          ...fixture.ownership,
          site_id: fixture.site.id,
          invoice_id: invoice.id,
        },
      }),
    ).toBe(1);
  });

  it('excludes another legal entity even when the admin belongs to both sites', async () => {
    const foreign = await fixture.invoice('RE-FOREIGN-ENTITY');
    const { tenant_id } = fixture.ownership;
    const entity = await prisma.legalEntity.create({
      data: { tenant_id, name: 'Synthetic Legal Entity', country_iso: 'AT' },
    });
    const site = await prisma.site.create({
      data: {
        tenant_id,
        legal_entity_id: entity.id,
        name: 'Secondary',
        code: 'SECOND',
      },
    });
    const member = await prisma.tenantMember.findFirstOrThrow({
      where: { tenant_id, role: 'ADMIN', is_active: true },
    });
    await prisma.siteMembership.create({
      data: { tenant_id, user_id: member.user_id, site_id: site.id },
    });
    await prisma.invoice.update({
      where: { id: foreign.id },
      data: { legal_entity_id: entity.id, site_id: site.id },
    });
    const transfer = await fixture.transfer('RE-FOREIGN-ENTITY');
    const suggestions = await request(app.getHttpServer())
      .get(`${path(transfer.id)}/suggestions`)
      .set('Authorization', admin)
      .expect(200);
    expect(
      suggestions.body.data.map(
        (candidate: { invoiceId: string }) => candidate.invoiceId,
      ),
    ).not.toContain(foreign.id);
    await confirm(transfer.id, foreign.id).expect(404);
  });

  it('excludes a legacy open item even when its reference and amount match', async () => {
    const source = {
      tenant_id: fixture.ownership.tenant_id,
      source_system: 'synthetic',
    };
    const run = await prisma.migrationRun.create({
      data: {
        ...fixture.ownership,
        ...source,
        name: 'Synthetic migration',
        cutover_date: fixture.date,
        manifest_json: {},
        manifest_sha256: '0'.repeat(64),
      },
    });
    const job = await prisma.importJob.create({
      data: {
        ...source,
        entity_type: 'LEGACY_OPEN_ITEM',
        file_name: 'legacy.csv',
        file_sha256: '0'.repeat(64),
        mapping_json: {},
        options_json: {},
        totals_json: {},
      },
    });
    const legacy = await prisma.legacyDocument.create({
      data: {
        ...fixture.ownership,
        ...source,
        site_id: fixture.site.id,
        external_id: 'legacy-open',
        migration_run_id: run.id,
        doc_type: 'OPEN_ITEM',
        origin: 'PRIOR_SYSTEM',
        doc_no: 'LEGACY-MATCH',
        doc_date: fixture.date,
        currency: 'EUR',
        net_total: 90,
        vat_total: 10,
        gross_total: 100,
        remaining_amount: 100,
        payload_json: {},
        payload_sha256: '0'.repeat(64),
        retain_until: fixture.date,
        import_job_id: job.id,
      },
    });
    const transfer = await fixture.transfer('LEGACY-MATCH', 100);
    const result = await request(app.getHttpServer())
      .get(`${path(transfer.id)}/suggestions`)
      .set('Authorization', admin)
      .expect(200);
    expect(result.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invoiceId: legacy.id }),
      ]),
    );
    expect(result.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invoiceNumber: legacy.doc_no }),
      ]),
    );
  });
});
