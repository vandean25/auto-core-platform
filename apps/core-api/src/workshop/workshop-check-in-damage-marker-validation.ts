import { BadRequestException } from '@nestjs/common';
import type { CheckInDamageMarkerDto } from './dto/workshop-check-in.dto.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import {
  CHECK_IN_DAMAGE_TYPE_VALUES,
  CHECK_IN_ZONE_ID_SET,
} from './workshop-check-in-zones.js';

const DAMAGE_TYPE_SET = new Set<string>(CHECK_IN_DAMAGE_TYPE_VALUES);

export function assertCheckInDamageMarkerContract(
  markers: CheckInDamageMarkerDto[],
): void {
  for (const marker of markers) {
    if (!CHECK_IN_ZONE_ID_SET.has(marker.zone_id)) {
      throw new BadRequestException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_ZONE_INVALID,
        message: `Unknown check-in damage zone_id: ${marker.zone_id}`,
      });
    }
    if (!DAMAGE_TYPE_SET.has(marker.type)) {
      throw new BadRequestException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_DAMAGE_TYPE_INVALID,
        message: `Unknown check-in damage type: ${marker.type}`,
      });
    }
  }
}
