import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "./client";
import { createHttpError } from "@/lib/error-utils";

export type DocumentBrandTheme = {
  schemaVersion: 1;
  presetId: "standard-v1";
  logoAssetId: string | null;
  primaryColor: string;
  secondaryColor: string;
  fontId: "acp-sans-v1";
  headerBand: "none" | "primary" | "secondary";
  footerBand: "none" | "primary" | "secondary";
  headerText: string;
  footerText: string;
};

export type DocumentBrandUploadConstraints = {
  maxBytes: number;
  mimeTypes: string[];
  accept: string;
  requirementLabel: string;
};

export type DocumentBrandProfile = {
  revision: number;
  activeRevision: number;
  activeTheme: DocumentBrandTheme;
  draftTheme: DocumentBrandTheme | null;
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  capabilities: {
    extractionAvailable: boolean;
    theme: { decorativeTextMaxCodePoints: number };
    uploads: {
      logo: DocumentBrandUploadConstraints;
      source: DocumentBrandUploadConstraints;
    };
  };
};

export type DocumentBrandAsset = {
  id: string;
  purpose: "SOURCE" | "LOGO";
  state: "QUARANTINED" | "READY" | "REJECTED" | "DELETING" | "DELETED";
  detectedMimeType: string | null;
  byteLength: number;
  pixelWidth: number | null;
  pixelHeight: number | null;
  failureCode: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type DocumentBrandExtraction = {
  id: string;
  state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DISCARDED";
  proposal: DocumentBrandTheme | null;
  warnings: string[];
  baseRevision: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  failureCode: string | null;
};

export const DEFAULT_DOCUMENT_BRAND_THEME: DocumentBrandTheme = {
  schemaVersion: 1,
  presetId: "standard-v1",
  logoAssetId: null,
  primaryColor: "#111827",
  secondaryColor: "#E5E7EB",
  fontId: "acp-sans-v1",
  headerBand: "none",
  footerBand: "none",
  headerText: "",
  footerText: "",
};

export const documentBrandingKeys = {
  all: ["document-branding"] as const,
  profile: (legalEntityId: string) =>
    [...documentBrandingKeys.all, "profile", legalEntityId] as const,
  asset: (legalEntityId: string, assetId: string) =>
    [...documentBrandingKeys.all, "asset", legalEntityId, assetId] as const,
  extraction: (legalEntityId: string, extractionId: string) =>
    [...documentBrandingKeys.all, "extraction", legalEntityId, extractionId] as const,
};

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string; code?: string }
    | undefined;
  return payload?.message ?? fallback;
}

async function throwHttpError(response: Response, fallback: string) {
  throw createHttpError(await readError(response, fallback), response.status);
}

export function documentBrandAssetUploadErrorMessage(
  purpose: "SOURCE" | "LOGO",
  error: unknown,
  constraints: DocumentBrandUploadConstraints | undefined,
): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  if (status === 415 && constraints?.requirementLabel) {
    return constraints.requirementLabel;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return purpose === "LOGO"
    ? "Logo could not be uploaded."
    : "Source file could not be uploaded.";
}

export function useDocumentBrandProfile(legalEntityId: string | null) {
  return useQuery<DocumentBrandProfile>({
    queryKey: documentBrandingKeys.profile(legalEntityId ?? ""),
    enabled: Boolean(legalEntityId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${legalEntityId}/document-branding`,
      );
      if (!response.ok) {
        await throwHttpError(response, "Failed to load document branding");
      }
      return response.json() as Promise<DocumentBrandProfile>;
    },
    refetchOnWindowFocus: true,
  });
}

export function useSaveDocumentBrandDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      legalEntityId: string;
      expectedRevision: number;
      theme: DocumentBrandTheme;
      extractionId?: string;
      signal?: AbortSignal;
    }) => {
      const { legalEntityId, signal, ...body } = payload;
      const response = await fetchWithAuth(
        `/api/legal-entities/${legalEntityId}/document-branding/draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      );
      if (!response.ok) {
        await throwHttpError(response, "Failed to save document branding");
      }
      return response.json() as Promise<DocumentBrandProfile>;
    },
    onSuccess: (profile, payload) => {
      queryClient.setQueryData(
        documentBrandingKeys.profile(payload.legalEntityId),
        profile,
      );
    },
  });
}

export function useConfirmDocumentBranding(action: "confirm" | "reset") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      legalEntityId: string;
      expectedRevision: number;
      idempotencyKey: string;
    }) => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${payload.legalEntityId}/document-branding/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": payload.idempotencyKey,
          },
          body: JSON.stringify({ expectedRevision: payload.expectedRevision }),
        },
      );
      if (!response.ok) {
        await throwHttpError(response, "Failed to confirm document branding");
      }
      return response.json() as Promise<DocumentBrandProfile>;
    },
    onSuccess: (profile, payload) => {
      queryClient.setQueryData(
        documentBrandingKeys.profile(payload.legalEntityId),
        profile,
      );
    },
  });
}

export function useDiscardDocumentBrandDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      legalEntityId: string;
      expectedRevision: number;
    }) => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${payload.legalEntityId}/document-branding/draft?expectedRevision=${payload.expectedRevision}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          "Failed to discard document branding draft",
        );
      }
      return response.json() as Promise<DocumentBrandProfile>;
    },
    onSuccess: (profile, payload) => {
      queryClient.setQueryData(
        documentBrandingKeys.profile(payload.legalEntityId),
        profile,
      );
    },
  });
}

export function usePreviewDocumentBranding() {
  return useMutation({
    mutationFn: async (payload: {
      legalEntityId: string;
      theme: DocumentBrandTheme;
      sample: "AT_STANDARD" | "DE_STANDARD";
    }) => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${payload.legalEntityId}/document-branding/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            theme: payload.theme,
            sample: payload.sample,
          }),
        },
      );
      if (!response.ok) {
        await throwHttpError(response, "Failed to create preview");
      }
      return response.json() as Promise<{
        html: string;
        warnings: string[];
        themeHash: string;
      }>;
    },
  });
}

export function useDocumentBrandAsset(
  legalEntityId: string,
  assetId: string | null,
) {
  const pollingStartedAt = useRef<number | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const query = useQuery<DocumentBrandAsset>({
    queryKey: documentBrandingKeys.asset(legalEntityId, assetId ?? ""),
    enabled: Boolean(legalEntityId && assetId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${legalEntityId}/document-branding/assets/${assetId}`,
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          "Failed to read uploaded asset status",
        );
      }
      return response.json() as Promise<DocumentBrandAsset>;
    },
    refetchInterval: (currentQuery) => {
      const isQuarantined = currentQuery.state.data?.state === "QUARANTINED";
      const startedAt = pollingStartedAt.current;
      const withinPollingLimit =
        startedAt !== null && Date.now() - startedAt < 2 * 60 * 1000;
      return isQuarantined && withinPollingLimit ? 2000 : false;
    },
  });
  useEffect(() => {
    pollingStartedAt.current = assetId ? Date.now() : null;
    setPollTimedOut(false);
  }, [assetId]);
  useEffect(() => {
    if (query.data?.state !== "QUARANTINED" || !assetId) {
      setPollTimedOut(false);
      return;
    }
    const startedAt = pollingStartedAt.current;
    if (startedAt === null) return;
    const remaining = Math.max(
      0,
      2 * 60 * 1000 - (Date.now() - startedAt),
    );
    if (remaining === 0) {
      setPollTimedOut(true);
      return;
    }
    const timeout = setTimeout(() => setPollTimedOut(true), remaining);
    return () => clearTimeout(timeout);
  }, [assetId, query.data?.state]);
  return { ...query, pollTimedOut };
}

export function useUploadDocumentBrandAsset() {
  return useMutation({
    mutationFn: async (payload: {
      legalEntityId: string;
      purpose: "SOURCE" | "LOGO";
      file: File;
    }) => {
      const body = new FormData();
      body.append("purpose", payload.purpose);
      body.append("file", payload.file);
      const response = await fetchWithAuth(
        `/api/legal-entities/${payload.legalEntityId}/document-branding/assets`,
        { method: "POST", body },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          "Failed to upload document branding asset",
        );
      }
      return response.json() as Promise<DocumentBrandAsset>;
    },
  });
}

export function useCreateDocumentBrandExtraction() {
  return useMutation({
    mutationFn: async (payload: {
      legalEntityId: string;
      sourceAssetId: string;
      expectedRevision: number;
      idempotencyKey: string;
    }) => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${payload.legalEntityId}/document-branding/extractions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": payload.idempotencyKey,
          },
          body: JSON.stringify({
            sourceAssetId: payload.sourceAssetId,
            expectedRevision: payload.expectedRevision,
          }),
        },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          "Could not start letterhead extraction",
        );
      }
      return response.json() as Promise<DocumentBrandExtraction>;
    },
  });
}

export function useDocumentBrandExtraction(
  legalEntityId: string,
  extractionId: string | null,
  polling: boolean,
) {
  return useQuery<DocumentBrandExtraction>({
    queryKey: documentBrandingKeys.extraction(legalEntityId, extractionId ?? ""),
    enabled: Boolean(legalEntityId && extractionId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${legalEntityId}/document-branding/extractions/${extractionId}`,
      );
      if (!response.ok) {
        await throwHttpError(response, "Could not read extraction status");
      }
      return response.json() as Promise<DocumentBrandExtraction>;
    },
    refetchInterval: (query) =>
      polling && ["QUEUED", "RUNNING"].includes(query.state.data?.state ?? "")
        ? 2000
        : false,
    refetchOnWindowFocus: false,
  });
}

export function useDiscardDocumentBrandExtraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { legalEntityId: string; extractionId: string }) => {
      const response = await fetchWithAuth(
        `/api/legal-entities/${payload.legalEntityId}/document-branding/extractions/${payload.extractionId}/discard`,
        { method: "POST" },
      );
      if (!response.ok) {
        await throwHttpError(response, "Could not discard extraction");
      }
      return response.json() as Promise<DocumentBrandExtraction>;
    },
    onSuccess: (extraction, payload) => {
      queryClient.setQueryData(
        documentBrandingKeys.extraction(payload.legalEntityId, payload.extractionId),
        extraction,
      );
    },
  });
}
