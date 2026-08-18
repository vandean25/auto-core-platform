import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopOrderPurpose } from '@prisma/client';
import { InvoicesService } from '../invoices/invoices.service';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class WorkshopInvoiceService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(InvoicesService) private invoicesService: InvoicesService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async createInvoiceFromOrder(orderId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      select: { purpose: true },
    });
    if (order?.purpose === WorkshopOrderPurpose.STOCK_PREP) {
      throw new BadRequestException(
        'Stock-prep workshop orders cannot be invoiced to a customer',
      );
    }
    return this.invoicesService.createDraftInvoice(orderId);
  }
}
