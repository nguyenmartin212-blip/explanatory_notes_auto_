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
  features?: { roles: boolean; visits: boolean; device_usage: boolean; audio_queue: boolean };
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
      detail?: string | { message?: string } | { loc: (string | number)[]; msg: string }[];
      message?: string;
    };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map(({ loc, msg }) => `${loc.slice(1).join('.')} — ${msg}`).join('\n');
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

export type PoiInput = {
  region_id: number;
  category_id: number | null;
  name_vi: string;
  description_vi: string;
  latitude: number;
  longitude: number;
  trigger_radius: number;
  audio_priority: number;
  cover_image_url: string | null;
  image_urls: string[];
};
export type AdminPoi = PoiInput & { id: number; is_active: boolean };
export type AdminCategory = { id: number; name_vi: string };
export type Localization = {
  lang_code: string;
  name: string;
  description: string;
  audio_url: string | null;
  audio_status: string;
  is_machine_translated: boolean;
};
export type AudioTask = {
  task_id: string;
  poi_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  error: string | null;
  updated_at: string;
};
export type AdminQr = { id: number; code: string; label: string; poi_id: number | null; is_active: boolean };
type AdminStats = {
  online_now: number;
  total_sessions: number;
  unique_visitors: number;
  total_qr_scans: number;
  scans_last_7_days: { date: string; count: number }[];
  visitors_last_7_days: { date: string; count: number }[];
  top_pois_by_views: { poi_id: number; name: string; count: number }[];
  top_pois_by_plays: { poi_id: number; name: string; count: number }[];
};

const base = '/api/v1/admin';
const poiBase = `${base}/pois`;
const qrBase = `${base}/qr`;
const usersBase = `${base}/auth/users`;
const body = (method: string, value: unknown) => ({ method, body: JSON.stringify(value) });

export async function listAdminPois() {
  const result: AdminPoi[] = [];
  const limit = 200;
  for (let skip = 0; ; skip += limit) {
    const page = await request<AdminPoi[]>(`${poiBase}?skip=${skip}&limit=${limit}`);
    result.push(...page);
    if (page.length < limit) return result;
  }
}

export const getAdminPoi = (id: number) => request<AdminPoi>(`${poiBase}/${id}`);
export const getCategories = () => request<AdminCategory[]>(`${poiBase}/categories`);
export const createPoi = (data: PoiInput) => request<AdminPoi>(poiBase, body('POST', data));
export const updatePoi = (id: number, data: PoiInput) => request<AdminPoi>(`${poiBase}/${id}`, body('PUT', data));
export const deletePoi = (id: number) => send(`${poiBase}/${id}`, { method: 'DELETE' });
export const activatePoi = (id: number, is_active: boolean) =>
  request<AdminPoi>(`${poiBase}/${id}/activation`, body('PATCH', { is_active }));
export const listLocalizations = (id: number) => request<Localization[]>(`${poiBase}/${id}/localizations`);
export const saveLocalization = (id: number, lang: string, name: string, description: string) =>
  request<Localization>(`${poiBase}/${id}/localizations/${encodeURIComponent(lang)}`, body('PUT', { name, description }));
export const generateAudio = (id: number, langs: string[]) =>
  request<{ task_id: string | null; detail: string }>(`${poiBase}/${id}/generate-audio`, body('POST', { langs }));

export const listQr = () => request<AdminQr[]>(qrBase);
export const createQr = (data: Pick<AdminQr, 'code' | 'label' | 'poi_id'>) =>
  request<AdminQr>(qrBase, body('POST', data));
export const updateQr = (id: number, data: Pick<AdminQr, 'label' | 'poi_id' | 'is_active'>) =>
  request<AdminQr>(`${qrBase}/${id}`, body('PATCH', data));
export const deleteQr = (id: number) => send(`${qrBase}/${id}`, { method: 'DELETE' });

export const getAdminStats = () => request<AdminStats>(`${base}/stats/summary`);
export const createAdminAccount = (data: { username: string; password: string; role: string }) =>
  send(usersBase, body('POST', data));
export const setAccountActive = (id: string, is_active: boolean) =>
  send(`${usersBase}/${encodeURIComponent(id)}`, body('PATCH', { is_active }));
export const resetAccountPassword = (id: string, new_password: string) =>
  send(`${usersBase}/${encodeURIComponent(id)}/reset-password`, body('POST', { new_password }));
export const deleteAdminAccount = (id: string) => send(`${usersBase}/${encodeURIComponent(id)}`, { method: 'DELETE' });

export async function streamAudioTasks(signal: AbortSignal, onTasks: (tasks: AudioTask[], snapshot: boolean) => void) {
  const response = await send(`${poiBase}/audio-tasks/stream`, { signal, headers: { Accept: 'text/event-stream' } });
  if (!response.body) throw new Error('Không mở được kết nối trạng thái audio.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value;
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const [event, data] = buffer.slice(0, end).split('\n');
        if (data?.startsWith('data: ')) {
          if (event === 'event: snapshot') onTasks((JSON.parse(data.slice(6)) as { tasks: AudioTask[] }).tasks, true);
          if (event === 'event: task') onTasks([JSON.parse(data.slice(6)) as AudioTask], false);
        }
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
