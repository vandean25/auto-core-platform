import type { PrismaService } from '../prisma/prisma.service.js';

export const DUPLICATE_CHECK_TENANT_ID = 'tenant-1';
export const DUPLICATE_CHECK_CUSTOMER_ID =
  '00000000-0000-4000-8000-000000000040';

export function duplicateCheckCustomerRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: DUPLICATE_CHECK_CUSTOMER_ID,
    tenant_id: DUPLICATE_CHECK_TENANT_ID,
    first_name: 'Anna',
    last_name: 'Berger',
    company_name: null,
    email: 'anna@example.at',
    phone: '0664 123456',
    vat_id: 'AT U 12345678',
    address_zip: '1010',
    ...overrides,
  };
}

export function createDuplicateCheckPrisma(
  rows: Record<string, unknown>[],
): PrismaService {
  const findMany = jest.fn(async ({ where, select }) => {
    return rows
      .filter((row) => matchesDuplicateCheckWhere(row, where))
      .map((row) => {
        const picked: Record<string, unknown> = {};
        for (const key of Object.keys(select ?? {})) {
          if (key in row) {
            picked[key] = row[key];
          }
        }
        return picked;
      });
  });
  return { customer: { findMany } } as unknown as PrismaService;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function matchesDuplicateCheckWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  if (where.tenant_id && row.tenant_id !== where.tenant_id) {
    return false;
  }
  if (where.email && typeof where.email === 'object') {
    const equals = (where.email as { equals?: string }).equals?.toLowerCase();
    const email = asString(row.email).toLowerCase();
    if (equals && email !== equals) {
      return false;
    }
  }
  if (where.phone && typeof where.phone === 'object') {
    const phoneWhere = where.phone as Record<string, unknown>;
    if (phoneWhere.not === null && row.phone == null) {
      return false;
    }
    if (Array.isArray(where.OR)) {
      const phone = asString(row.phone);
      const matched = where.OR.some((clause) => {
        const contains = (clause as { phone?: { contains?: string } }).phone
          ?.contains;
        return (
          typeof contains === 'string' &&
          phone.toLowerCase().includes(contains.toLowerCase())
        );
      });
      if (!matched) {
        return false;
      }
    }
  }
  if (where.vat_id && typeof where.vat_id === 'object') {
    const vatWhere = where.vat_id as Record<string, unknown>;
    if (vatWhere.not === null && row.vat_id == null) {
      return false;
    }
    if (Array.isArray(where.OR)) {
      const vatId = asString(row.vat_id);
      const matched = where.OR.some((clause) => {
        const contains = (clause as { vat_id?: { contains?: string } }).vat_id
          ?.contains;
        return (
          typeof contains === 'string' &&
          vatId.toLowerCase().includes(contains.toLowerCase())
        );
      });
      if (!matched) {
        return false;
      }
    }
  }
  if (where.address_zip && typeof where.address_zip === 'object') {
    const variants = (where.address_zip as { in?: string[] }).in ?? [];
    const zip = asString(row.address_zip).toLowerCase();
    if (!variants.some((variant) => zip === variant.toLowerCase())) {
      return false;
    }
  }
  if (where.AND && Array.isArray(where.AND)) {
    for (const clause of where.AND) {
      const first = (clause as { first_name?: { in?: string[] } }).first_name
        ?.in;
      if (first) {
        const value = asString(row.first_name).toLowerCase();
        if (!first.some((variant) => value === variant.toLowerCase())) {
          return false;
        }
      }
      const last = (clause as { last_name?: { in?: string[] } }).last_name?.in;
      if (last) {
        const value = asString(row.last_name).toLowerCase();
        if (!last.some((variant) => value === variant.toLowerCase())) {
          return false;
        }
      }
    }
  }
  return true;
}
