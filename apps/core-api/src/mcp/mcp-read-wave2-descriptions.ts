import type { McpWave2ReadToolName } from './mcp-read-wave2-catalog.js';

function bilingual(en: string, de: string): string {
  return `${en} | DE: ${de}`;
}

export const MCP_WAVE2_READ_TOOL_DESCRIPTIONS: Record<
  McpWave2ReadToolName,
  string
> = {
  list_loaner_bookings: bilingual(
    'List loaner bookings at the active site with optional filters and pageSize paging (max 25)',
    'Leihwagen-Buchungen am aktiven Standort mit optionalen Filtern und pageSize-Paging (max. 25)',
  ),
  list_estimates: bilingual(
    'List workshop estimate versions at the active site; filter by customer, order, status, or sent date range',
    'KVA-Versionen am aktiven Standort listen; Filter nach Kunde, Auftrag, Status oder Versandzeitraum',
  ),
  list_order_communications: bilingual(
    'Communication timeline for one workshop order without message bodies (pageSize max 25)',
    'Kommunikationsverlauf zu einem Werkstattauftrag ohne Nachrichtentexte (pageSize max. 25)',
  ),
  get_check_in: bilingual(
    'Check-in summary for a workshop order without signature image or hashes',
    'Annahme-Zusammenfassung zu einem Werkstattauftrag ohne Signaturbild oder Hashes',
  ),
  get_staff_availability: bilingual(
    'Staff presence and scheduled hours for a day (OWNER/ADMIN; same access as HR attendance view)',
    'Team-Anwesenheit und Soll-Stunden für einen Tag (OWNER/ADMIN; wie HR-Zeiterfassung)',
  ),
};
