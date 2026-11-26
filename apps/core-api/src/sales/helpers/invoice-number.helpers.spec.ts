import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma } from '@prisma/client';
import {
  calendarDateInTimeZone,
  calendarYearInTimeZone,
  generateInvoiceNumber,
  parseCalendarDateInTimeZone,
} from './invoice-number.helpers.js';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function collectNonSpecTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectNonSpecTsFiles(fullPath));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function createMockTx(options?: {
  siteTimezone?: string | null;
  invoicePrefix?: string;
  hasFinanceSettings?: boolean;
  sequenceCurrent?: number;
}) {
  const siteFindFirst = jest.fn().mockResolvedValue(
    options?.siteTimezone !== undefined
      ? { timezone: options.siteTimezone }
      : { timezone: 'Europe/Vienna' },
  );
  const financeSettingsFindFirst = jest.fn().mockResolvedValue(
    options?.hasFinanceSettings === false
      ? null
      : {
          id: 'fs-1',
          invoice_prefix: options?.invoicePrefix ?? 'RE-{YYYY}-',
        },
  );
  const financeSettingsUpdate = jest.fn().mockResolvedValue({
    id: 'fs-1',
    next_invoice_number: (options?.sequenceCurrent ?? 1) + 1,
  });
  const invoiceSequenceUpsert = jest
    .fn()
    .mockResolvedValue({ current: options?.sequenceCurrent ?? 1 });

  const tx = {
    site: { findFirst: siteFindFirst },
    financeSettings: {
      findFirst: financeSettingsFindFirst,
      update: financeSettingsUpdate,
    },
    invoiceSequence: { upsert: invoiceSequenceUpsert },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    siteFindFirst,
    financeSettingsFindFirst,
    financeSettingsUpdate,
    invoiceSequenceUpsert,
  };
}

describe('generateInvoiceNumber', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // AUT-1008 Scenario 1: 2027-01-01 00:30 Vienna = 2026-12-31 23:30 UTC
  it('uses Europe/Vienna year at 2027-01-01 00:30 Vienna (23:30 UTC) and returns number 1 of 2027', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-31T23:30:00.000Z') });
    const { tx, invoiceSequenceUpsert, financeSettingsUpdate } = createMockTx({
      invoicePrefix: 'RE-{YYYY}-',
      sequenceCurrent: 1,
    });

    const result = await generateInvoiceNumber(tx, 'tenant-1');

    expect(result).toBe('RE-2027-0001');
    expect(invoiceSequenceUpsert).toHaveBeenCalledWith({
      where: { tenant_id_year: { tenant_id: 'tenant-1', year: 2027 } },
      update: { current: { increment: 1 } },
      create: { tenant_id: 'tenant-1', year: 2027, current: 1 },
    });
    expect(financeSettingsUpdate).toHaveBeenCalledWith({
      where: { id: 'fs-1' },
      data: { next_invoice_number: 2 },
    });
  });

  it.each([
    { prefix: 'RE-{YYYY}-', current: 4513, expected: 'RE-2026-4513' },
    { prefix: 'INV-', current: 7, expected: 'INV-0007' },
    { prefix: 'AT-{YYYY}/', current: 42, expected: 'AT-2026/0042' },
  ])(
    'formats prefix "$prefix" with sequence $current as "$expected"',
    async ({ prefix, current, expected }) => {
      jest.useFakeTimers({ now: new Date('2026-06-15T12:00:00.000Z') });
      const { tx, invoiceSequenceUpsert } = createMockTx({
        invoicePrefix: prefix,
        sequenceCurrent: current,
      });

      const result = await generateInvoiceNumber(tx, 'tenant-1');

      expect(result).toBe(expected);
      expect(invoiceSequenceUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id_year: {
              tenant_id: 'tenant-1',
              year: prefix.includes('{YYYY}') ? 2026 : 0,
            },
          },
        }),
      );
    },
  );

  it('uses the issuing site timezone when siteId is provided', async () => {
    // 2027-01-01 02:00 UTC is 2026-12-31 21:00 in America/New_York
    jest.useFakeTimers({ now: new Date('2027-01-01T02:00:00.000Z') });
    const { tx, siteFindFirst, invoiceSequenceUpsert } = createMockTx({
      siteTimezone: 'America/New_York',
      invoicePrefix: 'RE-{YYYY}-',
      sequenceCurrent: 1,
    });

    const result = await generateInvoiceNumber(tx, 'tenant-1', {
      siteId: 'site-ny',
    });

    expect(siteFindFirst).toHaveBeenCalledWith({
      where: { id: 'site-ny', tenant_id: 'tenant-1' },
      select: { timezone: true },
    });
    expect(invoiceSequenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id_year: { tenant_id: 'tenant-1', year: 2026 } },
      }),
    );
    expect(result).toBe('RE-2026-0001');
  });

  it('has no other RE- literal building invoice numbers in core-api src', () => {
    const files = collectNonSpecTsFiles(SRC_ROOT);
    const offenders: string[] = [];
    const pattern = /['"`]RE-(?:\$\{|\d{4}-)/;
    const allowedSampleFiles = new Set([
      'sales/helpers/invoice-number.helpers.ts',
      'document-branding/document-branding-preview.ts',
      'search/dto/search-query.dto.ts',
    ]);

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (
        allowedSampleFiles.has(rel) ||
        rel.endsWith('.spec.support.ts') ||
        rel.startsWith('finance/accounting-export/fixtures/')
      ) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (pattern.test(content)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it.each([
    {
      instant: '2026-12-31T23:30:00.000Z',
      timeZone: 'Europe/Vienna',
      expected: '2027-01-01',
    },
    {
      instant: '2026-07-15T22:30:00.000Z',
      timeZone: 'Europe/Vienna',
      expected: '2026-07-16',
    },
    {
      instant: '2027-01-01T02:00:00.000Z',
      timeZone: 'America/New_York',
      expected: '2026-12-31',
    },
  ])(
    'calendarDateInTimeZone resolves $instant in $timeZone to $expected',
    ({ instant, timeZone, expected }) => {
      expect(calendarDateInTimeZone(new Date(instant), timeZone)).toBe(
        expected,
      );
    },
  );

  it.each([
    {
      input: '2027-01-01',
      timeZone: 'Europe/Vienna',
      expectedIso: '2027-01-01T12:00:00.000Z',
      expectedDay: '2027-01-01',
      expectedYear: 2027,
    },
    {
      input: '2026-12-31T23:30:00.000Z',
      timeZone: 'Europe/Vienna',
      expectedIso: '2027-01-01T12:00:00.000Z',
      expectedDay: '2027-01-01',
      expectedYear: 2027,
    },
    {
      input: '2027-01-01',
      timeZone: 'America/New_York',
      expectedIso: '2027-01-01T12:00:00.000Z',
      expectedDay: '2027-01-01',
      expectedYear: 2027,
    },
    {
      input: '2027-02-30',
      timeZone: 'Europe/Vienna',
      expectedIso: null,
      expectedDay: null,
      expectedYear: null,
    },
  ])(
    'parseCalendarDateInTimeZone parses $input in $timeZone',
    ({ input, timeZone, expectedIso, expectedDay, expectedYear }) => {
      const parsed = parseCalendarDateInTimeZone(input, timeZone);
      expect(parsed?.toISOString() ?? null).toBe(expectedIso);
      if (parsed) {
        expect(calendarDateInTimeZone(parsed, timeZone)).toBe(expectedDay);
        expect(calendarYearInTimeZone(parsed, timeZone)).toBe(expectedYear);
      }
    },
  );
});
