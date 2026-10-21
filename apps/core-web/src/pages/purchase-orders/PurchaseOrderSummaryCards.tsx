import { useTranslation } from "react-i18next";
import type { PurchaseOrder } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from '@/lib/format';

export function PurchaseOrderSummaryCards({
  po,
  unbilledCount,
}: {
  po: PurchaseOrder;
  unbilledCount: number;
}) {
  const { t } = useTranslation("finance");

  return (
    <div className="space-y-6 lg:col-span-1">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            {t("purchaseOrders.detail.purchaseOrder")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="text-muted-foreground">{t("purchaseOrders.detail.orderNumber")}</div>
            <div className="font-medium">{po.order_number}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("purchaseOrders.detail.created")}</div>
            <div className="font-medium">
              {formatDate(po.createdAt)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("columns.items")}</div>
            <div className="font-medium">{po.items.length}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("purchaseOrders.detail.unbilledReceipts")}</div>
            <div className="font-medium">{t("shared.itemsCount", { count: unbilledCount })}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("purchaseOrders.detail.vendorCard")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="font-medium">{po.vendor?.name}</div>
          {po.vendor?.email && (
            <div className="text-muted-foreground">{po.vendor.email}</div>
          )}
          {po.vendor?.account_number && (
            <div className="text-muted-foreground">
              {t("purchaseOrders.detail.account", { number: po.vendor.account_number })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
