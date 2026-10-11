import type { WarrantyClaim } from "@/api/types";
import { StatusBadge } from "@/components/status/StatusBadge";
import { cn } from "@/lib/utils";
import { formatEur, warrantyClaimTypeLabel } from "./warranty-claim-form";

type WarrantyClaimListProps = {
  claims: WarrantyClaim[];
  activeClaimId: string | null;
  onSelect: (claimId: string) => void;
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("de-AT");
}

export function WarrantyClaimList({ claims, activeClaimId, onSelect }: WarrantyClaimListProps) {
  if (claims.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
        No warranty or goodwill claims on this order yet.
      </p>
    );
  }

  return (
    <ul aria-label="Warranty claims" className="divide-y rounded-lg border bg-white">
      {claims.map((claim) => {
        const isActive = claim.id === activeClaimId;
        return (
          <li key={claim.id}>
            <button
              type="button"
              onClick={() => onSelect(claim.id)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                isActive && "bg-slate-100",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{warrantyClaimTypeLabel(claim.type)}</span>
                <StatusBadge status={claim.status} />
              </span>
              <span className="flex items-center justify-between gap-2 text-sm text-slate-500">
                <span className="tabular-nums">{formatEur(claim.claimedAmountNet)}</span>
                <span>Updated {formatDay(claim.updatedAt)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
