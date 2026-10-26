import { apiRequest } from '@/services/apiClient';

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
