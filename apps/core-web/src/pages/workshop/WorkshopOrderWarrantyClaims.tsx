import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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
  WARRANTY_CLAIM_STATUS_FILTER_VALUES,
  warrantyClaimStatusFilterOptions,
  linesClaimedElsewhere,
} from "@/features/workshop/warranty-claims/warranty-claim-form";
import { getErrorMessage } from "@/lib/error-utils";

const STATUS_PARAM = "status";
const CLAIM_PARAM = "claim";

export function WorkshopOrderWarrantyClaims() {
  const { t } = useTranslation("workshop");
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const orderQuery = useWorkshopOrder(id);
  const order = orderQuery.data;
  const claimsQuery = useWarrantyClaims(id);
  const createClaim = useCreateWarrantyClaim();

  const statusParam = searchParams.get(STATUS_PARAM);
  const statusFilterOptions = warrantyClaimStatusFilterOptions();
  const statusFilter: WarrantyClaimStatus | "all" = WARRANTY_CLAIM_STATUS_FILTER_VALUES.some(
    (value) => value === statusParam,
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

  const lineClaimedElsewhere = linesClaimedElsewhere(allClaims, activeClaimId);

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

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleCreate = async () => {
    try {
      const created = await createClaim.mutateAsync({ orderId: id, payload: { type: "GARANTIE" } });
      if (isMounted.current) {
        updateSearchParams({ [STATUS_PARAM]: null, [CLAIM_PARAM]: created.id });
      }
      toast.success(t("warrantyClaimsPage.created"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("warrantyClaimsPage.createFailed")));
    }
  };

  if (orderQuery.isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{t("orderDetail.loading")}</div>;
  }

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("orderDetail.notFoundTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">{t("orderDetail.notFoundDescription")}</p>
          <Button asChild>
            <Link to="/workshop/orders">{t("orderDetail.backToOrders")}</Link>
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
            {t("warrantyClaimsPage.backToOrder")}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{t("warrantyClaimsPage.title")}</h1>
          <p className="text-slate-500">
            {t("warrantyClaimsPage.orderMeta", {
              orderNumber: order.order_number,
              vehicle: vehicleName ? ` · ${vehicleName}` : "",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void handleCreate()} disabled={createClaim.isPending}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("warrantyClaimsPage.create")}
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
            <SelectTrigger aria-label={t("warrantyClaimsPage.filterAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {claimsQuery.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {getErrorMessage(claimsQuery.error, t("warrantyClaimsPage.loadError"))}
            </p>
          ) : claimsQuery.isLoading ? (
            <p className="text-sm text-slate-500">{t("warrantyClaimsPage.loading")}</p>
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
              {getErrorMessage(activeClaimQuery.error, t("warrantyClaimsPage.claimLoadError"))}
            </p>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-slate-500">
                {t("warrantyClaimsPage.selectOrCreate")}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkshopOrderWarrantyClaims;
