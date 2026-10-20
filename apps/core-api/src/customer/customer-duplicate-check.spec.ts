import { findDuplicateCandidates } from './customer-duplicate-check.js';
import {
  createDuplicateCheckPrisma,
  duplicateCheckCustomerRow,
  DUPLICATE_CHECK_TENANT_ID,
} from './customer-duplicate-check.spec.support.js';
import {
  buildPhoneCandidateWhere,
  buildVatIdCandidateWhere,
} from './customer-duplicate-check.where.js';

describe('customer-duplicate-check where clauses', () => {
  it('builds a broad phone probe filter from national digits', () => {
    const where = buildPhoneCandidateWhere(
      DUPLICATE_CHECK_TENANT_ID,
      '+43 664 123456',
    );
    expect(where).toMatchObject({
      tenant_id: DUPLICATE_CHECK_TENANT_ID,
      phone: { not: null },
    });
    expect(where?.OR).toEqual(
      expect.arrayContaining([
        { phone: { contains: '664123456', mode: 'insensitive' } },
        { phone: { contains: '123456', mode: 'insensitive' } },
        { phone: { contains: '123 456', mode: 'insensitive' } },
      ]),
    );
  });

  it('builds a broad UID probe filter from the normalized value', () => {
    expect(buildVatIdCandidateWhere(DUPLICATE_CHECK_TENANT_ID, 'at u 12345678')).toEqual({
      tenant_id: DUPLICATE_CHECK_TENANT_ID,
      vat_id: { not: null },
      OR: [
        { vat_id: { contains: 'ATU12345678', mode: 'insensitive' } },
        { vat_id: { contains: '12345678', mode: 'insensitive' } },
      ],
    });
  });
});

describe('customer-duplicate-check', () => {
  it('matches when the stored phone has a space inside the last six digits', async () => {
    const prisma = createDuplicateCheckPrisma([
      duplicateCheckCustomerRow({ phone: '0664 123 456' }),
    ]);

    const candidates = await findDuplicateCandidates(
      prisma,
      DUPLICATE_CHECK_TENANT_ID,
      { phone: '+43 664 123456', email: 'neu@example.at' },
    );

    expect(candidates[0]?.match_reasons).toContain('phone');
  });

  it('queries phone candidates with the broad filter and matches normalized phones', async () => {
    const prisma = createDuplicateCheckPrisma([
      duplicateCheckCustomerRow({ phone: '0664 123456' }),
    ]);

    const candidates = await findDuplicateCandidates(
      prisma,
      DUPLICATE_CHECK_TENANT_ID,
      { phone: '+43 664 123456', email: 'neu@example.at' },
    );

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: buildPhoneCandidateWhere(
          DUPLICATE_CHECK_TENANT_ID,
          '+43 664 123456',
        ),
      }),
    );
    expect(candidates[0]?.match_reasons).toContain('phone');
  });

  it('queries UID candidates with the broad filter and matches normalized UIDs', async () => {
    const prisma = createDuplicateCheckPrisma([
      duplicateCheckCustomerRow({ vat_id: 'AT U 12345678' }),
    ]);

    const candidates = await findDuplicateCandidates(
      prisma,
      DUPLICATE_CHECK_TENANT_ID,
      { vat_id: 'at u 12345678', email: 'neu@example.at' },
    );

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: buildVatIdCandidateWhere(
          DUPLICATE_CHECK_TENANT_ID,
          'at u 12345678',
        ),
      }),
    );
    expect(candidates[0]?.match_reasons).toContain('vat_id');
  });

  it('uses the matched customer name for display initials', async () => {
    const prisma = createDuplicateCheckPrisma([duplicateCheckCustomerRow()]);

    const candidates = await findDuplicateCandidates(
      prisma,
      DUPLICATE_CHECK_TENANT_ID,
      {
        first_name: 'Max',
        last_name: 'Mustermann',
        phone: '+43 664 123456',
        email: 'neu@example.at',
      },
    );

    expect(candidates[0]?.display_name_initials).toBe('AB');
  });

  it('does not emit name_zip without a probe postcode', async () => {
    const prisma = createDuplicateCheckPrisma([
      duplicateCheckCustomerRow({ first_name: 'Max', email: 'other@example.at' }),
    ]);

    const candidates = await findDuplicateCandidates(
      prisma,
      DUPLICATE_CHECK_TENANT_ID,
      {
        first_name: 'Max',
        last_name: 'Mustermann',
        email: 'neu@example.at',
      },
    );

    expect(candidates).toEqual([]);
  });
});
