export const API_KEY = import.meta.env.VITE_API_KEY;

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  } else {
    console.warn('VITE_API_KEY is not set');
  }

  const config: RequestInit = {
    ...init,
    headers,
  };

  return fetch(input, config);
}
