import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkshopOrderPurpose } from '@prisma/client';
import { InvoicesService } from '../invoices/invoices.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { isTaskBlockedByParts } from '../parts-requisition/parts-requisition.helpers.js';

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
      select: {
        purpose: true,
        tasks: {
          select: {
            line_items: {
              select: {
                part_execution_status: true,
                parts_reservations: {
                  select: {
                    status: true,
                    quantity: true,
                    quantity_consumed: true,
                    quantity_returned: true,
                    quantity_staged: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (order?.purpose === WorkshopOrderPurpose.STOCK_PREP) {
      throw new BadRequestException(
        'Stock-prep workshop orders cannot be invoiced to a customer',
      );
    }
    if (
      (order?.tasks ?? []).some((task) =>
        isTaskBlockedByParts({
          lines: task.line_items,
          reservations: task.line_items.flatMap(
            (line) => line.parts_reservations ?? [],
          ),
        }),
      )
    ) {
      throw new ConflictException(
        'Workshop order cannot be invoiced while part work is incomplete.',
      );
    }
    return this.invoicesService.createDraftInvoice(orderId);
  }
}
