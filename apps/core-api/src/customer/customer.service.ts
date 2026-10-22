import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Customer, Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { resolveHistoryPagination } from '../common/utils/history-pagination.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildCustomerDetailInclude } from './customer-detail.query.js';
import { confirmationAfterEmailWrite } from './customer-contact-email.js';
import { projectCustomerDetail } from './customer-detail.projection.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  assertCustomerVatIdFormat,
  normalizeCustomerVatId,
} from './customer-vat-id.validation.js';

function isPrismaCustomerQuery(
  params: unknown,
): params is Prisma.CustomerFindManyArgs {
  if (!params || typeof params !== 'object') {
    return false;
  }
  const query = params as Record<string, unknown>;
  return [query.where, query.orderBy, query.skip].some(
    (field) => field !== undefined,
  );
}

function buildLegacySearchWhere(
  tenantId: string,
  search?: string,
): Prisma.CustomerWhereInput {
  if (!search) {
    return { tenant_id: tenantId };
  }
  const searchFields = [
    'first_name',
    'last_name',
    'company_name',
    'email',
  ] as const;
  return {
    tenant_id: tenantId,
    OR: searchFields.map((field) => ({
      [field]: { contains: search, mode: 'insensitive' as const },
    })),
  };
}

async function queryTenantCustomers(
  prisma: PrismaService,
  tenantId: string,
  params: Prisma.CustomerFindManyArgs,
) {
  const where: Prisma.CustomerWhereInput = {
    ...(params.where ?? {}),
    tenant_id: tenantId,
  };
  const [data, total] = await Promise.all([
    prisma.customer.findMany({ ...params, where }),
    prisma.customer.count({ where }),
  ]);
  return { data, total };
}

async function getCustomerReferenceCounts(
  prisma: PrismaService,
  tenantId: string,
  customerId: string,
  authorizedSiteIds: string[],
) {
  const siteScoped = {
    tenant_id: tenantId,
    customer_id: customerId,
    site_id: { in: authorizedSiteIds },
  };
  const tenantScoped = { tenant_id: tenantId, customer_id: customerId };

  const [
    salesOrders,
    invoices,
    workshopOrders,
    vehicles,
    vehiclePurchases,
    vehicleSales,
    contactPoints,
    consentEvents,
    vehicleParties,
  ] = await Promise.all([
    prisma.salesOrder.count({ where: siteScoped }),
    prisma.invoice.count({ where: tenantScoped }),
    prisma.workshopOrder.count({ where: siteScoped }),
    prisma.vehicle.count({ where: tenantScoped }),
    prisma.vehiclePurchase.count({ where: siteScoped }),
    prisma.vehicleSale.count({ where: siteScoped }),
    prisma.customerContactPoint.count({ where: tenantScoped }),
    prisma.customerConsent.count({ where: tenantScoped }),
    prisma.vehicleParty.count({ where: tenantScoped }),
  ]);
  return {
    salesOrders,
    invoices,
    workshopOrders,
    vehicles,
    vehiclePurchases,
    vehicleSales,
    contactPoints,
    consentEvents,
    vehicleParties,
  };
}

