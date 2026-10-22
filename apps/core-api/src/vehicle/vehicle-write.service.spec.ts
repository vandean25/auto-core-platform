import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { VEHICLE_IDENTITY_RESET } from './vehicle-identity.util.js';
import type { VehiclePersistenceService } from './vehicle-persistence.service.js';
import { VehicleWriteService } from './vehicle-write.service.js';

describe('VehicleWriteService', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  let persistence: {
    findIdentityForUpdate: jest.Mock;
    customerExists: jest.Mock;
    updateIfIdentityUnchanged: jest.Mock;
    updateIfIdentityUnchangedWithMainContact: jest.Mock;
    vehicleExists: jest.Mock;
    findVehicleWithCustomer: jest.Mock;
  };
  let service: VehicleWriteService;

  beforeEach(() => {
    persistence = {
      findIdentityForUpdate: jest.fn(),
      customerExists: jest.fn(),
      updateIfIdentityUnchanged: jest.fn(),
      updateIfIdentityUnchangedWithMainContact: jest.fn(),
      vehicleExists: jest.fn(),
      findVehicleWithCustomer: jest.fn(),
    };
    service = new VehicleWriteService(
      persistence as unknown as VehiclePersistenceService,
    );
  });

  describe('loadExistingIdentity', () => {
    it('returns the identity snapshot of a tenant vehicle', async () => {
      const identity = { id: vehicleId, vin: 'VIN-1', plate: 'PLATE-1' };
      persistence.findIdentityForUpdate.mockResolvedValue(identity);

      await expect(service.loadExistingIdentity(vehicleId, tenantId)).resolves.toBe(
        identity,
      );
      expect(persistence.findIdentityForUpdate).toHaveBeenCalledWith(
        vehicleId,
        tenantId,
      );
    });

    it('throws not-found when the vehicle is missing from the tenant', async () => {
      persistence.findIdentityForUpdate.mockResolvedValue(null);

      await expect(
        service.loadExistingIdentity('missing', tenantId),
      ).rejects.toThrow(new NotFoundException('Vehicle with ID missing not found'));
    });
  });

  describe('prepareCreate', () => {
    it('skips the customer lookup when no customer is referenced', async () => {
      await service.prepareCreate(
        { make: 'Ford', model: 'Focus', year: 2021 },
        tenantId,
      );

      expect(persistence.customerExists).not.toHaveBeenCalled();
    });

    it('rejects a referenced customer that does not exist in the tenant', async () => {
      persistence.customerExists.mockResolvedValue(false);

      await expect(
        service.prepareCreate(
          { make: 'Ford', model: 'Focus', year: 2021, customer_id: 'cust-9' },
          tenantId,
        ),
      ).rejects.toThrow(new NotFoundException('Customer with ID cust-9 not found'));
      expect(persistence.customerExists).toHaveBeenCalledWith('cust-9', tenantId);
    });

    it('normalizes regulatory fields before building the create payload', async () => {
      const payload = await service.prepareCreate(
        {
          make: 'Ford',
          model: 'Focus',
          year: 2021,
          vin: ' vin-1 ',
          nova_class: ' standard ',
        },
        tenantId,
      );

      expect(payload).toMatchObject({
        vin: 'VIN-1',
        nova_class: 'STANDARD',
        tenant_id: tenantId,
      });
    });

    it('rejects invalid regulatory fields before any write', async () => {
      await expect(
        service.prepareCreate(
          { make: 'Ford', model: 'Focus', year: 2021, nova_class: 'XYZ' },
          tenantId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('prepareUpdate', () => {
    const existingVehicle = { id: vehicleId, vin: 'VIN-1', plate: 'PLATE-1' };

    it('checks a referenced customer before building the update payload', async () => {
      persistence.customerExists.mockResolvedValue(true);

      await expect(
        service.prepareUpdate(existingVehicle, { customer_id: 'cust-1' }, tenantId),
      ).resolves.toEqual({ customer_id: 'cust-1' });
      expect(persistence.customerExists).toHaveBeenCalledWith('cust-1', tenantId);
    });

    it('clears identity-derived fields when the plate changes', async () => {
      await expect(
        service.prepareUpdate(existingVehicle, { plate: 'PLATE-2' }, tenantId),
      ).resolves.toEqual({
        plate: 'PLATE-2',
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_token: null,
      });
    });
  });

  describe('applyUpdate', () => {
    const existingVehicle = { id: vehicleId, vin: 'VIN-1', plate: 'PLATE-1' };
    const data = { plate: 'PLATE-2' };

    it('returns the refetched vehicle after a guarded update', async () => {
      const refetched = { id: vehicleId, customer: null };
      persistence.updateIfIdentityUnchanged.mockResolvedValue(1);
      persistence.findVehicleWithCustomer.mockResolvedValue(refetched);

      await expect(
        service.applyUpdate(vehicleId, tenantId, existingVehicle, data),
      ).resolves.toBe(refetched);
      expect(persistence.updateIfIdentityUnchanged).toHaveBeenCalledWith(
        vehicleId,
        tenantId,
        existingVehicle,
        data,
      );
    });

    it.each([['cust-2'], [null]])(
      'hands the OWNER party over in the same transaction when customer_id is %s',
      async (customerId) => {
        const refetched = { id: vehicleId, customer: null };
        persistence.updateIfIdentityUnchangedWithMainContact.mockResolvedValue(
          1,
        );
        persistence.findVehicleWithCustomer.mockResolvedValue(refetched);

        await expect(
          service.applyUpdate(vehicleId, tenantId, existingVehicle, {
            customer_id: customerId,
          }),
        ).resolves.toBe(refetched);
        expect(persistence.updateIfIdentityUnchanged).not.toHaveBeenCalled();
        expect(
          persistence.updateIfIdentityUnchangedWithMainContact,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            id: vehicleId,
            tenantId,
            customerId,
            data: { customer_id: customerId },
          }),
        );
      },
    );

    it('reports a conflict when the guard missed but the vehicle still exists', async () => {
      persistence.updateIfIdentityUnchanged.mockResolvedValue(0);
      persistence.vehicleExists.mockResolvedValue(true);

      await expect(
        service.applyUpdate(vehicleId, tenantId, existingVehicle, data),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(persistence.findVehicleWithCustomer).not.toHaveBeenCalled();
    });

    it('reports not-found when the guard missed and the vehicle is gone', async () => {
      persistence.updateIfIdentityUnchanged.mockResolvedValue(0);
      persistence.vehicleExists.mockResolvedValue(false);

      await expect(
        service.applyUpdate(vehicleId, tenantId, existingVehicle, data),
      ).rejects.toThrow(new NotFoundException('Vehicle not found'));
    });

    it('reports not-found when the refetch finds nothing', async () => {
      persistence.updateIfIdentityUnchanged.mockResolvedValue(1);
      persistence.findVehicleWithCustomer.mockResolvedValue(null);

      await expect(
        service.applyUpdate(vehicleId, tenantId, existingVehicle, data),
      ).rejects.toThrow(new NotFoundException('Vehicle not found'));
    });
  });
});
