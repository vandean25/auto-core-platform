import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegalEntityRecord } from "@/api/site-admin";
import { DocumentBrandingSettings } from "./DocumentBrandingSettings";

const fixtures = vi.hoisted(() => ({
  clearPendingSave: vi.fn(),
  abortInFlightSave: vi.fn(),
  profile: {
    revision: 4,
    activeRevision: 3,
    activeTheme: {
      schemaVersion: 1 as const,
      presetId: "standard-v1" as const,
      logoAssetId: null,
      primaryColor: "#111827",
      secondaryColor: "#E5E7EB",
      fontId: "acp-sans-v1" as const,
      headerBand: "none" as const,
      footerBand: "none" as const,
      headerText: "",
      footerText: "",
    },
    draftTheme: null as null | Record<string, unknown>,
    confirmedAt: "2026-09-27T12:00:00.000Z",
    confirmedByUserId: "user-1",
    capabilities: { extractionAvailable: false },
  },
  previewHtml: "<!doctype html><p>SAMPLE — NOT AN INVOICE</p>",
  assetStatus: {
    data: null as null | { id: string; state: string; failureCode?: string },
    pollTimedOut: false,
    refetch: vi.fn(),
  },
  sourceAssetStatus: {
    data: null as null | { id: string; state: string; failureCode?: string },
    pollTimedOut: false,
    refetch: vi.fn(),
  },
  upload: vi.fn(),
}));

vi.mock("@/api/document-branding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/api/document-branding")>();
  return {
    ...actual,
    useDocumentBrandProfile: () => ({
      data: fixtures.profile,
      isLoading: false,
      error: null,
    }),
    useDocumentBrandAsset: (_legalEntityId: string, assetId: string | null) =>
      assetId === "source-1"
        ? fixtures.sourceAssetStatus
        : fixtures.assetStatus,
    useSaveDocumentBrandDraft: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useConfirmDocumentBranding: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useDiscardDocumentBrandDraft: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    usePreviewDocumentBranding: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
      data: {
        html: fixtures.previewHtml,
        warnings: [],
        themeHash: "a".repeat(64),
      },
      reset: vi.fn(),
    }),
    useUploadDocumentBrandAsset: () => ({
      mutateAsync: fixtures.upload,
      isPending: false,
    }),
    useCreateDocumentBrandExtraction: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useDiscardDocumentBrandExtraction: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useDocumentBrandExtraction: () => ({
      data: null,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/useDebouncedAutoSave", () => ({
  useDebouncedAutoSave: () => ({
    saveStatus: "saved",
    triggerAutoSave: vi.fn(),
    clearPendingSave: fixtures.clearPendingSave,
    abortInFlightSave: fixtures.abortInFlightSave,
  }),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  fixtures.profile.draftTheme = null;
  fixtures.profile.capabilities.extractionAvailable = false;
  fixtures.assetStatus.data = null;
  fixtures.sourceAssetStatus.data = null;
  fixtures.upload.mockReset();
});

const entity = {
  id: "entity-1",
  name: "Example GmbH",
  country_iso: "AT",
  is_active: true,
} as LegalEntityRecord;

describe("DocumentBrandingSettings", () => {
  it("shows the confirmed appearance separately from the editable draft", () => {
    render(<DocumentBrandingSettings entity={entity} />);

    expect(
      screen.getByRole("heading", { name: "Document branding" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Primary color")).toHaveProperty(
      "value",
      "#111827",
    );
    expect(
      screen
        .getByRole("button", { name: "Confirm branding" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("allows explicit confirmation and discard when a saved draft exists", () => {
    fixtures.profile.draftTheme = {
      ...fixtures.profile.activeTheme,
      headerText: "Draft",
    };
    render(<DocumentBrandingSettings entity={entity} />);

    expect(
      screen
        .getByRole("button", { name: "Confirm branding" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeTruthy();
  });

  it("renders the sample only in a sandboxed frame", () => {
    render(<DocumentBrandingSettings entity={entity} />);

    const preview = screen.getByTitle("Synthetic invoice branding preview");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("srcdoc")).toContain("SAMPLE — NOT AN INVOICE");
  });

  it("offers a bounded PDF or PNG source upload alongside the PNG logo upload", () => {
    render(<DocumentBrandingSettings entity={entity} />);
    expect(
      screen.getByLabelText("Letterhead source (PDF or PNG, up to 10 MiB)"),
    ).toHaveProperty("accept", "application/pdf,image/png,.pdf,.png");
    expect(screen.getByLabelText("Logo (PNG, up to 2 MiB)")).toHaveProperty(
      "accept",
      "image/png,.png",
    );
  });

  it("enables extraction after the uploaded source is validated", async () => {
    fixtures.profile.capabilities.extractionAvailable = true;
    fixtures.upload.mockResolvedValue({ id: "source-1" });
    fixtures.sourceAssetStatus.data = { id: "source-1", state: "READY" };
    const { rerender } = render(<DocumentBrandingSettings entity={entity} />);

    fireEvent.change(
      screen.getByLabelText("Letterhead source (PDF or PNG, up to 10 MiB)"),
      {
        target: {
          files: [new File(["letterhead"], "letterhead.png", { type: "image/png" })],
        },
      },
    );

    await waitFor(() => expect(fixtures.upload).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(sessionStorage.getItem("acp.document-brand-source.entity-1")).toBe(
        "source-1",
      ),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Extract suggestions" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(
      screen.queryByText("Upload and validate a PDF or PNG letterhead first."),
    ).toBeNull();

    rerender(
      <DocumentBrandingSettings entity={{ ...entity, id: "entity-2" }} />,
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Extract suggestions" })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  it("restores a READY letterhead source after remount for its legal entity", () => {
    fixtures.profile.capabilities.extractionAvailable = true;
    sessionStorage.setItem("acp.document-brand-source.entity-1", "source-1");
    const { rerender } = render(<DocumentBrandingSettings entity={entity} />);

    expect(
      screen.getByRole("button", { name: "Extract suggestions" }).hasAttribute("disabled"),
    ).toBe(false);

    rerender(<DocumentBrandingSettings entity={{ ...entity, id: "entity-2" }} />);

    expect(
      screen.getByRole("button", { name: "Extract suggestions" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("clears a persisted READY source when validation rejects the upload", async () => {
    fixtures.profile.capabilities.extractionAvailable = true;
    fixtures.upload.mockResolvedValue({ id: "source-1" });
    fixtures.sourceAssetStatus.data = {
      id: "source-1",
      state: "REJECTED",
      failureCode: "FILE_REJECTED",
    };
    sessionStorage.setItem("acp.document-brand-source.entity-1", "source-1");

    render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(
      screen.getByLabelText("Letterhead source (PDF or PNG, up to 10 MiB)"),
      {
        target: {
          files: [new File(["letterhead"], "letterhead.png", { type: "image/png" })],
        },
      },
    );

    await waitFor(() => expect(fixtures.upload).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(sessionStorage.getItem("acp.document-brand-source.entity-1")).toBeNull(),
    );
  });

  it("offers a manual status refresh when logo validation polling times out", async () => {
    fixtures.assetStatus.data = { id: "asset-1", state: "QUARANTINED" };
    fixtures.assetStatus.pollTimedOut = true;
    const { getByRole } = render(<DocumentBrandingSettings entity={entity} />);

    getByRole("button", { name: "Refresh validation status" }).click();

    expect(fixtures.assetStatus.refetch).toHaveBeenCalledOnce();
  });
});
