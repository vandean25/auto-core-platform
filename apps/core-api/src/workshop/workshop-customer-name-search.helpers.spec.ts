import {
  customerNameTermWhere,
  splitSearchTerms,
} from './workshop-customer-name-search.helpers.js';
import { buildCustomerSearchWhere } from './workshop-intake-query.helpers.js';

type CustomerRow = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
  phone: string | null;
};

type WhereNode = Record<string, any>;

const TEXT_FIELDS = ['first_name', 'last_name', 'company_name', 'phone'] as const;

const containsIgnoreCase = (value: string | null, needle: string) =>
  (value ?? '').toLowerCase().includes(needle.toLowerCase());

/** Evaluates the subset of Prisma where input the customer search builds (tenant, OR, AND, contains, id equals). */
function matchesWhere(where: WhereNode, row: CustomerRow): boolean {
  if (where.tenant_id !== undefined && where.tenant_id !== row.tenant_id) return false;
  if (where.id?.equals !== undefined && where.id.equals !== row.id) return false;
  if (Array.isArray(where.OR) && !where.OR.some((node: WhereNode) => matchesWhere(node, row))) {
    return false;
  }
  if (Array.isArray(where.AND) && !where.AND.every((node: WhereNode) => matchesWhere(node, row))) {
    return false;
  }
  return TEXT_FIELDS.every((field) => {
    const condition = where[field];
    return condition?.contains === undefined || containsIgnoreCase(row[field], condition.contains);
  });
}

const maxMustermann: CustomerRow = {
  id: 'customer-1',
  tenant_id: 'tenant-1',
  first_name: 'Max',
  last_name: 'Mustermann',
  company_name: null,
  phone: '+43 660 1234567',
};

describe('splitSearchTerms', () => {
  it('splits on whitespace and drops empty fragments', () => {
    expect(splitSearchTerms('  max   mustermann ')).toEqual(['max', 'mustermann']);
  });

  it('returns no terms for blank or missing input', () => {
    expect(splitSearchTerms('   ')).toEqual([]);
    expect(splitSearchTerms('')).toEqual([]);
    expect(splitSearchTerms(undefined as unknown as string)).toEqual([]);
  });
});

describe('customerNameTermWhere', () => {
  it('matches one term against first, last and company name columns', () => {
    expect(customerNameTermWhere('max')).toEqual({
      OR: [
        { first_name: { contains: 'max', mode: 'insensitive' } },
        { last_name: { contains: 'max', mode: 'insensitive' } },
        { company_name: { contains: 'max', mode: 'insensitive' } },
      ],
    });
  });
});

describe('buildCustomerSearchWhere full-name search', () => {
  it('finds a customer whose first and last name are in separate columns', () => {
    const where = buildCustomerSearchWhere('tenant-1', 'max mustermann');

    expect(matchesWhere(where, maxMustermann)).toBe(true);
  });

  it('ignores word order and letter case', () => {
    const where = buildCustomerSearchWhere('tenant-1', 'MUSTERMANN   max');

    expect(matchesWhere(where, maxMustermann)).toBe(true);
  });

  it('requires every word to match a name column', () => {
    const where = buildCustomerSearchWhere('tenant-1', 'max mueller');
    const otherMax = { ...maxMustermann, id: 'customer-2', last_name: 'Mueller' };

    expect(matchesWhere(where, maxMustermann)).toBe(false);
    expect(matchesWhere(where, otherMax)).toBe(true);
  });

  it('never returns a customer from another tenant', () => {
    const where = buildCustomerSearchWhere('tenant-1', 'max mustermann');
    const otherTenant = { ...maxMustermann, id: 'customer-3', tenant_id: 'tenant-2' };

    expect(matchesWhere(where, otherTenant)).toBe(false);
  });

  it('keeps whole-query phone matching for numbers that contain spaces', () => {
    const where = buildCustomerSearchWhere('tenant-1', '660 1234');

    expect(matchesWhere(where, maxMustermann)).toBe(true);
  });

  it('adds one AND branch per word only for multi-word queries', () => {
    const multi = buildCustomerSearchWhere('tenant-1', 'max mustermann');
    const single = buildCustomerSearchWhere('tenant-1', 'mustermann');

    expect(multi.OR).toContainEqual({
      AND: [customerNameTermWhere('max'), customerNameTermWhere('mustermann')],
    });
    expect(single.OR?.some((node) => 'AND' in node)).toBe(false);
  });
});
