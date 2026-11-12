import { API_URL } from './apiConfig';

export type AdminUser = {
  user_id: string;
  username: string;
  email?: string | null;
  role: string;
  is_active: boolean;
  is_poi_owner_verified?: boolean;
  owner_status?: string;
  created_at?: string;
  last_login_at?: string | null;
  permissions?: string[];
};

export type AdminRole = {
  name: string;
  description: string;
  permissions: string[];
  is_default: boolean;
};

export type VisitorVisit = {
  visit_id: string;
  poi_id: string;
  status: 'inside' | 'exited';
  entered_at: string;
  exited_at: string | null;
  exit_method: 'manual' | 'geofence' | null;
  saved_itinerary: { poi_ids: string[]; saved_at?: string } | null;
};

export type AdminPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

async function readError(response: Response) {
  try {
    const body = await response.json() as {
      detail?: string | { message?: string };
      message?: string;
    };
    if (typeof body.detail === 'string') return body.detail;
    if (body.detail?.message) return body.detail.message;
    if (body.message) return body.message;
  } catch {
    // Use the HTTP status when the server does not return JSON.
  }
  return `Yêu cầu thất bại (HTTP ${response.status}).`;
}

let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_URL}/admin/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  }).then((response) => response.ok).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function send(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && allowRefresh && !init.signal?.aborted && await refreshSession()) {
    return send(path, init, false);
  }

  if (!response.ok) {
    throw new AdminApiError(await readError(response), response.status);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit, allowRefresh = true): Promise<T> {
  const response = await send(path, init, allowRefresh);
  return response.json() as Promise<T>;
}

export function adminLogin(username: string, password: string) {
  return request<{ user: AdminUser }>('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, false);
}

export function adminLogout() {
  return send('/admin/auth/logout', { method: 'POST' });
}

export function getAdminMe() {
  return request<AdminUser>('/admin/auth/me');
}

export function getAdminUsers(limit: number, offset: number) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request<AdminPage<AdminUser>>(`/admin/users?${query}`);
}

export function assignUserRole(userId: string, role: string) {
  return request<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export function getAdminRoles() {
  return request<AdminRole[]>('/admin/roles');
}

export function updateAdminRole(
  name: string,
  changes: { permissions: string[]; description?: string },
) {
  return request<AdminRole>(`/admin/roles/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

export type UsagePeriod = 'day' | 'month';
export type DeviceUsageReport = {
  generated_at: string;
  timezone: 'UTC';
  active_device_count: number;
  active_devices: {
    user_id: string;
    device_id: string;
    device_name: string;
    last_seen_at: string;
  }[];
  period: UsagePeriod;
  from: string;
  to: string;
  usage: { period: string; sessions: number; uniqueDevices: number }[];
  total_sessions: number;
};

export function getDeviceUsage(filters: { period: UsagePeriod; from: string; to: string }, signal: AbortSignal) {
  const query = new URLSearchParams({ period: filters.period });
  if (filters.from && filters.to) {
    query.set('from', filters.from);
    query.set('to', filters.to);
  }
  return request<DeviceUsageReport>(`/api/analytics/usage?${query}`, { signal });
}

export function sendDeviceHeartbeat(deviceId: string, signal: AbortSignal) {
  return send('/api/analytics/devices/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId, device_name: 'Trình duyệt Web' }),
    signal,
  });
}

export function getVisitorVisits(limit: number, offset: number, poiId?: string) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (poiId) query.set('poi_id', poiId);
  return request<AdminPage<VisitorVisit>>(`/admin/visitor-visits?${query}`);
}
