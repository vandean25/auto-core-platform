import type { PrismaService } from '../prisma/prisma.service.js';
import {
  buildDisplayNameInitials,
  buildNameVariants,
  buildZipVariants,
  CUSTOMER_MATCH_REASONS,
  foldMatchName,
  isSameCustomerName,
  normalizeMatchEmail,
  normalizeMatchPhone,
  normalizeMatchVatId,
  normalizeMatchZip,
  type CustomerMatchCandidate,
  type CustomerMatchProbe,
  type CustomerMatchReason,
} from './customer-match.util.js';
import {
  buildPhoneCandidateWhere,
  buildVatIdCandidateWhere,
} from './customer-duplicate-check.where.js';

const CANDIDATE_LIMIT = 50;

type CustomerMatchRow = {
  id: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  vat_id: string | null;
  address_zip: string | null;
};

const MATCH_ROW_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  company_name: true,
  email: true,
  phone: true,
  vat_id: true,
  address_zip: true,
} as const;

type ReasonAccumulator = Map<string, Set<CustomerMatchReason>>;

/**
 * Finds the tenant customers a submitted customer record may already exist as
 * (AUT-613). The comparisons are the shared ones from customer-match.util, so
 * the MCP tools, the registration intake and the customer import agree on what
 * "the same customer" means.
 */
export async function findDuplicateCandidates(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchCandidate[]> {
  const reasons: ReasonAccumulator = new Map();
  const rows = await loadCandidateRows(prisma, tenantId, probe);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    const rowReasons = matchReasons(row, probe);
    if (rowReasons.length === 0) {
      continue;
    }
    const known = reasons.get(row.id) ?? new Set<CustomerMatchReason>();
    for (const reason of rowReasons) {
      known.add(reason);
    }
    reasons.set(row.id, known);
  }
  return [...reasons.entries()].map(([customerId, matched]) => {
    const row = rowById.get(customerId);
    return {
      customer_id: customerId,
      match_reasons: [...matched],
      display_name_initials: buildDisplayNameInitials(
        row ?? {
          first_name: probe.first_name,
          last_name: probe.last_name,
          company_name: probe.company_name,
        },
      ),
    };
  });
}

