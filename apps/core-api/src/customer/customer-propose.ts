import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Customer } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  findBlockingDuplicateCandidates,
  findDuplicateCandidates,
} from './customer-duplicate-check.js';
import {
  changedFields,
  currentFields,
  toCustomerCreateData,
  toCustomerUpdateData,
} from './customer-propose.fields.js';
import {
  CUSTOMER_DUPLICATE_CODE,
  CUSTOMER_STALE_PROPOSAL_CODE,
} from './customer-propose.constants.js';
import {
  buildProposalDiff,
  digestOf,
  maskProposalPayload,
  pickSubmittedFields,
  type CustomerCreateFields,
  type CustomerCreateProposalPayload,
  type CustomerProposalDiffEntry,
  type CustomerProposalFields,
  type CustomerUpdateProposalPayload,
} from './customer-propose.payload.js';
import {
  proposeCustomerCreateInputSchema,
  proposeCustomerUpdateInputSchema,
} from './customer-propose.schema.js';
import {
  CUSTOMER_MATCH_REASONS,
  type CustomerMatchCandidate,
} from './customer-match.util.js';

/** What a customer proposal returns to the caller; it carries masked values only. */
export type CustomerProposalOutcome = {
  id: string;
  customer_id: string;
  entity: 'Customer';
  op: 'create' | 'update';
  diff: CustomerProposalDiffEntry[];
  duplicate_candidates: CustomerMatchCandidate[];
};

type ProposalContext = {
  prisma: PrismaService;
  tenantId: string;
};

/** Builds the proposal payload of a create proposal. */
export async function enrichCustomerCreateProposal(
  context: ProposalContext,
  input: unknown,
): Promise<CustomerCreateProposalPayload> {
  const parsed = proposeCustomerCreateInputSchema.parse(input);
  const fields = pickSubmittedFields(parsed) as CustomerCreateFields;
  const candidates = await findDuplicateCandidates(
    context.prisma,
    context.tenantId,
    probeOf(fields),
  );
  assertNoBlockingDuplicate(candidates);
  return {
    action: 'customer.create',
    idempotency_key: parsed.idempotency_key,
    fields,
    duplicate_check: {
      digest: digestOf(fields),
      candidate_ids: candidates.map((candidate) => candidate.customer_id),
    },
  };
}

/** Builds the proposal payload of an update proposal, with the changed fields only. */
export async function enrichCustomerUpdateProposal(
  context: ProposalContext,
  input: unknown,
): Promise<CustomerUpdateProposalPayload> {
  const parsed = proposeCustomerUpdateInputSchema.parse(input);
  const customer = await loadCustomer(context, parsed.customer_id);
  const changes = changedFields(customer, parsed.changes);
  if (Object.keys(changes).length === 0) {
    throw new BadRequestException({
      code: 'CUSTOMER_NO_CHANGES',
      message:
        'CUSTOMER_NO_CHANGES: the submitted changes match the current customer data',
    });
  }
  const candidates = await findDuplicateCandidates(
    context.prisma,
    context.tenantId,
    probeOf({ ...currentFields(customer, changes), ...changes }),
  ).then((found) =>
    found.filter((candidate) => candidate.customer_id !== customer.id),
  );
  assertNoBlockingDuplicate(candidates);
  return {
    action: 'customer.update',
    idempotency_key: parsed.idempotency_key,
    customer_id: customer.id,
    reason: parsed.reason,
    changes,
    before_digest: digestOf(currentFields(customer, changes)),
    duplicate_check: {
      digest: digestOf(changes),
      candidate_ids: candidates.map((candidate) => candidate.customer_id),
    },
  };
}

/** Creates the customer of an approved create proposal. */
export async function applyCustomerCreateProposal(
  context: ProposalContext,
  payload: unknown,
): Promise<CustomerProposalOutcome> {
  const proposal = parseCreatePayload(payload);
  await assertIdentityIsFree(
    context,
    proposal.fields.email,
    proposal.fields.vat_id,
  );
  const data = toCustomerCreateData(proposal.fields, context.tenantId);
  const created = await context.prisma.customer.create({ data });
  return proposalOutcome(context, 'create', created, {}, proposal.fields);
}

/** Applies the changed fields of an approved update proposal. */
export async function applyCustomerUpdateProposal(
  context: ProposalContext,
  payload: unknown,
): Promise<CustomerProposalOutcome> {
  const proposal = parseUpdatePayload(payload);
  const customer = await loadCustomer(context, proposal.customer_id);
  assertProposalIsCurrent(customer, proposal);
  await assertIdentityIsFree(
    context,
    proposal.changes.email,
    proposal.changes.vat_id,
    customer.id,
  );
  const data = toCustomerUpdateData(customer, proposal.changes);
  const updated = await context.prisma.customer.update({
    where: { id: customer.id },
    data,
  });
  return proposalOutcome(
    context,
    'update',
    updated,
    currentFields(customer, proposal.changes),
    proposal.changes,
  );
}

