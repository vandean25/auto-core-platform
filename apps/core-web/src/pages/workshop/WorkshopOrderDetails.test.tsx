import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
  act,
} from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkshopOrderDetails } from "./WorkshopOrderDetails";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as workshopApi from "@/api/workshop";
import * as salesApi from "@/api/sales";
import * as invoicesApi from "@/api/invoices";
import * as vehicleInspectionApi from "@/api/vehicle-inspection-records";
import * as authSessionApi from "@/api/auth-session";
import * as estimateApi from "@/api/workshop-estimates";
import * as vehiclesApi from "@/api/vehicles";
import * as catalogSettingsApi from "@/api/useCatalogProviderSettings";
import { getCatalogSourceBannerCopy } from "@/features/workshop/catalog-source-copy";
import { toast } from "sonner";
import { formattedCurrencyPattern } from "@/test/format-assertions";
import { deWorkshop } from "@/test/de-workshop";
import { fetchWithAuth } from "@/api/client";

vi.mock("@/api/client", () => ({
  API_BASE_URL: "http://127.0.0.1:3000",
  fetchWithAuth: vi.fn(),
}));

const taskListCopy = deWorkshop.taskList;
const checkoutCopy = deWorkshop.checkout;
const checkoutSummaryCopy = deWorkshop.checkoutSummary;
const orderHeaderCopy = deWorkshop.orderHeader;
const orderDetailToast = deWorkshop.orderDetail.toast;

vi.mock("@/api/workshop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/workshop")>();
  return {
    ...actual,
    useWorkshopOrder: vi.fn(),
    useUpdateWorkshopOrder: vi.fn(),
    useCreateWorkshopTask: vi.fn(),
    useDeleteWorkshopTask: vi.fn(),
    useUpdateWorkshopTask: vi.fn(),
    useReplaceWorkshopTaskLineItems: vi.fn(),
    useCatalogSearch: vi.fn(),
    useWorkshopResources: vi.fn(),
    useAssignBoard: vi.fn(),
    useGenerateWorkshopPdf: vi.fn(),
    downloadWorkshopPdf: vi.fn(),
  };
});
vi.mock("@/api/vehicles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/vehicles")>();
  return {
    ...actual,
    useVehicle: vi.fn(actual.useVehicle),
    useResolveVehicleIdentity: vi.fn(actual.useResolveVehicleIdentity),
  };
});
vi.mock("@/api/useCatalogProviderSettings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/api/useCatalogProviderSettings")>();
  return {
    ...actual,
    useCatalogProviderSettings: vi.fn(actual.useCatalogProviderSettings),
  };
});
const fitmentModal = vi.hoisted(() => ({
  props: null as null | Record<string, (...args: never[]) => void> &
    Record<string, unknown>,
}));
vi.mock("@/components/workshop/FitmentSearchModal", () => ({
  FitmentSearchModal: (props: NonNullable<typeof fitmentModal.props>) => {
    fitmentModal.props = props;
    return <div data-testid="fitment-modal" />;
  },
}));
vi.mock("@/api/sales");
vi.mock("@/api/invoices");
vi.mock("@/api/vehicle-inspection-records");
vi.mock("@/api/auth-session");
vi.mock("@/api/workshop-estimates");
vi.mock("@/api/inventory");
vi.mock("@/api/workshop-communications", () => ({
  useWorkshopOrderCommunications: vi.fn(() => ({
    isPending: false,
    isError: false,
    data: [],
    refetch: vi.fn(),
  })),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn().mockReturnValue("toast-id"),
  },
}));

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const baseOrder = {
  id: "order-1",
  order_number: "WO-001",
  status: "IN_PROGRESS" as const,
  purpose: "CUSTOMER_REPAIR" as const,
  customer_id: "cust-1",
  customer: {
    id: "cust-1",
    first_name: "John",
    last_name: "Doe",
    type: "PRIVATE" as const,
    email: "john@example.com",
    phone: "123456789",
  },
  vehicle_id: "veh-1",
  vehicle: {
    id: "veh-1",
    year: 2020,
    make: "Toyota",
    model: "Corolla",
    vin: "VIN123",
    plate: "ABC-123",
  },
  odometer: 85000,
  fuel_level: 75,
  reportedIssue: "Strange noise from engine",
  notes: "Customer waiting in lobby",
  tasks: [
    {
      id: "task-1",
      title: "Oil Change",
      status: "IN_PROGRESS" as const,
      done: false,
      mechanicNotes: "",
      lineItems: [
        {
          id: "line-1",
          type: "PART" as const,
          itemNo: "OIL-FLTR",
          description: "Oil Filter",
          qty: 1,
          unitPrice: 15,
        },
        {
          id: "line-2",
          type: "LABOR" as const,
          itemNo: "LAB-01",
          description: "Oil change labor",
          qty: 0.5,
          unitPrice: 80,
        },
      ],
    },
  ],
  invoice: null,
  createdAt: "2026-01-15T10:30:00Z",
};

const companyOrder = {
  ...baseOrder,
  customer: {
    ...baseOrder.customer,
    type: "COMPANY" as const,
    company_name: "AutoMax GmbH",
  },
};

const completedOrder = { ...baseOrder, status: "COMPLETED" as const };

const invoicedOrder = {
  ...baseOrder,
  status: "INVOICED" as const,
  invoice: {
    id: "inv-1",
    invoice_number: "RE-2026-0001",
    status: "ISSUED" as const,
    customer_id: "cust-1",
    customer: baseOrder.customer,
    date: "2026-01-15",
    due_date: "2026-02-15",
    total_net: "55.00",
    total_tax: "0.00",
    total_gross: "55.00",
    items: [],
  },
};

const multiTaskOrder = {
  ...baseOrder,
  status: "COMPLETED" as const,
  tasks: [
    ...baseOrder.tasks,
    {
      id: "task-2",
      title: "Brake Inspection",
      status: "DONE" as const,
      done: true,
      mechanicNotes: "Pads at 30%",
      lineItems: [
        {
          id: "line-3",
          type: "PART" as const,
          itemNo: "BRK-PAD",
          description: "Brake Pads",
          qty: 2,
          unitPrice: 50,
        },
      ],
    },
  ],
};

// --------------------------------------------------------------------------
// Mock helpers
// --------------------------------------------------------------------------

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>;

function createMutationMock(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    ...overrides,
  };
}

