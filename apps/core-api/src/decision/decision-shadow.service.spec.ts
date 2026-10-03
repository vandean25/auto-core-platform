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
          useValue: { getTraceId: () => '00000000-0000-4000-8000-00000000bb01' },
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
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
