import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  applyCustomerCreateProposal,
  applyCustomerUpdateProposal,
  enrichCustomerCreateProposal,
  enrichCustomerUpdateProposal,
  maskCustomerProposalPayload,
} from './customer-propose.js';
import { normalizePhone } from './customer-phone.util.js';

const TENANT_ID = 'tenant-1';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000040';

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    tenant_id: TENANT_ID,
    type: 'PRIVATE',
    first_name: 'Max',
    last_name: 'Mustermann',
    company_name: null,
    email: 'max@example.at',
    phone: '+43 664 123456',
    vat_id: null,
    address_street: 'Mustergasse 1',
    address_zip: '1010',
    address_city: 'Wien',
    address_country: 'AT',
    preferred_language: 'de',
    contact_email_ok: true,
    ...overrides,
  };
}

type Harness = {
  prisma: PrismaService;
  customer: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  agentProposal: { findFirst: jest.Mock };
};

function createHarness(rows: Record<string, unknown>[] = []): Harness {
  const customer = {
    findMany: jest.fn().mockImplementation(async ({ where }) =>
      rows.filter(
        (row) => !where?.tenant_id || row.tenant_id === where.tenant_id,
      ),
    ),
    findFirst: jest.fn().mockImplementation(async ({ where }) => {
      const found = rows.find(
        (row) =>
          (!where?.tenant_id || row.tenant_id === where.tenant_id) &&
          (!where?.id || row.id === where.id),
      );
      return found ?? null;
    }),
    create: jest.fn().mockImplementation(async ({ data }) => customerRow(data)),
    update: jest.fn().mockImplementation(async ({ data }) =>
      customerRow({ ...(rows[0] ?? {}), ...data }),
    ),
  };
  const agentProposal = { findFirst: jest.fn().mockResolvedValue(null) };
  const prisma = {
    customer,
    agentProposal,
  } as unknown as PrismaService;
  return { prisma, customer, agentProposal };
}

const CREATE_INPUT = {
  customer_type: 'PRIVATE',
  first_name: 'Max',
  last_name: 'Mustermann',
  email: 'max@example.at',
  idempotency_key: 'aut613-create-1',
};

