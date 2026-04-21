import { Controller, Get, Param, Query } from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';

@Controller('vendors')
export class VendorUnbilledController {
  constructor(private readonly service: PurchaseInvoiceService) {}

  @Get(':vendorId/unbilled-receipts')
  @ApiQuery({ name: 'invoiceId', required: false, type: String })
  @ApiOkResponse({
    schema: { type: 'array', items: { type: 'object' } },
  })
  getUnbilledReceipts(
    @Param('vendorId') vendorId: string,
    @Query('invoiceId') invoiceId?: string,
  ) {
    return this.service.getUnbilledReceipts(vendorId, invoiceId);
  }
}
