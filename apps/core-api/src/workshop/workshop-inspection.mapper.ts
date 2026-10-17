import type {
  WorkshopInspection,
  WorkshopInspectionItem,
} from '@prisma/client';
import type { WorkshopInspectionResponseDto } from './dto/workshop-inspection-response.dto.js';

type InspectionWithItems = WorkshopInspection & {
  items: WorkshopInspectionItem[];
};

export function toWorkshopInspectionResponse(
  inspection: InspectionWithItems,
): WorkshopInspectionResponseDto {
  return {
    id: inspection.id,
    title: inspection.title,
    items: inspection.items.map((item) => ({
      id: item.id,
      label_snapshot: item.label_snapshot,
      passed: item.passed,
      notes: item.notes,
      unit: item.unit,
    })),
  };
}
