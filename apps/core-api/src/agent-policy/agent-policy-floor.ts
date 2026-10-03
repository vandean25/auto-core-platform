/**
 * Hard-coded HUMAN_ONLY floors. These categories always require a human,
 * regardless of platform or tenant policy table content.
 */
const HUMAN_ONLY_FLOOR_ACTION_TYPES = new Set([
  'invoice.finalize',
  'credit_note.issue',
  'credit_note.finalize',
  'tax_vat.update_wording',
  'accounting_export.create',
  'accounting_export.submit',
  'customer.delete',
  'vehicle.delete',
  'workshop_order.delete',
  'tenant_member.role_change',
  'tenant_member.invite',
  'consent.update',
  'consent.revoke',
]);

const HUMAN_ONLY_FLOOR_PREFIXES = [
  'credit_note.',
  'accounting_export.',
  'consent.',
  'invoice.finalize',
] as const;

function matchesTaxOrVatWording(actionType: string): boolean {
  const lower = actionType.toLowerCase();
  const mentionsWording = lower.includes('wording');
  if (!mentionsWording) {
    return false;
  }
  return lower.includes('tax') || lower.includes('vat');
}

function matchesUserOrRoleChange(actionType: string): boolean {
  const lower = actionType.toLowerCase();
  return lower.includes('role_change') || lower.includes('role_update');
}

export function isHumanOnlyFloorAction(actionType: string): boolean {
  const normalized = actionType.trim();
  if (!normalized) {
    return false;
  }

  if (HUMAN_ONLY_FLOOR_ACTION_TYPES.has(normalized)) {
    return true;
  }

  if (
    HUMAN_ONLY_FLOOR_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return true;
  }

  if (normalized.endsWith('.delete')) {
    return true;
  }

  if (matchesTaxOrVatWording(normalized)) {
    return true;
  }

  if (matchesUserOrRoleChange(normalized)) {
    return true;
  }

  return false;
}
