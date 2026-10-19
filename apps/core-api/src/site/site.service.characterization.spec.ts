import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  compileSiteServiceModule,
  createSiteServiceTestHarness,
  TENANT_ID,
} from './site.service.spec.support.js';
import { SiteService } from './site.service.js';

describe('SiteService characterization', () => {
  let service: SiteService;
  let harness: ReturnType<typeof createSiteServiceTestHarness>;

  beforeEach(async () => {
    harness = createSiteServiceTestHarness();
    ({ service } = await compileSiteServiceModule(harness));
  });

  describe('listMySites (ruling 47)', () => {
    it('returns activatable sites for an active tenant member', async () => {
      harness.prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        firebaseUid: 'fb-admin',
        active_site_id: null,
      });
      harness.prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      harness.prisma.siteMembership.findMany.mockResolvedValue([
        {
          site: {
            id: 'site-1',
            code: 'MAIN',
            name: 'Wien',
            legal_entity_id: 'le-1',
            legal_entity: { name: 'AT GmbH' },
          },
        },
      ]);

      const result = await service.listMySites();

      expect(result).toEqual([
        {
          id: 'site-1',
          code: 'MAIN',
          name: 'Wien',
          legalEntityId: 'le-1',
          legalEntityName: 'AT GmbH',
        },
      ]);
      expect(harness.prisma.siteMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: TENANT_ID,
            user_id: 'u-1',
            is_active: true,
            site: { is_active: true },
            tenantMember: { is_active: true },
          }),
        }),
      );
    });

    it('forbids when the caller has no active tenant membership', async () => {
      harness.prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        firebaseUid: 'fb-admin',
        active_site_id: null,
      });
      harness.prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(service.listMySites()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(harness.prisma.siteMembership.findMany).not.toHaveBeenCalled();
    });
  });

  describe('setActiveSite (ruling 9)', () => {
    function wireActiveUser() {
      harness.prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        firebaseUid: 'fb-admin',
        active_site_id: 'site-old',
      });
      harness.prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
    }

    it('clears active_site_id and emits a null site context', async () => {
      wireActiveUser();
      harness.prisma.user.update.mockResolvedValue({ id: 'u-1' });

      const result = await service.setActiveSite({ siteId: null });

      expect(result).toEqual({ activeSiteId: null });
      expect(harness.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { active_site_id: null },
      });
      expect(harness.dashboardRealtime.emitSiteContextUpdated).toHaveBeenCalledWith(
        'fb-admin',
        null,
      );
    });

    it('switches active site after validating membership inside a transaction', async () => {
      wireActiveUser();
      harness.prisma.site.findFirst.mockResolvedValue({ id: 'site-2' });
      harness.prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      harness.prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });
      harness.prisma.user.update.mockResolvedValue({ id: 'u-1' });

      const result = await service.setActiveSite({ siteId: 'site-2' });

      expect(result).toEqual({ activeSiteId: 'site-2' });
      expect(harness.prisma.$transaction).toHaveBeenCalled();
      expect(harness.dashboardRealtime.emitSiteContextUpdated).toHaveBeenCalledWith(
        'fb-admin',
        'site-2',
      );
    });

    it('rejects an inactive or foreign site with 422', async () => {
      wireActiveUser();
      harness.prisma.site.findFirst.mockResolvedValue(null);

      await expect(
        service.setActiveSite({ siteId: 'site-missing' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(harness.dashboardRealtime.emitSiteContextUpdated).not.toHaveBeenCalled();
    });

    it('forbids when the caller has no active tenant membership', async () => {
      harness.prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        firebaseUid: 'fb-admin',
        active_site_id: null,
      });
      harness.prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(
        service.setActiveSite({ siteId: 'site-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateSite fiscal register binding', () => {
    it('upserts a fiscal register when all provider fields are present', async () => {
      harness.prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: true,
        name: 'Wien',
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: null,
      });
      harness.prisma.site.update.mockResolvedValue({ id: 'site-1', name: 'Wien' });
      harness.prisma.fiscalRegister.upsert.mockResolvedValue({ id: 'fr-1' });

      await service.updateSite('site-1', {
        fiscalRegister: {
          env: 'TEST',
          providerCashRegisterId: 'cr-1',
          providerScuId: 'scu-1',
          providerState: 'REGISTERED',
          credentialsSecretRef: 'secret/ref',
        },
      });

      expect(harness.prisma.fiscalRegister.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id_site_id: { tenant_id: TENANT_ID, site_id: 'site-1' },
          },
          create: expect.objectContaining({
            tenant_id: TENANT_ID,
            legal_entity_id: 'le-1',
            site_id: 'site-1',
            provider: 'FISKALY_SIGN_AT_1_2_6',
            env: 'TEST',
            provider_cash_register_id: 'cr-1',
            provider_scu_id: 'scu-1',
            provider_state: 'REGISTERED',
            credentials_secret_ref: 'secret/ref',
          }),
        }),
      );
    });

    it('skips fiscal register upsert when provider fields are incomplete', async () => {
      harness.prisma.site.findFirst.mockResolvedValue({
        id: 'site-1',
        tenant_id: TENANT_ID,
        legal_entity_id: 'le-1',
        is_active: true,
        name: 'Wien',
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: null,
      });
      harness.prisma.site.update.mockResolvedValue({ id: 'site-1' });

      await service.updateSite('site-1', {
        fiscalRegister: {
          env: 'TEST',
          providerCashRegisterId: 'cr-1',
        },
      });

      expect(harness.prisma.fiscalRegister.upsert).not.toHaveBeenCalled();
    });
  });

  describe('guardSiteDeactivation', () => {
    it('rejects when open stock transfers exist', async () => {
      harness.prisma.inventoryStock.count.mockResolvedValue(0);
      harness.prisma.vehicle.count.mockResolvedValue(0);
      harness.prisma.stockTransfer.count.mockResolvedValue(2);

      await expect(
        service.guardSiteDeactivation(TENANT_ID, 'site-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when on-hand or reserved stock exists', async () => {
      harness.prisma.inventoryStock.count.mockResolvedValue(3);
      harness.prisma.vehicle.count.mockResolvedValue(0);
      harness.prisma.stockTransfer.count.mockResolvedValue(0);

      await expect(
        service.guardSiteDeactivation(TENANT_ID, 'site-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when parked dealer vehicles exist', async () => {
      harness.prisma.inventoryStock.count.mockResolvedValue(0);
      harness.prisma.vehicle.count.mockResolvedValue(1);
      harness.prisma.stockTransfer.count.mockResolvedValue(0);

      await expect(
        service.guardSiteDeactivation(TENANT_ID, 'site-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes when no blocking inventory or transfers exist', async () => {
      harness.prisma.inventoryStock.count.mockResolvedValue(0);
      harness.prisma.vehicle.count.mockResolvedValue(0);
      harness.prisma.stockTransfer.count.mockResolvedValue(0);

      await expect(
        service.guardSiteDeactivation(TENANT_ID, 'site-1'),
      ).resolves.toBeUndefined();
    });
  });
});
