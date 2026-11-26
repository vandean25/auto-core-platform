import { ConflictException } from '@nestjs/common';
import { RksvMode } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SETTLEMENT_ERROR_CODES } from '../settlement/settlement.constants.js';
import { LegalEntityService } from './legal-entity.service.js';

describe('LegalEntityService document-branding retention', () => {
  it('blocks hard deletion while a branding profile retains the entity', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'entity-1',
      documentBrandProfile: { id: 'profile-1' },
      _count: { sites: 0, documentBrandAssets: 0 },
    });
    const deleteEntity = jest.fn();
    const prisma = {
      legalEntity: { findFirst, delete: deleteEntity },
    } as unknown as PrismaService;
    const tenantContext = {
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    } as unknown as TenantContextService;
    const service = new LegalEntityService(prisma, tenantContext);

    await expect(service.deleteLegalEntity('entity-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleteEntity).not.toHaveBeenCalled();
  });
});

describe('LegalEntityService rksvMode guard (AUT-1071)', () => {
  const existingEntity = {
    id: 'entity-1',
    tenant_id: 'tenant-1',
    name: 'Test GmbH',
    country_iso: 'AT',
    is_active: true,
    rksv_mode: RksvMode.OFF,
    address_street: null,
    address_line2: null,
    address_zip: null,
    address_city: null,
    tax_number: null,
    vat_id: null,
    iban: null,
    bic: null,
    bank_name: null,
    email: null,
    phone: null,
    registration_number: null,
    registration_court: null,
    representatives: null,
    payment_terms_days: null,
    payment_terms_text: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  function createService(updatedMode: RksvMode = RksvMode.OFF) {
    const update = jest.fn().mockResolvedValue({
      ...existingEntity,
      rksv_mode: updatedMode,
    });
    const prisma = {
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue(existingEntity),
      },
      $transaction: jest.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ legalEntity: { update } }),
      ),
    } as unknown as PrismaService;
    const tenantContext = {
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    } as unknown as TenantContextService;
    return { service: new LegalEntityService(prisma, tenantContext), update };
  }

  it('rejects REQUIRED_ACP_RKSV with 422 ACP_RKSV_UNAVAILABLE when live signing is not configured', async () => {
    const { service, update } = createService();

    await expect(
      service.updateLegalEntity('entity-1', {
        rksvMode: RksvMode.REQUIRED_ACP_RKSV,
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        code: SETTLEMENT_ERROR_CODES.ACP_RKSV_UNAVAILABLE,
      }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    RksvMode.OFF,
    RksvMode.UNKNOWN,
    RksvMode.REQUIRED_EXTERNAL_KASSE,
  ])('allows setting rksvMode to %s', async (mode) => {
    const { service, update } = createService(mode);

    const result = await service.updateLegalEntity('entity-1', {
      rksvMode: mode,
    });

    expect(result.rksv_mode).toBe(mode);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rksv_mode: mode }),
      }),
    );
  });

  it('allows updating other seller fields when stored rksv_mode is already REQUIRED_ACP_RKSV', async () => {
    const alreadyAcpEntity = {
      ...existingEntity,
      rksv_mode: RksvMode.REQUIRED_ACP_RKSV,
    };
    const update = jest.fn().mockResolvedValue({
      ...alreadyAcpEntity,
      address_street: 'Neuer Weg 2',
    });
    const prisma = {
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue(alreadyAcpEntity),
      },
      $transaction: jest.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ legalEntity: { update } }),
      ),
    } as unknown as PrismaService;
    const tenantContext = {
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    } as unknown as TenantContextService;
    const service = new LegalEntityService(prisma, tenantContext);

    const result = await service.updateLegalEntity('entity-1', {
      rksvMode: RksvMode.REQUIRED_ACP_RKSV,
      addressStreet: 'Neuer Weg 2',
    });

    expect(result.rksv_mode).toBe(RksvMode.REQUIRED_ACP_RKSV);
    expect(result.address_street).toBe('Neuer Weg 2');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address_street: 'Neuer Weg 2',
          rksv_mode: RksvMode.REQUIRED_ACP_RKSV,
        }),
      }),
    );
  });
});

