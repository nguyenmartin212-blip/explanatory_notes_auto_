import { apiGet } from '@/services/apiClient';

export type AnalyticsPeriod = 'day' | 'month';

export type ActiveDevice = {
  user_id: string;
  device_id: string;
  device_name: string;
  last_seen_at: string;
};

export type UsageItem = {
  period: string;
  sessions: number;
  uniqueDevices: number;
};

export type UsageSummary = {
  generated_at: string;
  timezone: string;
  active_device_count: number;
  active_devices: ActiveDevice[];
  period: AnalyticsPeriod;
  from: string;
  to: string;
  usage: UsageItem[];
  total_sessions: number;
};

export function getUsageSummary(period: AnalyticsPeriod, accessToken: string) {
  return apiGet<UsageSummary>(`/api/analytics/usage?period=${period}`, accessToken);
}