describe('customer proposals (AUT-613)', () => {
  describe('duplicate check', () => {
    it('reports a candidate for the same e-mail', async () => {
      const harness = createHarness([customerRow({ email: 'MAX@example.at' })]);

      const candidates = await findCandidates(harness, CREATE_INPUT);

      expect(candidates).toEqual([
        expect.objectContaining({
          customer_id: CUSTOMER_ID,
          match_reasons: expect.arrayContaining(['email']),
        }),
      ]);
    });

    it('reports a candidate for the same phone in another format', async () => {
      const harness = createHarness([customerRow({ phone: '0664 123456' })]);

      const candidates = await findCandidates(harness, {
        ...CREATE_INPUT,
        email: 'neu@example.at',
        phone: '+43 664 123456',
      });

      expect(candidates[0]?.match_reasons).toContain('phone');
    });

    it('reports a candidate for the same UID', async () => {
      const harness = createHarness([customerRow({ vat_id: 'ATU12345678' })]);

      const candidates = await findCandidates(harness, {
        ...CREATE_INPUT,
        email: 'neu@example.at',
        vat_id: 'at u 12345678',
      });

      expect(candidates[0]?.match_reasons).toContain('vat_id');
    });

    it('reports a candidate for the same name and postcode', async () => {
      const harness = createHarness([
        customerRow({ email: 'other@example.at', first_name: 'Max' }),
      ]);

      const candidates = await findCandidates(harness, {
        ...CREATE_INPUT,
        email: 'neu@example.at',
        address: { zip: '1010' },
      });

      expect(candidates[0]?.match_reasons).toContain('name_zip');
    });

    it('ignores a customer of another tenant', async () => {
      const harness = createHarness([
        customerRow({ tenant_id: 'tenant-2', email: 'max@example.at' }),
      ]);

      const candidates = await findCandidates(harness, CREATE_INPUT);

      expect(candidates).toEqual([]);
      expect(harness.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: TENANT_ID }),
        }),
      );
    });

    it('blocks a create on an exact e-mail hit', async () => {
      const harness = createHarness([customerRow({ email: 'max@example.at' })]);

      await expect(
        enrichCustomerCreateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          CREATE_INPUT,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('blocks a create on an exact UID hit', async () => {
      const harness = createHarness([customerRow({ vat_id: 'ATU12345678' })]);

      await expect(
        enrichCustomerCreateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          { ...CREATE_INPUT, vat_id: 'ATU12345678' },
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('allows a create when only the phone or the name matches', async () => {
      const harness = createHarness([
        customerRow({ email: 'other@example.at', vat_id: null }),
      ]);

      const proposal = await enrichCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        { ...CREATE_INPUT, email: 'neu@example.at' },
      );

      expect(proposal.action).toBe('customer.create');
    });
  });

  describe('proposal payload', () => {
    it('stores only the submitted fields of a create', async () => {
      const harness = createHarness();

      const proposal = await enrichCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        CREATE_INPUT,
      );

      expect(Object.keys(proposal.fields).sort()).toEqual([
        'customer_type',
        'email',
        'first_name',
        'last_name',
      ]);
    });

    it('stores only the changed fields of an update', async () => {
      const harness = createHarness([customerRow()]);

      const proposal = await enrichCustomerUpdateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        {
          customer_id: CUSTOMER_ID,
          changes: {
            email: 'neu@example.at',
            last_name: 'Mustermann',
          },
          reason: 'Neue E-Mail-Adresse',
          idempotency_key: 'aut613-update-1',
        },
      );

      expect(Object.keys(proposal.changes)).toEqual(['email']);
      expect(proposal.customer_id).toBe(CUSTOMER_ID);
    });

    it('refuses an update without any change', async () => {
      const harness = createHarness([customerRow()]);

      await expect(
        enrichCustomerUpdateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          {
            customer_id: CUSTOMER_ID,
            changes: { email: 'max@example.at' },
            reason: 'Unverändert',
            idempotency_key: 'aut613-update-2',
          },
        ),
      ).rejects.toThrow(/CUSTOMER_NO_CHANGES/);
    });

    it('allows enrich when a pending proposal exists (replay happens on commit)', async () => {
      const harness = createHarness();
      harness.agentProposal.findFirst.mockResolvedValue({ id: 'proposal-1' });

      const proposal = await enrichCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        CREATE_INPUT,
      );

      expect(proposal.idempotency_key).toBe(CREATE_INPUT.idempotency_key);
    });
  });

  describe('masking', () => {
    it('masks the e-mail, the phone, and the address in the payload', async () => {
      const harness = createHarness();

      const proposal = await enrichCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        {
          ...CREATE_INPUT,
          phone: '+43 664 123456',
          address: { street: 'Mustergasse 1', zip: '1010' },
        },
      );
      const masked = maskCustomerProposalPayload(proposal) as {
        fields: Record<string, unknown>;
      };

      expect(masked.fields.email).toBe('m***@example.at');
      expect(String(masked.fields.phone)).toContain('456');
      expect(String(masked.fields.phone)).not.toContain('664');
      expect(masked.fields.address).toEqual({ street: '***', zip: '***' });
    });

    it('masks the values of the diff', async () => {
      const harness = createHarness([customerRow()]);

      const outcome = await applyCustomerUpdateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        await enrichCustomerUpdateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          {
            customer_id: CUSTOMER_ID,
            changes: { email: 'neu@example.at' },
            reason: 'Neue E-Mail-Adresse',
            idempotency_key: 'aut613-update-1',
          },
        ),
      );

      expect(outcome.diff).toEqual([
        {
          field: 'email',
          before_masked: 'm***@example.at',
          after_masked: 'n***@example.at',
        },
      ]);
    });
  });

  describe('apply', () => {
    it('creates the customer of an approved create proposal', async () => {
      const harness = createHarness();

      const outcome = await applyCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        await enrichCustomerCreateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          CREATE_INPUT,
        ),
      );

      expect(harness.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: TENANT_ID,
            first_name: 'Max',
            last_name: 'Mustermann',
          }),
        }),
      );
      expect(outcome.entity).toBe('Customer');
      expect(outcome.op).toBe('create');
    });

    it('sets phone_digits when the create proposal includes a phone', async () => {
      const harness = createHarness();
      const phone = '+43 664 1234567';

      await applyCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        await enrichCustomerCreateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          { ...CREATE_INPUT, phone },
        ),
      );

      expect(harness.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone,
            phone_digits: normalizePhone(phone),
          }),
        }),
      );
    });

    it('refuses a create when the e-mail was taken in the meantime', async () => {
      const harness = createHarness();
      const proposal = await enrichCustomerCreateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        CREATE_INPUT,
      );
      harness.customer.findMany.mockResolvedValue([
        customerRow({ email: 'max@example.at' }),
      ]);

      await expect(
        applyCustomerCreateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          proposal,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(harness.customer.create).not.toHaveBeenCalled();
    });

    it('withdraws the e-mail confirmation when the address changes', async () => {
      const harness = createHarness([customerRow()]);

      await applyCustomerUpdateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        await enrichCustomerUpdateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          {
            customer_id: CUSTOMER_ID,
            changes: { email: 'neu@example.at' },
            reason: 'Neue E-Mail-Adresse',
            idempotency_key: 'aut613-update-1',
          },
        ),
      );

      expect(harness.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contact_email_ok: false }),
        }),
      );
    });

    it('refuses an e-mail another customer already uses', async () => {
      const harness = createHarness([customerRow()]);
      const proposal = await enrichCustomerUpdateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        {
          customer_id: CUSTOMER_ID,
          changes: { email: 'taken@example.at' },
          reason: 'Neue E-Mail-Adresse',
          idempotency_key: 'aut613-update-1',
        },
      );
      harness.customer.findMany.mockResolvedValue([
        customerRow({ id: 'other-customer', email: 'taken@example.at' }),
      ]);

      await expect(
        applyCustomerUpdateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          proposal,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(harness.customer.update).not.toHaveBeenCalled();
    });

    it('refuses a stale proposal', async () => {      const harness = createHarness([customerRow()]);
      const proposal = await enrichCustomerUpdateProposal(
        { prisma: harness.prisma, tenantId: TENANT_ID },
        {
          customer_id: CUSTOMER_ID,
          changes: { email: 'neu@example.at' },
          reason: 'Neue E-Mail-Adresse',
          idempotency_key: 'aut613-update-1',
        },
      );
      harness.customer.findFirst.mockResolvedValue(
        customerRow({ email: 'zwischen@example.at' }),
      );

      await expect(
        applyCustomerUpdateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          proposal,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(harness.customer.update).not.toHaveBeenCalled();
    });

    it('refuses a customer of another tenant', async () => {
      const harness = createHarness([customerRow({ tenant_id: 'tenant-2' })]);

      await expect(
        applyCustomerUpdateProposal(
          { prisma: harness.prisma, tenantId: TENANT_ID },
          {
            action: 'customer.update',
            idempotency_key: 'aut613-update-1',
            customer_id: CUSTOMER_ID,
            reason: 'Neue E-Mail-Adresse',
            changes: { email: 'neu@example.at' },
            before_digest: 'digest',
            duplicate_check: { digest: 'digest', candidate_ids: [] },
          },
        ),
      ).rejects.toThrow(/not found/i);
    });
  });
});

async function findCandidates(harness: Harness, input: Record<string, unknown>) {
  const { findDuplicateCandidates } = await import(
    './customer-duplicate-check.js'
  );
  return findDuplicateCandidates(harness.prisma, TENANT_ID, {
    first_name: (input.first_name as string) ?? null,
    last_name: (input.last_name as string) ?? null,
    company_name: null,
    email: (input.email as string) ?? null,
    phone: (input.phone as string) ?? null,
    vat_id: (input.vat_id as string) ?? null,
    address_zip:
      ((input.address as { zip?: string } | undefined)?.zip) ?? null,
  });
}
