import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateWarrantyClaim, useWarrantyClaim, useWarrantyClaims } from "@/api/warranty-claims";
import { useWorkshopOrder } from "@/api/workshop";
import { WorkshopOrderWarrantyClaims } from "./WorkshopOrderWarrantyClaims";

vi.mock("@/api/workshop", () => ({ useWorkshopOrder: vi.fn() }));
vi.mock("@/api/warranty-claims", () => ({
  useWarrantyClaims: vi.fn(),
  useWarrantyClaim: vi.fn(),
  useCreateWarrantyClaim: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

const setSearchParams = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useSearchParams: () => [new URLSearchParams(), setSearchParams],
}));

function pageTree() {
  return (
    <MemoryRouter initialEntries={["/workshop/orders/order-1/garantie-kulanz"]}>
      <Routes>
        <Route path="/workshop/orders/:id/garantie-kulanz" element={<WorkshopOrderWarrantyClaims />} />
      </Routes>
    </MemoryRouter>
  );
}

function givenOrder(loading: boolean) {
  const query = loading
    ? { data: undefined, isLoading: true }
    : {
        data: { id: "order-1", order_number: "WO-001", vehicle: null, tasks: [] },
        isLoading: false,
      };
  vi.mocked(useWorkshopOrder).mockReturnValue(query as unknown as ReturnType<typeof useWorkshopOrder>);
}

function givenCreate(mutateAsync: (input: unknown) => Promise<{ id: string }>) {
  vi.mocked(useCreateWarrantyClaim).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateWarrantyClaim>);
}

beforeEach(() => {
  setSearchParams.mockClear();
  givenOrder(false);
  vi.mocked(useWarrantyClaims).mockReturnValue({
    data: { data: [], meta: { total: 0 } },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useWarrantyClaims>);
  vi.mocked(useWarrantyClaim).mockReturnValue({
    data: undefined,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useWarrantyClaim>);
});

afterEach(() => {
  cleanup();
});

describe("WorkshopOrderWarrantyClaims: create", () => {
  it("selects the new claim when the advisor is still on the page", async () => {
    givenCreate(async () => ({ id: "claim-new" }));
    render(pageTree());

    fireEvent.click(screen.getByRole("button", { name: "Warranty Claim" }));

    await waitFor(() => expect(setSearchParams).toHaveBeenCalledTimes(1));
  });

  it("does not move the advisor back to the claims tab when the create finishes after they left it", async () => {
    let finishCreate!: (claim: { id: string }) => void;
    givenCreate(
      () =>
        new Promise<{ id: string }>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const { unmount } = render(pageTree());

    fireEvent.click(screen.getByRole("button", { name: "Warranty Claim" }));
    unmount();
    await act(async () => {
      finishCreate({ id: "claim-new" });
    });

    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it("keeps the same hooks when the order finishes loading", () => {
    givenOrder(true);
    const { rerender } = render(pageTree());

    givenOrder(false);

    expect(() => rerender(pageTree())).not.toThrow();
    expect(screen.getByRole("heading", { level: 1, name: "Garantie/Kulanz" })).toBeInTheDocument();
  });
});
