import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentBrandAsset } from "@/api/document-branding";
import type { LegalEntityRecord } from "@/api/site-admin";
import { createHttpError } from "@/lib/error-utils";
import { toast } from "sonner";
import type { UseDebouncedAutoSaveOptions } from "@/hooks/useDebouncedAutoSave";
import type { DocumentBrandTheme } from "@/api/document-branding";
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
    capabilities: {
      extractionAvailable: false,
      theme: { decorativeTextMaxCodePoints: 120 },
      uploads: {
        logo: {
          maxBytes: 2 * 1024 * 1024,
          mimeTypes: ["image/png"],
          accept: "image/png,.png",
          requirementLabel: "Logo must be PNG (max 2 MiB).",
        },
        source: {
          maxBytes: 10 * 1024 * 1024,
          mimeTypes: ["image/png", "application/pdf"],
          accept: "application/pdf,image/png,.pdf,.png",
          requirementLabel:
            "Letterhead source must be PNG or PDF (max 10 MiB).",
        },
      },
    },
    draftSourceAssetId: null as string | null,
    draftSourceAsset: null as DocumentBrandAsset | null,
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
  refetchProfile: vi.fn(),
  saveDraft: vi.fn(),
  saveStatus: "saved" as "idle" | "saving" | "saved" | "error",
  markIdle: vi.fn(),
  markSaved: vi.fn(),
  triggerAutoSave: vi.fn(),
  autoSaveOptions: null as UseDebouncedAutoSaveOptions<DocumentBrandTheme> | null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
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
      refetch: fixtures.refetchProfile,
    }),
    useDocumentBrandAsset: (_legalEntityId: string, assetId: string | null) =>
      assetId === "source-1"
        ? fixtures.sourceAssetStatus
        : fixtures.assetStatus,
    useSaveDocumentBrandDraft: () => ({
      mutateAsync: fixtures.saveDraft,
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

vi.mock("./LetterheadSourceAsset", () => ({
  LetterheadSourceAsset: () => null,
}));

vi.mock("@/hooks/useDebouncedAutoSave", () => ({
  useDebouncedAutoSave: (options: UseDebouncedAutoSaveOptions<DocumentBrandTheme>) => {
    fixtures.autoSaveOptions = options;
    return {
      saveStatus: fixtures.saveStatus,
      triggerAutoSave: fixtures.triggerAutoSave,
      clearPendingSave: fixtures.clearPendingSave,
      abortInFlightSave: fixtures.abortInFlightSave,
      markIdle: fixtures.markIdle,
      markSaved: fixtures.markSaved,
    };
  },
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  fixtures.profile.draftTheme = null;
  fixtures.profile.activeTheme = {
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
  };
  fixtures.profile.capabilities.extractionAvailable = false;
  fixtures.assetStatus.data = null;
  fixtures.sourceAssetStatus.data = null;
  fixtures.upload.mockReset();
  fixtures.refetchProfile.mockReset();
  fixtures.saveDraft.mockReset();
  fixtures.saveStatus = "saved";
  fixtures.markIdle.mockReset();
  fixtures.markSaved.mockReset();
  fixtures.triggerAutoSave.mockReset();
  fixtures.autoSaveOptions = null;
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.message).mockReset();
  vi.mocked(toast.success).mockReset();
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

  it("keeps the bounded PNG logo upload control from backend capabilities", () => {
    render(<DocumentBrandingSettings entity={entity} />);
    expect(screen.getByLabelText("Logo")).toHaveProperty(
      "accept",
      "image/png,.png",
    );
    expect(screen.getByText("Logo must be PNG (max 2 MiB).")).toBeTruthy();
  });

  it("enables extraction when the draft letterhead source is validated", async () => {
    fixtures.profile.capabilities.extractionAvailable = true;
    fixtures.profile.draftSourceAssetId = "source-1";
    fixtures.profile.draftSourceAsset = {
      id: "source-1",
      purpose: "SOURCE",
      state: "READY",
      detectedMimeType: "image/png",
      byteLength: 0,
      pixelWidth: null,
      pixelHeight: null,
      failureCode: null,
      originalFilename: null,
      pagePreviewAvailable: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
    };
    fixtures.sourceAssetStatus.data = { id: "source-1", state: "READY" };
    const { rerender } = render(<DocumentBrandingSettings entity={entity} />);

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

    fixtures.profile.draftSourceAssetId = null;
    fixtures.profile.draftSourceAsset = null;
    fixtures.sourceAssetStatus.data = null;
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

  it("does not show the saved indicator while decorative text fails validation", () => {
    render(<DocumentBrandingSettings entity={entity} />);

    expect(screen.getByText("All changes saved")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "x".repeat(121) },
    });

    expect(screen.queryByText("All changes saved")).toBeNull();
  });

  function triggerRevisionConflict() {
    act(() => {
      fixtures.autoSaveOptions?.onError?.(
        createHttpError("Branding revision conflict", 409),
      );
    });
  }

  it("shows conflict recovery actions after a revision conflict", () => {
    render(<DocumentBrandingSettings entity={entity} />);
    triggerRevisionConflict();

    expect(screen.getByRole("button", { name: "Reload latest" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep my edits" })).toBeTruthy();
  });

  it("keeps local edits when reload latest refetch fails", async () => {
    render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "local-edit" },
    });
    triggerRevisionConflict();
    fixtures.refetchProfile.mockResolvedValue({
      isSuccess: false,
      data: {
        ...fixtures.profile,
        activeTheme: {
          ...fixtures.profile.activeTheme,
          footerText: "stale-server-copy",
        },
      },
      error: new Error("network down"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Decorative footer text/)).toHaveProperty(
        "value",
        "local-edit",
      ),
    );
    expect(toast.message).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("applies the server draft when reload latest refetch succeeds", async () => {
    render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "local-edit" },
    });
    triggerRevisionConflict();
    fixtures.refetchProfile.mockResolvedValue({
      isSuccess: true,
      data: {
        ...fixtures.profile,
        revision: 9,
        activeTheme: {
          ...fixtures.profile.activeTheme,
          footerText: "server-copy",
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Decorative footer text/)).toHaveProperty(
        "value",
        "server-copy",
      ),
    );
    expect(toast.message).toHaveBeenCalledWith(
      "Loaded the latest document branding from the server.",
    );
    expect(fixtures.markIdle).toHaveBeenCalled();
  });

  it("re-applies local edits on the latest revision after a successful refetch", async () => {
    render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "local-edit" },
    });
    triggerRevisionConflict();
    fixtures.refetchProfile.mockResolvedValue({
      isSuccess: true,
      data: { ...fixtures.profile, revision: 9 },
    });
    fixtures.saveDraft.mockResolvedValue({
      ...fixtures.profile,
      revision: 10,
      draftTheme: {
        ...fixtures.profile.activeTheme,
        footerText: "local-edit",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));

    await waitFor(() =>
      expect(fixtures.saveDraft).toHaveBeenCalledWith({
        legalEntityId: entity.id,
        expectedRevision: 9,
        theme: expect.objectContaining({ footerText: "local-edit" }),
      }),
    );
    await waitFor(() => expect(fixtures.markSaved).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reload latest" })).toBeNull(),
    );
  });

  it("clears save failed indicator after keep my edits succeeds", async () => {
    fixtures.saveStatus = "error";
    const { rerender } = render(<DocumentBrandingSettings entity={entity} />);
    expect(screen.getByText("Save failed")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "local-edit" },
    });
    triggerRevisionConflict();
    fixtures.refetchProfile.mockResolvedValue({
      isSuccess: true,
      data: { ...fixtures.profile, revision: 9 },
    });
    fixtures.saveDraft.mockResolvedValue({
      ...fixtures.profile,
      revision: 10,
      draftTheme: {
        ...fixtures.profile.activeTheme,
        footerText: "local-edit",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));

    await waitFor(() => expect(fixtures.markSaved).toHaveBeenCalled());
    fixtures.saveStatus = "saved";
    rerender(<DocumentBrandingSettings entity={entity} />);
    expect(screen.queryByText("Save failed")).toBeNull();
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("saves the latest theme when footer changes during keep my edits refetch", async () => {
    let resolveRefetch:
      | ((value: {
          isSuccess: boolean;
          data: typeof fixtures.profile;
        }) => void)
      | undefined;
    fixtures.refetchProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefetch = resolve;
        }),
    );

    render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "before-refetch" },
    });
    triggerRevisionConflict();
    fixtures.saveDraft.mockResolvedValue({
      ...fixtures.profile,
      revision: 10,
      draftTheme: {
        ...fixtures.profile.activeTheme,
        footerText: "after-refetch",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));

    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "after-refetch" },
    });

    await act(async () => {
      resolveRefetch?.({
        isSuccess: true,
        data: { ...fixtures.profile, revision: 9 },
      });
    });

    await waitFor(() =>
      expect(fixtures.saveDraft).toHaveBeenCalledWith({
        legalEntityId: entity.id,
        expectedRevision: 9,
        theme: expect.objectContaining({ footerText: "after-refetch" }),
      }),
    );
  });

  it("autosaves theme edits that land while keep my edits is saving", async () => {
    let resolveSave:
      | ((value: {
          revision: number;
          draftTheme: Record<string, unknown>;
        }) => void)
      | undefined;
    fixtures.refetchProfile.mockResolvedValue({
      isSuccess: true,
      data: { ...fixtures.profile, revision: 9 },
    });
    fixtures.saveDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "local-edit" },
    });
    triggerRevisionConflict();

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));

    await waitFor(() => expect(fixtures.refetchProfile).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "typed-during-put" },
    });

    await act(async () => {
      resolveSave?.({
        revision: 10,
        draftTheme: {
          ...fixtures.profile.activeTheme,
          footerText: "local-edit",
        },
      });
    });

    await waitFor(() => expect(fixtures.markSaved).toHaveBeenCalled());
    await waitFor(() =>
      expect(fixtures.triggerAutoSave).toHaveBeenCalledWith(
        expect.objectContaining({ footerText: "typed-during-put" }),
      ),
    );
  });

  it("ignores a stale reload when the legal entity changes before refetch completes", async () => {
    let resolveRefetch:
      | ((value: {
          isSuccess: boolean;
          data: typeof fixtures.profile;
        }) => void)
      | undefined;
    fixtures.refetchProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefetch = resolve;
        }),
    );

    const { rerender } = render(<DocumentBrandingSettings entity={entity} />);
    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "entity-a-local" },
    });
    triggerRevisionConflict();
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    fixtures.profile.activeTheme = {
      ...fixtures.profile.activeTheme,
      footerText: "entity-b-profile",
    };
    rerender(
      <DocumentBrandingSettings entity={{ ...entity, id: "entity-2" }} />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/Decorative footer text/)).toHaveProperty(
        "value",
        "entity-b-profile",
      ),
    );

    await act(async () => {
      resolveRefetch?.({
        isSuccess: true,
        data: {
          ...fixtures.profile,
          revision: 99,
          activeTheme: {
            ...fixtures.profile.activeTheme,
            footerText: "entity-a-stale-server",
          },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Decorative footer text/)).toHaveProperty(
        "value",
        "entity-b-profile",
      ),
    );
    expect(fixtures.saveDraft).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("does not save when keep my edits cannot refetch the latest profile", async () => {
    render(<DocumentBrandingSettings entity={entity} />);
    triggerRevisionConflict();
    fixtures.refetchProfile.mockResolvedValue({
      isSuccess: false,
      data: fixtures.profile,
      error: new Error("network down"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));

    await waitFor(() => expect(fixtures.saveDraft).not.toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Keep my edits" })).toBeTruthy();
  });

  it("shows a character counter and inline validation for over-limit footer text", () => {
    render(<DocumentBrandingSettings entity={entity} />);

    fireEvent.change(screen.getByLabelText(/Decorative footer text/), {
      target: { value: "x".repeat(121) },
    });

    expect(screen.getByText("121/120")).toBeTruthy();
    expect(
      document.getElementById("brand-footer-text-error")?.textContent,
    ).toContain("120 characters");
  });

  it("offers a manual status refresh when logo validation polling times out", async () => {
    fixtures.assetStatus.data = { id: "asset-1", state: "QUARANTINED" };
    fixtures.assetStatus.pollTimedOut = true;
    const { getByRole } = render(<DocumentBrandingSettings entity={entity} />);

    getByRole("button", { name: "Refresh validation status" }).click();

    expect(fixtures.assetStatus.refetch).toHaveBeenCalledOnce();
  });
});
