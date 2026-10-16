import type { CheckInDamageMarkerDto } from './dto/workshop-check-in.dto.js';

export function serializeCheckInDamageMarkers(
  markers: CheckInDamageMarkerDto[],
): Array<{
  id: string;
  zone_id: string;
  type: string;
  note: string;
  media_ids: string[];
}> {
  return markers.map((marker) => ({
    id: marker.id,
    zone_id: marker.zone_id,
    type: marker.type,
    note: marker.note,
    media_ids: marker.media_ids,
  }));
}
