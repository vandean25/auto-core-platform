import type { McpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';

function bilingual(en: string, de: string): string {
  return `${en} | DE: ${de}`;
}

export const MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS: Record<
  McpComplianceReadToolName,
  string
> = {
  check_contact_permission: bilingual(
    'Whether the tenant may contact a customer for a purpose and channel (allowed and reason only; no consent ledger text)',
    'Ob der Mandant einen Kunden für Zweck und Kanal kontaktieren darf (nur erlaubt und Grund; kein Einwilligungstext)',
  ),
  list_gewaehrleistung_due: bilingual(
    'Consumer vehicle sales at the active site whose base Gewährleistung period ends within 30, 60, or 90 days (pageSize max 25, opaque cursor)',
    'Verbraucher-Fahrzeugverkäufe am aktiven Standort mit Gewährleistungsende in 30, 60 oder 90 Tagen (pageSize max. 25, Cursor)',
  ),
  list_tyre_sets: bilingual(
    'Tyre storage sets at the active site by customer, vehicle, status, or due-for-swap flag (pageSize max 25, opaque cursor)',
    'Reifeneinlagerungssätze am aktiven Standort nach Kunde, Fahrzeug, Status oder fälligem Wechsel (pageSize max. 25, Cursor)',
  ),
  list_warranty_claims: bilingual(
    'Garantie, Kulanz, and Gewährleistung claims at the active site, optionally for one workshop order (pageSize max 25, keyset cursor; no complaint text)',
    'Garantie-, Kulanz- und Gewährleistungsfälle am aktiven Standort, optional zu einem Werkstattauftrag (pageSize max. 25, Keyset-Cursor; ohne Reklamationstext)',
  ),
};
