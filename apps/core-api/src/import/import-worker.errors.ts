import { Prisma } from '@prisma/client';

export class ImportWorkerLeaseLostError extends Error {
  readonly name = 'ImportWorkerLeaseLostError';
}

export function isImportWorkerContentionError(error: unknown): boolean {
  if (error instanceof ImportWorkerLeaseLostError) {
    return true;
  }
  return isPrismaSerializationFailure(error);
}

export function isPrismaSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}
