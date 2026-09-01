import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import type {
  CatalogSearchConcern,
  CatalogSearchSource,
} from '../providers/catalog-provider.types';

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  return undefined;
}

export class CatalogExternalSearchQueryDto {
  @ApiProperty()
  @IsString()
  workshopOrderId!: string;

  @ApiProperty()
  @IsString()
  taskId!: string;

  @ApiProperty({ enum: ['PARTS', 'LABOR'] })
  @IsEnum(['PARTS', 'LABOR'] as const)
  concern!: CatalogSearchConcern;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    enum: ['AUTO', 'OEM', 'AFTERMARKET'],
    required: false,
    default: 'AUTO',
  })
  @IsOptional()
  @IsEnum(['AUTO', 'OEM', 'AFTERMARKET'] as const)
  source?: CatalogSearchSource;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseOptionalBoolean(value))
  @IsBoolean()
  confirmFallback?: boolean;
}

export class CatalogAssemblyGroupsQueryDto {
  @ApiProperty()
  @IsString()
  workshopOrderId!: string;

  @ApiProperty({ enum: ['PARTS'] })
  @IsEnum(['PARTS'] as const)
  concern!: 'PARTS';
}
