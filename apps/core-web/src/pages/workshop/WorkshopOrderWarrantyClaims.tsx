import { ArrowLeft, Plus } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { WarrantyClaimStatus } from "@/api/types";
import { useCreateWarrantyClaim, useWarrantyClaim, useWarrantyClaims } from "@/api/warranty-claims";
import { useWorkshopOrder } from "@/api/workshop";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WarrantyClaimEditor } from "@/features/workshop/warranty-claims/WarrantyClaimEditor";
import { WarrantyClaimList } from "@/features/workshop/warranty-claims/WarrantyClaimList";
import {
  WARRANTY_CLAIM_STATUS_FILTER_OPTIONS,
  warrantyClaimTypeLabel,
} from "@/features/workshop/warranty-claims/warranty-claim-form";
import { getErrorMessage } from "@/lib/error-utils";

const STATUS_PARAM = "status";
const CLAIM_PARAM = "claim";

export function WorkshopOrderWarrantyClaims() {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const orderQuery = useWorkshopOrder(id);
  const order = orderQuery.data;
  const claimsQuery = useWarrantyClaims(id);
  const createClaim = useCreateWarrantyClaim();

  const statusParam = searchParams.get(STATUS_PARAM);
  const statusFilter: WarrantyClaimStatus | "all" = WARRANTY_CLAIM_STATUS_FILTER_OPTIONS.some(
    (option) => option.value === statusParam,
  )
    ? (statusParam as WarrantyClaimStatus | "all")
    : "all";

  const allClaims = claimsQuery.data?.data ?? [];
  const visibleClaims =
    statusFilter === "all" ? allClaims : allClaims.filter((claim) => claim.status === statusFilter);
  const requestedClaimId = searchParams.get(CLAIM_PARAM);
  const activeClaimId =
    visibleClaims.find((claim) => claim.id === requestedClaimId)?.id ?? visibleClaims[0]?.id ?? null;
  const activeClaimQuery = useWarrantyClaim(id, activeClaimId);

  // A line can sit on one open claim at a time. Other open claims mark their lines as taken.
  const lineClaimedElsewhere = new Map<string, string>();
  for (const claim of allClaims) {
    if (claim.id === activeClaimId || claim.status === "CLOSED") continue;
    for (const line of claim.lines) {
      lineClaimedElsewhere.set(
        line.workshopTaskLineItemId,
        `${warrantyClaimTypeLabel(claim.type)} claim`,
      );
    }
  }

  const updateSearchParams = (updates: Record<string, string | null>) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const handleCreate = async () => {
    try {
      const created = await createClaim.mutateAsync({ orderId: id, payload: { type: "GARANTIE" } });
      // Clears the status filter too, so the new draft is visible in the list.
      updateSearchParams({ [STATUS_PARAM]: null, [CLAIM_PARAM]: created.id });
      toast.success("Warranty claim created");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to create the warranty claim"));
    }
  };

  if (orderQuery.isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading workshop order...</div>;
  }

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Workshop order not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">The selected workshop order does not exist.</p>
          <Button asChild>
            <Link to="/workshop/orders">Back to Workshop Orders</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const vehicleName = [order.vehicle?.make, order.vehicle?.model].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            to={`/workshop/orders/${id}`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to order
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Garantie/Kulanz</h1>
          <p className="text-slate-500">
            Order {order.order_number}
            {vehicleName ? ` · ${vehicleName}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void handleCreate()} disabled={createClaim.isPending}>
            <Plus className="h-4 w-4" aria-hidden />
            Warranty Claim
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              updateSearchParams({
                [STATUS_PARAM]: value === "all" ? null : value,
                [CLAIM_PARAM]: null,
              })
            }
          >
            <SelectTrigger aria-label="Filter claims by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WARRANTY_CLAIM_STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {claimsQuery.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {getErrorMessage(claimsQuery.error, "Failed to load warranty claims")}
            </p>
          ) : claimsQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading claims...</p>
          ) : (
            <WarrantyClaimList
              claims={visibleClaims}
              activeClaimId={activeClaimId}
              onSelect={(claimId) => updateSearchParams({ [CLAIM_PARAM]: claimId })}
            />
          )}
        </div>

        <div className="lg:col-span-2">
          {activeClaimQuery.data ? (
            <WarrantyClaimEditor
              key={`${activeClaimQuery.data.id}:${activeClaimQuery.data.status}`}
              orderId={id}
              orderNumber={order.order_number}
              claim={activeClaimQuery.data}
              tasks={order.tasks ?? []}
              lineClaimedElsewhere={lineClaimedElsewhere}
            />
          ) : activeClaimQuery.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {getErrorMessage(activeClaimQuery.error, "Failed to load the warranty claim")}
            </p>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-slate-500">
                Select a claim, or create one for this order.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkshopOrderWarrantyClaims;
