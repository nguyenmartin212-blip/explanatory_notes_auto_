const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type ApiRequestOptions = {
  method?: 'GET' | 'POST'| 'PUT';
  accessToken?: string;
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message ?? `Yêu cầu thất bại (${response.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export function apiGet<T>(path: string, accessToken?: string): Promise<T> {
  return apiRequest<T>(path, { accessToken });
}

export function apiPost<T>(path: string, body: unknown, accessToken?: string,): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body, accessToken });
}

export function apiPut<T>(path: string, body: unknown, accessToken?: string,): Promise<T> {
  return apiRequest<T>(path, { method: 'PUT', body, accessToken,});
}