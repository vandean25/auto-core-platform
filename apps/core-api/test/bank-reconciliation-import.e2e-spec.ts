import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

function buildCamt053Fixture(params: {
  receivingIban: string;
  statementId: string;
  entries: Array<{
    amount: string;
    currency: string;
    cdtDbtInd: 'CRDT' | 'DBIT';
    bookingDate: string;
    bankRef: string;
    remitterName?: string;
    remitterIban?: string;
    referenceText?: string;
  }>;
}): Buffer {
  const entryXml = params.entries
    .map(
      (e) => `
      <Ntry>
        <Amt Ccy="${e.currency}">${e.amount}</Amt>
        <CdtDbtInd>${e.cdtDbtInd}</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>${e.bookingDate}</Dt></BookgDt>
        <AcctSvcrRef>${e.bankRef}</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <RltdPties>
              ${e.remitterName ? `<Dbtr><Nm>${e.remitterName}</Nm></Dbtr>` : ''}
              ${e.remitterIban ? `<DbtrAcct><Id><IBAN>${e.remitterIban}</IBAN></Id></DbtrAcct>` : ''}
            </RltdPties>
            ${e.referenceText ? `<RmtInf><Ustrd>${e.referenceText}</Ustrd></RmtInf>` : ''}
          </TxDtls>
        </NtryDtls>
      </Ntry>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>${params.statementId}</Id>
      <Acct>
        <Id>
          <IBAN>${params.receivingIban}</IBAN>
        </Id>
      </Acct>
      ${entryXml}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
  return Buffer.from(xml, 'utf8');
}

describe('Bank Reconciliation Import (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let legalEntityAId: string;
  let ownerHeaderA: string;
  let salesHeaderA: string;
  let ownerHeaderB: string;

  const receivingIbanA = 'AT611904300234573201';
  const receivingIbanB = 'AT483200000012345864';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const authService = app.get(AuthService);

    const suffix = Date.now();
    const tenantA = await createTestTenant(basePrisma, `bank-rec-a-${suffix}`);
    const tenantB = await createTestTenant(basePrisma, `bank-rec-b-${suffix}`);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    prismaA = createTenantAwarePrisma(basePrisma, tenantAId);
    prismaB = createTenantAwarePrisma(basePrisma, tenantBId);

    ownerHeaderA = await createMemberBearer(
      basePrisma,
      authService,
      tenantA,
      'OWNER',
    );
    salesHeaderA = await createMemberBearer(
      basePrisma,
      authService,
      tenantA,
      'SALES',
    );
    ownerHeaderB = `Bearer ${createTestAuthToken(authService, tenantB)}`;

    await runWithTenantContext(tenantAId, async () => {
      const entityA = await prismaA.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantAId, is_active: true },
      });
      legalEntityAId = entityA.id;
      await prismaA.legalEntity.update({
        where: { id: entityA.id },
        data: { iban: receivingIbanA },
      });
      await prismaA.financeSettings.upsert({
        where: { tenant_id: tenantAId },
        update: { bank_reconciliation_enabled: false },
        create: {
          tenant_id: tenantAId,
          workshop_order_prefix: 'WO-2026-',
          bank_reconciliation_enabled: false,
        },
      });
    });

    await runWithTenantContext(tenantBId, async () => {
      const entityB = await prismaB.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantBId, is_active: true },
      });
      await prismaB.legalEntity.update({
        where: { id: entityB.id },
        data: { iban: receivingIbanB },
      });
      await prismaB.financeSettings.upsert({
        where: { tenant_id: tenantBId },
        update: { bank_reconciliation_enabled: false },
        create: {
          tenant_id: tenantBId,
          workshop_order_prefix: 'WO-2026-',
          bank_reconciliation_enabled: false,
        },
      });
    });
  });

  afterAll(async () => {
    if (prismaA) {
      await runWithTenantContext(tenantAId, async () => {
        await prismaA.bankTransaction.deleteMany({
          where: { tenant_id: tenantAId },
        });
        await prismaA.bankStatementImport.deleteMany({
          where: { tenant_id: tenantAId },
        });
      });
    }
    if (prismaB) {
      await runWithTenantContext(tenantBId, async () => {
        await prismaB.bankTransaction.deleteMany({
          where: { tenant_id: tenantBId },
        });
        await prismaB.bankStatementImport.deleteMany({
          where: { tenant_id: tenantBId },
        });
      });
    }
    await teardownTestApp(app);
  });

  // Scenario 3: WHEN the flag is off THEN import and list return 404
  it('returns 404 on import and list when bank_reconciliation_enabled is false', async () => {
    const fixture = buildCamt053Fixture({
      receivingIban: receivingIbanA,
      statementId: 'STMT-OFF-1',
      entries: [
        {
          amount: '100.00',
          currency: 'EUR',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-10',
          bankRef: 'REF-OFF-1',
        },
      ],
    });

    await request(app.getHttpServer())
      .post('/api/bank-reconciliation/imports')
      .set('Authorization', ownerHeaderA)
      .attach('file', fixture, 'statement.xml')
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/bank-reconciliation/transactions')
      .set('Authorization', ownerHeaderA)
      .expect(404);
  });

  // Scenario 4 & Scenario 1 & Anti-criterion 2:
  // Turn flag on for tenant A only -> tenant B still 404; only credits become UNMATCHED; Invoice/Payment counts unchanged
  it('enables for tenant A only, imports only credits as UNMATCHED, ignores debits, and leaves Invoice/Payment unchanged', async () => {
    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', ownerHeaderA)
      .send({ bank_reconciliation_enabled: true })
      .expect(200);

    // Tenant B still has flag off -> 404
    await request(app.getHttpServer())
      .get('/api/bank-reconciliation/transactions')
      .set('Authorization', ownerHeaderB)
      .expect(404);

    // Non-admin in tenant A gets 403 when flag is on
    await request(app.getHttpServer())
      .get('/api/bank-reconciliation/transactions')
      .set('Authorization', salesHeaderA)
      .expect(403);

    const [invoiceCountBefore, paymentCountBefore] = await runWithTenantContext(
      tenantAId,
      async () =>
        Promise.all([
          prismaA.invoice.count({ where: { tenant_id: tenantAId } }),
          prismaA.payment.count({ where: { tenant_id: tenantAId } }),
        ]),
    );

    const fixture = buildCamt053Fixture({
      receivingIban: 'AT61 1904 3002 3457 3201',
      statementId: 'STMT-A-001',
      entries: [
        {
          amount: '1250.50',
          currency: 'EUR',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-10',
          bankRef: 'BANK-REF-A-001',
          remitterName: 'Muster GmbH',
          remitterIban: 'DE89370400440532013000',
          referenceText: 'RE-2026-0001',
        },
        {
          amount: '45.00',
          currency: 'EUR',
          cdtDbtInd: 'DBIT',
          bookingDate: '2026-11-11',
          bankRef: 'BANK-REF-A-DEBIT-1',
        },
        {
          amount: '300.00',
          currency: 'CHF',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-12',
          bankRef: 'BANK-REF-A-002',
          remitterName: 'Swiss AG',
          remitterIban: 'CH9300762011623852957',
          referenceText: 'RE-2026-0002',
        },
      ],
    });

    const importRes = await request(app.getHttpServer())
      .post('/api/bank-reconciliation/imports')
      .set('Authorization', ownerHeaderA)
      .attach('file', fixture, 'camt053-a.xml')
      .expect(200);

    expect(importRes.body).toMatchObject({
      legalEntityId: legalEntityAId,
      receivingIban: receivingIbanA,
      totalEntries: 3,
      creditEntries: 2,
      debitEntries: 1,
      importedCount: 3,
      duplicateCount: 0,
      deduplicated: false,
    });

    // Only credit lines become UNMATCHED transactions
    const unmatchedRes = await request(app.getHttpServer())
      .get('/api/bank-reconciliation/transactions?status=UNMATCHED&limit=1')
      .set('Authorization', ownerHeaderA)
      .expect(200);

    expect(unmatchedRes.body.data).toHaveLength(1);
    expect(unmatchedRes.body.data[0]).toMatchObject({
      bank_ref: 'BANK-REF-A-002',
      status: 'UNMATCHED',
      is_credit: true,
      non_eur: true,
      currency: 'CHF',
      remitter_iban_last4: '2957',
    });
    expect(unmatchedRes.body.meta.hasNextPage).toBe(true);
    expect(unmatchedRes.body.meta.nextCursor).toBeTruthy();

    const page2Res = await request(app.getHttpServer())
      .get(
        `/api/bank-reconciliation/transactions?status=UNMATCHED&limit=1&cursor=${encodeURIComponent(unmatchedRes.body.meta.nextCursor)}`,
      )
      .set('Authorization', ownerHeaderA)
      .expect(200);

    expect(page2Res.body.data).toHaveLength(1);
    expect(page2Res.body.data[0]).toMatchObject({
      bank_ref: 'BANK-REF-A-001',
      status: 'UNMATCHED',
      is_credit: true,
      non_eur: false,
      currency: 'EUR',
      remitter_iban_last4: '3000',
    });
    expect(page2Res.body.meta.hasNextPage).toBe(false);

    // Anti-criterion: Invoice and Payment counts are unchanged
    const [invoiceCountAfter, paymentCountAfter] = await runWithTenantContext(
      tenantAId,
      async () =>
        Promise.all([
          prismaA.invoice.count({ where: { tenant_id: tenantAId } }),
          prismaA.payment.count({ where: { tenant_id: tenantAId } }),
        ]),
    );
    expect(invoiceCountAfter).toBe(invoiceCountBefore);
    expect(paymentCountAfter).toBe(paymentCountBefore);
  });

  // Scenario 2: WHEN the same file is uploaded again THEN no duplicate transactions exist
  it('deduplicates exact re-uploads and overlapping bank references idempotently', async () => {
    const fixture = buildCamt053Fixture({
      receivingIban: 'AT61 1904 3002 3457 3201',
      statementId: 'STMT-A-001',
      entries: [
        {
          amount: '1250.50',
          currency: 'EUR',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-10',
          bankRef: 'BANK-REF-A-001',
          remitterName: 'Muster GmbH',
          remitterIban: 'DE89370400440532013000',
          referenceText: 'RE-2026-0001',
        },
        {
          amount: '45.00',
          currency: 'EUR',
          cdtDbtInd: 'DBIT',
          bookingDate: '2026-11-11',
          bankRef: 'BANK-REF-A-DEBIT-1',
        },
        {
          amount: '300.00',
          currency: 'CHF',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-12',
          bankRef: 'BANK-REF-A-002',
          remitterName: 'Swiss AG',
          remitterIban: 'CH9300762011623852957',
          referenceText: 'RE-2026-0002',
        },
      ],
    });

    const reuploadRes = await request(app.getHttpServer())
      .post('/api/bank-reconciliation/imports')
      .set('Authorization', ownerHeaderA)
      .attach('file', fixture, 'camt053-a.xml')
      .expect(200);

    expect(reuploadRes.body).toMatchObject({
      importedCount: 0,
      duplicateCount: 3,
      deduplicated: true,
    });

    // Overlapping statement with one existing ref and one new ref
    const overlapFixture = buildCamt053Fixture({
      receivingIban: receivingIbanA,
      statementId: 'STMT-A-002',
      entries: [
        {
          amount: '1250.50',
          currency: 'EUR',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-10',
          bankRef: 'BANK-REF-A-001',
        },
        {
          amount: '210.00',
          currency: 'EUR',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-13',
          bankRef: 'BANK-REF-A-003',
        },
      ],
    });

    const overlapRes = await request(app.getHttpServer())
      .post('/api/bank-reconciliation/imports')
      .set('Authorization', ownerHeaderA)
      .attach('file', overlapFixture, 'camt053-overlap.xml')
      .expect(200);

    expect(overlapRes.body).toMatchObject({
      importedCount: 1,
      duplicateCount: 1,
      deduplicated: false,
    });

    const countAfter = await runWithTenantContext(tenantAId, () =>
      prismaA.bankTransaction.count({
        where: { tenant_id: tenantAId, status: 'UNMATCHED' },
      }),
    );
    expect(countAfter).toBe(3);
  });

  it('rejects statements whose receiving IBAN does not match any active legal entity in the tenant', async () => {
    const unknownIbanFixture = buildCamt053Fixture({
      receivingIban: 'AT000000000000000000',
      statementId: 'STMT-UNKNOWN',
      entries: [
        {
          amount: '50.00',
          currency: 'EUR',
          cdtDbtInd: 'CRDT',
          bookingDate: '2026-11-10',
          bankRef: 'BANK-REF-UNKNOWN',
        },
      ],
    });

    await request(app.getHttpServer())
      .post('/api/bank-reconciliation/imports')
      .set('Authorization', ownerHeaderA)
      .attach('file', unknownIbanFixture, 'unknown.xml')
      .expect(400);
  });
});
