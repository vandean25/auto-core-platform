import { ConflictException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
