import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryDomainEventsDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from meta.next_cursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 10, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  pageSize?: number;

  @ApiPropertyOptional({
    description: 'Filter by event_type, e.g. workshop_order.scheduled.v1',
  })
  @IsOptional()
  @IsString()
  eventType?: string;
}
