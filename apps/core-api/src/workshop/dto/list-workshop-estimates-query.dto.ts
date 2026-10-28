import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkshopEstimateStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const WORKSHOP_ESTIMATE_LIST_DEFAULT_PAGE_SIZE = 25;
export const WORKSHOP_ESTIMATE_LIST_MAX_PAGE_SIZE = 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Query of the estimates list of the active site (AUT-795). Same filters as the MCP tool `list_estimates`. */
export class ListWorkshopEstimatesQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** Without a status, versions that a newer version replaced (SUPERSEDED) are left out; ask for SUPERSEDED to see them. */
  @ApiPropertyOptional({
    enum: WorkshopEstimateStatus,
    enumName: 'WorkshopEstimateStatus',
  })
  @IsOptional()
  @IsEnum(WorkshopEstimateStatus)
  status?: WorkshopEstimateStatus;

  /** First day (site-local, YYYY-MM-DD) on which the estimate was sent. Needs `sentTo`. */
  @ApiPropertyOptional({ example: '2026-10-01' })
  @ValidateIf(
    (dto: ListWorkshopEstimatesQueryDto) =>
      dto.sentTo !== undefined || dto.sentFrom !== undefined,
  )
  @Matches(ISO_DATE, { message: 'sentFrom must be a date as YYYY-MM-DD' })
  sentFrom?: string;

  /** Last day (site-local, YYYY-MM-DD) on which the estimate was sent. Needs `sentFrom`. */
  @ApiPropertyOptional({ example: '2026-10-31' })
  @ValidateIf(
    (dto: ListWorkshopEstimatesQueryDto) =>
      dto.sentTo !== undefined || dto.sentFrom !== undefined,
  )
  @Matches(ISO_DATE, { message: 'sentTo must be a date as YYYY-MM-DD' })
  sentTo?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: WORKSHOP_ESTIMATE_LIST_MAX_PAGE_SIZE,
    default: WORKSHOP_ESTIMATE_LIST_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSHOP_ESTIMATE_LIST_MAX_PAGE_SIZE)
  pageSize?: number;

  /** Opaque cursor: the `next_cursor` of the previous page. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
