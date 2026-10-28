import type { Storage } from '@google-cloud/storage';

type MediaStorage = Pick<Storage, 'authClient' | 'apiEndpoint'>;

type HeaderSource = {
  getRequestHeaders: (
    url?: string,
  ) => Promise<Headers | Record<string, string>>;
};

function mediaUrl(
  storage: MediaStorage,
  bucket: string,
  objectName: string,
): string {
  const endpoint = storage.apiEndpoint || 'https://storage.googleapis.com';
  const objectPath = encodeURIComponent(objectName);
  return `${endpoint}/storage/v1/b/${bucket}/o/${objectPath}?alt=media`;
}

async function authHeaders(
  storage: MediaStorage,
  url: string,
): Promise<Headers> {
  const client =
    (await storage.authClient.getClient()) as Partial<HeaderSource>;
  if (typeof client.getRequestHeaders !== 'function') {
    return new Headers();
  }
  const raw = await client.getRequestHeaders(url);
  return new Headers(raw);
}

function statusError(status: number): Error {
  return Object.assign(new Error(`GCS media ${status}`), { status });
}

export function isRangeNotSatisfiable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const status = (error as { status?: unknown; code?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  return status === 416 || code === 416;
}

/** Authenticated media GET. 416 is returned to the caller as a status error. */
export async function fetchGcsObjectMedia(
  storage: MediaStorage,
  bucket: string,
  objectName: string,
  start?: number,
  end?: number,
): Promise<Buffer> {
  const url = mediaUrl(storage, bucket, objectName);
  const headers = await authHeaders(storage, url);
  if (start !== undefined) {
    headers.set('Range', `bytes=${start}-${end ?? ''}`);
  }
  const response = await fetch(url, { headers });
  if (response.status === 200 || response.status === 206) {
    return Buffer.from(await response.arrayBuffer());
  }
  throw statusError(response.status);
}
