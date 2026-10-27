import { apiGet, apiPost, apiPut, apiRequest } from '@/services/apiClient';

export type AdminUser = {
  user_id: string;
  username: string;
  email: string | null;
  role: string | null;
  is_active: boolean;
  permissions: string[];
};

export type AdminSession = {
  token_type: 'bearer';
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  user: AdminUser;
};

export function loginAdmin(username: string, password: string) {
  return apiRequest<AdminSession>('/admin/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function refreshAdminSession(refreshToken: string) {
  return apiRequest<Omit<AdminSession, 'user'>>('/admin/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

export function logoutAdmin(accessToken: string, refreshToken: string) {
  return apiRequest<{ logged_out: boolean }>('/admin/auth/logout', {
    method: 'POST',
    accessToken,
    body: { refresh_token: refreshToken },
  });
}

export type ManagedUser = {
  user_id: string;
  username: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
};

export type ManagedRole = {
  name: string;
  description: string;
  permissions: string[];
  is_default: boolean;
};

export function listAdminUsers(accessToken: string, limit = 50, offset = 0) {
  return apiGet<{
    items: ManagedUser[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/users?limit=${limit}&offset=${offset}`, accessToken);
}

export function createAdminUser(
  accessToken: string,
  data: {
    username: string;
    password: string;
    email?: string | null;
    role: string;
  },
) {
  return apiPost<{ user: ManagedUser }>(
    '/admin/users',
    data,
    accessToken,
  );
}

export function updateAdminUserRole(
  accessToken: string,
  userId: string,
  role: string,
) {
  return apiPut<{ user: ManagedUser }>(
    `/admin/users/${encodeURIComponent(userId)}/role`,
    { role },
    accessToken,
  );
}

export function listAdminRoles(accessToken: string) {
  return apiGet<{ items: ManagedRole[] }>(
    '/admin/roles',
    accessToken,
  );
}

export function updateAdminRole(
  accessToken: string,
  name: string,
  data: { permissions?: string[]; description?: string },
) {
  return apiPut<{ role: ManagedRole }>(
    `/admin/roles/${encodeURIComponent(name)}`,
    data,
    accessToken,
  );
}