import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function mapEstimateWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException({
      code: 'ESTIMATE_CONFLICT',
      message:
        'The estimate changed while it was being saved. Reload it and try again.',
    });
  }
  throw error;
}
