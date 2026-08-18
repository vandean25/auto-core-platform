import { ApiProperty } from '@nestjs/swagger';
import { PurchaseInvoiceStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { VendorResponseDto } from '../../vendor/dto/vendor-response.dto';

export class PurchaseInvoiceLinePurchaseOrderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order_number!: string;
}

export class PurchaseInvoiceLinePurchaseOrderItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  purchase_order_id!: string;

  @ApiProperty({ type: () => PurchaseInvoiceLinePurchaseOrderDto })
  purchase_order!: PurchaseInvoiceLinePurchaseOrderDto;
}

export class PurchaseInvoiceLineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  purchase_invoice_id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  purchase_order_item_id?: string | null;

  @ApiProperty({
    type: () => PurchaseInvoiceLinePurchaseOrderItemDto,
    required: false,
    nullable: true,
  })
  purchase_order_item?: PurchaseInvoiceLinePurchaseOrderItemDto | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, example: '1.00' })
  quantity!: string;

  @ApiProperty({ type: String, example: '10.00' })
  unit_price!: string;

  @ApiProperty()
  tax_rate!: number;

  @ApiProperty({ type: String, example: '10.00' })
  line_total!: string;
}

export class PurchaseInvoiceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  vendor_id!: string;

  @ApiProperty({ type: () => VendorResponseDto })
  vendor!: VendorResponseDto;

  @ApiProperty()
  vendor_invoice_number!: string;

  @ApiProperty({
    enum: PurchaseInvoiceStatus,
    enumName: 'PurchaseInvoiceStatus',
  })
  status!: PurchaseInvoiceStatus;

  @ApiProperty()
  invoice_date!: Date;

  @ApiProperty()
  due_date!: Date;

  @ApiProperty({ type: String, example: '100.00' })
  total_amount!: string;

  @ApiProperty({ type: [PurchaseInvoiceLineResponseDto] })
  lines!: PurchaseInvoiceLineResponseDto[];

  @ApiProperty()
  createdAt!: Date;
}

export class PurchaseInvoicePaginatedResponseDto {
  @ApiProperty({ type: [PurchaseInvoiceResponseDto] })
  data!: PurchaseInvoiceResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class UnbilledReceiptItemDto {
  @ApiProperty()
  purchaseOrderItemId!: string;

  @ApiProperty()
  purchaseOrderId!: string;

  @ApiProperty()
  purchaseOrderNumber!: string;

  @ApiProperty()
  catalogItemId!: string;

  @ApiProperty()
  catalogItemName!: string;

  @ApiProperty()
  quantityReceived!: number;

  @ApiProperty()
  quantityInvoiced!: number;

  @ApiProperty()
  quantityPending!: number;

  @ApiProperty()
  lastUnitCost!: number;
}
