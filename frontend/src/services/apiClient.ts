import { API_URL } from './apiConfig';

export class ApiError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(detail || `Yêu cầu API thất bại (HTTP ${status}).`);
  }
}

async function assertSuccess(response: Response) {
  if (response.ok) return;
  const error = await response.json().catch(() => null) as { detail?: unknown } | null;
  throw new ApiError(response.status, typeof error?.detail === 'string' ? error.detail : undefined);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  await assertSuccess(response);
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await assertSuccess(response);
  return response.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { method: 'DELETE' });
  await assertSuccess(response);
}
