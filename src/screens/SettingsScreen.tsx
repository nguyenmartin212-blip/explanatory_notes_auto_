import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';

import { Screen } from '@/components';
import {
  getAppPreferences,
  getOfflineContentStats,
  updateAppPreferences,
  type AppPreferences,
} from '@/features/content/database';
import { loadPoisOfflineFirst } from '@/features/content/offline-defense';
import type { SupportedLanguage } from '@/types';
import { colors, radius, spacing } from '@/theme';

const LANGUAGES: { id: SupportedLanguage; label: string; nativeName: string }[] = [
  { id: 'vi', label: 'Tiếng Việt', nativeName: 'VI' },
  { id: 'en', label: 'English', nativeName: 'EN' },
  { id: 'zh', label: '中文', nativeName: '中文' },
  { id: 'ko', label: '한국어', nativeName: '한국어' },
];

export function SettingsScreen() {
  const [preferences, setPreferences] = useState<AppPreferences>({
    language: 'vi',
    autoPlayNarration: false,
  });
  const [permissionStatus, setPermissionStatus] = useState('Đang kiểm tra…');
  const [offlinePoiCount, setOfflinePoiCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const [savedPreferences, permission, stats] = await Promise.all([
        getAppPreferences(),
        Location.getForegroundPermissionsAsync(),
        getOfflineContentStats(),
      ]);
      setPreferences(savedPreferences);
      setPermissionStatus(permission.granted ? 'Đã cấp quyền vị trí' : 'Chưa cấp quyền vị trí');
      setOfflinePoiCount(stats.poiCount);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải cài đặt.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadSettings(); }, [loadSettings]));

  const savePreference = async (next: Partial<AppPreferences>) => {
    try {
      const updated = await updateAppPreferences(next);
      setPreferences(updated);
      setNotice('Cài đặt đã được lưu trên thiết bị này.');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu cài đặt.');
    }
  };

  const requestLocationPermission = async () => {
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(result.granted ? 'Đã cấp quyền vị trí' : 'Chưa cấp quyền vị trí');
      setNotice(result.granted
        ? 'Ứng dụng có thể dùng vị trí khi bạn mở chức năng bản đồ.'
        : 'Bạn có thể tiếp tục dùng ứng dụng mà không bật vị trí.');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể yêu cầu quyền vị trí.');
    }
  };

  const refreshOfflineContent = async () => {
    setIsRefreshing(true);
    setNotice(null);
    try {
      const result = await loadPoisOfflineFirst(preferences.language);
      setOfflinePoiCount(result.pois.length);
      setNotice(result.warning
        ? `Đang dùng dữ liệu đã lưu: ${result.warning}`
        : `Đã cập nhật ${result.pois.length} điểm đến.`);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật nội dung offline.');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>CÁ NHÂN HÓA TRẢI NGHIỆM</Text>
        <Text style={styles.title}>Cài đặt</Text>
        <Text style={styles.subtitle}>Tùy chỉnh ngôn ngữ, thuyết minh và dữ liệu trên thiết bị.</Text>

        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
        {isLoading ? (
          <ActivityIndicator color={colors.teal} style={styles.loader} />
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ngôn ngữ thuyết minh mặc định</Text>
              <Text style={styles.sectionHint}>Áp dụng mặc định khi mở chi tiết POI; phần giao diện hiện dùng tiếng Việt.</Text>
              <View style={styles.languageGrid}>
                {LANGUAGES.map((language) => {
                  const selected = preferences.language === language.id;
                  return (
                    <Pressable
                      key={language.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => void savePreference({ language: language.id })}
                      style={[styles.languageOption, selected && styles.languageOptionSelected]}
                    >
                      <Text style={[styles.languageCode, selected && styles.languageSelectedText]}>
                        {language.nativeName}
                      </Text>
                      <Text style={[styles.languageLabel, selected && styles.languageSelectedText]}>
                        {language.label}
                      </Text>
                      {selected && <Text style={styles.selectedMark}>✓ Đang dùng</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.preferenceRow}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>Tự phát thuyết minh</Text>
                <Text style={styles.preferenceHint}>
                  Tự bắt đầu nghe khi mở chi tiết POI (không áp dụng cho lần quét QR).
                </Text>
              </View>
              <Switch
                accessibilityLabel="Tự phát thuyết minh"
                value={preferences.autoPlayNarration}
                onValueChange={(value) => void savePreference({ autoPlayNarration: value })}
                trackColor={{ false: colors.border, true: colors.teal }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Vị trí</Text>
              <Text style={styles.sectionHint}>
                {permissionStatus}. Chỉ sử dụng khi bạn mở bản đồ hoặc tính năng liên quan.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void requestLocationPermission()}
                style={styles.outlineButton}
              >
                <Text style={styles.outlineButtonText}>Cập nhật quyền vị trí</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Nội dung offline</Text>
              <Text style={styles.sectionHint}>
                {offlinePoiCount === null ? 'Chưa có thống kê nội dung.' : `${offlinePoiCount} điểm đến đã sẵn sàng trên thiết bị.`}
                {' '}Ảnh và audio có thể cần kết nối mạng nếu chưa được tải riêng.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isRefreshing}
                onPress={() => void refreshOfflineContent()}
                style={[styles.outlineButton, isRefreshing && styles.buttonDisabled]}
              >
                {isRefreshing
                  ? <ActivityIndicator color={colors.teal} />
                  : <Text style={styles.outlineButtonText}>Cập nhật dữ liệu điểm đến</Text>}
              </Pressable>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerTitle}>Go to Horizon</Text>
              <Text style={styles.footerText}>Cài đặt và dữ liệu cá nhân được lưu trên thiết bị này.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', marginTop: 6 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  loader: { marginTop: 42 },
  error: { color: colors.error, backgroundColor: '#F8E8E3', borderRadius: radius.md, padding: 12, marginTop: 16 },
  notice: { color: colors.teal, backgroundColor: colors.green, borderRadius: radius.md, fontSize: 12, lineHeight: 18, padding: 12, marginTop: 16 },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: 16, padding: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sectionHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  languageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 13 },
  languageOption: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexGrow: 1, minWidth: '45%', padding: 12 },
  languageOptionSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  languageCode: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  languageLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 5 },
  languageSelectedText: { color: '#fff' },
  selectedMark: { color: '#D8E7E4', fontSize: 10, marginTop: 7 },
  preferenceRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: 12, marginTop: 16, padding: spacing.md },
  preferenceCopy: { flex: 1 },
  preferenceTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  preferenceHint: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  outlineButton: { alignItems: 'center', alignSelf: 'flex-start', borderColor: colors.teal, borderRadius: 11, borderWidth: 1, marginTop: 13, minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 9 },
  outlineButtonText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  buttonDisabled: { opacity: 0.6 },
  footer: { alignItems: 'center', padding: spacing.lg },
  footerTitle: { color: colors.teal, fontSize: 13, fontWeight: '800' },
  footerText: { color: colors.muted, fontSize: 11, marginTop: 5, textAlign: 'center' },
});
