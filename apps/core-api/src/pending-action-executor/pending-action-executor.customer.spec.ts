import { ConflictException } from '@nestjs/common';
import { enrichCustomerUpdateProposal } from '../customer/customer-propose.js';
import { CUSTOMER_STALE_PROPOSAL_CODE } from '../customer/customer-propose.constants.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  customerCreateExecutor,
  customerUpdateExecutor,
} from './pending-action-executor.customer.js';

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
    contact_email_ok: true,
    ...overrides,
  };
}

function createDeps(rows: Record<string, unknown>[] = []) {
  const prisma = {
    customer: {
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    agentProposal: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  return {
    prisma,
    tenantContext: {
      getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
    },
    siteContext: { getSiteId: jest.fn().mockResolvedValue('site-1') },
  } as never;
}

describe('customer pending action executors (AUT-613)', () => {
  describe('customer.create', () => {
    it('builds the proposal payload from the submitted fields', async () => {
      const deps = createDeps();
      const executor = customerCreateExecutor(deps, 'customer.create');

      const payload = await executor.enrichInput!({
        customer_type: 'PRIVATE',
        first_name: 'Max',
        last_name: 'Mustermann',
        email: 'max@example.at',
        idempotency_key: 'aut613-create-1',
      });

      expect(payload).toMatchObject({
        action: 'customer.create',
        idempotency_key: 'aut613-create-1',
        fields: { customer_type: 'PRIVATE', first_name: 'Max' },
      });
    });

    it('creates the customer when the proposal is applied', async () => {
      const deps = createDeps();
      const executor = customerCreateExecutor(deps, 'customer.create');
      const payload = await executor.enrichInput!({
        customer_type: 'PRIVATE',
        first_name: 'Max',
        last_name: 'Mustermann',
        idempotency_key: 'aut613-create-1',
      });

      const result = await executor.execute(payload);

      expect(deps.prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenant_id: TENANT_ID }),
        }),
      );
      expect(result).toMatchObject({ customer_id: CUSTOMER_ID, op: 'create' });
    });

    it('logs the action as not reversible', async () => {
      const deps = createDeps();
      const executor = customerCreateExecutor(deps, 'customer.create');

      const metadata = executor.buildLogMetadata?.({ customer_id: CUSTOMER_ID });

      expect(metadata).toEqual({
        entityType: 'Customer',
        entityId: CUSTOMER_ID,
        reversible: false,
      });
    });

    it('masks the proposal payload for the result and the action log', async () => {
      const deps = createDeps();
      const executor = customerCreateExecutor(deps, 'customer.create');
      const payload = await executor.enrichInput!({
        customer_type: 'PRIVATE',
        first_name: 'Max',
        last_name: 'Mustermann',
        email: 'max@example.at',
        phone: '+43 664 123456',
        idempotency_key: 'aut613-create-1',
      });

      const masked = executor.maskProposalPayload!(payload) as {
        fields: Record<string, unknown>;
      };
      const maskedArgs = executor.maskLoggedArgs!({
        email: 'max@example.at',
        phone: '+43 664 123456',
      }) as Record<string, unknown>;

      expect(masked.fields.email).toBe('m***@example.at');
      expect(maskedArgs.email).toBe('m***@example.at');
      expect(String(maskedArgs.phone)).toContain('456');
    });
  });

  describe('customer.update', () => {
    it('applies the changed fields of the proposal', async () => {
      const deps = createDeps([customerRow()]);
      const executor = customerUpdateExecutor(deps, 'customer.update');
      const payload = await executor.enrichInput!({
        customer_id: CUSTOMER_ID,
        changes: { email: 'neu@example.at' },
        reason: 'Neue E-Mail-Adresse',
        idempotency_key: 'aut613-update-1',
      });

      const result = await executor.execute(payload);

      expect(deps.prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID },
          data: expect.objectContaining({
            email: 'neu@example.at',
            contact_email_ok: false,
          }),
        }),
      );
      expect(result).toMatchObject({ customer_id: CUSTOMER_ID, op: 'update' });
    });

    it('keeps the legacy customer.update payload working', async () => {
      const deps = createDeps([customerRow()]);
      const executor = customerUpdateExecutor(deps, 'customer.update');

      const result = await executor.execute({
        customer_id: CUSTOMER_ID,
        first_name: 'Maximilian',
      });

      expect(deps.prisma.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID, tenant_id: TENANT_ID },
          data: expect.objectContaining({ first_name: 'Maximilian' }),
        }),
      );
      expect(result).toMatchObject({ id: CUSTOMER_ID });
    });

    it('rejects approval when the customer changed after the proposal was stored', async () => {
      const deps = createDeps([customerRow()]);
      const executor = customerUpdateExecutor(deps, 'customer.update');
      const proposal = await enrichCustomerUpdateProposal(
        { prisma: deps.prisma, tenantId: TENANT_ID },
        {
          customer_id: CUSTOMER_ID,
          changes: { email: 'neu@example.at' },
          reason: 'Neue E-Mail-Adresse',
          idempotency_key: 'aut613-update-1',
        },
      );
      deps.prisma.customer.findFirst.mockResolvedValue(
        customerRow({ email: 'zwischen@example.at' }),
      );

      const error = await executor
        .execute(proposal)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CUSTOMER_STALE_PROPOSAL_CODE,
      });
      expect(deps.prisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('scopes the customer lookup to the tenant of the caller', async () => {
      const deps = createDeps([customerRow({ tenant_id: 'tenant-2' })]);
      const executor = customerUpdateExecutor(deps, 'customer.update');

      await expect(
        executor.execute({
          action: 'customer.update',
          idempotency_key: 'aut613-update-1',
          customer_id: CUSTOMER_ID,
          reason: 'Neue E-Mail-Adresse',
          changes: { email: 'neu@example.at' },
          before_digest: 'digest',
          duplicate_check: { digest: 'digest', candidate_ids: [] },
        }),
      ).rejects.toThrow(/not found/i);
    });
  });
});
