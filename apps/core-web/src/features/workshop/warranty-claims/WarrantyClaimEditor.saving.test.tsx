import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  claimFixture,
  failSavesWith,
  fetchMock,
  payloadOf,
  renderEditor,
  settle,
  toastMock,
  useEditorMocks,
} from "./WarrantyClaimEditor.testUtils";

vi.mock("@/api/client", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("WarrantyClaimEditor: saving", () => {
  useEditorMocks();

  it("autosaves only the field that changed, after the 750 ms debounce", async () => {
    renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Cause and correction"), {
      target: { value: "Geberzylinder getauscht" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/workshop/orders/order-1/warranty-claims/claim-1");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ causeCorrection: "Geberzylinder getauscht" });
  });

  it("does not save an amount that cannot be read", async () => {
    renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Claimed amount (EUR, net)"), {
      target: { value: "12,345" },
    });

    expect(screen.getByText("Enter an amount in EUR with at most two decimals.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves pending edits before it closes the claim", async () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close claim" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close claim" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ externalReference: "OEM-REF-9" });
    expect(payloadOf(fetchMock.mock.calls[1])).toEqual({ status: "CLOSED" });
  });

  it("does not close the claim when the pending edits fail to save", async () => {
    failSavesWith("externalReference", "The OEM reference could not be stored.");
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close claim" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close claim" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ externalReference: "OEM-REF-9" });
    expect(payloadOf(fetchMock.mock.calls[0])).not.toHaveProperty("status");
  });

  it("saves an edit that is still waiting for the debounce when the editor unmounts", async () => {
    const { unmount } = renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Cause and correction"), {
      target: { value: "Geberzylinder getauscht" },
    });
    unmount();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ causeCorrection: "Geberzylinder getauscht" });
  });

  it("does not submit the claim when the pending edits fail to save", async () => {
    failSavesWith("causeCorrection", "The cause could not be stored.");
    renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Cause and correction"), {
      target: { value: "Geberzylinder getauscht" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark submitted" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ causeCorrection: "Geberzylinder getauscht" });
  });

  it("does not print the claim when the pending edits fail to save", async () => {
    failSavesWith("externalReference", "The OEM reference could not be stored.");
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Print" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/\/pdf$/);
  });

  it("saves the other edits when the claimed amount cannot be read and the editor unmounts", async () => {
    const { unmount } = renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Complaint"), {
      target: { value: "Kupplung rutscht bei Kaltstart" },
    });
    fireEvent.change(screen.getByLabelText("Claimed amount (EUR, net)"), {
      target: { value: "12,345" },
    });
    unmount();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ complaint: "Kupplung rutscht bei Kaltstart" });
    expect(toastMock.error).toHaveBeenCalledWith(
      "The claimed amount could not be read, so it was not saved.",
    );
  });

  it("does not save on unmount when nothing is pending", async () => {
    const { unmount } = renderEditor(claimFixture());

    unmount();

    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
