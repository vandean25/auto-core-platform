/** Document kinds the MCP reads list. Each one is a stored PDF on a site-owned row. */
export const MCP_DOCUMENT_TYPES = [
  'invoice',
  'credit_note',
  'workshop_order',
  'vehicle_sale_contract',
] as const;

export type McpDocumentType = (typeof MCP_DOCUMENT_TYPES)[number];

/** The record a document was generated from. */
export type McpDocumentOwnerType =
  'invoice' | 'credit_note' | 'workshop_order' | 'vehicle_sale';

/** Filters for list_documents: an owner record, or a customer or vehicle whose documents are listed. */
export const MCP_DOCUMENT_ENTITY_TYPES = [
  'customer',
  'vehicle',
  'invoice',
  'credit_note',
  'workshop_order',
  'vehicle_sale',
] as const;

export type McpDocumentEntityType = (typeof MCP_DOCUMENT_ENTITY_TYPES)[number];

const OWNER_OF_DOCUMENT: Record<McpDocumentType, McpDocumentOwnerType> = {
  invoice: 'invoice',
  credit_note: 'credit_note',
  workshop_order: 'workshop_order',
  vehicle_sale_contract: 'vehicle_sale',
};

const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DOCUMENT_ID_PATTERN = new RegExp(
  `^(${MCP_DOCUMENT_TYPES.join('|')}):(${UUID_SOURCE})$`,
  'i',
);

/** Document IDs are the document type, a colon, and the owner record UUID, as list_documents returns them. */
export type ParsedMcpDocumentId = {
  type: McpDocumentType;
  recordId: string;
};

export function isMcpDocumentId(value: string): boolean {
  return DOCUMENT_ID_PATTERN.test(value);
}

export function parseMcpDocumentId(value: string): ParsedMcpDocumentId | null {
  const match = DOCUMENT_ID_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return {
    type: match[1] as McpDocumentType,
    recordId: match[2].toLowerCase(),
  };
}

export function mcpDocumentId(type: McpDocumentType, recordId: string): string {
  return `${type}:${recordId}`;
}

/** The record a PDF belongs to, carried through the list and link reads before mapping. */
export type McpDocumentCandidate = {
  type: McpDocumentType;
  recordId: string;
  createdAt: Date;
  name: string;
};

/**
 * File name for a document. These match the names the REST PDF downloads send,
 * so a file saved from the MCP link carries the same name as one saved from the app.
 */
export function mcpDocumentFileName(
  type: McpDocumentType,
  number: string | null,
  recordId: string,
): string {
  const label = number ?? recordId;
  switch (type) {
    case 'invoice':
      return `invoice-${label}.pdf`;
    case 'credit_note':
      return `credit-note-${label}.pdf`;
    case 'workshop_order':
      return `job-card-${label}.pdf`;
    case 'vehicle_sale_contract':
      return `kaufvertrag-${label.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;
  }
}

export function toMcpDocumentRow(candidate: McpDocumentCandidate) {
  return {
    id: mcpDocumentId(candidate.type, candidate.recordId),
    type: candidate.type,
    name: candidate.name,
    created_at: candidate.createdAt.toISOString(),
    entity: {
      type: OWNER_OF_DOCUMENT[candidate.type],
      id: candidate.recordId,
    },
  };
}

export type McpDocumentPdf = ReturnType<typeof toMcpDocumentRow> & {
  content_type: 'application/pdf';
  link: { url: string; expires_at: string };
};

/** Metadata plus a short-lived read link. The PDF bytes never leave the server. */
export function toMcpDocumentPdf(
  candidate: McpDocumentCandidate,
  link: { url: string; expiresAt: Date },
): McpDocumentPdf {
  return {
    ...toMcpDocumentRow(candidate),
    content_type: 'application/pdf',
    link: { url: link.url, expires_at: link.expiresAt.toISOString() },
  };
}

/**
 * Action log summary for a document link. It records which document was opened
 * and when the link expires. The URL is a bearer credential, so it is never stored.
 */
export function summarizeMcpDocumentPdfForLog(result: unknown) {
  const pdf = result as Partial<McpDocumentPdf> | undefined;
  if (!pdf?.id || !pdf.type || !pdf.entity || !pdf.link) {
    return null;
  }
  return {
    document_id: pdf.id,
    document_type: pdf.type,
    entity: pdf.entity,
    link_expires_at: pdf.link.expires_at,
  };
}
