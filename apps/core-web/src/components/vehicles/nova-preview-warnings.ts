const NOVA_WARNING_LABELS: Record<string, string> = {
  wertentwicklung_not_applied:
    'Wertentwicklung wird in dieser Vorschau nicht angewendet.',
  eu_import_tariff_hint:
    'Historischer EU-Importtarif zur Erstzulassung ist in dieser Vorschau nicht enthalten.',
  nedc_fractional_co2_unverified:
    'CO₂-Rundung (NEDC) ist noch nicht durch den Steuerberater bestätigt.',
  fractional_co2_unverified:
    'CO₂-Rundung ist noch nicht durch den Steuerberater bestätigt.',
  phev_weighted_wltp: 'PHEV: gewichteter WLTP-Wert wird in der Vorschau verwendet.',
  tariff_outside_taxable_event_date:
    'Tarif liegt außerhalb des steuerlichen Ereignisses.',
  tariff_outside_registration_date:
    'Tarif liegt außerhalb des Erstzulassungsdatums.',
}

export function formatNovaPreviewWarning(warning: string): string {
  return NOVA_WARNING_LABELS[warning] ?? warning
}
