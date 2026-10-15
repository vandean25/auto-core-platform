import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentMethod, Prisma } from '@prisma/client';
import { FakeFiskalySignAtContractServer } from './fiskaly-sign-at-contract.server.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import {
  buildNormalSignRequestBody,
  buildCancellationSignRequestBody,
} from './settlement-sign-body.builder.js';

const fixturePath = join(
  process.cwd(),
  '../../docs/internal/02-Feature-Specs/Finance/at-settlement-rksv.fixtures.json',
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  ids: Record<string, string>;
  normalBody: Record<string, unknown>;
  cases: Array<{ id: string }>;
};

describe('Settlement fixture scenarios (fake fiskaly)', () => {
  let provider: FiskalySignAtFixtureProvider;
  let server: FakeFiskalySignAtContractServer;

  beforeEach(() => {
    provider = new FiskalySignAtFixtureProvider();
    server = provider.contractServer;
    server.reset();
  });

  it('success-normal signs once with PUT 200', async () => {
    const result = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId: fixtures.ids.normalReceiptId,
      body: fixtures.normalBody,
    });
    expect(result.kind).toBe('http');
    if (result.kind === 'http') {
      expect(result.status).toBe(200);
      expect(result.body?.signed).toBe(true);
    }
    expect(server.calls).toEqual([{ method: 'PUT', receiptId: fixtures.ids.normalReceiptId }]);
  });

  it('rejection-schema returns definite 400', async () => {
    server.configure({ putBehavior: 'reject400' });
    const result = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId: fixtures.ids.normalReceiptId,
      body: fixtures.normalBody,
    });
    expect(result).toMatchObject({ kind: 'http', status: 400 });
  });

  it('timeout-after-possible-acceptance reconciles with GET 200', async () => {
    server.configure({ putBehavior: 'timeout_maybe_stored' });
    const put = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId: fixtures.ids.normalReceiptId,
      body: fixtures.normalBody,
    });
    expect(put.kind).toBe('transport');
    const get = await provider.retrieveReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId: fixtures.ids.normalReceiptId,
    });
    expect(get.kind).toBe('http');
    if (get.kind === 'http') {
      expect(get.status).toBe(200);
    }
  });

  it('frozen PUT body matches fixture metadata for cancellation on payment e1', async () => {
    const body = buildCancellationSignRequestBody({
      invoiceId: fixtures.ids.invoiceId,
      invoiceNumber: 'RE-2026-0101',
      paymentId: fixtures.ids.paymentId,
      grossAmount: new Prisma.Decimal('120.00'),
      method: PaymentMethod.CASH,
      originalReceiptId: fixtures.ids.normalReceiptId,
    });
    const result = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId: fixtures.ids.cancellationReceiptId,
      body,
    });
    expect(result.kind).toBe('http');
    expect(body.metadata).toEqual({
      acp_invoice_id: fixtures.ids.invoiceId,
      acp_invoice_no: 'RE-2026-0101',
      acp_payment_id: fixtures.ids.paymentId,
      acp_original_receipt_id: fixtures.ids.normalReceiptId,
    });
  });

  it('stores signed false outage response once without a second PUT', async () => {
    server.configure({
      putBehavior: 'success',
      successBodyTemplate: {
        signed: false,
        hints: ['Sicherheitseinrichtung ausgefallen'],
        _env: 'TEST',
        receipt_number: '99',
      },
    });
    const receiptId = fixtures.ids.normalReceiptId;
    const first = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId,
      body: fixtures.normalBody,
    });
    const second = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId,
      receiptId,
      body: fixtures.normalBody,
    });
    expect(first.kind).toBe('http');
    expect(second.kind).toBe('http');
    if (first.kind === 'http' && second.kind === 'http') {
      expect(first.body?.signed).toBe(false);
      expect(second.body?.signed).toBe(false);
    }
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('lists every fixture case id for traceability', () => {
    const ids = fixtures.cases.map((caseRow) => caseRow.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'success-normal',
        'rejection-schema',
        'timeout-after-possible-acceptance',
      ]),
    );
  });
});
