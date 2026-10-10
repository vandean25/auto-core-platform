import { Outlet, useParams } from "react-router-dom";
import { OrderDetailTabs } from "./components/OrderDetailTabs";

/** Frame for one workshop order: the Order and Garantie/Kulanz tabs sit above the page. */
export function WorkshopOrderLayout() {
  const { id = "" } = useParams<{ id: string }>();
  return (
    <div className="space-y-6">
      <OrderDetailTabs orderId={id} />
      <Outlet />
    </div>
  );
}

export default WorkshopOrderLayout;
