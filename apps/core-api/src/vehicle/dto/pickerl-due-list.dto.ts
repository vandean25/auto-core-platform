import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';
import { VehicleResponseDto } from './vehicle-response.dto.js';
import type { PickerlDueStatus } from '../pickerl/compute-pickerl-due.js';

export class PickerlDueListQueryDto {
  @ApiProperty({ required: false, enum: [30, 60, 90] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([30, 60, 90])
  window?: 30 | 60 | 90;

  @ApiProperty({
    required: false,
    enum: ['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN'],
  })
  @IsOptional()
  @IsIn(['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN'])
  status?: PickerlDueStatus;

  @ApiProperty({
    required: false,
    enum: ['yes', 'no', 'older_than'],
  })
  @IsOptional()
  @IsIn(['yes', 'no', 'older_than'])
  contacted?: 'yes' | 'no' | 'older_than';

  @ApiProperty({ required: false, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contactedDays?: number;

  @ApiProperty({ required: false, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 50,
    description: 'Larger values are clamped to 50.',
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class PickerlDueListExportQueryDto {
  @ApiProperty({ required: false, enum: [30, 60, 90] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([30, 60, 90])
  window?: 30 | 60 | 90;

  @ApiProperty({
    required: false,
    enum: ['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN'],
  })
  @IsOptional()
  @IsIn(['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN'])
  status?: PickerlDueStatus;

  @ApiProperty({
    required: false,
    enum: ['yes', 'no', 'older_than'],
  })
  @IsOptional()
  @IsIn(['yes', 'no', 'older_than'])
  contacted?: 'yes' | 'no' | 'older_than';

  @ApiProperty({ required: false, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contactedDays?: number;
}

export class PickerlDuePaginatedResponseDto {
  @ApiProperty({ type: [VehicleResponseDto] })
  data!: VehicleResponseDto[];

  @ApiProperty()
  meta!: PaginationMetaDto;
}
