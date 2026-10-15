import type { FiskalySignAtProviderResult } from './fiskaly-sign-at.types.js';

export type FakePutBehavior =
  | 'success'
  | 'reject400'
  | 'timeout'
  | 'timeout_maybe_stored';

type StoredReceipt = {
  body: Record<string, unknown>;
  response: Record<string, unknown>;
  requestId: string;
};

/**
 * In-memory fiskaly SIGN AT contract for tests and local fake E2E.
 * Responses use `_env: TEST` only — never treated as a productive LIVE signature.
 */
export class FakeFiskalySignAtContractServer {
  private readonly store = new Map<string, StoredReceipt>();
  private putBehavior: FakePutBehavior = 'success';
  private rejectBody: Record<string, unknown> = {
    status_code: 400,
    error: 'Bad Request',
    code: 'E_FAILED_SCHEMA_VALIDATION',
    message: 'Synthetic schema failure',
  };
  private successBodyTemplate: Record<string, unknown> | null = null;
  readonly calls: Array<{ method: 'PUT' | 'GET'; receiptId: string }> = [];

  reset(): void {
    this.store.clear();
    this.calls.length = 0;
    this.putBehavior = 'success';
    this.rejectBody = {
      status_code: 400,
      error: 'Bad Request',
      code: 'E_FAILED_SCHEMA_VALIDATION',
      message: 'Synthetic schema failure',
    };
    this.successBodyTemplate = null;
  }

  configure(options: {
    putBehavior?: FakePutBehavior;
    rejectBody?: Record<string, unknown>;
    successBodyTemplate?: Record<string, unknown>;
  }): void {
    if (options.putBehavior) this.putBehavior = options.putBehavior;
    if (options.rejectBody) this.rejectBody = options.rejectBody;
    if (options.successBodyTemplate) {
      this.successBodyTemplate = options.successBodyTemplate;
    }
  }

  seedReceipt(receiptId: string, body: Record<string, unknown>, response: Record<string, unknown>): void {
    this.store.set(receiptId, {
      body,
      response,
      requestId: 'synthetic-seeded',
    });
  }

  async signReceipt(
    receiptId: string,
    body: Record<string, unknown>,
  ): Promise<FiskalySignAtProviderResult> {
    this.calls.push({ method: 'PUT', receiptId });

    if (this.putBehavior === 'reject400') {
      return {
        kind: 'http',
        status: 400,
        body: this.rejectBody,
        requestId: 'synthetic-request-reject',
      };
    }

    const existing = this.store.get(receiptId);
    if (existing && JSON.stringify(existing.body) === JSON.stringify(body)) {
      return {
        kind: 'http',
        status: 200,
        body: existing.response,
        requestId: existing.requestId,
      };
    }

    const response = this.buildSuccessBody(receiptId, body);

    if (this.putBehavior === 'timeout') {
      return { kind: 'transport', transport: 'timeout' };
    }

    if (this.putBehavior === 'timeout_maybe_stored') {
      this.store.set(receiptId, {
        body,
        response,
        requestId: 'synthetic-request-timeout',
      });
      return { kind: 'transport', transport: 'timeout' };
    }

    this.store.set(receiptId, {
      body,
      response,
      requestId: 'synthetic-request-success',
    });
    return {
      kind: 'http',
      status: 200,
      body: response,
      requestId: 'synthetic-request-success',
    };
  }

  async retrieveReceipt(receiptId: string): Promise<FiskalySignAtProviderResult> {
    this.calls.push({ method: 'GET', receiptId });
    const stored = this.store.get(receiptId);
    if (!stored) {
      return {
        kind: 'http',
        status: 404,
        body: {
          status_code: 404,
          error: 'Not Found',
          code: 'E_RECEIPT_NOT_FOUND',
          message: 'Synthetic illustration. No receipt was stored for this receipt id.',
        },
      };
    }
    const body = { ...stored.response, fon_validations: [] as unknown[] };
    return {
      kind: 'http',
      status: 200,
      body,
      requestId: stored.requestId,
    };
  }

  private buildSuccessBody(
    receiptId: string,
    requestBody: Record<string, unknown>,
  ): Record<string, unknown> {
    if (this.successBodyTemplate) {
      return { ...this.successBodyTemplate, _id: receiptId };
    }
    const receiptType = requestBody.receipt_type ?? 'NORMAL';
    const standard =
      (requestBody.schema as { standard_v1?: Record<string, unknown> })
        ?.standard_v1 ?? {};
    const gross =
      (standard.amounts_per_vat_rate as Array<{ amount: string }>)?.[0]
        ?.amount ?? '0.00';
    return {
      _id: receiptId,
      _type: 'RECEIPT',
      _env: 'TEST',
      _version: '1.2.6',
      receipt_type: receiptType,
      receipt_number: '42',
      time_signature: 1577833200,
      cash_register_serial_number: '1',
      qr_code_data:
        '_R1-AT3_dGxx_19_2017-10-24T11:07:32_0,00_0,00_0,00_0,00_0,00_7eti9M9dETz2_5474185F_M8LJDeWizNY=_4CtUHTuHoWvNfY0Ty+K8SuUVPYfZHjkM70/ZzATkb7Oj6G8PNWR6K1vsFWTXg2YsMyYHxVXpGJYEiAn0Uojfzw==',
      signed: true,
      schema: {
        standard_v1: standard,
        raw: {
          gross_amount_standard: gross.replace('-', ''),
          gross_amount_reduced_1: '0.00',
          gross_amount_reduced_2: '0.00',
          gross_amount_special: '0.00',
          gross_amount_zero: '0.00',
        },
      },
      metadata: requestBody.metadata ?? {},
      cash_register_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      signature_creation_unit_id: '00000000-0000-4000-8000-0000000000bb',
    };
  }
}
