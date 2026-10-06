import type { Customer } from '@prisma/client';
import { DecisionUseCaseHooksService } from './decision-use-case-hooks.service.js';
import { DecisionShadowService } from './decision-shadow.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('DecisionUseCaseHooksService', () => {
  const scheduleShadow = jest.fn();
  const isShadowEnabled = jest.fn();
  const findMany = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildService() {
    const shadow = {
      scheduleShadow,
      isShadowEnabled,
      resolveTraceId: () => 'trace-1',
    } as unknown as DecisionShadowService;
    const prisma = {
      customer: { findMany },
    } as unknown as PrismaService;
    return new DecisionUseCaseHooksService(shadow, prisma);
  }

  it('does not load customers when shadow mode is disabled', async () => {
    isShadowEnabled.mockReturnValue(false);
    const service = buildService();

    await service.scheduleCustomerImportDryRunShadows('tenant-1', undefined, [
      ambiguousCustomerRow(1),
    ]);

    expect(findMany).not.toHaveBeenCalled();
    expect(scheduleShadow).not.toHaveBeenCalled();
  });

  it('loads customers only when an ambiguous normalized row exists', async () => {
    isShadowEnabled.mockReturnValue(true);
    findMany.mockResolvedValue([]);
    const service = buildService();

    await service.scheduleCustomerImportDryRunShadows('tenant-1', undefined, [
      {
        ...ambiguousCustomerRow(1),
        warnings: [],
      },
    ]);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('limits one import to fifty ambiguous rows', async () => {
    isShadowEnabled.mockReturnValue(true);
    findMany.mockResolvedValue([matchingCustomer()] as Customer[]);
    const service = buildService();

    await service.scheduleCustomerImportDryRunShadows(
      'tenant-1',
      undefined,
      Array.from({ length: 60 }, (_, index) => ambiguousCustomerRow(index + 1)),
    );

    expect(scheduleShadow).toHaveBeenCalledTimes(50);
  });

  it('schedules customer matching with opaque identities and choices', async () => {
    isShadowEnabled.mockReturnValue(true);
    findMany.mockResolvedValue([matchingCustomer()] as Customer[]);
    const service = buildService();

    await service.scheduleCustomerImportDryRunShadows('tenant-1', undefined, [
      ambiguousCustomerRow(1),
    ]);

    const scheduled = scheduleShadow.mock.calls[0][0];
    const serialized = JSON.stringify(scheduled);
    expect(serialized).not.toContain('Ada');
    expect(serialized).not.toContain('Lovelace');
    expect(serialized).not.toContain('ada@example.org');
    expect(serialized).not.toContain('external-1');
    expect(scheduled.choices).toEqual(['choice_1', 'create_new']);
    expect(scheduled.actualOutcome.choice).toBe('choice_1');
  });

  it('includes prior same-file creates when no stored customer matches', async () => {
    isShadowEnabled.mockReturnValue(true);
    findMany.mockResolvedValue([]);
    const service = buildService();
    const priorRow = {
      ...ambiguousCustomerRow(1),
      action: 'CREATE',
      entity_id: null,
      warnings: [],
    };
    const duplicateRow = {
      ...ambiguousCustomerRow(2),
      action: 'CREATE',
      entity_id: null,
    };

    await service.scheduleCustomerImportDryRunShadows('tenant-1', undefined, [
      priorRow,
      duplicateRow,
    ]);

    expect(scheduleShadow).toHaveBeenCalledTimes(1);
    expect(scheduleShadow.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        choices: ['choice_1', 'create_new'],
        actualOutcome: expect.objectContaining({ choice: 'create_new' }),
        input: expect.objectContaining({
          candidates: [
            expect.objectContaining({
              choice: 'choice_1',
              match_features: expect.any(Array),
            }),
          ],
        }),
      }),
    );
  });

  it('sends document sort signals instead of extracted text', () => {
    const service = buildService();

    service.scheduleDocumentSortForText({
      tenantId: 'tenant-1',
      text: 'Rechnung an Synthetic Customer, email: person@example.org',
    });

    const scheduled = scheduleShadow.mock.calls[0][0];
    expect(scheduled.input).toEqual({ signals: ['Rechnung'] });
    expect(JSON.stringify(scheduled)).not.toContain('Synthetic Customer');
    expect(JSON.stringify(scheduled)).not.toContain('person@example.org');
    expect(scheduled.actualOutcome).toEqual({
      choice: 'Rechnung',
      source: 'heuristic_classifier',
    });
  });
});

function ambiguousCustomerRow(rowNo: number) {
  return {
    row_no: rowNo,
    external_id: `external-${rowNo}`,
    action: 'UPDATE',
    entity_id: 'customer-1',
    errors: [],
    warnings: [{ code: 'IMPORT_POSSIBLE_DUPLICATE', message: 'Duplicate' }],
    normalized: {
      external_id: `external-${rowNo}`,
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.org',
      phone: null,
      vat_id: null,
      address_street: null,
      address_zip: null,
      address_city: null,
      address_country: 'AT',
    },
  } as const;
}

function matchingCustomer(): Customer {
  return {
    id: 'customer-1',
    tenant_id: 'tenant-1',
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Ada',
    last_name: 'Lovelace',
  } as Customer;
}
