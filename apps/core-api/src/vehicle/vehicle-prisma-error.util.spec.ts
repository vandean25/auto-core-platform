import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rethrowVehiclePrismaError } from './vehicle-prisma-error.util.js';

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}

describe('rethrowVehiclePrismaError', () => {
  it('maps P2025 to a vehicle not-found error', () => {
    expect(() => rethrowVehiclePrismaError(prismaError('P2025'))).toThrow(
      new NotFoundException('Vehicle not found'),
    );
  });

  it('names the conflicting fields for P2002 with a field target', () => {
    expect(() =>
      rethrowVehiclePrismaError(prismaError('P2002', { target: ['vin', 'plate'] })),
    ).toThrow(
      new ConflictException('Unique constraint failed on fields: vin, plate'),
    );
  });

  it('falls back to a generic conflict message for P2002 without a field list', () => {
    expect(() =>
      rethrowVehiclePrismaError(prismaError('P2002', { target: 'vehicles_vin_key' })),
    ).toThrow(new ConflictException('Unique constraint violation'));
  });

  it('rethrows other Prisma errors unchanged', () => {
    const error = prismaError('P2003');

    expect(() => rethrowVehiclePrismaError(error)).toThrow(error);
    try {
      rethrowVehiclePrismaError(error);
    } catch (thrown) {
      expect(thrown).toBe(error);
    }
  });

  it('rethrows non-Prisma errors unchanged', () => {
    const error = new ConflictException('Vehicle VIN or plate changed while updating; please retry');

    try {
      rethrowVehiclePrismaError(error);
    } catch (thrown) {
      expect(thrown).toBe(error);
    }
  });
});
