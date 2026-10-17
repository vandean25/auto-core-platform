import type { WorkshopCheckIn } from '@prisma/client';
import type { WorkshopCheckInResponseDto } from './dto/workshop-check-in.dto.js';

export function toWorkshopCheckInResponse(
  row: WorkshopCheckIn,
): WorkshopCheckInResponseDto {
  return {
    id: row.id,
    workshop_order_id: row.workshop_order_id,
    status: row.status,
    revision: row.revision,
    condition_json: row.condition_json as Record<string, unknown>,
    damage_markers_json: row.damage_markers_json as unknown[],
    items_left: row.items_left,
    key_count: row.key_count,
    warning_lights: row.warning_lights,
    odometer: row.odometer,
    fuel_level: row.fuel_level,
    inspection_id: row.inspection_id,
    content_sha256: row.content_sha256,
    completed_at: row.completed_at?.toISOString() ?? null,
    pdf_sha256: row.pdf_sha256,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
