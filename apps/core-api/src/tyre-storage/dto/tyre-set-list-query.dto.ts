import { ApiPropertyOptional } from '@nestjs/swagger';
import { TyreSeason, TyreSetStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class TyreSetListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleSearch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ enum: TyreSeason, enumName: 'TyreSeason' })
  @IsOptional()
  @IsEnum(TyreSeason)
  season?: TyreSeason;

  @ApiPropertyOptional({ enum: TyreSetStatus, enumName: 'TyreSetStatus' })
  @IsOptional()
  @IsEnum(TyreSetStatus)
  status?: TyreSetStatus;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  /** Row offset for keyset-free paging (MCP offset cursors). Ignored when `page` is used without `skip`. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