/** The candidates whose e-mail or UID matches exactly; those block a create. */
export async function findBlockingDuplicateCandidates(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchCandidate[]> {
  const candidates = await findDuplicateCandidates(prisma, tenantId, probe);
  return candidates.filter((candidate) =>
    candidate.match_reasons.some(
      (reason) =>
        reason === CUSTOMER_MATCH_REASONS.email ||
        reason === CUSTOMER_MATCH_REASONS.vatId,
    ),
  );
}

async function loadCandidateRows(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchRow[]> {
  const [emailRows, phoneRows, vatRows, nameRows] = await Promise.all([
    findByEmail(prisma, tenantId, probe),
    findByPhone(prisma, tenantId, probe),
    findByVatId(prisma, tenantId, probe),
    findByName(prisma, tenantId, probe),
  ]);
  const merged = new Map<string, CustomerMatchRow>();
  for (const row of [...emailRows, ...phoneRows, ...vatRows, ...nameRows]) {
    merged.set(row.id, row);
  }
  return [...merged.values()];
}

async function findByEmail(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchRow[]> {
  const email = normalizeMatchEmail(probe.email);
  if (!email) {
    return [];
  }
  return prisma.customer.findMany({
    where: {
      tenant_id: tenantId,
      email: { equals: email, mode: 'insensitive' },
    },
    take: CANDIDATE_LIMIT,
    select: MATCH_ROW_SELECT,
  });
}

async function findByPhone(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchRow[]> {
  const where = buildPhoneCandidateWhere(tenantId, probe.phone);
  if (!where) {
    return [];
  }
  const rows = await prisma.customer.findMany({
    where,
    take: CANDIDATE_LIMIT,
    select: MATCH_ROW_SELECT,
  });
  const national = normalizeMatchPhone(probe.phone);
  return rows.filter((row) => {
    const rowNational = normalizeMatchPhone(row.phone);
    return rowNational !== null && rowNational === national;
  });
}

async function findByVatId(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchRow[]> {
  const where = buildVatIdCandidateWhere(tenantId, probe.vat_id);
  if (!where) {
    return [];
  }
  const rows = await prisma.customer.findMany({
    where,
    take: CANDIDATE_LIMIT,
    select: MATCH_ROW_SELECT,
  });
  const normalized = normalizeMatchVatId(probe.vat_id);
  return rows.filter((row) => normalizeMatchVatId(row.vat_id) === normalized);
}

/**
 * Name and postcode matches need both fields; without a probe postcode no
 * name_zip candidate is returned.
 */
async function findByName(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchRow[]> {
  const zip = normalizeMatchZip(probe.address_zip);
  if (!zip) {
    return [];
  }
  const rows = await findByZip(prisma, tenantId, probe);
  return rows.filter((row) => matchesName(row, probe) && matchesZip(row, zip));
}

async function findByZip(
  prisma: PrismaService,
  tenantId: string,
  probe: CustomerMatchProbe,
): Promise<CustomerMatchRow[]> {
  const variants = buildZipVariants(probe.address_zip);
  if (variants.length === 0) {
    return [];
  }
  const firstVariants = buildNameVariants(probe.first_name);
  const lastVariants = buildNameVariants(probe.last_name);
  if (firstVariants.length === 0 && lastVariants.length === 0) {
    return [];
  }
  return prisma.customer.findMany({
    where: {
      tenant_id: tenantId,
      address_zip: { in: variants, mode: 'insensitive' },
      AND: [
        ...(firstVariants.length === 0
          ? []
          : [
              {
                first_name: {
                  in: firstVariants,
                  mode: 'insensitive' as const,
                },
              },
            ]),
        ...(lastVariants.length === 0
          ? []
          : [
              {
                last_name: {
                  in: lastVariants,
                  mode: 'insensitive' as const,
                },
              },
            ]),
      ],
    },
    take: CANDIDATE_LIMIT,
    select: MATCH_ROW_SELECT,
  });
}

function matchesName(
  row: CustomerMatchRow,
  probe: CustomerMatchProbe,
): boolean {
  if (probe.first_name && probe.last_name) {
    return isSameCustomerName(
      row.first_name,
      row.last_name,
      probe.first_name,
      probe.last_name,
    );
  }
  if (probe.first_name) {
    return foldMatchName(row.first_name) === foldMatchName(probe.first_name);
  }
  if (probe.last_name) {
    return foldMatchName(row.last_name) === foldMatchName(probe.last_name);
  }
  const company = foldMatchName(row.company_name);
  return company.length > 0 && company === foldMatchName(probe.company_name);
}

function matchesZip(row: CustomerMatchRow, zip: string | null): boolean {
  if (!zip) {
    return false;
  }
  return normalizeMatchZip(row.address_zip) === zip;
}

function matchReasons(
  row: CustomerMatchRow,
  probe: CustomerMatchProbe,
): CustomerMatchReason[] {
  const reasons: CustomerMatchReason[] = [];
  const probeZip = normalizeMatchZip(probe.address_zip);
  if (matchesEmail(row, probe)) {
    reasons.push(CUSTOMER_MATCH_REASONS.email);
  }
  if (matchesPhone(row, probe)) {
    reasons.push(CUSTOMER_MATCH_REASONS.phone);
  }
  if (matchesVatId(row, probe)) {
    reasons.push(CUSTOMER_MATCH_REASONS.vatId);
  }
  if (probeZip && matchesName(row, probe) && matchesZip(row, probeZip)) {
    reasons.push(CUSTOMER_MATCH_REASONS.nameZip);
  }
  return reasons;
}

function matchesEmail(
  row: CustomerMatchRow,
  probe: CustomerMatchProbe,
): boolean {
  const probeEmail = normalizeMatchEmail(probe.email);
  if (!probeEmail) {
    return false;
  }
  return normalizeMatchEmail(row.email) === probeEmail;
}

function matchesPhone(
  row: CustomerMatchRow,
  probe: CustomerMatchProbe,
): boolean {
  const probePhone = normalizeMatchPhone(probe.phone);
  if (!probePhone) {
    return false;
  }
  return normalizeMatchPhone(row.phone) === probePhone;
}

function matchesVatId(
  row: CustomerMatchRow,
  probe: CustomerMatchProbe,
): boolean {
  const probeVatId = normalizeMatchVatId(probe.vat_id);
  if (!probeVatId) {
    return false;
  }
  return normalizeMatchVatId(row.vat_id) === probeVatId;
}
