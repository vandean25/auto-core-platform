import { ApiProperty } from '@nestjs/swagger';
import {
  CUSTOMER_ACTIVITY_TYPES,
  type CustomerActivityType,
} from '../activity/customer-activity.types.js';

export class CustomerActivityItemDto {
  @ApiProperty({ description: 'Stable item identifier within its source' })
  id!: string;

  @ApiProperty({ enum: CUSTOMER_ACTIVITY_TYPES })
  type!: CustomerActivityType;

  @ApiProperty({ format: 'date-time' })
  occurred_at!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'Referenced entity ID' })
  ref_id!: string;

  @ApiProperty({ nullable: true, type: String })
  ref_link!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  summary!: Record<string, unknown>;
}

export class CustomerActivityMetaDto {
  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasNextPage!: boolean;

  @ApiProperty()
  limit!: number;
}

export class CustomerActivityResponseDto {
  @ApiProperty({ type: [CustomerActivityItemDto] })
  data!: CustomerActivityItemDto[];

  @ApiProperty({ type: CustomerActivityMetaDto })
  meta!: CustomerActivityMetaDto;
}
