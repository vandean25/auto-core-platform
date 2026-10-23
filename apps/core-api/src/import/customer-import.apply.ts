import {
  AuditLogAction,
  ImportEntityType,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { resolveImportExternalId } from './import-apply.errors.js';
import { pickCustomerAuditSnapshot } from './import-audit.util.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import {
  createExternalMapping,
  upsertExternalMapping,
} from './import-external-id.store.js';
import type { ImportApplyJob, ImportApplyRow } from './import-type-handler.js';
import { confirmationAfterEmailWrite } from '../customer/customer-contact-email.js';
import { withPhoneDigits } from '../customer/customer-phone.util.js';
import { assignImportUpdateFields } from './import-update-data.util.js';
import type { ImportJobOptions } from './import.types.js';

export type CustomerApplyContext = {
  tenantId: string;
  job: ImportApplyJob;
  actorUserId: string;
  audit: ImportAuditWriter;
};

type CustomerSnapshotFields = {
  type: string;
  company_name: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  vat_id: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
};

function buildCustomerUpdateData(
  existing: CustomerSnapshotFields,
  payload: Record<string, unknown>,
  options: ImportJobOptions,
): Prisma.CustomerUpdateInput {
  const data = assignImportUpdateFields(
    existing,
    [
      ['type', payload.type],
      ['company_name', payload.company_name],
      ['first_name', payload.first_name],
      ['last_name', payload.last_name],
      ['email', payload.email],
      ['phone', payload.phone],
      ['vat_id', payload.vat_id],
      ['address_street', payload.address_street],
      ['address_zip', payload.address_zip],
      ['address_city', payload.address_city],
      ['address_country', payload.address_country],
    ],
    options,
  );
  // A changed address withdraws the advisor's confirmation for order communication (ADR-0025 §8).
  if (confirmationAfterEmailWrite(existing.email, data) === false) {
    data.contact_email_ok = false;
  }
  return withPhoneDigits(data);
}

async function createCustomer(
  tx: Prisma.TransactionClient,
  ctx: CustomerApplyContext,
  externalId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const created = await tx.customer.create({
    data: withPhoneDigits({
      tenant_id: ctx.tenantId,
      type: payload.type as Prisma.CustomerCreateInput['type'],
      company_name: payload.company_name as string | null,
      first_name: String(payload.first_name),
      last_name: String(payload.last_name),
      email: payload.email as string | null,
      phone: payload.phone as string | null,
      vat_id: payload.vat_id as string | null,
      address_street: payload.address_street as string | null,
      address_zip: payload.address_zip as string | null,
      address_city: payload.address_city as string | null,
      address_country: (payload.address_country as string | null) ?? 'AT',
    }),
  });
  await createExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.CUSTOMER,
    ctx.job.source_system,
    externalId,
    created.id,
    ctx.job.id,
  );
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'Customer',
    created.id,
    AuditLogAction.CREATE,
    null,
    pickCustomerAuditSnapshot(created),
  );
}

async function updateCustomer(
  tx: Prisma.TransactionClient,
  ctx: CustomerApplyContext,
  entityId: string,
  externalId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const before = await tx.customer.findFirst({
    where: { tenant_id: ctx.tenantId, id: entityId },
  });
  if (!before) {
    throw new Error('Customer not found');
  }
  const updateData = buildCustomerUpdateData(
    before,
    payload,
    (ctx.job.options_json as ImportJobOptions) ?? {},
  );
  const after = await tx.customer.update({
    where: { id: entityId },
    data: updateData,
  });
  await upsertExternalMapping(
    tx,
    ctx.tenantId,
    ImportEntityType.CUSTOMER,
    ctx.job.source_system,
    externalId,
    after.id,
    ctx.job.id,
  );
  await ctx.audit.writeEntityAudit(
    tx,
    ctx.tenantId,
    ctx.actorUserId,
    ctx.job.id,
    'Customer',
    after.id,
    AuditLogAction.UPDATE,
    pickCustomerAuditSnapshot(before),
    pickCustomerAuditSnapshot(after),
  );
}

/** Writes one planned customer row. CREATE adds a customer, UPDATE changes an existing one. */
export async function applyCustomerImportRow(
  tx: Prisma.TransactionClient,
  ctx: CustomerApplyContext,
  row: ImportApplyRow,
): Promise<void> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  delete payload.external_id;

  if (row.action === ImportRowAction.CREATE) {
    await createCustomer(tx, ctx, externalId, payload);
    return;
  }
  if (row.action === ImportRowAction.UPDATE && row.entity_id) {
    await updateCustomer(tx, ctx, row.entity_id, externalId, payload);
  }
}
