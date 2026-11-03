import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentBrandAsset } from "@/api/document-branding";
import { changeUiLanguage } from "@/lib/i18n";
import { createHttpError } from "@/lib/error-utils";
import { DEFAULT_UI_LANGUAGE } from "@/lib/i18n/constants";
import deSettings from "../../../../../../locales/de/settings.json";
import enSettings from "../../../../../../locales/en/settings.json";
import { LetterheadSourceAsset } from "./LetterheadSourceAsset";

const sourceCopy = deSettings.documentBranding.letterheadSource;

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  attach: vi.fn(),
  remove: vi.fn(),
  uploadPending: false,
  attachPending: false,
  removePending: false,
  assetQuery: {
    data: null as DocumentBrandAsset | null,
    isFetching: false,
    pollTimedOut: false,
    refetch: vi.fn(),
  },
  fetchWithAuth: vi.fn(),
}));

vi.mock("@/api/document-branding", () => ({
  documentBrandingKeys: {
    all: ["document-branding"],
    profile: (legalEntityId: string) => [
      "document-branding",
      "profile",
      legalEntityId,
    ],
    asset: (legalEntityId: string, assetId: string) => [
      "document-branding",
      "asset",
      legalEntityId,
      assetId,
    ],
  },
  useUploadDocumentBrandAsset: () => ({
    mutateAsync: mocks.upload,
    isPending: mocks.uploadPending,
  }),
  useAttachDocumentBrandDraftSource: () => ({
    mutateAsync: mocks.attach,
    isPending: mocks.attachPending,
  }),
  useRemoveDocumentBrandDraftSource: () => ({
    mutateAsync: mocks.remove,
    isPending: mocks.removePending,
  }),
  useDocumentBrandAsset: () => mocks.assetQuery,
}));

