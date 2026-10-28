import { ApiProperty } from '@nestjs/swagger';
import { WorkshopEstimateStatus } from '@prisma/client';

export class WorkshopEstimateListRowDto {
  /** The estimate version; the id of `GET /workshop/estimates/:versionId`. */
  @ApiProperty({ format: 'uuid' })
  version_id!: string;

  @ApiProperty()
  estimate_number!: string;

  @ApiProperty()
  version!: number;

  /** Effective status: a SENT version past its validity shows as EXPIRED. */
  @ApiProperty({
    enum: WorkshopEstimateStatus,
    enumName: 'WorkshopEstimateStatus',
  })
  status!: WorkshopEstimateStatus;

  @ApiProperty({ format: 'uuid' })
  order_id!: string;

  @ApiProperty()
  order_number!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  customer_id!: string | null;

  /** Company name, otherwise first and last name; null when the order has no customer. */
  @ApiProperty({ type: String, nullable: true })
  customer_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  vehicle_plate!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sent_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  valid_until!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  decided_at!: string | null;

  /** Decimal as a string with two places. */
  @ApiProperty({ type: String, nullable: true })
  total_gross!: string | null;
}

export class WorkshopEstimateListPageMetaDto {
  @ApiProperty()
  page_size!: number;

  @ApiProperty({ type: String, nullable: true })
  next_cursor!: string | null;
}

export class WorkshopEstimateListPageResponseDto {
  @ApiProperty({ type: [WorkshopEstimateListRowDto] })
  data!: WorkshopEstimateListRowDto[];

  @ApiProperty({ type: WorkshopEstimateListPageMetaDto })
  meta!: WorkshopEstimateListPageMetaDto;
}
