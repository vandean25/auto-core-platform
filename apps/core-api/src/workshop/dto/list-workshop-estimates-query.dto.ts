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
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

export const WORKSHOP_ESTIMATE_LIST_DEFAULT_PAGE_SIZE = 25;
export const WORKSHOP_ESTIMATE_LIST_MAX_PAGE_SIZE = 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** A real calendar day, and not before `sentFrom` (the MCP tool refuses the same). */
@ValidatorConstraint({ name: 'sentRange', async: false })
class SentRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args?: ValidationArguments): boolean {
    const { sentFrom, sentTo } = args?.object as ListWorkshopEstimatesQueryDto;
    return (
      isCalendarDate(sentFrom) && isCalendarDate(sentTo) && sentFrom <= sentTo
    );
  }

  defaultMessage(): string {
    return 'sentFrom and sentTo must be real days as YYYY-MM-DD, and sentFrom must not be after sentTo';
  }
}

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
  @Validate(SentRangeConstraint)
  sentFrom?: string;

  /** Last day (site-local, YYYY-MM-DD) on which the estimate was sent. Needs `sentFrom`. */
  @ApiPropertyOptional({ example: '2026-10-31' })
  @ValidateIf(
    (dto: ListWorkshopEstimatesQueryDto) =>
      dto.sentTo !== undefined || dto.sentFrom !== undefined,
  )
  @Matches(ISO_DATE, { message: 'sentTo must be a date as YYYY-MM-DD' })
  @Validate(SentRangeConstraint)
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