vi.mock("@/api/client", () => ({
  fetchWithAuth: (...args: unknown[]) => mocks.fetchWithAuth(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    message: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function renderSource(
  props: Partial<React.ComponentProps<typeof LetterheadSourceAsset>> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onProfileUpdated = vi.fn();
  const getExpectedRevision =
    props.getExpectedRevision ?? (() => 4);

  const result = render(
    <QueryClientProvider client={client}>
      <LetterheadSourceAsset
        legalEntityId="entity-1"
        entityActive={props.entityActive ?? true}
        getExpectedRevision={getExpectedRevision}
        draftSourceAssetId={props.draftSourceAssetId ?? null}
        initialAsset={props.initialAsset ?? null}
        extractionAvailable={props.extractionAvailable ?? false}
        onProfileUpdated={onProfileUpdated}
      />
    </QueryClientProvider>,
  );
  return { ...result, onProfileUpdated };
}

const readyAsset: DocumentBrandAsset = {
  id: "source-1",
  purpose: "SOURCE",
  state: "READY",
  detectedMimeType: "image/png",
  byteLength: 2048,
  pixelWidth: 100,
  pixelHeight: 50,
  failureCode: null,
  originalFilename: "letterhead.png",
  pagePreviewAvailable: false,
  createdAt: "2026-09-30T12:00:00.000Z",
  expiresAt: null,
};

const quarantinedAsset: DocumentBrandAsset = {
  ...readyAsset,
  state: "QUARANTINED",
  detectedMimeType: "application/pdf",
  pagePreviewAvailable: false,
};

afterEach(async () => {
  cleanup();
  await changeUiLanguage(DEFAULT_UI_LANGUAGE);
  mocks.upload.mockReset();
  mocks.attach.mockReset();
  mocks.remove.mockReset();
  mocks.fetchWithAuth.mockReset();
  mocks.assetQuery.data = null;
  mocks.assetQuery.pollTimedOut = false;
  mocks.uploadPending = false;
  mocks.attachPending = false;
  mocks.removePending = false;
});

describe("LetterheadSourceAsset", () => {
  it("attaches with the latest revision when autosave bumps revision during upload", async () => {
    let revision = 4;
    const profile = {
      revision: 5,
      activeRevision: 3,
      draftSourceAssetId: "asset-new",
    };

    mocks.upload.mockImplementation(async () => {
      revision = 5;
      return {
        id: "asset-new",
        purpose: "SOURCE",
        state: "QUARANTINED",
        detectedMimeType: "application/pdf",
        byteLength: 1000,
        pixelWidth: null,
        pixelHeight: null,
        failureCode: null,
        originalFilename: "letter.pdf",
        pagePreviewAvailable: false,
        createdAt: "2026-09-30T12:00:00.000Z",
        expiresAt: null,
      };
    });
    mocks.attach.mockImplementation(async (payload) => {
      expect(payload.expectedRevision).toBe(5);
      expect(payload.sourceAssetId).toBe("asset-new");
      return profile;
    });

    renderSource({
      getExpectedRevision: () => revision,
    });

    const input = document.getElementById("brand-source") as HTMLInputElement;
    const file = new File(["pdf"], "letter.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mocks.attach).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.attach.mock.calls[0][0].expectedRevision).toBe(5),
    );
  });

  it("retries attach once after a revision conflict", async () => {
    const refreshedProfile = {
      revision: 6,
      activeRevision: 3,
      draftSourceAssetId: "asset-new",
    };
    mocks.upload.mockResolvedValue({
      id: "asset-new",
      purpose: "SOURCE",
      state: "QUARANTINED",
      detectedMimeType: "application/pdf",
      byteLength: 1000,
      pixelWidth: null,
      pixelHeight: null,
      failureCode: null,
      originalFilename: "letter.pdf",
      pagePreviewAvailable: false,
      createdAt: "2026-09-30T12:00:00.000Z",
      expiresAt: null,
    });
    mocks.attach
      .mockRejectedValueOnce(
        createHttpError("Konflikt", 409, { code: "BRAND_REVISION_CONFLICT" }),
      )
      .mockResolvedValueOnce(refreshedProfile);
    mocks.fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => refreshedProfile,
    });

    const { onProfileUpdated } = renderSource({
      getExpectedRevision: () => 4,
    });

    const input = document.getElementById("brand-source") as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["pdf"], "letter.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => expect(mocks.attach).toHaveBeenCalledTimes(2));
    expect(mocks.attach.mock.calls[1][0].expectedRevision).toBe(6);
    await waitFor(() =>
      expect(onProfileUpdated).toHaveBeenCalledWith(refreshedProfile),
    );
  });

  it("keeps remove and replace enabled while a quarantined source is validating", () => {
    mocks.assetQuery.data = quarantinedAsset;
    renderSource({
      draftSourceAssetId: "source-1",
      initialAsset: quarantinedAsset,
    });

    expect(screen.getByRole("button", { name: sourceCopy.replace })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: sourceCopy.remove })).not.toBeDisabled();
  });

  it("disables remove while upload or attach is in flight", () => {
    mocks.assetQuery.data = quarantinedAsset;
    mocks.uploadPending = true;
    renderSource({
      draftSourceAssetId: "source-1",
      initialAsset: quarantinedAsset,
    });
    expect(screen.getByRole("button", { name: sourceCopy.remove })).toBeDisabled();

    cleanup();
    mocks.uploadPending = false;
    mocks.attachPending = true;
    renderSource({
      draftSourceAssetId: "source-1",
      initialAsset: quarantinedAsset,
    });
    expect(screen.getByRole("button", { name: sourceCopy.remove })).toBeDisabled();
  });

  it("disables replace and remove when the legal entity is inactive", () => {
    mocks.assetQuery.data = readyAsset;
    renderSource({
      entityActive: false,
      draftSourceAssetId: "source-1",
      initialAsset: readyAsset,
    });
    expect(screen.getByRole("button", { name: sourceCopy.replace })).toBeDisabled();
    expect(screen.getByRole("button", { name: sourceCopy.remove })).toBeDisabled();
    expect(screen.getByRole("button", { name: sourceCopy.download })).not.toBeDisabled();
  });

  it("shows validation status for a quarantined asset", () => {
    mocks.assetQuery.data = quarantinedAsset;
    renderSource({
      draftSourceAssetId: "source-1",
      initialAsset: quarantinedAsset,
    });

    expect(screen.getByRole("status")).toHaveTextContent(/Datei wird geprüft/i);
  });

  it("keeps one short hint line under the letterhead upload with the details behind the info icon", () => {
    renderSource();

    expect(deSettings.documentBranding.letterheadSource.hint.length).toBeLessThanOrEqual(60);
    expect(enSettings.documentBranding.letterheadSource.hint.length).toBeLessThanOrEqual(60);
    expect(screen.getByText(sourceCopy.hint)).toBeInTheDocument();
    expect(screen.queryByText(sourceCopy.info)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: sourceCopy.infoAria }),
    ).toBeInTheDocument();
  });

  // jsdom does not synthesize keyboard or touch activation of a native button;
  // the real-browser phone spec e2e/settings-compact-texts-phone.spec.ts covers Enter activation.
  for (const language of ["de", "en"] as const) {
    it(`AUT-901: activates the letterhead info icon by click in ${language} and shows the moved guidance`, async () => {
      await changeUiLanguage(language);
      const copy =
        language === "de"
          ? deSettings.documentBranding.letterheadSource
          : enSettings.documentBranding.letterheadSource;
      renderSource();

      expect(screen.queryByText(copy.info)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: copy.infoAria }));
      expect(screen.getByText(copy.info)).toBeInTheDocument();
    });
  }
});
