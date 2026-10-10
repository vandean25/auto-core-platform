import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  claimFixture,
  failSavesWith,
  fetchMock,
  jsonResponse,
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

describe("WarrantyClaimEditor: decisions", () => {
  useEditorMocks();

  it("keeps the decision date and note the advisor entered when recording an approval", async () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Decision date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "80% goodwill share" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Decision date")).toHaveValue("2026-10-08");
    expect(within(dialog).getByLabelText("Decision note")).toHaveValue("80% goodwill share");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark approved" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(payloadOf(fetchMock.mock.calls[1])).toEqual({
      status: "APPROVED",
      decisionDate: "2026-10-08",
      decisionNote: "80% goodwill share",
    });
  });

  it("does not record an approval when the pending edits fail to save", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark approved" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ externalReference: "OEM-REF-9" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the decision dialog open, with the advisor's entries, while the decision is being saved", async () => {
    const pendingStatus: { answer?: (response: Response) => void } = {};
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if ("status" in payload) {
        return new Promise<Response>((resolve) => {
          pendingStatus.answer = resolve;
        });
      }
      return jsonResponse(claimFixture(payload));
    });
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "80% goodwill share" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark approved" }));
    await waitFor(() => expect(pendingStatus.answer).toBeDefined());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toastMock.message).toHaveBeenCalledWith("The decision is still being saved.");

    pendingStatus.answer?.(jsonResponse({ message: "The claim changed." }, 409));
    const settled = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(settled).getByRole("button", { name: "Mark approved" })).toBeEnabled(),
    );
    expect(within(settled).getByLabelText("Decision note")).toHaveValue("80% goodwill share");
  });

  it("closes the decision dialog when nothing is being saved", async () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toastMock.message).not.toHaveBeenCalled();
  });
});
