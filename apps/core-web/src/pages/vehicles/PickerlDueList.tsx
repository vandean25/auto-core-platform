import type { components } from "@/api/generated/openapi";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ensureNamespaceLoaded } from "@/lib/i18n";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useDataTableQuery } from "@/hooks/useDataTableQuery";
import { StatusBadge } from "@/components/status/StatusBadge";
import { usePickerlDueList } from "@/api/vehicles";
import { triggerBlobDownload } from "@/lib/download";
import { fetchWithAuth } from "@/api/client";
import { RecordPickerlDialog } from "@/components/vehicles/RecordPickerlDialog";
import { WorkshopOrderIntakeDialog } from "@/components/workshop/WorkshopOrderIntakeDialog";
import { useAuthSession } from "@/api/auth-session";
import { canRecordVehicleInspection } from "@/components/vehicles/vehicle-pickerl-permissions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PickerlDueRow = {
  id: string;
  plate: string;
  vehicle: string;
  customer: string;
  dueMonth: string;
  status: string;
  lastInspection: string | null;
  phone: string;
  email: string;
  openPickerlOrder: { id: string; order_number: string } | null;
};

type QueryParamsType = {
  window?: 30 | 60 | 90;
  status?: string;
  page?: number;
  pageSize?: number;
};

const WINDOW_ALL = "ALL";
const STATUS_ALL = "ALL";

function upsertFilter(
  current: ColumnFiltersState,
  id: string,
  value: string | null,
): ColumnFiltersState {
  const next = current.filter((filter) => filter.id !== id);
  if (value) next.push({ id, value });
  return next;
}

