import type { PrismaService } from '../prisma/prisma.service.js';
import { RegistrationIntakeMatchService } from './registration-intake-match.service.js';
import type { RegistrationFieldEvidence } from './registration-document-extraction.types.js';

const TENANT_ID = 'tenant-1';

type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

function buildPrisma(rows: CustomerRow[]) {
  return {
    customer: { findMany: jest.fn().mockResolvedValue(rows) },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function holderEvidence(
  firstName: string,
  lastName: string,
): Record<string, RegistrationFieldEvidence> {
  return {
    holder: {
      raw: `${firstName} ${lastName}`,
      normalized: { firstName, lastName },
      source: null,
      uncertainty: null,
    },
  };
}

describe('RegistrationIntakeMatchService.buildMatchSnapshot', () => {
  it('reports an existing customer whose name matches case-insensitively', async () => {
    const service = new RegistrationIntakeMatchService();
    const prisma = buildPrisma([
      { id: 'customer-1', first_name: 'Max', last_name: 'Musterfrau' },
    ]);

    const snapshot = await service.buildMatchSnapshot(
      prisma,
      TENANT_ID,
      holderEvidence('max', 'musterfrau'),
      [],
    );

    expect(snapshot.cases).toContain('EXISTING_CUSTOMER');
    expect(snapshot.customers).toEqual([
      { id: 'customer-1', firstName: 'Max', lastName: 'Musterfrau' },
    ]);
  });

  it('reports no customer when the name differs', async () => {
    const service = new RegistrationIntakeMatchService();
    const prisma = buildPrisma([
      { id: 'customer-1', first_name: 'Moritz Beispiel', last_name: 'Musterfrau' },
    ]);

    const snapshot = await service.buildMatchSnapshot(
      prisma,
      TENANT_ID,
      holderEvidence('Max', 'Mustermann'),
      [],
    );

    expect(snapshot.cases).not.toContain('EXISTING_CUSTOMER');
    expect(snapshot.customers).toEqual([]);
  });

  it('searches the customer by the name of the document holder', async () => {
    const service = new RegistrationIntakeMatchService();
    const prisma = buildPrisma([]);

    await service.buildMatchSnapshot(
      prisma,
      TENANT_ID,
      holderEvidence('Max', 'Mustermann'),
      [],
    );

    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        first_name: { equals: 'Max', mode: 'insensitive' },
        last_name: { equals: 'Mustermann', mode: 'insensitive' },
      },
      take: 25,
      select: { id: true, first_name: true, last_name: true },
    });
  });
});
