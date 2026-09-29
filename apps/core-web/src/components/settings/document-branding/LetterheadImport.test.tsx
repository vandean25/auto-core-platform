import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LetterheadImport } from "./LetterheadImport";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  discard: vi.fn(),
  extraction: {
    data: null as null | Record<string, unknown>,
    isFetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  pollingStates: [] as boolean[],
  extractionCalls: [] as Array<{
    legalEntityId: string;
    extractionId: string | null;
    enabled: boolean;
  }>,
}));

vi.mock("@/api/document-branding", () => ({
  useCreateDocumentBrandExtraction: () => ({ mutateAsync: mocks.create, isPending: false }),
  useDiscardDocumentBrandExtraction: () => ({ mutateAsync: mocks.discard, isPending: false }),
  useDocumentBrandExtraction: (legalEntityId: string, extractionId: string | null, enabled: boolean) => {
    mocks.pollingStates.push(enabled);
    mocks.extractionCalls.push({ legalEntityId, extractionId, enabled });
    return mocks.extraction;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.extraction.data = null;
  mocks.pollingStates = [];
  mocks.extractionCalls = [];
  sessionStorage.clear();
  mocks.create.mockReset();
  mocks.discard.mockReset();
  mocks.extraction.refetch.mockReset();
});

describe("LetterheadImport", () => {
  it("explains manual fallback when extraction is unavailable", () => {
    render(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText(/configure the profile manually/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Extract suggestions" })).toBeNull();
  });

  it("applies a successful proposal through the draft callback without confirming", async () => {
    sessionStorage.setItem("acp.document-brand-extraction.entity-1", "extraction-1");
    const theme = {
      schemaVersion: 1,
      presetId: "standard-v1",
      logoAssetId: "logo-1",
      primaryColor: "#123456",
      secondaryColor: "#E5E7EB",
      fontId: "acp-sans-v1",
      headerBand: "none",
      footerBand: "none",
      headerText: "Example",
      footerText: "",
    };
    mocks.extraction.data = {
      id: "extraction-1",
      state: "SUCCEEDED",
      proposal: theme,
      warnings: [],
      baseRevision: 4,
    };
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use proposal in draft" }));

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith(theme, "extraction-1"),
    );
  });

  it("discards an unfinished extraction and stops polling", async () => {
    mocks.extraction.data = {
      id: "extraction-1",
      state: "RUNNING",
      proposal: null,
      warnings: [],
      baseRevision: 4,
    };
    mocks.create.mockResolvedValue({ id: "extraction-1", state: "RUNNING" });
    render(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Extract suggestions" }));
    await waitFor(() => expect(mocks.pollingStates.at(-1)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Discard extraction" }));

    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith({
      legalEntityId: "entity-1",
      extractionId: "extraction-1",
    }));
    await waitFor(() => expect(mocks.pollingStates.at(-1)).toBe(false));
    expect(
      screen.getByRole("button", { name: "Extract suggestions" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(sessionStorage.getItem("acp.document-brand-extraction.entity-1")).toBe(
      "extraction-1",
    );
  });

  it("restores a completed extraction after remount without polling", async () => {
    const theme = {
      schemaVersion: 1,
      presetId: "standard-v1",
      logoAssetId: "logo-1",
      primaryColor: "#123456",
      secondaryColor: "#E5E7EB",
      fontId: "acp-sans-v1",
      headerBand: "none",
      footerBand: "none",
      headerText: "Example",
      footerText: "",
    };
    sessionStorage.setItem("acp.document-brand-extraction.entity-1", "extraction-1");
    mocks.extraction.data = {
      id: "extraction-1",
      state: "SUCCEEDED",
      proposal: theme,
      warnings: [],
      baseRevision: 4,
    };

    render(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() =>
      expect(mocks.extractionCalls).toContainEqual({
        legalEntityId: "entity-1",
        extractionId: "extraction-1",
        enabled: false,
      }),
    );
    expect(await screen.findByRole("button", { name: "Use proposal in draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard proposal" })).toBeTruthy();
    expect(mocks.pollingStates.at(-1)).toBe(false);
  });

  it("polls a restored active extraction until it becomes terminal", async () => {
    sessionStorage.setItem("acp.document-brand-extraction.entity-1", "extraction-1");
    mocks.extraction.data = {
      id: "extraction-1",
      state: "RUNNING",
      proposal: null,
      warnings: [],
      baseRevision: 4,
    };
    const { rerender } = render(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => expect(mocks.pollingStates.at(-1)).toBe(true));

    mocks.extraction.data = {
      id: "extraction-1",
      state: "SUCCEEDED",
      proposal: null,
      warnings: [],
      baseRevision: 4,
    };
    rerender(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => expect(mocks.pollingStates.at(-1)).toBe(false));
    expect(sessionStorage.getItem("acp.document-brand-extraction.entity-1")).toBe(
      "extraction-1",
    );
  });

  it("keeps restored polling capped until refresh starts a new two-minute window", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("acp.document-brand-extraction.entity-1", "extraction-1");
    mocks.extraction.data = {
      id: "extraction-1",
      state: "RUNNING",
      proposal: null,
      warnings: [],
      baseRevision: 4,
    };
    render(
      <LetterheadImport
        legalEntityId="entity-1"
        sourceAssetId="source-1"
        expectedRevision={4}
        enabled
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(mocks.pollingStates.at(-1)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(mocks.pollingStates.at(-1)).toBe(false);
    expect(screen.getByRole("button", { name: "Refresh extraction status" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh extraction status" }));

    expect(mocks.pollingStates.at(-1)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(mocks.pollingStates.at(-1)).toBe(false);
    expect(screen.getByRole("button", { name: "Refresh extraction status" })).toBeTruthy();
  });

  it("does not expose the previous entity's extraction after switching entities", async () => {
    sessionStorage.setItem("acp.document-brand-extraction.entity-1", "extraction-1");
    sessionStorage.setItem("acp.document-brand-extraction.entity-2", "extraction-2");
    mocks.extraction.data = {
      id: "extraction-1",
      state: "SUCCEEDED",
      proposal: null,
      warnings: [],
      baseRevision: 4,
    };
    const props = {
      sourceAssetId: "source-1",
      expectedRevision: 4,
      enabled: true,
      onApply: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(
      <LetterheadImport legalEntityId="entity-1" {...props} />,
    );

    rerender(<LetterheadImport legalEntityId="entity-2" {...props} />);

    expect(mocks.extractionCalls.at(-1)).toEqual({
      legalEntityId: "entity-2",
      extractionId: "extraction-2",
      enabled: false,
    });
    expect(screen.queryByText(/Extraction: succeeded/i)).toBeNull();
  });
});
