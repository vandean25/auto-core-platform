import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function rethrowVehiclePrismaError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    throw new NotFoundException('Vehicle not found');
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.join(', ') : undefined;
    throw new ConflictException(
      fields
        ? `Unique constraint failed on fields: ${fields}`
        : 'Unique constraint violation',
    );
  }

  throw error;
}
