/**
 * The approval link is the one secret a customer message carries: its token sits in the path (ADR-0025 §7).
 * A row in a terminal state needs its words for the record but not the link, so the stored body keeps the
 * text and loses the link. The link is redacted at the terminal write, never while a retry still needs it.
 */
const APPROVAL_LINK_PATTERN = /https:\/\/\S+\/approve\/\S+/g;

export const REDACTED_APPROVAL_LINK = '[Link entfernt]';

export function redactApprovalLinks(body: string): string;
export function redactApprovalLinks(body: string | null): string | null;
export function redactApprovalLinks(body: string | null): string | null {
  if (body === null) {
    return null;
  }
  return body.replace(APPROVAL_LINK_PATTERN, REDACTED_APPROVAL_LINK);
}
