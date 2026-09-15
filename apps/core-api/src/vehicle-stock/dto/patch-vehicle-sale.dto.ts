import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PatchVehicleSaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  sale_price?: number;

  @ApiPropertyOptional({
    description: 'Target site ID to retarget vehicle sale to (DRAFT only)',
  })
  @IsOptional()
  @IsUUID()
  site_id?: string;

  @ApiPropertyOptional({
    description: 'Alias for site_id',
  })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({
    description: 'Expected site ID for optimistic concurrency checks',
  })
  @IsOptional()
  @IsUUID()
  expectedSiteId?: string;
}
