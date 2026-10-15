import { ApiProperty } from '@nestjs/swagger';

export class DomainEventEnvelopeResponseDto {
  @ApiProperty()
  event_id!: string;

  @ApiProperty()
  event_type!: string;

  @ApiProperty()
  schema_version!: number;

  @ApiProperty()
  tenant_id!: string;

  @ApiProperty()
  site_id!: string;

  @ApiProperty()
  entity_id!: string;

  @ApiProperty()
  occurred_at!: string;

  @ApiProperty()
  trace_id!: string;

  @ApiProperty({ description: 'Monotonic position in the tenant feed' })
  sequence!: string;

  @ApiProperty({ required: false })
  estimate_version_id?: string;

  @ApiProperty({ required: false, enum: ['APPROVED', 'DECLINED'] })
  decision?: 'APPROVED' | 'DECLINED';
}

export class DomainEventFeedMetaDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque cursor for the next page, or null when exhausted',
  })
  next_cursor!: string | null;
}

export class DomainEventFeedListResponseDto {
  @ApiProperty({ type: [DomainEventEnvelopeResponseDto] })
  data!: DomainEventEnvelopeResponseDto[];

  @ApiProperty({ type: DomainEventFeedMetaDto })
  meta!: DomainEventFeedMetaDto;
}