function setupDefaultMocks(orderOverride?: unknown) {
  asMock(workshopApi.useWorkshopOrder).mockReturnValue({
    data: orderOverride ?? baseOrder,
    isLoading: false,
  });
  asMock(salesApi.useInvoice).mockReturnValue({ data: null, isLoading: false });
  asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
    createMutationMock(),
  );
  asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(
    createMutationMock(),
  );
  asMock(workshopApi.useDeleteWorkshopTask).mockReturnValue(
    createMutationMock(),
  );
  asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
    createMutationMock(),
  );
  asMock(workshopApi.useReplaceWorkshopTaskLineItems).mockReturnValue(
    createMutationMock(),
  );
  asMock(invoicesApi.useCreateDraftInvoice).mockReturnValue(
    createMutationMock(),
  );
  asMock(invoicesApi.useIssueInvoice).mockReturnValue(createMutationMock());
  asMock(invoicesApi.useUpdateInvoiceDiscount).mockReturnValue(
    createMutationMock(),
  );
  asMock(workshopApi.useCatalogSearch).mockReturnValue({
    data: [],
    isFetching: false,
  });
  asMock(workshopApi.useWorkshopResources).mockReturnValue({
    data: { mechanics: [], bays: [] },
    isLoading: false,
  });
  asMock(workshopApi.useAssignBoard).mockReturnValue(createMutationMock());
  asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(
    createMutationMock(),
  );
  asMock(workshopApi.downloadWorkshopPdf).mockResolvedValue(new Blob());
  asMock(estimateApi.useWorkshopOrderEstimate).mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  });
  asMock(estimateApi.useWorkshopEstimateVersion).mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  asMock(estimateApi.useCreateWorkshopEstimate).mockReturnValue(
    createMutationMock(),
  );
  asMock(estimateApi.useReviseWorkshopEstimate).mockReturnValue(
    createMutationMock(),
  );
  asMock(estimateApi.useSendWorkshopEstimateVersion).mockReturnValue(
    createMutationMock(),
  );
}

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe("WorkshopOrderDetails Characterization", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    asMock(
      vehicleInspectionApi.useCreateVehicleInspectionRecord,
    ).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    setupDefaultMocks();
    asMock(authSessionApi.useAuthSession).mockReturnValue({
      data: { activeRole: "SALES" },
    });
  });
  asMock(vehicleInspectionApi.useVehicleInspectionRecords).mockReturnValue({
    data: [],
    isLoading: false,
  });
  asMock(authSessionApi.useAuthSession).mockReturnValue({
    data: { activeRole: "SALES" },
  });

  afterEach(() => {
    cleanup();
  });

  describe("communication timeline", () => {
    it("is shown beside the estimate card to an estimate role", async () => {
      asMock(authSessionApi.useAuthSession).mockReturnValue({
        data: { activeRole: "SALES" },
      });

      renderComponent();

      await waitFor(() => expect(screen.getAllByText("Oil Change").length).toBeGreaterThan(0));
      expect(screen.getByRole("heading", { name: "Kostenvoranschlag" })).toBeInTheDocument();
      expect(screen.getByText("Kommunikation mit dem Kunden")).toBeInTheDocument();
    });

    it("is hidden from a technician session, together with the estimate card", async () => {
      asMock(authSessionApi.useAuthSession).mockReturnValue({
        data: { activeRole: "TECH" },
      });

      renderComponent();

      await waitFor(() => expect(screen.getAllByText("Oil Change").length).toBeGreaterThan(0));
      expect(screen.queryByRole("heading", { name: "Kostenvoranschlag" })).not.toBeInTheDocument();
      expect(screen.queryByText("Kommunikation mit dem Kunden")).not.toBeInTheDocument();
    });
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workshop/orders/order-1"]}>
          <Routes>
            <Route
              path="/workshop/orders/:id"
              element={<WorkshopOrderDetails />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  // =====================================================================
  // P0: Loading & Not-Found States
  // =====================================================================

  describe("loading and error states", () => {
    it("renders loading indicator while fetching", () => {
      asMock(workshopApi.useWorkshopOrder).mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      renderComponent();

      expect(screen.getByText("Werkstattauftrag wird geladen…")).toBeInTheDocument();
    });

    it("renders not-found card when order is null", () => {
      asMock(workshopApi.useWorkshopOrder).mockReturnValue({
        data: null,
        isLoading: false,
      });

      renderComponent();

      expect(screen.getByText("Werkstattauftrag nicht gefunden")).toBeInTheDocument();
      expect(
        screen.getByText("Der gewählte Werkstattauftrag existiert nicht."),
      ).toBeInTheDocument();
      expect(screen.getByText("Zurück zu Werkstattaufträgen")).toBeInTheDocument();
    });
  });

  // =====================================================================
  // P0: Standard View — Rendering Characterization
  // =====================================================================

  describe("standard view rendering", () => {
    it("renders order number and status badge", () => {
      renderComponent();

      expect(screen.getByText("WO-001")).toBeInTheDocument();
    });

    it("shows customer, vehicle, and plate in the header", () => {
      renderComponent();

      const header = screen.getByRole("banner");

      expect(
        within(header).getByRole("heading", { name: "WO-001" }),
      ).toBeInTheDocument();
      expect(within(header).getByText(/John Doe/)).toBeInTheDocument();
      expect(
        within(header).getByText(/2020 Toyota Corolla/),
      ).toBeInTheDocument();
      expect(within(header).getByText(/ABC-123/)).toBeInTheDocument();
    });

    it("shows promised time as Not set and does not render Waiter or KPI labels", () => {
      renderComponent();

      const header = screen.getByRole("banner");

      expect(
        within(header).getByText(/Zugesagter Termin: Nicht gesetzt/),
      ).toBeInTheDocument();
      expect(screen.queryByText("Waiter")).not.toBeInTheDocument();
      expect(screen.queryByText("Total Parts")).not.toBeInTheDocument();
      expect(screen.queryByText("Labor Revenue")).not.toBeInTheDocument();
      expect(screen.queryByText("Internal Labor Cost")).not.toBeInTheDocument();
      expect(screen.queryByText("Est. Margin")).not.toBeInTheDocument();
    });

    it("shows loaner booking chip when order has loaner summary", () => {
      setupDefaultMocks({
        ...baseOrder,
        loanerBooking: {
          id: "loaner-booking-1",
          status: "HANDED_OVER",
          plannedFrom: "2026-10-01T08:00:00.000Z",
          plannedTo: "2026-10-05T18:00:00.000Z",
          loanerVehicleId: "loaner-veh-1",
          displayName: "Golf Ersatz",
          vehicleMake: "VW",
          vehicleModel: "Golf",
          vehiclePlate: "W-LOAN 1",
        },
      });
      renderComponent();

      const header = screen.getByRole("banner");
      expect(
        within(header).getByRole("link", {
          name: /Ersatzwagen: W-LOAN 1 bis/i,
        }),
      ).toHaveAttribute(
        "href",
        "/workshop/loaner-vehicles?vehicle=loaner-veh-1",
      );
    });

    it("puts Jobkarte drucken in the header and keeps invoice actions out of it", () => {
      renderComponent();

      const header = screen.getByRole("banner");

      expect(
        within(header).getByRole("button", { name: /Jobkarte drucken/i }),
      ).toBeInTheDocument();
      expect(
        within(header).queryByRole("button", { name: /Generate Invoice/i }),
      ).not.toBeInTheDocument();
      expect(
        within(header).queryByRole("button", { name: /Open Checkout/i }),
      ).not.toBeInTheDocument();
    });

    it("renders customer info for PRIVATE customer", () => {
      renderComponent();

      expect(screen.getAllByText("John Doe")[0]).toBeInTheDocument();
      expect(screen.getAllByText("john@example.com")[0]).toBeInTheDocument();
      expect(screen.getAllByText("123456789")[0]).toBeInTheDocument();
    });

    it("renders company_name for COMPANY customer type", () => {
      setupDefaultMocks(companyOrder);
      renderComponent();

      expect(screen.getAllByText("AutoMax GmbH")[0]).toBeInTheDocument();
    });

    it("renders vehicle info with all fields populated", () => {
      renderComponent();

      expect(screen.getAllByText("2020 Toyota Corolla")[0]).toBeInTheDocument();
      expect(screen.getAllByText("VIN123")[0]).toBeInTheDocument();
      expect(screen.getAllByText("ABC-123")[0]).toBeInTheDocument();
    });

    it("renders an editable assigned tech select with active mechanics", () => {
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            {
              id: "mech-1",
              name: "Alex Tech",
              isActive: true,
              role: "MECHANIC",
              sortOrder: 1,
            },
            {
              id: "mech-2",
              name: "Inactive Tech",
              isActive: false,
              role: "MECHANIC",
              sortOrder: 2,
            },
          ],
          bays: [],
        },
        isLoading: false,
      });

      renderComponent();

      expect(screen.getByTestId("assigned-tech-select")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("assigned-tech-select"));
      expect(
        screen.getByRole("option", { name: "Nicht zugewiesen" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Alex Tech" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: "Inactive Tech" }),
      ).not.toBeInTheDocument();
    });

    it("assigns a technician from the order detail select", async () => {
      const assignBoardMutateAsync = vi.fn().mockResolvedValue({});
      asMock(workshopApi.useAssignBoard).mockReturnValue(
        createMutationMock({ mutateAsync: assignBoardMutateAsync }),
      );
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            {
              id: "mech-1",
              name: "Alex Tech",
              isActive: true,
              role: "MECHANIC",
              sortOrder: 1,
            },
          ],
          bays: [],
        },
        isLoading: false,
      });

      renderComponent();

      fireEvent.click(screen.getByTestId("assigned-tech-select"));
      fireEvent.click(screen.getByRole("option", { name: "Alex Tech" }));

      await waitFor(() => {
        expect(assignBoardMutateAsync).toHaveBeenCalledWith({
          orderId: "order-1",
          mechanicId: "mech-1",
        });
      });
      expect(toast.success).toHaveBeenCalledWith(orderDetailToast.technicianAssigned);
    });

    it("disables assigned tech select when the order is invoiced", () => {
      setupDefaultMocks(invoicedOrder);
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            {
              id: "mech-1",
              name: "Alex Tech",
              isActive: true,
              role: "MECHANIC",
              sortOrder: 1,
            },
          ],
          bays: [],
        },
        isLoading: false,
      });

      renderComponent();

      expect(screen.getByTestId("assigned-tech-select")).toBeDisabled();
    });

    it("disables assigned tech select when the order is completed", () => {
      setupDefaultMocks(completedOrder);
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            {
              id: "mech-1",
              name: "Alex Tech",
              isActive: true,
              role: "MECHANIC",
              sortOrder: 1,
            },
          ],
          bays: [],
        },
        isLoading: false,
      });

      renderComponent();

      expect(screen.getByTestId("assigned-tech-select")).toBeDisabled();
    });

    it("unassigns a technician from the order detail select", async () => {
      const assignBoardMutateAsync = vi.fn().mockResolvedValue({});
      setupDefaultMocks({
        ...baseOrder,
        mechanicId: "mech-1",
        mechanic_id: "mech-1",
      });
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            {
              id: "mech-1",
              name: "Alex Tech",
              isActive: true,
              role: "MECHANIC",
              sortOrder: 1,
            },
          ],
          bays: [],
        },
        isLoading: false,
      });
      asMock(workshopApi.useAssignBoard).mockReturnValue(
        createMutationMock({ mutateAsync: assignBoardMutateAsync }),
      );

      renderComponent();

      fireEvent.click(screen.getByTestId("assigned-tech-select"));
      fireEvent.click(screen.getByRole("option", { name: "Nicht zugewiesen" }));

      await waitFor(() => {
        expect(assignBoardMutateAsync).toHaveBeenCalledWith({
          orderId: "order-1",
          mechanicId: null,
        });
      });
      expect(toast.success).toHaveBeenCalledWith(orderDetailToast.technicianUnassigned);
    });

    it("shows an error toast when technician assignment fails", async () => {
      const assignBoardMutateAsync = vi
        .fn()
        .mockRejectedValue(new Error("Cannot assign resources"));
      asMock(workshopApi.useAssignBoard).mockReturnValue(
        createMutationMock({ mutateAsync: assignBoardMutateAsync }),
      );
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            {
              id: "mech-1",
              name: "Alex Tech",
              isActive: true,
              role: "MECHANIC",
              sortOrder: 1,
            },
          ],
          bays: [],
        },
        isLoading: false,
      });

      renderComponent();

      fireEvent.click(screen.getByTestId("assigned-tech-select"));
      fireEvent.click(screen.getByRole("option", { name: "Alex Tech" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Cannot assign resources");
      });
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("renders odometer and fuel level when present", () => {
      renderComponent();

      // formatOdometerKm output may use narrow spaces; match the number flexibly
      expect(
        screen.getAllByText((content) =>
          /85.?000\s*km/i.test(content.replace(/\u202f/g, " ")),
        )[0],
      ).toBeInTheDocument();
      expect(screen.getAllByText("75%")[0]).toBeInTheDocument();
    });

    it("renders fallback dashes when odometer and fuel_level are missing", () => {
      setupDefaultMocks({
        ...baseOrder,
        odometer: undefined,
        fuel_level: undefined,
      });
      renderComponent();

      const dashElements = screen.getAllByText("-");
      expect(dashElements.length).toBeGreaterThanOrEqual(2);
    });

    it("renders VIN and plate as N/A when missing", () => {
      setupDefaultMocks({
        ...baseOrder,
        vehicle: { ...baseOrder.vehicle, vin: "", plate: "" },
      });
      renderComponent();

      const naElements = screen.getAllByText(orderHeaderCopy.noPlate);
      expect(naElements.length).toBeGreaterThanOrEqual(2);
    });

    it("calculates and displays totals correctly", () => {
      // Parts: 1 * 15 = €15.00 | Labor: 0.5 * 80 = €40.00 | Grand: €55.00
      renderComponent();

      expect(screen.getAllByText(formattedCurrencyPattern(15))[0]).toBeInTheDocument();
      expect(screen.getAllByText(formattedCurrencyPattern(40))[0]).toBeInTheDocument();
      expect(screen.getAllByText(formattedCurrencyPattern(55))[0]).toBeInTheDocument();
    });

    it("renders task list with title, total, and status", () => {
      renderComponent();

      expect(screen.getAllByText("Reparaturaufgaben")[0]).toBeInTheDocument();
      expect(screen.getAllByText("Oil Change")[0]).toBeInTheDocument();
    });

    it("expands a task in place and keeps only one task expanded", () => {
      setupDefaultMocks(multiTaskOrder);
      renderComponent();

      fireEvent.click(screen.getByText("Oil Change"));
      expect(
        screen.getByRole("button", { name: taskListCopy.mechanicNotesEmpty }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByText("Brake Inspection"));

      expect(screen.getByText("Pads at 30%")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: taskListCopy.mechanicNotesEmpty }),
      ).not.toBeInTheDocument();
    });

    it("does not render an Open button on task rows", () => {
      renderComponent();

      expect(
        screen.queryByRole("button", { name: /^Open$/i }),
      ).not.toBeInTheDocument();
    });

    it("renders empty tasks message when there are no tasks", () => {
      setupDefaultMocks({ ...baseOrder, tasks: [] });
      renderComponent();

      expect(
        screen.getByText(taskListCopy.noTasks),
      ).toBeInTheDocument();
    });

    it("renders reported issue and internal notes cards", () => {
      renderComponent();

      expect(screen.getAllByText("Gemeldetes Problem")[0]).toBeInTheDocument();
      expect(screen.getAllByText("Interne Notizen")[0]).toBeInTheDocument();
    });

    it("renders call customer button when phone is present", () => {
      renderComponent();

      const callButtons = screen.getAllByText("Kunde anrufen");
      expect(callButtons.length).toBeGreaterThan(0);
      const callLinks = screen.getAllByRole("link", { name: /Kunde anrufen/i });
      expect(callLinks[0]).toHaveAttribute("href", "tel:123456789");
    });

    it("does not render call customer button when phone is missing", () => {
      setupDefaultMocks({
        ...baseOrder,
        customer: { ...baseOrder.customer, phone: "" },
      });
      renderComponent();

      expect(screen.queryByText("Kunde anrufen")).not.toBeInTheDocument();
    });
  });

  // =====================================================================
  // P0: INVOICED Locked Mode
  // =====================================================================

  describe("INVOICED (locked) mode", () => {
    beforeEach(() => {
      setupDefaultMocks(invoicedOrder);
      asMock(salesApi.useInvoice).mockReturnValue({
        data: invoicedOrder.invoice,
        isLoading: false,
      });
    });

    it("disables the new task input and add button", () => {
      renderComponent();

      const taskInputs = screen.getAllByPlaceholderText(taskListCopy.newTaskPlaceholder);
      taskInputs.forEach((input) => expect(input).toBeDisabled());
    });

    it("disables task checkboxes", () => {
      renderComponent();

      const checkboxes = screen.getAllByRole("checkbox");
      checkboxes.forEach((cb) => expect(cb).toBeDisabled());
    });

    it("shows open-invoice action in the checkout footer", () => {
      renderComponent();

      expect(
        screen.getByRole("button", { name: checkoutCopy.openInvoice }),
      ).toBeInTheDocument();
    });
  });

  // =====================================================================
  // P0: Mutation Handler Tests
  // =====================================================================

  describe("handleAddTask", () => {
    it("creates a task and clears input on success", async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({ id: "task-new" });
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(
        createMutationMock({
          mutateAsync: mockMutateAsync,
        }),
      );

      renderComponent();

      const inputs = screen.getAllByPlaceholderText(taskListCopy.newTaskPlaceholder);
      fireEvent.change(inputs[0], { target: { value: "Tire Rotation" } });

      const addButtons = screen.getAllByRole("button", { name: taskListCopy.addTask });
      fireEvent.click(addButtons[0]);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          orderId: "order-1",
          title: "Tire Rotation",
        });
      });
      expect(toast.success).toHaveBeenCalledWith(orderDetailToast.taskCreated);
    });

    it("does not create task when input is empty or whitespace", async () => {
      const mockMutateAsync = vi.fn();
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(
        createMutationMock({
          mutateAsync: mockMutateAsync,
        }),
      );

      renderComponent();

      // Leave input empty, click add
      const addButtons = screen.getAllByRole("button", { name: taskListCopy.addTask });
      fireEvent.click(addButtons[0]);

      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it("creates task on Enter key press with non-empty input", async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({ id: "task-new" });
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(
        createMutationMock({
          mutateAsync: mockMutateAsync,
        }),
      );

      renderComponent();

      const inputs = screen.getAllByPlaceholderText(taskListCopy.newTaskPlaceholder);
      // Set up value and fire change first
      fireEvent.change(inputs[0], { target: { value: "Alignment" } });
      // Use click on add button to verify the value is in state
      const addButtons = screen.getAllByRole("button", { name: taskListCopy.addTask });
      fireEvent.click(addButtons[0]);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          orderId: "order-1",
          title: "Alignment",
        });
      });
    });

    it("toasts error when create task fails", async () => {
      const mockMutateAsync = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(
        createMutationMock({
          mutateAsync: mockMutateAsync,
        }),
      );

      renderComponent();

      const inputs = screen.getAllByPlaceholderText(taskListCopy.newTaskPlaceholder);
      fireEvent.change(inputs[0], { target: { value: "Failing task" } });

      const addButtons = screen.getAllByRole("button", { name: taskListCopy.addTask });
      fireEvent.click(addButtons[0]);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Server error");
      });
    });

    it("disables task input when order is INVOICED", () => {
      setupDefaultMocks(invoicedOrder);
      asMock(salesApi.useInvoice).mockReturnValue({
        data: invoicedOrder.invoice,
        isLoading: false,
      });

      renderComponent();

      const inputs = screen.getAllByPlaceholderText(taskListCopy.newTaskPlaceholder);
      inputs.forEach((input) => expect(input).toBeDisabled());
    });
  });

  describe("handleToggleTask", () => {
    it("calls updateTask with DONE when checkbox is checked", async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({});
      asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
        createMutationMock({
          mutateAsync: mockMutateAsync,
        }),
      );

      renderComponent();

      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          orderId: "order-1",
          taskId: "task-1",
          status: "DONE",
        });
      });
      expect(
        screen.queryByRole("heading", { name: "Pickerl erfasst" }),
      ).not.toBeInTheDocument();
    });

    it("does not offer Pickerl recording to TECH when the §57a task is completed", async () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [{ ...baseOrder.tasks[0]!, title: "§57a Begutachtung" }],
      });
      asMock(authSessionApi.useAuthSession).mockReturnValue({
        data: { activeRole: "TECH" },
      });
      asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
        createMutationMock({ mutateAsync: vi.fn().mockResolvedValue({}) }),
      );

      renderComponent();
      fireEvent.click(screen.getAllByRole("checkbox")[0]!);

      await waitFor(() => {
        expect(workshopApi.useUpdateWorkshopTask).toHaveBeenCalled();
      });
      expect(
        screen.queryByRole("heading", { name: "Pickerl erfasst" }),
      ).not.toBeInTheDocument();
    });
    it("offers the Pickerl recording dialog when the §57a task is completed", async () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [{ ...baseOrder.tasks[0]!, title: "§57a Begutachtung" }],
      });
      asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
        createMutationMock({
          mutateAsync: vi.fn().mockResolvedValue({}),
        }),
      );
      asMock(
        vehicleInspectionApi.useCreateVehicleInspectionRecord,
      ).mockReturnValue(createMutationMock() as never);

      renderComponent();
      fireEvent.click(screen.getAllByRole("checkbox")[0]!);

      expect(
        await screen.findByRole("heading", { name: "Pickerl erfasst" }),
      ).toBeInTheDocument();
      expect(
        (screen.getByLabelText("Begutachtet am") as HTMLInputElement).value,
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("offers the Pickerl recording dialog when an authorized user later opens a completed §57a order", async () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [
          {
            ...baseOrder.tasks[0]!,
            title: "§57a Begutachtung",
            status: "DONE",
            done: true,
          },
        ],
      });

      renderComponent();

      expect(
        await screen.findByRole("heading", { name: "Pickerl erfasst" }),
      ).toBeInTheDocument();
    });

    it("still prompts when the vehicle has only an older inspection record", async () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [{
          ...baseOrder.tasks[0]!,
          title: "§57a Begutachtung",
          status: "DONE",
          done: true,
          updatedAt: "2026-10-07T12:00:00.000Z",
        }],
      });
      asMock(vehicleInspectionApi.useVehicleInspectionRecords).mockReturnValue({
        data: [{ createdAt: "2025-08-01T12:00:00.000Z" }],
        isLoading: false,
      });

      renderComponent();

      expect(await screen.findByRole("heading", { name: "Pickerl erfasst" })).toBeInTheDocument();
    });

    it("does not re-prompt when a Pickerl record was created after task completion", async () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [{
          ...baseOrder.tasks[0]!,
          title: "§57a Begutachtung",
          status: "DONE",
          done: true,
          updatedAt: "2026-10-07T12:00:00.000Z",
        }],
      });
      asMock(vehicleInspectionApi.useVehicleInspectionRecords).mockReturnValue({
        data: [{ createdAt: "2026-10-07T12:01:00.000Z" }],
        isLoading: false,
      });

      renderComponent();

      expect(screen.queryByRole("heading", { name: "Pickerl erfasst" })).not.toBeInTheDocument();
    });
  });

  // =====================================================================
  // P1: Checkout View
  // =====================================================================

  describe("checkout view", () => {
    it("shows grand total and Checkout in the footer while order is IN_PROGRESS", () => {
      renderComponent();

      expect(screen.getByText("Gesamtsumme")).toBeInTheDocument();
      expect(screen.getAllByText(formattedCurrencyPattern(55)).length).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", { name: checkoutCopy.primaryAction }),
      ).toBeInTheDocument();
    });

    it("keeps the task list mounted when checkout expands", () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      expect(screen.getByText(checkoutSummaryCopy.title)).toBeInTheDocument();
      expect(screen.getAllByText("Oil Change").length).toBeGreaterThan(0);
    });

    it("does not show Return to Tasks in the expanded footer", () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));
      expect(screen.queryByText("Return to Tasks")).not.toBeInTheDocument();
    });

    it("collapses checkout with the footer close action", () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));
      expect(screen.getByText(checkoutSummaryCopy.title)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.close }));
      expect(screen.queryByText(checkoutSummaryCopy.title)).not.toBeInTheDocument();
    });

    it("shows Create Draft Invoice button when no invoice linked", () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      expect(
        screen.getByRole("button", { name: checkoutSummaryCopy.createDraft }),
      ).toBeInTheDocument();
    });

    it("disables Create Draft Invoice until the order is COMPLETED", () => {
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      expect(
        screen.getByRole("button", { name: checkoutSummaryCopy.createDraft }),
      ).toBeDisabled();
    });

    it("creates draft invoice and shows toast on success", async () => {
      setupDefaultMocks(completedOrder);
      const mockCreate = vi.fn().mockResolvedValue({
        id: "inv-draft-1",
        invoice_number: "RE-2026-0099",
      });
      asMock(invoicesApi.useCreateDraftInvoice).mockReturnValue(
        createMutationMock({
          mutateAsync: mockCreate,
        }),
      );

      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));
      fireEvent.click(
        screen.getByRole("button", { name: checkoutSummaryCopy.createDraft }),
      );

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith("order-1");
      });
      expect(toast.success).toHaveBeenCalledWith(
        deWorkshop.checkout.toast.draftInvoiceCreated.replace(
          "{{number}}",
          "RE-2026-0099",
        ),
      );
    });

    it("renders checkout totals without discounts", () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      // Net: 15 + 40 = 55.00
      expect(screen.getAllByText(formattedCurrencyPattern(55)).length).toBeGreaterThan(0);
    });

    it("shows empty checkout message when there are no tasks", () => {
      setupDefaultMocks({
        ...completedOrder,
        tasks: [],
      });
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      // When groupedCheckoutTasks is empty, the table renders a "no lines" message
      const allCells = document.querySelectorAll("td");
      const emptyCell = Array.from(allCells).find((cell) =>
        cell.textContent?.includes(checkoutSummaryCopy.empty),
      );
      expect(emptyCell).toBeTruthy();
    });
  });

  // =====================================================================
  // P1: Checkout Discount Cascading
  // =====================================================================

  describe("checkout discount calculations", () => {
    it("applies task-level percentage discount to all nested lines", async () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      // Find the task discount input
      const inputs = screen.getAllByPlaceholderText("0");
      fireEvent.change(inputs[0], { target: { value: "10" } });

      // Base: 55.00, Discount: 5.50, Net: 49.50
      await waitFor(() => {
        expect(screen.getAllByText(formattedCurrencyPattern(49.5)).length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText(formattedCurrencyPattern(-5.5)).length).toBeGreaterThan(0);
    });

    it("expands task group to show line items in checkout view", async () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      // Click task group header to expand
      const taskHeaders = screen.getAllByText("Oil Change");
      fireEvent.click(taskHeaders[0]);

      // Oil Filter should now appear in the expanded table rows
      await waitFor(() => {
        expect(screen.getAllByText("Oil Filter").length).toBeGreaterThan(0);
      });
    });

    it("calculates multi-task totals with invoice tax rates", async () => {
      setupDefaultMocks(multiTaskOrder);

      const mockInvoice = {
        id: "inv-1",
        items: [
          { id: "line-1", unit_price: 15, qty: 1, tax_rate: 21 },
          { id: "line-2", unit_price: 80, qty: 0.5, tax_rate: 0 },
          { id: "line-3", unit_price: 50, qty: 2, tax_rate: 10 },
        ],
      };
      asMock(salesApi.useInvoice).mockReturnValue({
        data: mockInvoice,
        isLoading: false,
      });

      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      // Net: 15 + 40 + 100 = 155.00
      // VAT: 3.15 + 0 + 10 = 13.15
      // Grand: 168.15
      await waitFor(() => {
        expect(screen.getAllByText(formattedCurrencyPattern(155)).length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText(formattedCurrencyPattern(13.15)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(formattedCurrencyPattern(168.15)).length).toBeGreaterThan(0);
    });
  });

  // =====================================================================
  // P1: Invoice Lifecycle in Checkout
  // =====================================================================

  describe("invoice lifecycle in checkout", () => {
    it("shows the linked invoice gross total in the collapsed footer", () => {
      setupDefaultMocks(invoicedOrder);
      asMock(salesApi.useInvoice).mockReturnValue({
        data: {
          id: "inv-1",
          status: "ISSUED",
          invoice_number: "RE-2026-0001",
          items: [
            { id: "line-1", unit_price: 15, qty: 1, tax_rate: 21 },
            { id: "line-2", unit_price: 80, qty: 0.5, tax_rate: 0 },
          ],
        },
        isLoading: false,
      });

      renderComponent();

      expect(screen.getByText("Gesamtsumme")).toBeInTheDocument();
      expect(screen.getByText(formattedCurrencyPattern(58.15))).toBeInTheDocument();
    });

    it("shows Issue Invoice button when draft invoice is linked", () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: "inv-draft-1" },
      });
      asMock(salesApi.useInvoice).mockReturnValue({
        data: {
          id: "inv-draft-1",
          status: "DRAFT",
          invoice_number: "RE-2026-0001",
          items: [],
        },
        isLoading: false,
      });

      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      expect(screen.getAllByText(checkoutSummaryCopy.issue)[0]).toBeInTheDocument();
    });

    it("issues invoice and shows success toast", async () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: "inv-draft-1" },
      });
      asMock(salesApi.useInvoice).mockReturnValue({
        data: {
          id: "inv-draft-1",
          status: "DRAFT",
          invoice_number: "RE-2026-0001",
          items: [],
        },
        isLoading: false,
      });
      const mockIssue = vi.fn().mockResolvedValue({
        id: "inv-draft-1",
        invoice_number: "RE-2026-0001",
      });
      asMock(invoicesApi.useIssueInvoice).mockReturnValue(
        createMutationMock({
          mutateAsync: mockIssue,
        }),
      );

      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));
      fireEvent.click(screen.getAllByText(checkoutSummaryCopy.issue)[0]);

      await waitFor(() => {
        expect(mockIssue).toHaveBeenCalledWith("inv-draft-1");
      });
      expect(toast.success).toHaveBeenCalledWith(
        deWorkshop.checkout.toast.invoiceIssued.replace(
          "{{number}}",
          "RE-2026-0001",
        ),
      );
    });

    it("persists line discount overrides before issuing invoice", async () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: "inv-draft-1" },
      });
      const invoiceData = {
        id: "inv-draft-1",
        status: "DRAFT",
        invoice_number: "RE-2026-0001",
        items: [
          { id: "line-1", unit_price: 15, qty: 1, tax_rate: 21 },
          { id: "line-2", unit_price: 80, qty: 0.5, tax_rate: 0 },
        ],
      };
      asMock(salesApi.useInvoice).mockReturnValue({
        data: invoiceData,
        isLoading: false,
      });

      const mockUpdateDiscount = vi.fn().mockResolvedValue({});
      const mockIssue = vi.fn().mockResolvedValue({
        id: "inv-draft-1",
        invoice_number: "RE-2026-0001",
      });
      asMock(invoicesApi.useUpdateInvoiceDiscount).mockReturnValue(
        createMutationMock({
          mutateAsync: mockUpdateDiscount,
        }),
      );
      asMock(invoicesApi.useIssueInvoice).mockReturnValue(
        createMutationMock({
          mutateAsync: mockIssue,
        }),
      );

      renderComponent();

      fireEvent.click(screen.getByRole("button", { name: checkoutCopy.primaryAction }));

      // Apply a task-level discount to populate lineDiscountOverrides
      const inputs = screen.getAllByPlaceholderText("0");
      fireEvent.change(inputs[0], { target: { value: "5" } });

      // Issue invoice
      fireEvent.click(screen.getAllByText(checkoutSummaryCopy.issue)[0]);

      await waitFor(() => {
        expect(mockUpdateDiscount).toHaveBeenCalledWith(
          expect.objectContaining({
            invoiceId: "inv-draft-1",
            payload: expect.objectContaining({
              lineItems: expect.any(Array),
            }),
          }),
        );
      });
      expect(mockIssue).toHaveBeenCalledWith("inv-draft-1");
    });
  });

  // =====================================================================
  // P2: Print Action
  // =====================================================================

  describe("print action", () => {
    it("calls PDF generation and triggers download", async () => {
      const mockGenerate = createMutationMock({
        mutateAsync: vi.fn().mockResolvedValue({ enqueued: false }),
      });
      asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(mockGenerate);
      asMock(workshopApi.downloadWorkshopPdf).mockResolvedValue(new Blob());

      // Mock URL methods before rendering
      window.URL.createObjectURL = vi.fn().mockReturnValue("mock-url");
      window.URL.revokeObjectURL = vi.fn();

      renderComponent();

      const printButtons = screen.getAllByText("Jobkarte drucken");
      expect(printButtons[0]?.closest("button")).toHaveAttribute(
        "data-action-id",
        "workOrder.jobCardPdf",
      );
      fireEvent.click(printButtons[0]);

      await waitFor(() => {
        expect(mockGenerate.mutateAsync).toHaveBeenCalledWith("order-1");
        expect(workshopApi.downloadWorkshopPdf).toHaveBeenCalledWith("order-1");
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });
    });
  });

  // =====================================================================
  // P2: Edge Cases
  // =====================================================================

  describe("edge cases", () => {
    it("handles order with undefined tasks gracefully", () => {
      setupDefaultMocks({ ...baseOrder, tasks: undefined });
      renderComponent();

      expect(
        screen.getByText(taskListCopy.noTasks),
      ).toBeInTheDocument();
    });

    it("handles task with undefined lineItems gracefully", () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [
          {
            id: "task-1",
            title: "Empty",
            status: "IN_PROGRESS",
            done: false,
            lineItems: undefined,
          },
        ],
      });
      renderComponent();

      expect(screen.getAllByText("Empty")[0]).toBeInTheDocument();
      expect(screen.getAllByText(formattedCurrencyPattern(0))[0]).toBeInTheDocument();
    });

    it("normalizes phone number for tel: link", () => {
      setupDefaultMocks({
        ...baseOrder,
        customer: { ...baseOrder.customer, phone: "+31 (6) 12-34-56-78" },
      });
      renderComponent();

      const callLinks = screen.getAllByRole("link", { name: /Kunde anrufen/i });
      expect(callLinks[0]).toHaveAttribute("href", "tel:+31612345678");
    });

    it("renders Hohe Priorität badge when order is not COMPLETED", () => {
      renderComponent();

      expect(screen.getAllByText("Hohe Priorität")[0]).toBeInTheDocument();
    });

    it("does not render Hohe Priorität badge when order is COMPLETED", () => {
      setupDefaultMocks(completedOrder);
      renderComponent();

      expect(screen.queryByText("Hohe Priorität")).not.toBeInTheDocument();
    });

    it("offers estimate creation to SALES on an open order", async () => {
      renderComponent();

      expect(
        await screen.findByRole("button", { name: "Kostenvoranschlag erstellen" }),
      ).toBeInTheDocument();
    });

    it("keeps the estimate card away from TECH sessions", async () => {
      asMock(authSessionApi.useAuthSession).mockReturnValue({
        data: { activeRole: "TECH" },
      });
      renderComponent();

      expect(await screen.findByText("Oil Change")).toBeInTheDocument();
      expect(
        screen.queryByText("Kostenvoranschlag", { exact: true }),
      ).not.toBeInTheDocument();
    });
  });

  // =====================================================================
  // AUT-672: characterization of the page-level handlers and wiring
  // =====================================================================

  describe("page handlers and wiring (AUT-672)", () => {
    const orderDetailCopy = deWorkshop.orderDetail;
    const resourcesWithMechanic = {
      data: {
        mechanics: [
          { id: "mech-1", name: "Alex Tech", isActive: true, role: "MECHANIC", sortOrder: 1 },
        ],
        bays: [{ id: "bay-1", name: "Bay 3" }],
      },
      isLoading: false,
    };

    afterEach(() => {
      asMock(vehiclesApi.useVehicle).mockReset();
      asMock(vehiclesApi.useResolveVehicleIdentity).mockReset();
      asMock(catalogSettingsApi.useCatalogProviderSettings).mockReset();
      asMock(vehicleInspectionApi.useVehicleInspectionRecords).mockReturnValue({
        data: [],
        isLoading: false,
      });
      fitmentModal.props = null;
    });

    const editInline = (
      displayText: string,
      ariaLabel: string,
      nextValue: string,
    ) => {
      fireEvent.click(screen.getByText(displayText));
      const textarea = screen.getByLabelText(ariaLabel);
      fireEvent.change(textarea, { target: { value: nextValue } });
      fireEvent.blur(textarea);
    };

    describe("document title", () => {
      it("titles the page with the order number", () => {
        renderComponent();

        expect(document.title).toContain("WO-001");
      });
    });

    describe("inline note saves", () => {
      it("saves the internal notes and toasts success", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        editInline("Customer waiting in lobby", deWorkshop.taskList.internalNotesAria, "New note");

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith({ id: "order-1", notes: "New note" }),
        );
        expect(toast.success).toHaveBeenCalledWith(orderDetailToast.notesSaved);
      });

      it("toasts the error message when saving the internal notes fails", async () => {
        const mutateAsync = vi.fn().mockRejectedValue(new Error("Notes rejected"));
        asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        editInline("Customer waiting in lobby", deWorkshop.taskList.internalNotesAria, "New note");

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Notes rejected"));
        expect(toast.success).not.toHaveBeenCalled();
      });

      it("falls back to the translated message when the notes error carries none", async () => {
        const mutateAsync = vi.fn().mockRejectedValue("boom");
        asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        editInline("Customer waiting in lobby", deWorkshop.taskList.internalNotesAria, "New note");

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(orderDetailToast.notesSaveFailed),
        );
      });

      it("saves the reported issue and toasts success", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        editInline("Strange noise from engine", deWorkshop.taskList.reportedIssueAria, "Rattle");

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith({ id: "order-1", reportedIssue: "Rattle" }),
        );
        expect(toast.success).toHaveBeenCalledWith(orderDetailToast.reportedIssueSaved);
      });

      it("shows the snake_case reported issue and saves it under the camelCase field", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        setupDefaultMocks({
          ...baseOrder,
          reportedIssue: undefined,
          reported_issue: "Legacy issue text",
        });
        asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        editInline("Legacy issue text", deWorkshop.taskList.reportedIssueAria, "Updated");

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith({ id: "order-1", reportedIssue: "Updated" }),
        );
      });

      it("toasts when saving the reported issue fails", async () => {
        const mutateAsync = vi.fn().mockRejectedValue("boom");
        asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        editInline("Strange noise from engine", deWorkshop.taskList.reportedIssueAria, "Rattle");

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(orderDetailToast.reportedIssueSaveFailed),
        );
      });

      it("renders the notes read-only when the order is invoiced", () => {
        setupDefaultMocks(invoicedOrder);
        renderComponent();

        fireEvent.click(screen.getByText("Customer waiting in lobby"));

        expect(
          screen.queryByLabelText(deWorkshop.taskList.internalNotesAria),
        ).not.toBeInTheDocument();
      });
    });

    describe("task status and mechanic notes", () => {
      it("sends IN_PROGRESS when a done task is unchecked", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        setupDefaultMocks({
          ...baseOrder,
          tasks: [{ ...baseOrder.tasks[0]!, status: "DONE", done: true }],
        });
        asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        fireEvent.click(screen.getAllByRole("checkbox")[0]!);

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith({
            orderId: "order-1",
            taskId: "task-1",
            status: "IN_PROGRESS",
          }),
        );
      });

      it("toasts when the task status update fails", async () => {
        asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync: vi.fn().mockRejectedValue("boom") }),
        );
        renderComponent();

        fireEvent.click(screen.getAllByRole("checkbox")[0]!);

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(orderDetailToast.taskStatusUpdateFailed),
        );
      });

      it("saves the mechanic notes of an expanded task without a success toast", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        fireEvent.click(screen.getByText("Oil Change"));
        fireEvent.click(screen.getByRole("button", { name: deWorkshop.taskList.mechanicNotesEmpty }));
        const textarea = screen.getByLabelText(deWorkshop.taskList.mechanicNotesAria);
        fireEvent.change(textarea, { target: { value: "Checked filter" } });
        fireEvent.blur(textarea);

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith({
            orderId: "order-1",
            taskId: "task-1",
            mechanicNotes: "Checked filter",
          }),
        );
        expect(toast.success).not.toHaveBeenCalled();
      });

      it("toasts when saving the mechanic notes fails", async () => {
        asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync: vi.fn().mockRejectedValue("boom") }),
        );
        renderComponent();

        fireEvent.click(screen.getByText("Oil Change"));
        fireEvent.click(screen.getByRole("button", { name: deWorkshop.taskList.mechanicNotesEmpty }));
        const textarea = screen.getByLabelText(deWorkshop.taskList.mechanicNotesAria);
        fireEvent.change(textarea, { target: { value: "Checked filter" } });
        fireEvent.blur(textarea);

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(orderDetailToast.mechanicNotesUpdateFailed),
        );
      });
    });

    describe("task deletion", () => {
      const openDeleteDialog = () => {
        fireEvent.click(screen.getByText("Oil Change"));
        fireEvent.click(screen.getByRole("button", { name: taskListCopy.deleteTask }));
        return screen.getByRole("alertdialog");
      };

      it("asks for confirmation naming the task", () => {
        renderComponent();

        const dialog = openDeleteDialog();

        expect(within(dialog).getByText(orderDetailCopy.deleteTaskTitle)).toBeInTheDocument();
        expect(within(dialog).getByText(/Oil Change/)).toBeInTheDocument();
      });

      it("deletes the task on confirm, collapses it and closes the dialog", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        asMock(workshopApi.useDeleteWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        const dialog = openDeleteDialog();
        fireEvent.click(within(dialog).getByRole("button", { name: orderDetailCopy.deleteTask }));

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith({ orderId: "order-1", taskId: "task-1" }),
        );
        expect(toast.success).toHaveBeenCalledWith(orderDetailToast.taskDeleted);
        await waitFor(() =>
          expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
        expect(
          screen.queryByRole("button", { name: taskListCopy.mechanicNotesEmpty }),
        ).not.toBeInTheDocument();
      });

      it("keeps the dialog open and toasts when the deletion fails", async () => {
        const mutateAsync = vi.fn().mockRejectedValue(new Error("Task is referenced"));
        asMock(workshopApi.useDeleteWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        const dialog = openDeleteDialog();
        fireEvent.click(within(dialog).getByRole("button", { name: orderDetailCopy.deleteTask }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Task is referenced"));
        expect(toast.success).not.toHaveBeenCalled();
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });

      it("closes the dialog on cancel without deleting", async () => {
        const mutateAsync = vi.fn();
        asMock(workshopApi.useDeleteWorkshopTask).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();

        const dialog = openDeleteDialog();
        fireEvent.click(within(dialog).getByRole("button", { name: orderDetailCopy.cancel }));

        await waitFor(() =>
          expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
        expect(mutateAsync).not.toHaveBeenCalled();
      });

      it("disables deletion once a draft invoice is linked", () => {
        setupDefaultMocks({ ...baseOrder, invoice: { id: "inv-draft-1" } });
        asMock(salesApi.useInvoice).mockReturnValue({
          data: { id: "inv-draft-1", status: "DRAFT", invoice_number: "RE-1", items: [] },
          isLoading: false,
        });
        renderComponent();

        fireEvent.click(screen.getByText("Oil Change"));

        expect(screen.getByRole("button", { name: taskListCopy.deleteTask })).toBeDisabled();
      });

      it("disables the delete button while a deletion is pending", () => {
        asMock(workshopApi.useDeleteWorkshopTask).mockReturnValue(
          createMutationMock({ isPending: true }),
        );
        renderComponent();

        fireEvent.click(screen.getByText("Oil Change"));

        expect(screen.getByRole("button", { name: taskListCopy.deleteTask })).toBeDisabled();
      });
    });

    describe("print action", () => {
      it("shows the queued toast and skips the download when the PDF is enqueued", async () => {
        asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(
          createMutationMock({ mutateAsync: vi.fn().mockResolvedValue({ enqueued: true }) }),
        );
        renderComponent();

        fireEvent.click(screen.getAllByText("Jobkarte drucken")[0]!);

        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(orderDetailToast.jobCardPdfQueued, {
            id: "toast-id",
          }),
        );
        expect(toast.loading).toHaveBeenCalledWith(orderDetailToast.jobCardPdfGenerating);
        expect(workshopApi.downloadWorkshopPdf).not.toHaveBeenCalled();
      });

      it("downloads a sanitized job card file name and resolves the loading toast", async () => {
        asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(
          createMutationMock({ mutateAsync: vi.fn().mockResolvedValue({ enqueued: false }) }),
        );
        window.URL.createObjectURL = vi.fn().mockReturnValue("mock-url");
        window.URL.revokeObjectURL = vi.fn();
        const downloads: string[] = [];
        const clickSpy = vi
          .spyOn(HTMLAnchorElement.prototype, "click")
          .mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push(this.download);
          });
        renderComponent();

        fireEvent.click(screen.getAllByText("Jobkarte drucken")[0]!);

        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(orderDetailToast.jobCardPdfDownloaded, {
            id: "toast-id",
          }),
        );
        expect(downloads).toEqual(["job_card_wo_001.pdf"]);
        clickSpy.mockRestore();
      });

      it("toasts the error under the loading toast id when PDF generation fails", async () => {
        asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(
          createMutationMock({ mutateAsync: vi.fn().mockRejectedValue("boom") }),
        );
        renderComponent();

        fireEvent.click(screen.getAllByText("Jobkarte drucken")[0]!);

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(orderDetailToast.jobCardPdfFailed, {
            id: "toast-id",
          }),
        );
      });
    });

    describe("technician assignment", () => {
      beforeEach(async () => {
        const actual = await vi.importActual<typeof import("@/api/workshop")>(
          "@/api/workshop",
        );
        vi.mocked(workshopApi.useAssignBoard).mockImplementation(actual.useAssignBoard);
      });

      const pickAlex = () => {
        fireEvent.click(screen.getByTestId("assigned-tech-select"));
        fireEvent.click(screen.getByRole("option", { name: "Alex Tech" }));
      };

      it("updates the cached order optimistically while the assignment is pending", async () => {
        let resolveAssign: (() => void) | undefined;
        vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
          if (
            String(input) === "/api/workshop/board/assign" &&
            init?.method === "PATCH"
          ) {
            return new Promise<Response>((resolve) => {
              resolveAssign = () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => ({}),
                } as Response);
            });
          }
          return Promise.reject(new Error(`unexpected fetch ${String(input)}`));
        });
        asMock(workshopApi.useWorkshopResources).mockReturnValue(resourcesWithMechanic);
        queryClient.setQueryData(workshopApi.workshopKeys.detail("order-1"), baseOrder);
        renderComponent();

        pickAlex();

        await waitFor(() =>
          expect(
            queryClient.getQueryData<{ mechanicId?: string; mechanic_id?: string }>(
              workshopApi.workshopKeys.detail("order-1"),
            ),
          ).toMatchObject({ mechanicId: "mech-1", mechanic_id: "mech-1" }),
        );
        await act(async () => resolveAssign?.());
        expect(toast.success).toHaveBeenCalledWith(orderDetailToast.technicianAssigned);
      });

      it("rolls the cached order back and toasts when the assignment fails", async () => {
        vi.mocked(fetchWithAuth).mockResolvedValue({
          ok: false,
          status: 403,
          json: async () => ({ message: "forbidden" }),
        } as Response);
        asMock(workshopApi.useWorkshopResources).mockReturnValue(resourcesWithMechanic);
        queryClient.setQueryData(workshopApi.workshopKeys.detail("order-1"), baseOrder);
        renderComponent();

        pickAlex();

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith("forbidden"),
        );
        await waitFor(() => {
          const order = queryClient.getQueryData<{ mechanicId?: string | null; mechanic_id?: string | null }>(
            workshopApi.workshopKeys.detail("order-1"),
          );
          expect(order?.mechanicId ?? null).toBeNull();
          expect(order?.mechanic_id ?? null).toBeNull();
        });
      });

      it("reads the technician and bay from the snake_case ids", () => {
        setupDefaultMocks({ ...baseOrder, mechanic_id: "mech-1", bay_id: "bay-1" });
        asMock(workshopApi.useWorkshopResources).mockReturnValue(resourcesWithMechanic);
        renderComponent();

        expect(screen.getAllByText(/Bay 3/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Alex Tech/).length).toBeGreaterThan(0);
      });

      it("allows assigning on a scheduled order", () => {
        setupDefaultMocks({ ...baseOrder, status: "SCHEDULED" });
        asMock(workshopApi.useWorkshopResources).mockReturnValue(resourcesWithMechanic);
        renderComponent();

        expect(screen.getByTestId("assigned-tech-select")).not.toBeDisabled();
      });
    });

    describe("check-in link", () => {
      it.each(["INTAKE", "IN_PROGRESS"] as const)("links to the check-in page while %s", (status) => {
        setupDefaultMocks({ ...baseOrder, status });
        renderComponent();

        expect(screen.getByTestId("workshop-order-check-in-link")).toHaveAttribute(
          "href",
          "/workshop/orders/order-1/check-in",
        );
      });

      it.each(["SCHEDULED", "COMPLETED", "INVOICED"] as const)(
        "hides the check-in link while %s",
        (status) => {
          setupDefaultMocks({ ...baseOrder, status });
          renderComponent();

          expect(screen.queryByTestId("workshop-order-check-in-link")).not.toBeInTheDocument();
        },
      );
    });

    describe("waiting tasks panel", () => {
      const waitingOrder = {
        ...baseOrder,
        tasks: [
          { ...baseOrder.tasks[0]!, id: "task-w1", status: "WAITING_CUSTOMER" as const },
          { ...baseOrder.tasks[0]!, id: "task-w2", status: "WAITING_CUSTOMER" as const },
          { ...baseOrder.tasks[0]!, id: "task-p", status: "IN_PROGRESS" as const },
        ],
      };

      it("counts only the tasks waiting for the customer", () => {
        setupDefaultMocks(waitingOrder);
        renderComponent();

        expect(screen.getByTestId("resume-waiting-tasks-panel")).toHaveTextContent(/^2 Aufgaben/);
      });

      it("is hidden when no task waits", () => {
        renderComponent();

        expect(screen.queryByTestId("resume-waiting-tasks-panel")).not.toBeInTheDocument();
      });

      it("is hidden from a technician session", () => {
        setupDefaultMocks(waitingOrder);
        asMock(authSessionApi.useAuthSession).mockReturnValue({ data: { activeRole: "TECH" } });
        renderComponent();

        expect(screen.queryByTestId("resume-waiting-tasks-panel")).not.toBeInTheDocument();
      });
    });

    describe("Pickerl prompt guards", () => {
      const pickerlOrder = {
        ...baseOrder,
        tasks: [
          { ...baseOrder.tasks[0]!, title: "§57a Begutachtung", status: "DONE" as const, done: true },
        ],
      };

      it("waits for the inspection records before prompting", () => {
        setupDefaultMocks(pickerlOrder);
        asMock(vehicleInspectionApi.useVehicleInspectionRecords).mockReturnValue({
          data: undefined,
          isLoading: true,
        });
        renderComponent();

        expect(screen.queryByRole("heading", { name: "Pickerl erfasst" })).not.toBeInTheDocument();
      });

      it("prompts only once per completed task", async () => {
        setupDefaultMocks(pickerlOrder);
        const view = renderComponent();
        expect(await screen.findByRole("heading", { name: "Pickerl erfasst" })).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        await waitFor(() =>
          expect(screen.queryByRole("heading", { name: "Pickerl erfasst" })).not.toBeInTheDocument(),
        );

        asMock(vehicleInspectionApi.useVehicleInspectionRecords).mockReturnValue({
          data: [{ createdAt: "2020-01-01T00:00:00.000Z" }],
          isLoading: false,
        });
        view.rerender(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/workshop/orders/order-1"]}>
              <Routes>
                <Route path="/workshop/orders/:id" element={<WorkshopOrderDetails />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        );

        expect(screen.queryByRole("heading", { name: "Pickerl erfasst" })).not.toBeInTheDocument();
      });
    });

    describe("fitment search", () => {
      const openFitmentSearch = () => {
        fireEvent.click(screen.getByText("Oil Change"));
        fireEvent.click(screen.getByTestId("open-fitment-search-button"));
      };

      it("offers no fitment search on an invoiced order", () => {
        setupDefaultMocks(invoicedOrder);
        renderComponent();

        fireEvent.click(screen.getByText("Oil Change"));

        expect(screen.queryByTestId("open-fitment-search-button")).not.toBeInTheDocument();
      });

      it("keeps the modal unmounted until a task opens it", () => {
        renderComponent();

        expect(screen.queryByTestId("fitment-modal")).not.toBeInTheDocument();
      });

      it("opens the modal for the task with a stale identity and no OEM concern by default", () => {
        renderComponent();

        openFitmentSearch();

        expect(screen.getByTestId("fitment-modal")).toBeInTheDocument();
        expect(fitmentModal.props).toMatchObject({
          open: true,
          workshopOrderId: "order-1",
          taskId: "task-1",
          vehicleId: "veh-1",
          oemConcernCode: null,
          isIdentityStale: true,
        });
      });

      it("passes the OEM concern and a fresh identity of the vehicle to the modal", () => {
        asMock(vehiclesApi.useVehicle).mockReturnValue({
          data: {
            make_brand_id: 7,
            identity_input_fingerprint: "fp",
            identity_resolved_at: "2026-01-01T00:00:00.000Z",
          },
        });
        asMock(catalogSettingsApi.useCatalogProviderSettings).mockReturnValue({
          data: { oemConcerns: [{ code: "VAG", memberMakes: [{ id: 7 }] }] },
        });
        renderComponent();

        openFitmentSearch();

        expect(fitmentModal.props).toMatchObject({ oemConcernCode: "VAG", isIdentityStale: false });
      });

      it("unmounts the modal when it asks to close", () => {
        renderComponent();
        openFitmentSearch();

        act(() => fitmentModal.props!.onOpenChange(false as never));

        expect(screen.queryByTestId("fitment-modal")).not.toBeInTheDocument();
      });

      it("shows the catalog source of a search session in the header", () => {
        renderComponent();
        openFitmentSearch();
        const metadata = {
          concern: "PARTS",
          sourceUsed: "AFTERMARKET",
          oemStatus: "EMPTY",
          fallbackReason: "EMPTY",
        } as const;

        act(() => fitmentModal.props!.onSearchSessionUpdate(metadata as never));

        expect(screen.getByText(getCatalogSourceBannerCopy(metadata))).toBeInTheDocument();
      });

      it("closes the modal and resolves the vehicle identity on request", async () => {
        const mutateAsync = vi.fn().mockResolvedValue({});
        asMock(vehiclesApi.useResolveVehicleIdentity).mockReturnValue(
          createMutationMock({ mutateAsync }),
        );
        renderComponent();
        openFitmentSearch();

        act(() => fitmentModal.props!.onRequestResolveIdentity());

        expect(screen.queryByTestId("fitment-modal")).not.toBeInTheDocument();
        await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("veh-1"));
        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(orderDetailToast.vehicleIdentityResolved),
        );
      });

      it("toasts when resolving the vehicle identity fails", async () => {
        asMock(vehiclesApi.useResolveVehicleIdentity).mockReturnValue(
          createMutationMock({ mutateAsync: vi.fn().mockRejectedValue("boom") }),
        );
        renderComponent();
        openFitmentSearch();

        act(() => fitmentModal.props!.onRequestResolveIdentity());

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(orderDetailToast.vehicleIdentityResolveFailed),
        );
      });
    });
  });
});
