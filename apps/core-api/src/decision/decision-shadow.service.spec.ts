import { Test } from '@nestjs/testing';
import { DecisionShadowService } from './decision-shadow.service.js';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { DECISION_USE_CASES } from './decision.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';

describe('DecisionShadowService', () => {
  const createMock = jest.fn();
  const decide = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DECISION_SHADOW_ENABLED;
  });

  async function buildModule() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DecisionShadowService,
        {
          provide: PrismaService,
          useValue: { decisionShadowLog: { create: createMock } },
        },
        {
          provide: RequestContextService,
          useValue: {
            getTraceId: () => '00000000-0000-4000-8000-00000000bb01',
          },
        },
        {
          provide: DECISION_PROVIDER_TOKEN,
          useValue: { providerId: 'noop', decide },
        },
      ],
    }).compile();
    return moduleRef.get(DecisionShadowService);
  }

  it('does not call provider when shadow is disabled', async () => {
    const service = await buildModule();
    service.scheduleShadow({
      tenantId: 'tenant-1',
      traceId: '00000000-0000-4000-8000-00000000aa01',
      useCase: DECISION_USE_CASES.DOCUMENT_SORT,
      input: { text: 'Rechnung' },
      choices: ['Rechnung', 'Sonstiges'],
      actualOutcome: { choice: 'Rechnung' },
    });
    await flushMicrotasks();
    expect(decide).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('writes shadow rows asynchronously with match computed', async () => {
    process.env.DECISION_SHADOW_ENABLED = 'true';
    decide.mockResolvedValue({
      choice: 'Rechnung',
      raw_ref: 'ref-1',
      latency_ms: 12,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    });
    const service = await buildModule();
    service.scheduleShadow({
      tenantId: 'tenant-1',
      traceId: '00000000-0000-4000-8000-00000000aa01',
      useCase: DECISION_USE_CASES.DOCUMENT_SORT,
      input: { text: 'Rechnung' },
      choices: ['Rechnung', 'Sonstiges'],
      actualOutcome: { choice: 'Rechnung' },
    });
    await flushMicrotasks();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        match: true,
        provider: 'openrouter-jev',
      }),
    });
  });

  it('redacts identifying input and customer choices before provider and persistence', async () => {
    process.env.DECISION_SHADOW_ENABLED = 'true';
    decide.mockResolvedValue(null);
    const service = await buildModule();
    service.scheduleShadow({
      tenantId: 'tenant-1',
      traceId: '00000000-0000-4000-8000-00000000aa01',
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      input: {
        row: {
          first_name: 'Synthetic First',
          email: 'person@example.org',
          match_features: [{ kind: 'email', token: 'opaque-email-hash' }],
        },
        candidates: [{ id: 'customer-123', label: 'Synthetic Last' }],
      },
      choices: ['customer-123', '__create_new__'],
      actualOutcome: { choice: 'customer-123', source: 'import_dry_run' },
    });

    await flushMicrotasks();

    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          row: {
            first_name: '[REDACTED]',
            email: '[REDACTED]',
            match_features: [{ kind: 'email', token: 'opaque-email-hash' }],
          },
          candidates: [{ id: 'choice_1', label: '[REDACTED]' }],
        },
        choices: ['choice_1', 'choice_2'],
      }),
    );
    const persisted = createMock.mock.calls[0][0].data;
    expect(JSON.stringify(persisted)).not.toContain('Synthetic First');
    expect(JSON.stringify(persisted)).not.toContain('person@example.org');
    expect(JSON.stringify(persisted)).not.toContain('customer-123');
    expect(persisted.actual_outcome_json).toEqual({
      choice: 'choice_1',
      source: 'import_dry_run',
    });
  });

  it('limits concurrent provider calls while draining queued shadows', async () => {
    process.env.DECISION_SHADOW_ENABLED = 'true';
    let activeCalls = 0;
    let maxConcurrentCalls = 0;
    decide.mockImplementation(
      () =>
        new Promise((resolve) => {
          activeCalls += 1;
          maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
          setTimeout(() => {
            activeCalls -= 1;
            resolve(null);
          }, 5);
        }),
    );
    const service = await buildModule();

    for (let index = 0; index < 20; index += 1) {
      service.scheduleShadow({
        tenantId: 'tenant-1',
        traceId: `trace-${index}`,
        useCase: DECISION_USE_CASES.DOCUMENT_SORT,
        input: { signals: ['Rechnung'] },
        choices: ['Rechnung', 'Sonstiges'],
        actualOutcome: { choice: 'Rechnung' },
      });
    }
    for (
      let attempt = 0;
      attempt < 50 && createMock.mock.calls.length < 20;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(maxConcurrentCalls).toBe(4);
    expect(createMock).toHaveBeenCalledTimes(20);
  });
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
