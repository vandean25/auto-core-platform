import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaborCategoriesTab } from "./LaborCategoriesTab";

vi.mock("@/api/labor", () => ({
  useLaborCategories: () => ({
    data: {
      data: [
        {
          id: "category-1",
          name: "Engine",
          description: null,
          sort_order: 1,
          parent_id: null,
          default_hourly_rate: null,
          is_active: true,
          children: [],
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useCreateLaborCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateLaborCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLaborCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("LaborCategoriesTab", () => {
  it("shows Not set when a category has no default hourly rate", () => {
    render(<LaborCategoriesTab />);

    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});
