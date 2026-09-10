import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Convert a Prisma Decimal (or plain number/null/undefined) to a JS number,
 * preserving 0 as a valid value. Returns null when the input is null or undefined.
 *
 * Shared between LaborCategoryService and LaborService to eliminate duplication.
 */
export function toDecimalNumber(
  value: Prisma.Decimal | number | null | undefined,
): number | null {
  return value !== null && value !== undefined ? Number(value) : null;
}

/**
 * If `error` is a Prisma P2002 unique-constraint violation, throw a
 * ConflictException with the supplied message.  Otherwise re-throw `error`
 * unchanged.
 *
 * Usage inside a catch block:
 *   catch (error) { rethrowAsConflict(error, `Foo "bar" already exists`); }
 *
 * The return type is `never` so callers know this function always throws.
 */
export function rethrowAsConflict(error: unknown, message: string): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException(message);
  }
  throw error;
}
