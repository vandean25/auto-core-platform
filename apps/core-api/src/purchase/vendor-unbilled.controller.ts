import { Controller, Get, Param } from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';

@Controller('vendors')
export class VendorUnbilledController {
  constructor(private readonly service: PurchaseInvoiceService) {}

  @Get(':vendorId/unbilled-receipts')
  getUnbilledReceipts(@Param('vendorId') vendorId: string) {
    return this.service.getUnbilledReceipts(vendorId);
  }
}
