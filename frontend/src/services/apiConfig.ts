export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export function apiMediaUrl(path: string) {
  const base = API_URL ? new URL(`${API_URL}/`, location.origin) : location.origin;
  return new URL(path, base).href;
}