@Injectable()
export class CustomerService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async create(createCustomerDto: CreateCustomerDto) {
    const tenantId = await this.tenantContext.getTenantId();
    assertCustomerVatIdFormat(
      createCustomerDto.address_country,
      createCustomerDto.vat_id,
    );
    const normalizedVatId = normalizeCustomerVatId(createCustomerDto.vat_id);
    return this.prisma.customer.create({
      data: {
        ...createCustomerDto,
        ...(createCustomerDto.vat_id !== undefined
          ? { vat_id: normalizedVatId }
          : {}),
        tenant_id: tenantId,
      },
    });
  }

  async findAll(
    params?: string | Prisma.CustomerFindManyArgs,
  ): Promise<{ data: Customer[]; total: number }> {
    const tenantId = await this.tenantContext.getTenantId();
    if (isPrismaCustomerQuery(params)) {
      return queryTenantCustomers(this.prisma, tenantId, params);
    }

    // Fallback for legacy calls (if any)
    const search = typeof params === 'string' ? params : undefined;
    const result = await this.prisma.customer.findMany({
      where: buildLegacySearchWhere(tenantId, search),
      orderBy: [{ company_name: 'asc' }, { last_name: 'asc' }],
    });
    return { data: result, total: result.length };
  }

  async findOne(
    id: string,
    options?: { historyPage?: number; historyLimit?: number },
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const pagination = resolveHistoryPagination({
      page: options?.historyPage,
      limit: options?.historyLimit,
    });

    const [customer, workshopOrdersTotal, invoicesTotal] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id, tenant_id: tenantId },
        include: buildCustomerDetailInclude(
          pagination,
          authorizedSiteIds,
          tenantId,
        ),
      }),
      this.prisma.workshopOrder.count({
        where: {
          tenant_id: tenantId,
          customer_id: id,
          site_id: { in: authorizedSiteIds },
        },
      }),
      this.prisma.invoice.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return projectCustomerDetail(
      customer,
      pagination,
      {
        workshopOrders: workshopOrdersTotal,
        invoices: invoicesTotal,
      },
      authorizedSiteIds,
    );
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.customer.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const mergedCountry =
      updateCustomerDto.address_country ?? existing.address_country;
    const mergedVatId =
      updateCustomerDto.vat_id !== undefined
        ? updateCustomerDto.vat_id
        : existing.vat_id;
    if (
      updateCustomerDto.vat_id !== undefined ||
      updateCustomerDto.address_country !== undefined
    ) {
      assertCustomerVatIdFormat(mergedCountry, mergedVatId);
    }

    const data: Prisma.CustomerUpdateInput = { ...updateCustomerDto };
    if (updateCustomerDto.vat_id !== undefined) {
      data.vat_id = normalizeCustomerVatId(updateCustomerDto.vat_id);
    }
    if (
      confirmationAfterEmailWrite(existing.email, updateCustomerDto) === false
    ) {
      data.contact_email_ok = false;
    }

    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    await this.ensureCustomerExists(id);

    const counts = await getCustomerReferenceCounts(
      this.prisma,
      tenantId,
      id,
      authorizedSiteIds,
    );

    const hasActiveReferences = [
      counts.salesOrders,
      counts.invoices,
      counts.workshopOrders,
      counts.vehiclePurchases,
      counts.vehicleSales,
    ].some((count) => count > 0);

    if (hasActiveReferences) {
      throw new BadRequestException(
        'Customer cannot be deleted because it has linked orders or invoices. Use archive/deactivate instead.',
      );
    }

    if (counts.vehicles > 0) {
      throw new BadRequestException(
        'Customer cannot be deleted while vehicles are linked. Reassign or remove vehicles first.',
      );
    }

    if (counts.vehicleParties > 0) {
      throw new ConflictException({
        code: 'CUSTOMER_HAS_VEHICLE_PARTIES',
        message:
          'Customer cannot be deleted while vehicle parties reference it. End the party validity instead.',
      });
    }

    if (counts.contactPoints > 0 || counts.consentEvents > 0) {
      throw new BadRequestException(
        'Customer cannot be deleted while contact preferences or consent proof are retained. Use erasure processing or wait for retention expiry.',
      );
    }

    const deleteResult = await this.prisma.$transaction(async (tx) => {
      const { clearRegistrationEvidenceForCustomer } =
        await import('../registration-intake/registration-intake-evidence-cleanup.js');
      await clearRegistrationEvidenceForCustomer(tx, tenantId, id);
      await tx.customerConsentUnsubscribeToken.deleteMany({
        where: { tenant_id: tenantId, customer_id: id },
      });
      await tx.customerCommunicationState.deleteMany({
        where: { tenant_id: tenantId, customer_id: id },
      });
      return tx.customer.deleteMany({
        where: { id, tenant_id: tenantId },
      });
    });

    if (deleteResult.count === 0) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return { id };
  }

  private async ensureCustomerExists(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }
  }
}
