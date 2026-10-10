import type { Prisma } from '@prisma/client';
import type {
  WorkshopEstimateDraftPreviewDto,
  WorkshopEstimateOverrunWarningDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateSnapshotDto,
  WorkshopEstimateVersionDetailDto,
  WorkshopEstimateVersionSummaryDto,
} from './dto/workshop-estimate-response.dto.js';
import type { WorkshopEstimateLine } from './workshop-estimate-lines.helpers.js';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';

export const WORKSHOP_ESTIMATE_VERSION_SUMMARY_SELECT = {
  id: true,
  version: true,
  status: true,
  sent_at: true,
  valid_from: true,
  valid_until: true,
  total_net: true,
  total_tax: true,
  total_gross: true,
  snapshot_sha256: true,
  legal_text_version: true,
  retain_until: true,
  legal_hold: true,
} satisfies Prisma.WorkshopEstimateVersionSelect;

export type WorkshopEstimateVersionSummaryRow =
  Prisma.WorkshopEstimateVersionGetPayload<{
    select: typeof WORKSHOP_ESTIMATE_VERSION_SUMMARY_SELECT;
  }>;

type Totals = {
  total_net: string;
  total_tax: string;
  total_gross: string;
  tax_breakdown: Array<{
    rate: string;
    net: string;
    tax: string;
    gross: string;
  }>;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toMoney(value: Prisma.Decimal | null): string | null {
  return value ? value.toFixed(2) : null;
}

export function toWorkshopEstimateVersionSummaryDto(
  row: WorkshopEstimateVersionSummaryRow,
): WorkshopEstimateVersionSummaryDto {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    sent_at: toIso(row.sent_at),
    valid_from: toIso(row.valid_from),
    valid_until: toIso(row.valid_until),
    total_net: toMoney(row.total_net),
    total_tax: toMoney(row.total_tax),
    total_gross: toMoney(row.total_gross),
    snapshot_sha256: row.snapshot_sha256,
    legal_text_version: row.legal_text_version,
    retain_until: toIso(row.retain_until),
    legal_hold: row.legal_hold,
  };
}

export function toWorkshopEstimateOverrunDto(
  warning: WorkshopEstimateOverrunWarning | null,
): WorkshopEstimateOverrunWarningDto | null {
  return warning;
}

export function toWorkshopEstimateDto(params: {
  estimate: {
    id: string;
    workshop_order_id: string;
    estimate_number: string;
    year: number;
    createdAt: Date;
    versions: WorkshopEstimateVersionSummaryRow[];
  };
  overrun: WorkshopEstimateOverrunWarning | null;
  sendEnabled: boolean;
  thresholdPct: string;
}): WorkshopEstimateResponseDto {
  return {
    id: params.estimate.id,
    workshop_order_id: params.estimate.workshop_order_id,
    estimate_number: params.estimate.estimate_number,
    year: params.estimate.year,
    created_at: params.estimate.createdAt.toISOString(),
    versions: params.estimate.versions.map(toWorkshopEstimateVersionSummaryDto),
    overrun_warning: toWorkshopEstimateOverrunDto(params.overrun),
    send_enabled: params.sendEnabled,
    overrun_threshold_pct: params.thresholdPct,
  };
}

export function toWorkshopEstimateDraftPreviewDto(
  lines: WorkshopEstimateLine[],
  totals: Totals,
): WorkshopEstimateDraftPreviewDto {
  return { lines, totals };
}

export function toWorkshopEstimateVersionDetailDto(params: {
  version: WorkshopEstimateVersionSummaryRow & {
    status: WorkshopEstimateVersionSummaryRow['status'];
    snapshot: Prisma.JsonValue | null;
  };
  estimate: { id: string; estimate_number: string; workshop_order_id: string };
  draftPreview: WorkshopEstimateDraftPreviewDto | null;
}): WorkshopEstimateVersionDetailDto {
  return {
    ...toWorkshopEstimateVersionSummaryDto(params.version),
    estimate_id: params.estimate.id,
    estimate_number: params.estimate.estimate_number,
    workshop_order_id: params.estimate.workshop_order_id,
    snapshot: params.version
      .snapshot as unknown as WorkshopEstimateSnapshotDto | null,
    draft_preview: params.draftPreview,
  };
}
