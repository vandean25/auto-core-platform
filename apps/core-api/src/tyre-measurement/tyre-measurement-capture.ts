import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  evaluateTyreWheel,
  type TyreEvaluationContext,
} from './tyre-evaluation.js';
import type { CreateTyreWheelDto } from './tyre-measurement.dto.js';

const CAPTURE_ERRORS: Readonly<Record<string, { code: string }>> = {
  TYRE_DOT_INVALID_FORMAT: { code: 'TYRE_DOT_INVALID_FORMAT' },
  TYRE_DOT_INVALID_WEEK: { code: 'TYRE_DOT_INVALID_WEEK' },
  TYRE_DOT_FUTURE_DATE: { code: 'TYRE_DOT_FUTURE_DATE' },
  TYRE_EVALUATION_DATE_INVALID: { code: 'TYRE_EVALUATION_DATE_INVALID' },
  TYRE_TREAD_INVALID: { code: 'TYRE_TREAD_INVALID' },
  TYRE_THRESHOLDS_INVALID: { code: 'TYRE_THRESHOLDS_INVALID' },
};

export function captureTyreWheel(
  wheel: CreateTyreWheelDto,
  context: TyreEvaluationContext,
): Prisma.TyreWheelReadingUncheckedCreateWithoutMeasurementInput {
  try {
    return {
      position: wheel.position,
      tread_inner_mm: wheel.treadInnerMm,
      tread_middle_mm: wheel.treadMiddleMm,
      tread_outer_mm: wheel.treadOuterMm,
      brand: wheel.brand ?? null,
      model: wheel.model ?? null,
      size: wheel.size ?? null,
      dot: wheel.dot ?? null,
      season: wheel.season,
      construction: wheel.construction ?? 'RADIAL',
      winter_marking: wheel.winterMarking ?? 'NONE',
      media_id: wheel.mediaId ?? null,
      evaluation: evaluateTyreWheel(wheel, context),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      Object.hasOwn(CAPTURE_ERRORS, error.message)
    ) {
      throw new BadRequestException({
        ...CAPTURE_ERRORS[error.message],
        position: wheel.position,
      });
    }
    throw error;
  }
}
