import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({
    description:
      'Target site ID to retarget this purchase order to (DRAFT only)',
    example: 'site-uuid',
  })
  @IsOptional()
  @IsString()
  siteId?: string;

  @ApiPropertyOptional({
    description: 'Expected site ID for optimistic concurrency checks',
    example: 'site-uuid',
  })
  @IsOptional()
  @IsString()
  expectedSiteId?: string;
}
