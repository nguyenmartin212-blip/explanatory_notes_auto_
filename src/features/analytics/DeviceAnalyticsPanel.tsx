import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '@/theme';
import { getUsageSummary, type AnalyticsPeriod, type UsageSummary } from './api';
 
type Props = {
  accessToken: string;
  onSessionExpired: () => Promise<string | null>;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function DeviceAnalyticsPanel({ accessToken, onSessionExpired }: Props) {
  const [period, setPeriod] = useState<AnalyticsPeriod>('day');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

  const loadSummary = useCallback(async () => {
    setError('');
    try {
      let result: UsageSummary;
      try {
        result = await getUsageSummary(period, accessToken);
      } catch (err) {
        if ((err as Error & { status?: number }).status !== 401) throw err;
        const renewedToken = await onSessionExpired();
        if (!renewedToken) return;
        result = await getUsageSummary(period, renewedToken);
      }
      setSummary(result);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu thống kê.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, onSessionExpired, period]);

  useEffect(() => {
    setLoading(true);
    void loadSummary();
    const interval = setInterval(() => void loadSummary(), 20_000);
    return () => clearInterval(interval);
  }, [loadSummary]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Thống kê thiết bị và lượt sử dụng</Text>
      <Text style={styles.note}>Dữ liệu tự tải khi mở màn hình và làm mới mỗi 20 giây.</Text>

      <Text style={styles.label}>Khoảng thống kê</Text>
      <View style={styles.row}>
        {(['day', 'month'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            onPress={() => setPeriod(value)}
            style={[styles.periodButton, period === value && styles.periodButtonActive]}
          >
            <Text style={[styles.periodText, period === value && styles.periodTextActive]}>
              {value === 'day' ? 'Theo ngày' : 'Theo tháng'}
            </Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void loadSummary(); }} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Làm mới</Text>
        </Pressable>
      </View>

      {loading && !summary && <ActivityIndicator color={colors.teal} />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

      {summary && (
        <View style={styles.results}>
          <Text style={styles.sectionTitle}>Tổng quan</Text>
          <Text style={styles.metric}>Thiết bị đang hoạt động: {summary.active_device_count}</Text>
          <Text style={styles.metric}>Tổng phiên sử dụng: {summary.total_sessions}</Text>
          <Text style={styles.small}>Khoảng dữ liệu: {summary.from} đến {summary.to} ({summary.timezone || 'UTC'})</Text>

          <Text style={styles.sectionTitle}>Thiết bị đang hoạt động</Text>
          {summary.active_devices.length === 0 ? (
            <Text style={styles.small}>Chưa có thiết bị gửi heartbeat trong 2 phút gần nhất.</Text>
          ) : summary.active_devices.map((device) => (
            <View key={`${device.user_id}:${device.device_id}`} style={styles.device}>
              <Text style={styles.deviceName}>{device.device_name || 'Thiết bị không tên'}</Text>
              <Text style={styles.small}>ID: {device.device_id}</Text>
              <Text style={styles.small}>Hoạt động gần nhất: {formatDate(device.last_seen_at)}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>Lượt sử dụng {period === 'day' ? 'theo ngày' : 'theo tháng'}</Text>
          {summary.usage.length === 0 ? <Text style={styles.small}>Chưa có dữ liệu.</Text> : summary.usage.map((item) => (
            <View key={item.period} style={styles.usageRow}>
              <Text style={styles.usagePeriod}>{item.period}</Text>
              <Text style={styles.usageValue}>{item.sessions} phiên · {item.uniqueDevices} thiết bị</Text>
            </View>
          ))}
          <Text style={styles.small}>Cập nhật lần cuối: {lastUpdated || 'đang tải...'}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { paddingBottom: spacing.xl, gap: spacing.sm },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  note: { color: colors.muted, fontSize: 13 },
  label: { color: colors.text, fontWeight: '700', marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  periodButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  periodButtonActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  periodText: { color: colors.text, fontWeight: '600' },
  periodTextActive: { color: '#FFFFFF' },
  refreshButton: { paddingHorizontal: 12, paddingVertical: 9 },
  refreshText: { color: colors.teal, fontWeight: '700' },
  error: { color: colors.error, marginTop: spacing.sm },
  results: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { color: colors.teal, fontSize: 16, fontWeight: '800', marginTop: spacing.sm },
  metric: { color: colors.text, fontSize: 15, fontWeight: '600' },
  small: { color: colors.muted, fontSize: 12 },
  device: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.sm, gap: 3 },
  deviceName: { color: colors.text, fontWeight: '700' },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  usagePeriod: { color: colors.text, fontWeight: '600', flexShrink: 1 },
  usageValue: { color: colors.text, textAlign: 'right' },
});
