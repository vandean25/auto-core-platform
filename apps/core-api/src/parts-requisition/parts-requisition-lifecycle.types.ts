import {
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
  WorkshopOrderStatus,
} from '@prisma/client';

export const OPEN_WORKSHOP_ORDER_STATUSES = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
] as const;

export const REQUISITION_SLICE_STATUSES = [
  PartsReservationStatus.OPEN,
  PartsReservationStatus.ORDERED,
] as const;

export const ZERO = new Prisma.Decimal(0);

export type ReservationRow = {
  id: string;
  tenant_id: string;
  workshop_task_line_item_id: string;
  quantity: Prisma.Decimal;
  quantity_received?: Prisma.Decimal;
  quantity_consumed: Prisma.Decimal;
  quantity_staged: Prisma.Decimal;
  quantity_returned: Prisma.Decimal;
  kind: PartsReservationKind;
  status: PartsReservationStatus;
  location_id?: string | null;
  tote_cost_basis?: Prisma.Decimal | null;
  purchase_order_item_id?: string | null;
  requisition_line_id?: string | null;
  requisition_line?: { requisition_id: string } | null;
  detached_at?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ShortageLine = {
  id: string;
  workshop_task_id: string;
  item_no: string;
  description: string;
  quantity: Prisma.Decimal;
  parts_reservations: Array<{
    quantity: Prisma.Decimal;
    quantity_consumed: Prisma.Decimal;
    quantity_staged: Prisma.Decimal;
    quantity_returned: Prisma.Decimal;
    status: PartsReservationStatus;
  }>;
  workshop_task: {
    id: string;
    workshop_order: {
      id: string;
      order_number: string;
      site_id: string;
      vehicle: {
        make: string;
        make_brand_id: number | null;
      };
    };
  };
};

export type RequisitionCandidateLine = {
  id: string;
  workshop_task_id: string;
  quantity: Prisma.Decimal;
  workshop_task: {
    workshop_order: {
      id: string;
      order_number: string;
      vehicle: { make_brand_id: number | null };
    };
  };
};

export type RequisitionDetailLine = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  reservation: {
    id: string;
    workshop_task_line_item_id: string;
    quantity: Prisma.Decimal;
    status: PartsReservationStatus;
    purchase_order_item_id: string | null;
    createdAt: Date;
    updatedAt: Date;
    workshop_task_line_item: {
      item_no: string;
      description: string;
      workshop_task: {
        workshop_order: { id: string; order_number: string };
      };
    };
  } | null;
};

export type RequisitionDetail = {
  id: string;
  tenant_id: string;
  vehicle_make_brand_id: number;
  status: PartsRequisitionStatus;
  createdAt: Date;
  updatedAt: Date;
  lines: RequisitionDetailLine[];
};

export type RequisitionCatalogItemWithBrand = {
  id: string;
  brand_id: number | null;
  brand: { id: number; name: string } | null;
};
