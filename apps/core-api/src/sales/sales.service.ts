import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { InvoiceStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import {
  assertCustomerBelongsToTenant,
  assertVehicleBelongsToTenant,
} from './helpers/sales-tenant-validation.helpers.js';
import {
  buildFormattedInvoiceItems,
  buildInvoiceDueDate,
} from './helpers/invoice-line-items.helpers.js';
import { reconcileDraftInvoiceItems } from './helpers/invoice-draft-reconciliation.helpers.js';
import { InvoiceFinalizationService } from './invoice-finalization.service.js';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private readonly tenantContext: TenantContextService,
    private readonly invoiceFinalization: InvoiceFinalizationService,
  ) {}

  async createDraft(_createInvoiceDto: CreateInvoiceDto) {
    throw new BadRequestException({
      code: 'SOURCE_DOCUMENT_REQUIRED',
      message:
        'Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
    });
  }

  async updateDraft(id: string, updateInvoiceDto: CreateInvoiceDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.invoice.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Invoice not found');
    }
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be updated');
    }

    const { items = [], ...invoiceData } = updateInvoiceDto;

    if (invoiceData.customerId) {
      await assertCustomerBelongsToTenant(
        this.prisma,
        invoiceData.customerId,
        tenantId,
      );
    }

    if (invoiceData.vehicleId) {
      await assertVehicleBelongsToTenant(
        this.prisma,
        invoiceData.vehicleId,
        tenantId,
      );
    }

    const { formattedItems, totalNet, totalTax, totalGross } =
      await buildFormattedInvoiceItems(this.prisma, tenantId, items);

    return this.prisma.$transaction(async (tx) =>
      reconcileDraftInvoiceItems(tx, {
        invoiceId: id,
        tenantId,
        headerData: {
          customer_id: invoiceData.customerId,
          vehicle_id: invoiceData.vehicleId,
          notes: invoiceData.notes,
          internal_notes: invoiceData.internalNotes,
          total_net: totalNet,
          total_tax: totalTax,
          total_gross: totalGross,
        },
        formattedItems,
      }),
    );
  }

  async finalize(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenant_id: tenantId },
      include: { items: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be finalized');
    }

    await this.financeService.validateTransactionDate(invoice.date);

    return this.prisma.$transaction(async (tx) =>
      this.invoiceFinalization.finalizeInTransaction(tx, tenantId, invoice),
    );
  }

  async findAll() {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.invoice.findMany({
      where: { tenant_id: tenantId },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenant_id: tenantId },
      include: { customer: true, items: true, vehicle: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return {
      ...invoice,
      vehicle: invoice.vehicle
        ? stripVehicleIdentityResolutionState(invoice.vehicle)
        : invoice.vehicle,
    };
  }
}
