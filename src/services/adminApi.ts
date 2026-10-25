const CONFIGURED_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Đăng nhập admin dùng cookie httpOnly, và cookie chỉ được gửi lại khi trang web và API cùng "site".
 * `npm run web` đặt API = IP LAN nhưng Expo thường mở trình duyệt ở http://localhost:8081, nên
 * đăng nhập báo thành công rồi mọi request sau đều 401. Khi cả trang lẫn API đều là địa chỉ nội bộ,
 * gọi API bằng đúng hostname mà trang đang dùng.
 */
function resolveApiUrl() {
  if (typeof window === 'undefined') return CONFIGURED_API_URL;
  try {
    const url = new URL(CONFIGURED_API_URL);
    const pageHost = window.location.hostname;
    if (url.hostname !== pageHost && LOCAL_HOST.test(url.hostname) && LOCAL_HOST.test(pageHost)) {
      url.hostname = pageHost;
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Giữ nguyên địa chỉ đã cấu hình nếu không phân tích được.
  }
  return CONFIGURED_API_URL;
}

const API_URL = resolveApiUrl();
export const ADMIN_API_URL = API_URL;

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

  if (response.status === 401 && allowRefresh && path !== '/admin/auth/refresh') {
    const refreshed = await fetch(`${API_URL}/admin/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshed.ok) {
      return send(path, init, false);
    }
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

export function getVisitorVisits(limit: number, offset: number, poiId?: string) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (poiId) query.set('poi_id', poiId);
  return request<AdminPage<VisitorVisit>>(`/admin/visitor-visits?${query}`);
}
