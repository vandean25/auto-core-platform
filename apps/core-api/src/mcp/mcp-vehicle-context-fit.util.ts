import { keysetCursorOf } from './mcp-audit-read.mapper.js';
import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';
import { parseMcpDocumentId } from './mcp-document-read.mapper.js';
import {
  encodeMcpVehicleContextCursor,
  MCP_VEHICLE_CONTEXT_PAGINATED_SECTIONS,
  type McpVehicleContextPaginatedSection,
  type McpVehicleContextSection,
} from './mcp-vehicle-context.mapper.js';
import type { McpKeysetCursor } from './mcp-output.util.js';

export type VehicleContextPaginatedOkSection = {
  state: 'ok';
  data: unknown[];
  meta?: {
    total: number;
    page_size: number;
    next_cursor: string | null;
  };
  truncated?: boolean;
  incomplete?: boolean;
};

export type VehicleContextIdentityOkSection = {
  state: 'ok';
  data: Record<string, unknown>;
};

export type VehicleContextSectionUnavailable = {
  state: 'unavailable';
  reason: 'active_site_required';
  message: string;
};

export type VehicleContextSectionError = {
  state: 'error';
  message: string;
};

export type VehicleContextPaginatedSectionResult =
  | VehicleContextPaginatedOkSection
  | VehicleContextSectionUnavailable
  | VehicleContextSectionError;

type VehicleContextIdentitySectionResult =
  | VehicleContextIdentityOkSection
  | VehicleContextSectionUnavailable
  | VehicleContextSectionError;

export type VehicleContextSections = {
  [K in McpVehicleContextSection]?: K extends 'identity'
    ? VehicleContextIdentitySectionResult
    : VehicleContextPaginatedSectionResult;
};

export type VehicleContextPayload = {
  vehicle_id: string;
  as_of: string;
  disclaimer: string;
  site_id: string | null;
  sections: VehicleContextSections;
};

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

function isOkPaginatedSection(
  section: VehicleContextPaginatedSectionResult | undefined,
): section is VehicleContextPaginatedOkSection {
  return (
    section !== undefined &&
    section.state === 'ok' &&
    'data' in section &&
    Array.isArray(section.data)
  );
}

function keysetForRow(
  section: McpVehicleContextPaginatedSection,
  row: Record<string, unknown>,
): McpKeysetCursor | null {
  switch (section) {
    case 'inspections': {
      const id = row.id;
      const inspectedOn = row.inspected_on;
      if (typeof id !== 'string' || typeof inspectedOn !== 'string') {
        return null;
      }
      return keysetCursorOf(new Date(inspectedOn), id);
    }
    case 'open_workshop': {
      const id = row.id;
      const openedAt = row.opened_at;
      if (typeof id !== 'string' || typeof openedAt !== 'string') {
        return null;
      }
      return keysetCursorOf(new Date(openedAt), id);
    }
    case 'documents': {
      const id = row.id;
      const createdAt = row.created_at;
      if (typeof id !== 'string' || typeof createdAt !== 'string') {
        return null;
      }
      const parsed = parseMcpDocumentId(id);
      if (!parsed) {
        return null;
      }
      return keysetCursorOf(new Date(createdAt), parsed.recordId);
    }
    case 'warranty_claims': {
      const id = row.id;
      const createdAt = row.created_at;
      if (typeof id !== 'string' || typeof createdAt !== 'string') {
        return null;
      }
      return keysetCursorOf(new Date(createdAt), id);
    }
    case 'warranty_periods': {
      const id = row.vehicle_sale_id;
      const createdAt = row.created_at;
      if (typeof id !== 'string' || typeof createdAt !== 'string') {
        return null;
      }
      return keysetCursorOf(new Date(createdAt), id);
    }
    default:
      return null;
  }
}

function trimSectionRow(
  section: VehicleContextPaginatedOkSection,
  sectionName: McpVehicleContextPaginatedSection,
) {
  if (!Array.isArray(section.data) || section.data.length === 0) {
    return false;
  }
  section.data = section.data.slice(0, -1);
  section.truncated = true;
  section.incomplete = true;
  const last = section.data.at(-1) as Record<string, unknown> | undefined;
  if (!last || !section.meta) {
    if (section.meta) {
      section.meta.next_cursor = null;
    }
    return true;
  }
  const keyset = keysetForRow(sectionName, last);
  section.meta.next_cursor = keyset
    ? encodeMcpVehicleContextCursor({ section: sectionName, keyset })
    : null;
  return true;
}

/**
 * Drops trailing rows from paginated sections until the full payload fits the MCP
 * byte cap, preserving per-section next_cursor values from the last kept row.
 */
export function fitVehicleContextPayloadToCap(
  payload: VehicleContextPayload,
  maxBytes: number = MCP_TOOL_RESULT_MAX_BYTES,
): VehicleContextPayload {
  const result: VehicleContextPayload = structuredClone(payload);
  if (serializedBytes(result) <= maxBytes) {
    return result;
  }

  while (serializedBytes(result) > maxBytes) {
    let trimmed = false;
    let largestSection: McpVehicleContextPaginatedSection | null = null;
    let largestLength = 0;
    for (const sectionName of MCP_VEHICLE_CONTEXT_PAGINATED_SECTIONS) {
      const section = result.sections[sectionName];
      if (!isOkPaginatedSection(section)) {
        continue;
      }
      if (section.data.length > largestLength) {
        largestLength = section.data.length;
        largestSection = sectionName;
      }
    }
    if (largestSection && largestLength > 0) {
      const section = result.sections[
        largestSection
      ] as VehicleContextPaginatedOkSection;
      trimmed = trimSectionRow(section, largestSection);
    }
    if (!trimmed) {
      break;
    }
  }
  return result;
}
