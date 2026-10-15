import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakeFiskalySignAtContractServer } from './fiskaly-sign-at-contract.server.js';
import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';

const fixtures = JSON.parse(
  readFileSync(
    '/workspace/docs/internal/02-Feature-Specs/Finance/at-settlement-rksv.fixtures.json',
    'utf8',
  ),
) as {
  cases: Array<{ id: string; providerResponse?: { status: number | null; transport?: string } }>;
};

describe('FiskalySignAtFixtureProvider', () => {
  let provider: FiskalySignAtFixtureProvider;
  let server: FakeFiskalySignAtContractServer;

  beforeEach(() => {
    provider = new FiskalySignAtFixtureProvider();
    server = provider.contractServer;
    server.reset();
  });

  it('maps success-normal with a single PUT 200 and no GET', async () => {
    const body = fixtures.normalBody as Record<string, unknown>;
    const receiptId = fixtures.ids.normalReceiptId as string;
    const result = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId as string,
      receiptId,
      body,
    });
    expect(result.kind).toBe('http');
    if (result.kind === 'http') {
      expect(result.status).toBe(200);
      expect(result.body?.signed).toBe(true);
      expect(result.body?._env).toBe('TEST');
    }
    expect(server.calls).toEqual([{ method: 'PUT', receiptId }]);
  });

  it('maps rejection-schema as definite 400', async () => {
    server.configure({ putBehavior: 'reject400' });
    const result = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId as string,
      receiptId: '11111111-2222-4333-8444-555555555556',
      body: { receipt_type: 'NORMAL' },
    });
    expect(result).toMatchObject({
      kind: 'http',
      status: 400,
      body: { code: 'E_FAILED_SCHEMA_VALIDATION' },
    });
  });

  it('maps timeout-after-possible-acceptance with GET 200 on reconcile', async () => {
    server.configure({ putBehavior: 'timeout_maybe_stored' });
    const receiptId = fixtures.ids.normalReceiptId as string;
    const body = fixtures.normalBody as Record<string, unknown>;
    const put = await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId as string,
      receiptId,
      body,
    });
    expect(put.kind).toBe('transport');
    const get = await provider.retrieveReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId as string,
      receiptId,
    });
    expect(get.kind).toBe('http');
    if (get.kind === 'http') {
      expect(get.status).toBe(200);
      expect(get.body?.receipt_number).toBe('42');
      expect(get.body?.fon_validations).toEqual([]);
    }
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('replay-same-body does not sign twice for the same receipt id', async () => {
    const receiptId = fixtures.ids.normalReceiptId as string;
    const body = fixtures.normalBody as Record<string, unknown>;
    await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId as string,
      receiptId,
      body,
    });
    await provider.signReceipt({
      cashRegisterId: fixtures.ids.cashRegisterId as string,
      receiptId,
      body,
    });
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  });
});
