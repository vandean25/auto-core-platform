import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';

type FakeSpan = {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
  setAttribute: jest.Mock;
  setAttributes: jest.Mock;
};

const mockStartSpan = jest.fn();
const mockGetClient = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: mockStartSpan,
  getClient: mockGetClient,
  getActiveSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const {
  ACTOR_AUTH_UID,
  ACTOR_EMAIL,
  JOB_ID,
  arrangeApply,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} = await import('./import.service.spec.support.js');

const CUSTOMER_CSV = 'Kunden-Nr;Vorname;Nachname\nK-1;Anna;Berger\n';
const CUSTOMER_MAPPING = {
  external_id: 'Kunden-Nr',
  first_name: 'Vorname',
  last_name: 'Nachname',
};

function recordSpans(): FakeSpan[] {
  const spans: FakeSpan[] = [];
  mockStartSpan.mockImplementation((options, callback) => {
    const opts = options as {
      name: string;
      op: string;
      attributes?: Record<string, unknown>;
    };
    const span: FakeSpan = {
      name: opts.name,
      op: opts.op,
      attributes: { ...opts.attributes },
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
    };
    spans.push(span);
    return (callback as (s: FakeSpan) => unknown)(span);
  });
  return spans;
}

describe('ImportService stage spans', () => {
  const h = setupImportHarness();
  let spans: FakeSpan[];

  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockReturnValue({});
    spans = recordSpans();
  });

  it('records parse and validate spans with entity type and row counts, and no cell values', async () => {
    await h.service.createDryRunFromUpload(
      dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
        mappingJson: CUSTOMER_MAPPING,
      }),
    );

    expect(spans.map((span) => span.op)).toEqual([
      'import.parse',
      'import.validate',
    ]);
    expect(spans[0].attributes).toEqual({ entity_type: 'CUSTOMER' });
    expect(spans[0].setAttribute).toHaveBeenCalledWith('row_count', 1);
    expect(spans[1].attributes).toEqual({ entity_type: 'CUSTOMER' });
    expect(spans[1].setAttributes).toHaveBeenCalledWith({
      row_count: 1,
      error_row_count: 0,
    });

    const recorded = JSON.stringify(
      spans.map((span) => [
        span.attributes,
        span.setAttribute.mock.calls,
        span.setAttributes.mock.calls,
      ]),
    );
    expect(recorded).not.toContain('Anna');
    expect(recorded).not.toContain('Berger');
    expect(recorded).not.toContain('K-1');
  });

  it('records a commit span with entity type and the rows the apply stage walks', async () => {
    arrangeApply(
      h,
      importJobRecord({
        entity_type: ImportEntityType.CUSTOMER,
        options_json: {},
      }),
      [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.SKIP,
          external_id: 'K-2',
        }),
        jobRowRecord({
          row_no: 2,
          action: ImportRowAction.ERROR,
          external_id: 'K-3',
        }),
      ],
    );

    await h.service.applyJob(JOB_ID);

    expect(spans.map((span) => span.op)).toContain('import.commit');
    expect(spans.map((span) => span.op)).toContain('import.apply.batch');
    expect(spans[0].attributes).toEqual({
      entity_type: 'CUSTOMER',
      row_count: 2,
    });
  });

  it('propagates a rejected upload unchanged and records only the parse span', async () => {
    await expect(
      h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, 'Kunden-Nr;Vorname\n'),
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: IMPORT_ERROR_CODES.EMPTY_FILE },
    });

    expect(spans.map((span) => span.op)).toEqual([]);
    expect(h.prisma.importJob.create).not.toHaveBeenCalled();
  });

  it('opens no span for a caller the tenant guard rejects', async () => {
    h.tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: ACTOR_AUTH_UID,
      role: 'TECH',
      email: ACTOR_EMAIL,
    });

    await expect(
      h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV),
      ),
    ).rejects.toThrow('Tenant admin access is required.');

    expect(spans).toHaveLength(0);
  });
});
