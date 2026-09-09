import retry from 'async-retry';

export type PdfUploadResult = {
  bucket: string;
  key: string;
  etag: string | null;
};

const isClientError = (error: unknown): boolean => {
  const maybeStatus = (error as { status?: unknown } | null | undefined)
    ?.status;
  const status = typeof maybeStatus === 'number' ? maybeStatus : undefined;
  return status !== undefined && status >= 400 && status < 500;
};

export async function renderAndUploadPdf(params: {
  render: () => Promise<Buffer>;
  upload: (pdf: Buffer) => Promise<PdfUploadResult>;
  onRetry?: (error: unknown, attempt: number) => void;
}): Promise<PdfUploadResult> {
  return retry(
    async (bail) => {
      try {
        const pdf = await params.render();
        return await params.upload(pdf);
      } catch (error) {
        if (isClientError(error)) {
          bail(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    },
    {
      retries: 2,
      minTimeout: 1000,
      maxTimeout: 5000,
      onRetry: params.onRetry,
    },
  );
}