function matchesClientSearch(row: PickerlDueRow, term: string): boolean {
  const haystack = [row.plate, row.vehicle, row.customer, row.phone, row.email]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

export default function PickerlDueList() {
  const { t } = useTranslation("vehicles");
  useEffect(() => {
    void ensureNamespaceLoaded("vehicles");
  }, []);
  const navigate = useNavigate();
  const emDash = t("shared.emDash");
  const sessionQuery = useAuthSession();
  const canManagePickerl = canRecordVehicleInspection(
    sessionQuery.data?.activeRole,
  );
  const {
    queryParams: tableQueryParams,
    columnFilters,
    setColumnFilters,
    setPagination,
    globalFilter,
    setGlobalFilter,
    ...tableState
  } = useDataTableQuery({ defaultPageSize: 25, initialSorting: [] });

  const queryParams: QueryParamsType = {
    page: tableQueryParams.page,
    pageSize: tableQueryParams.pageSize,
  };

  const windowFilter = columnFilters.find((f) => f.id === "window");
  if (windowFilter?.value) {
    queryParams.window = Number(windowFilter.value) as 30 | 60 | 90;
  }
  const statusFilter = columnFilters.find((f) => f.id === "status");
  if (statusFilter?.value) {
    queryParams.status = statusFilter.value as string;
  }

  const { data: responseData, isLoading } = usePickerlDueList(queryParams);

  const [recordPickerlVehicleId, setRecordPickerlVehicleId] = useState<
    string | null
  >(null);
  const [intakeVehicleId, setIntakeVehicleId] = useState<string | null>(null);
  const rows = useMemo<PickerlDueRow[]>(() => {
    const source = responseData?.data ?? [];
    return source.map((vehicle) => {
      const v = vehicle as components["schemas"]["VehicleResponseDto"] & {
        pickerl_due?: Record<string, unknown>;
      };
      const customer = v.customer;
      const customerName = customer
        ? customer.type === "COMPANY" && customer.company_name
          ? customer.company_name
          : `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
        : "";
      const pickerlDue = v.pickerl_due || {};
      const lastInspectedOn = (pickerlDue as Record<string, unknown>)
        .last_inspected_on as string | null | undefined;
      const lastInspectionDate = lastInspectedOn
        ? format(new Date(`${lastInspectedOn}T00:00:00.000Z`), "PP")
        : null;
      const dueMonthRaw = (pickerlDue as Record<string, unknown>).due_month as
        string | null | undefined;

      return {
        id: v.id,
        plate: v.plate || "",
        vehicle: `${v.make} ${v.model}`,
        customer: customerName,
        dueMonth: dueMonthRaw ? String(dueMonthRaw) : emDash,
        status:
          ((pickerlDue as Record<string, unknown>).status as string) ||
          "UNKNOWN",
        lastInspection: lastInspectionDate,
        phone: v.customer?.phone || "",
        email: v.customer?.email || "",
        openPickerlOrder: v.open_pickerl_order ?? null,
      };
    });
  }, [emDash, responseData?.data]);

  const filteredRows = useMemo(() => {
    const term = globalFilter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => matchesClientSearch(row, term));
  }, [rows, globalFilter]);

  const exportDueCsv = async () => {
    const searchParams = new URLSearchParams();
    if (queryParams.window)
      searchParams.set("window", queryParams.window.toString());
    if (queryParams.status)
      searchParams.set("status", queryParams.status as string);

    const response = await fetchWithAuth(
      `/api/vehicles/pickerl-due/export?${searchParams.toString()}`,
    );
    if (!response.ok) {
      toast.error(t("pickerlDue.exportFailed"));
      return;
    }
    const text = await response.text();
    const blob = new Blob([text], { type: "text/csv" });
    triggerBlobDownload(blob, "pickerl-due.csv");
  };

  const columns = useMemo<ColumnDef<PickerlDueRow>[]>(() => {
    return [
      {
        accessorKey: "plate",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.plate")} />
        ),
      },
      {
        accessorKey: "vehicle",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.vehicle")} />
        ),
      },
      {
        accessorKey: "customer",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.customer")} />
        ),
      },
      {
        accessorKey: "dueMonth",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.dueMonth")} />
        ),
      },
      {
        accessorKey: "status",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.status")} />
        ),
        cell: ({ row }) => (
          <StatusBadge
            status={
              row.original.status as "UNKNOWN" | "OK" | "DUE_SOON" | "OVERDUE"
            }
          />
        ),
      },
      {
        accessorKey: "lastInspection",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.lastInspection")} />
        ),
        cell: ({ row }) => row.original.lastInspection ?? emDash,
      },
      {
        accessorKey: "phone",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.phone")} />
        ),
      },
      {
        accessorKey: "email",
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("pickerlDue.columns.email")} />
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        cell: ({ row }) => {
          return (
            <div
              className="flex justify-end gap-2"
              role="presentation"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}
            >
              {canManagePickerl ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRecordPickerlVehicleId(row.original.id)}
                  >
                    {t("pickerlDue.recordPickerl")}
                  </Button>
                  {row.original.openPickerlOrder ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/workshop/orders/${row.original.openPickerlOrder?.id}`,
                        )
                      }
                    >
                      {t("pickerlDue.openOrder")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIntakeVehicleId(row.original.id)}
                    >
                      {t("pickerlDue.createOrder")}
                    </Button>
                  )}
                </>
              ) : null}
            </div>
          );
        },
      },
    ];
  }, [canManagePickerl, emDash, navigate, t]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("pickerlDue.title")}
          </h1>
          <p className="text-slate-500">{t("pickerlDue.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            className="min-h-11"
            onClick={() => void exportDueCsv()}
          >
            <Download className="mr-2 h-4 w-4" />
            {t("pickerlDue.exportCsv")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={queryParams.window ? String(queryParams.window) : WINDOW_ALL}
          onValueChange={(value) => {
            setColumnFilters((current) =>
              upsertFilter(
                current,
                "window",
                value === WINDOW_ALL ? null : value,
              ),
            );
            setPagination((current) => ({ ...current, pageIndex: 0 }));
          }}
        >
          <SelectTrigger aria-label={t("pickerlDue.windowAria")} className="w-[180px]">
            <SelectValue placeholder={t("pickerlDue.windowPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WINDOW_ALL}>{t("pickerlDue.windowAll")}</SelectItem>
            <SelectItem value="30">{t("pickerlDue.windowDays", { count: 30 })}</SelectItem>
            <SelectItem value="60">{t("pickerlDue.windowDays", { count: 60 })}</SelectItem>
            <SelectItem value="90">{t("pickerlDue.windowDays", { count: 90 })}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={queryParams.status ?? STATUS_ALL}
          onValueChange={(value) => {
            setColumnFilters((current) =>
              upsertFilter(
                current,
                "status",
                value === STATUS_ALL ? null : value,
              ),
            );
            setPagination((current) => ({ ...current, pageIndex: 0 }));
          }}
        >
          <SelectTrigger aria-label={t("pickerlDue.statusAria")} className="w-[180px]">
            <SelectValue placeholder={t("pickerlDue.statusPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>{t("pickerlDue.statusAll")}</SelectItem>
            <SelectItem value="OK">{t("pickerlDue.statusOk")}</SelectItem>
            <SelectItem value="DUE_SOON">{t("pickerlDue.statusDueSoon")}</SelectItem>
            <SelectItem value="OVERDUE">{t("pickerlDue.statusOverdue")}</SelectItem>
            <SelectItem value="UNKNOWN">{t("pickerlDue.statusUnknown")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={filteredRows}
        isLoading={isLoading}
        pageCount={responseData?.meta.pageCount ?? 0}
        enableCsvExport={false}
        rowBehaviour={{
          getRowAccessibleName: (row) => t('pickerlDue.vehicleRowAria', { plate: row.plate }),
          onRowClick: (row) => navigate(`/vehicles/${row.id}`),
        }}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        setPagination={setPagination}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        searchPlaceholder={t("pickerlDue.searchLoadedRows")}
        {...tableState}
      />

      {recordPickerlVehicleId && (
        <RecordPickerlDialog
          vehicleId={recordPickerlVehicleId}
          open={!!recordPickerlVehicleId}
          onOpenChange={(open) => !open && setRecordPickerlVehicleId(null)}
        />
      )}

      {intakeVehicleId && (
        <WorkshopOrderIntakeDialog
          open={!!intakeVehicleId}
          onOpenChange={(open) => !open && setIntakeVehicleId(null)}
          initialVehicleId={intakeVehicleId}
          pickerlMode
        />
      )}
    </div>
  );
}
