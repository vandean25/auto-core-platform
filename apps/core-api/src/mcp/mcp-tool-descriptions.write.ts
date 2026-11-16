import type { McpWriteToolName } from './mcp.constants.js';

const DRY_RUN_HINT =
  ' Optional dry_run: true previews policy and effects without writing. | DE: Optional dry_run: true zeigt nur Vorschau ohne Schreiben.';

function withDryRunHint(description: string): string {
  return description + DRY_RUN_HINT;
}

export const MCP_WRITE_TOOL_DESCRIPTIONS_WITH_DRY_RUN: Record<
  McpWriteToolName,
  string
> = {
  draft_workshop_order: withDryRunHint(
    'Create a DRAFT/SCHEDULED workshop order (policy-checked, logged)',
  ),
  reserve_part: withDryRunHint(
    'Reserve on-hand stock for a catalog-backed part line from a bin (the line needs a catalog_item_id; a free-text line fails with NOT_A_CATALOG_LINE); AUTO at or below policy amount_max (EUR 250 platform cap), PROPOSE above amount_max (reversible; counter-tool: release_reservation)',
  ),
  release_reservation: withDryRunHint(
    'Release a parts reservation (counter-tool of reserve_part)',
  ),
  propose_line_item: withDryRunHint(
    'Propose a workshop task line item (PART, LABOR, or FEE; never executes; records a pending proposal)',
  ),
  propose_registration_intake: withDryRunHint(
    'Propose applying a reviewed registration document intake (never executes; records a pending proposal)',
  ),
  propose_workshop_booking: withDryRunHint(
    'Propose a scheduled workshop order with an optional reserved loaner booking and optional loaner_charge FEE line (never executes alone; records one pending proposal)',
  ),
  propose_purchase_order: withDryRunHint(
    'Propose a DRAFT purchase order from verified local parts requisition demand (never sends externally; records one pending proposal)',
  ),
  propose_workshop_order_completion: withDryRunHint(
    'Propose completing open workshop tasks on an order and moving it to a derived completed status when all tasks are done; optional ready-for-pickup email only when notify_customer is true and the action is applied (never finalizes invoices)',
  ),
  propose_invoice_draft_from_order: withDryRunHint(
    'Propose a DRAFT invoice from a COMPLETED workshop order (never finalizes, sends, or records payment; records one pending proposal)',
  ),
  propose_estimate_send: withDryRunHint(
    'Propose creating or revising a workshop estimate (KVA) and emailing the customer an online approval link (never sends without human apply; records one pending proposal)',
  ),
  request_workshop_media_upload: withDryRunHint(
    'Reserve a short-lived direct upload slot for workshop task media (jpeg, png, heic, or webp). Does not change workshop business state until a finding or other flow references the returned media_id',
  ),
  propose_mechanic_finding: withDryRunHint(
    'Propose an additional mechanic finding with photos for advisor review (never sends customer messages; records one pending proposal)',
  ),
  propose_customer_create: withDryRunHint(
    'Propose a new customer record for human approval (never executes; records one pending proposal). The tenant is checked for a duplicate e-mail, phone, UID, or name and postcode before the proposal is stored, and an exact e-mail or UID hit is refused with DUPLICATE_CUSTOMER so the agent can propose an update instead. Consent fields are rejected by the schema; consent stays human-only | DE: Schlägt einen neuen Kundenstammdatensatz zur menschlichen Freigabe vor (führt nie selbst aus; legt genau einen offenen Vorschlag an). Vor dem Speichern wird auf doppelte E-Mail, Telefon, UID oder Name und PLZ geprüft; ein exakter Treffer bei E-Mail oder UID wird mit DUPLICATE_CUSTOMER abgelehnt, damit stattdessen eine Änderung vorgeschlagen werden kann. Einwilligungsfelder werden vom Schema abgelehnt; Einwilligung bleibt ausschließlich menschlich',
  ),
  propose_customer_update: withDryRunHint(
    'Propose a change to the master data of an existing customer for human approval (never executes; records one pending proposal). Only the changed fields and the customer id are stored, and the approval re-checks that the customer still exists, that the e-mail is still free, and that the customer still has the values the proposal was based on. Consent fields are rejected by the schema; consent stays human-only | DE: Schlägt eine Änderung der Stammdaten eines bestehenden Kunden zur menschlichen Freigabe vor (führt nie selbst aus; legt genau einen offenen Vorschlag an). Es werden nur die geänderten Felder und die Kunden-ID gespeichert; bei der Freigabe wird erneut geprüft, ob der Kunde noch existiert, ob die E-Mail noch frei ist und ob der Kunde noch die Werte des Vorschlags hat. Einwilligungsfelder werden vom Schema abgelehnt; Einwilligung bleibt ausschließlich menschlich',
  ),
  propose_vehicle_create: withDryRunHint(
    'Propose a new vehicle master-data record for human approval (never executes; records one pending proposal). Validates VIN (17 chars) and normalizes plate; an exact VIN match is refused with DUPLICATE_VEHICLE, while normalized plate or same owner make/model/first registration matches return warnings and duplicate_candidates. Stock, sales, listing, valuation, and inspection fields are rejected by the schema | DE: Schlägt einen neuen Fahrzeugstammdatensatz zur menschlichen Freigabe vor (führt nie selbst aus; legt genau einen offenen Vorschlag an). Prüft die FIN/VIN (17 Zeichen) und normalisiert das Kennzeichen; ein exakter VIN-Treffer wird mit DUPLICATE_VEHICLE abgelehnt, während Treffer bei normalisiertem Kennzeichen oder gleicher Marke/Modell/Erstzulassung beim selben Halter Warnungen und duplicate_candidates liefern. Bestands-, Verkaufs-, Inserats-, Bewertungs- und Prüfungsfelder werden vom Schema abgelehnt',
  ),
  propose_vehicle_update: withDryRunHint(
    'Propose a change to the master data of an existing vehicle for human approval (never executes; records one pending proposal). Mileage may only increase unless reason is given (decrease is flagged as a warning in diff); approval re-validates VIN uniqueness and that the vehicle is unchanged since the proposal. Stock, sales, listing, valuation, and inspection fields are rejected by the schema | DE: Schlägt eine Änderung der Stammdaten eines bestehenden Fahrzeugs zur menschlichen Freigabe vor (führt nie selbst aus; legt genau einen offenen Vorschlag an). Der Kilometerstand darf nur erhöht werden, außer es wird ein Grund (reason) angegeben (Verringerung wird im Diff als Warnung markiert); bei der Freigabe wird erneut geprüft, ob die VIN eindeutig und das Fahrzeug unverändert ist. Bestands-, Verkaufs-, Inserats-, Bewertungs- und Prüfungsfelder werden vom Schema abgelehnt',
  ),
  generate_weekly_report_pdf: withDryRunHint(
    'Render the internal weekly report PDF for one ISO calendar week (Monday through Sunday in the site timezone) and return a short-lived read link. Does not archive the PDF or send anything externally',
  ),
};
