export async function jsonRequest(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `API ${response.status}: ${String(body.error?.message ?? body.message ?? body.error_description ?? body.error ?? response.statusText).slice(0, 220)}`,
    );
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body;
}
export const formRequest = (url: string, data: Record<string, string>, signal?: AbortSignal) =>
  jsonRequest(url, { method: 'POST', body: new URLSearchParams(data), signal });
