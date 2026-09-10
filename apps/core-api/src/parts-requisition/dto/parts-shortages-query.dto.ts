import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class PartsShortagesQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Limit the queue to one workshop order.',
  })
  @IsOptional()
  @IsUUID()
  workshopOrderId?: string;
}
