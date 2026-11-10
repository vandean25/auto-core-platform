import { ApiProperty } from '@nestjs/swagger';
import { DiscountType, InvoiceStatus, InvoiceTaxMode } from '@prisma/client';
import { ListCursorPageMetaDto } from '../../common/dto/list-cursor-response.dto.js';
import { CustomerVehicleReferenceDto } from './customer-vehicle-reference.dto.js';

export class InvoiceItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  catalog_item_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  workshop_task_line_item_id?: string | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, example: '1.00' })
  quantity!: string;

  @ApiProperty({ type: String, example: '10.00' })
  unit_price!: string;

  @ApiProperty()
  tax_rate!: number;

  @ApiProperty({
    enum: DiscountType,
    enumName: 'DiscountType',
    required: false,
    nullable: true,
  })
  line_discount_type?: DiscountType | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  line_discount_value?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  line_total?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  revenue_group_name?: string | null;
}

export class InvoiceResponseDto extends CustomerVehicleReferenceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  invoice_number!: string | null;

  @ApiProperty({ enum: InvoiceStatus, enumName: 'InvoiceStatus' })
  status!: InvoiceStatus;

  @ApiProperty({ type: String, required: false, nullable: true })
  sales_order_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  workshop_order_id?: string | null;

  @ApiProperty()
  date!: Date;

  @ApiProperty()
  due_date!: Date;

  @ApiProperty({ type: String, example: '100.00' })
  total_net!: string;

  @ApiProperty({ type: String, example: '20.00' })
  total_tax!: string;

  @ApiProperty({ type: String, example: '120.00' })
  total_gross!: string;

  @ApiProperty({
    enum: InvoiceTaxMode,
    enumName: 'InvoiceTaxMode',
    required: false,
  })
  tax_mode?: InvoiceTaxMode;

  @ApiProperty({
    enum: DiscountType,
    enumName: 'DiscountType',
    required: false,
    nullable: true,
  })
  global_discount_type?: DiscountType | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  global_discount_value?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  internal_notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  pdf_generated_at?: Date | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  pdf_generation_error?: string | null;

  @ApiProperty({ type: [InvoiceItemResponseDto] })
  items!: InvoiceItemResponseDto[];

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description:
      'Country-specific margin-scheme legal notice for on-screen invoice display.',
  })
  margin_scheme_legal_note?: string | null;
}

export class InvoiceCursorPageResponseDto {
  @ApiProperty({ type: () => [InvoiceResponseDto] })
  data!: InvoiceResponseDto[];

  @ApiProperty({ type: () => ListCursorPageMetaDto })
  meta!: ListCursorPageMetaDto;
}