/** The e-mail and the UID stay free per tenant, also when the proposal is applied. */
async function assertIdentityIsFree(
  context: ProposalContext,
  email: string | undefined,
  vatId: string | undefined,
  customerId?: string,
): Promise<void> {
  if (!email && !vatId) {
    return;
  }
  const candidates = await findBlockingDuplicateCandidates(
    context.prisma,
    context.tenantId,
    { email, vat_id: vatId },
  );
  const conflict = candidates.find(
    (candidate) => candidate.customer_id !== customerId,
  );
  if (!conflict) {
    return;
  }
  throw new UnprocessableEntityException({
    code: CUSTOMER_DUPLICATE_CODE,
    message: `${CUSTOMER_DUPLICATE_CODE}: another customer already uses this e-mail address or UID (customer_id ${conflict.customer_id}). The customer data was not changed.`,
  });
}

/** A masked copy of a proposal payload, for the tool result and the action log. */
export function maskCustomerProposalPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const action = (payload as Record<string, unknown>).action;
  if (action === 'customer.create') {
    return maskProposalPayload(parseCreatePayload(payload));
  }
  if (action === 'customer.update') {
    return maskProposalPayload(parseUpdatePayload(payload));
  }
  return payload;
}

function parseCreatePayload(payload: unknown): CustomerCreateProposalPayload {
  const record = asRecord(payload);
  if (record.action !== 'customer.create') {
    throw new BadRequestException({
      code: 'CUSTOMER_PROPOSAL_INVALID',
      message: 'CUSTOMER_PROPOSAL_INVALID: not a customer create proposal',
    });
  }
  return {
    action: 'customer.create',
    idempotency_key: asText(record.idempotency_key),
    fields: record.fields as CustomerCreateFields,
    duplicate_check: (record.duplicate_check ?? {
      digest: '',
      candidate_ids: [],
    }) as CustomerCreateProposalPayload['duplicate_check'],
  };
}

function parseUpdatePayload(payload: unknown): CustomerUpdateProposalPayload {
  const record = asRecord(payload);
  if (record.action !== 'customer.update') {
    throw new BadRequestException({
      code: 'CUSTOMER_PROPOSAL_INVALID',
      message: 'CUSTOMER_PROPOSAL_INVALID: not a customer update proposal',
    });
  }
  return {
    action: 'customer.update',
    idempotency_key: asText(record.idempotency_key),
    customer_id: asText(record.customer_id),
    reason: asText(record.reason),
    changes: record.changes ?? {},
    before_digest: asText(record.before_digest),
    duplicate_check: (record.duplicate_check ?? {
      digest: '',
      candidate_ids: [],
    }) as CustomerUpdateProposalPayload['duplicate_check'],
  };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    throw new BadRequestException({
      code: 'CUSTOMER_PROPOSAL_INVALID',
      message: 'CUSTOMER_PROPOSAL_INVALID: the proposal payload is missing',
    });
  }
  return payload as Record<string, unknown>;
}

async function loadCustomer(
  context: ProposalContext,
  customerId: string,
): Promise<Customer> {
  const customer = await context.prisma.customer.findFirst({
    where: { id: customerId, tenant_id: context.tenantId },
  });
  if (!customer) {
    throw new NotFoundException(`Customer with ID ${customerId} not found`);
  }
  return customer;
}

function probeOf(fields: CustomerProposalFields) {
  return {
    first_name: fields.first_name ?? null,
    last_name: fields.last_name ?? null,
    company_name: fields.company_name ?? null,
    email: fields.email ?? null,
    phone: fields.phone ?? null,
    vat_id: fields.vat_id ?? null,
    address_zip: fields.address?.zip ?? null,
  };
}

function assertNoBlockingDuplicate(candidates: CustomerMatchCandidate[]): void {
  const blocking = candidates.find(
    (candidate) =>
      candidate.match_reasons.includes(CUSTOMER_MATCH_REASONS.email) ||
      candidate.match_reasons.includes(CUSTOMER_MATCH_REASONS.vatId),
  );
  if (!blocking) {
    return;
  }
  throw new UnprocessableEntityException({
    code: CUSTOMER_DUPLICATE_CODE,
    message: `${CUSTOMER_DUPLICATE_CODE}: a customer with the same e-mail or UID already exists (customer_id ${blocking.customer_id}). Propose an update for that customer instead of a create.`,
  });
}

function assertProposalIsCurrent(
  customer: Customer,
  proposal: CustomerUpdateProposalPayload,
): void {
  const current = digestOf(currentFields(customer, proposal.changes));
  if (current === proposal.before_digest) {
    return;
  }
  throw new ConflictException({
    code: CUSTOMER_STALE_PROPOSAL_CODE,
    message: `${CUSTOMER_STALE_PROPOSAL_CODE}: the customer data changed since this proposal was created. Reload the customer and propose the change again.`,
  });
}

async function proposalOutcome(
  context: ProposalContext,
  op: 'create' | 'update',
  customer: Customer,
  before: CustomerProposalFields,
  after: CustomerProposalFields,
): Promise<CustomerProposalOutcome> {
  const candidates = await findDuplicateCandidates(
    context.prisma,
    context.tenantId,
    probeOf({ ...before, ...after }),
  );
  return {
    id: customer.id,
    customer_id: customer.id,
    entity: 'Customer',
    op,
    diff: buildProposalDiff(before, after),
    duplicate_candidates: candidates.filter(
      (candidate) => candidate.customer_id !== customer.id,
    ),
  };
}
