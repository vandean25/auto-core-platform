import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateWorkshopOrderDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reportedIssue?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bayId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @IsOptional()
  @IsUUID()
  mechanicId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledStartAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledEndAt?: string;
}
