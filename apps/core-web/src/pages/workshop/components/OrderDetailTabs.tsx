import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

type OrderDetailTabsProps = {
  orderId: string;
};

export function OrderDetailTabs({ orderId }: OrderDetailTabsProps) {
  const orderPath = `/workshop/orders/${orderId}`;
  const tabs = [
    { label: "Order", to: orderPath, end: true },
    { label: "Garantie/Kulanz", to: `${orderPath}/garantie-kulanz`, end: false },
  ];

  return (
    <nav aria-label="Workshop order sections" className="flex gap-1 border-b border-slate-200">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
