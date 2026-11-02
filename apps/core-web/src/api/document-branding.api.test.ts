import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getErrorMessage } from "@/lib/error-utils";
import { changeUiLanguage } from "@/lib/i18n";
import { useDocumentBrandProfile, useUploadDocumentBrandAsset } from "./document-branding";
import deErrors from "../../../../locales/de/errors.json";
import enErrors from "../../../../locales/en/errors.json";

const deCodes = deErrors.codes as Record<string, string>;
const enCodes = enErrors.codes as Record<string, string>;

const mocks = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock("./client", () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function failedResponse(status: number, body: Record<string, unknown>) {
  return { ok: false, status, json: vi.fn().mockResolvedValue(body) };
}

async function rejectedRun(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (failure) {
    return failure;
  }
  throw new Error("Expected the branding request to fail.");
}

describe("document branding API helpers", () => {
  beforeEach(() => {
    mocks.fetchWithAuth.mockReset();
  });

  it.each([
    { status: 415, code: "BRAND_FILE_TYPE_UNSUPPORTED" },
    { status: 413, code: "BRAND_UPLOAD_TOO_LARGE" },
  ])(
    "maps a rejected logo upload ($code) to copy in the current UI language",
    async ({ status, code }) => {
      const englishBackendText = "Logo must be PNG (max 2 MiB).";
      mocks.fetchWithAuth.mockResolvedValue(
        failedResponse(status, { code, message: englishBackendText }),
      );
      const { result } = renderHook(() => useUploadDocumentBrandAsset(), {
        wrapper: createWrapper(),
      });

      const failure = await rejectedRun(() =>
        result.current.mutateAsync({
          legalEntityId: "entity-1",
          purpose: "LOGO",
          file: new File(["png"], "logo.png", { type: "image/png" }),
        }),
      );

      expect((failure as Error).message).not.toContain(englishBackendText);
      expect(getErrorMessage(failure, "fallback")).toBe(deCodes[code]);
      await changeUiLanguage("en");
      expect(getErrorMessage(failure, "fallback")).toBe(enCodes[code]);
    },
  );

  it("fails a profile load without a backend code on the status fallback copy", async () => {
    const englishBackendText = "Legal entity not found";
    mocks.fetchWithAuth.mockResolvedValue(
      failedResponse(404, { message: englishBackendText }),
    );
    const { result } = renderHook(() => useDocumentBrandProfile("entity-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.error?.message).not.toContain(englishBackendText);
    expect(getErrorMessage(result.current.error, "fallback")).toBe(
      deCodes.HTTP_404,
    );
  });
});
