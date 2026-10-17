import { Outlet, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useWorkshopOrder } from "@/api/workshop";
import { OrderDetailTabs } from "./components/OrderDetailTabs";
import { usePageBreadcrumbs } from "@/hooks/usePageBreadcrumbs";
import { APP_ROUTE_PATHS } from "@/lib/app-route-paths";

/** Frame for one workshop order: the Order and Garantie/Kulanz tabs sit above the page. */
export function WorkshopOrderLayout() {
  const { t } = useTranslation("workshop");
  const { id = "" } = useParams<{ id: string }>();
  const { data: order } = useWorkshopOrder(id);
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.workshopOrders,
    currentLabel: order?.order_number ?? t("orderDetail.breadcrumbFallback"),
  });
  return (
    <div className="space-y-6">
      <OrderDetailTabs orderId={id} />
      <Outlet />
    </div>
  );
}

export default WorkshopOrderLayout;
