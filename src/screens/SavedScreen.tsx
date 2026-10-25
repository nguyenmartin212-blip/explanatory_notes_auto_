import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '@/components';
import { getSavedPois, toggleSavedPoi } from '@/features/content/database';
import type { Poi } from '@/features/poi';
import type { MainTabParamList, RootStackParamList } from '@/navigation';
import { colors, radius, spacing } from '@/theme';

type TabNavigation = BottomTabNavigationProp<MainTabParamList, 'Saved'>;
type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

export function SavedScreen() {
  const navigation = useNavigation<TabNavigation>();
  const rootNavigation = navigation.getParent<RootNavigation>();
  const [pois, setPois] = useState<Poi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPois(await getSavedPois());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải điểm đã lưu.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const removePoi = (poi: Poi) => {
    Alert.alert('Bỏ khỏi danh sách đã lưu?', poi.name.vi, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Bỏ lưu',
        style: 'destructive',
        onPress: () => {
          void toggleSavedPoi(poi.id).then(refresh).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Không thể cập nhật điểm đã lưu.');
          });
        },
      },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>BỘ SƯU TẬP CỦA BẠN</Text>
        <Text style={styles.title}>Điểm đã lưu</Text>
        <Text style={styles.subtitle}>Lưu lại những nơi bạn muốn ghé thăm hoặc nghe lại sau.</Text>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {isLoading ? (
          <ActivityIndicator color={colors.teal} style={styles.loader} />
        ) : pois.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>♡</Text>
            <Text style={styles.emptyTitle}>Chưa có điểm nào được lưu</Text>
            <Text style={styles.emptyText}>
              Mở chi tiết một điểm đến và nhấn “Lưu điểm” để thêm vào danh sách này.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Map')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Tìm điểm đến</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.count}>{pois.length} điểm đến đã lưu</Text>
            {pois.map((poi) => (
              <View key={poi.id} style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => rootNavigation?.navigate('PoiDetail', { poiId: poi.id, origin: 'manual' })}
                  style={styles.cardMain}
                >
                  <View style={styles.iconWrap}><Text style={styles.icon}>⌖</Text></View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardTitle}>{poi.name.vi}</Text>
                    <Text numberOfLines={2} style={styles.cardDescription}>{poi.description.vi}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => rootNavigation?.navigate('PoiDetail', { poiId: poi.id, origin: 'manual' })}
                    style={styles.openButton}
                  >
                    <Text style={styles.openText}>Xem chi tiết</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => removePoi(poi)}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeText}>Bỏ lưu</Text>
                  </Pressable>
                </View>
              </View>
            ))}
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
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: 24, padding: spacing.lg },
  emptyIcon: { color: colors.primary, fontSize: 42 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: radius.md, marginTop: 18, paddingHorizontal: spacing.lg, paddingVertical: 13 },
  primaryButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  count: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 22, marginBottom: 2 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: 12, padding: 13 },
  cardMain: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  iconWrap: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 18, height: 38, justifyContent: 'center', width: 38 },
  icon: { color: colors.teal, fontSize: 20 },
  cardCopy: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  cardDescription: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  chevron: { color: colors.muted, fontSize: 24 },
  actions: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10 },
  openButton: { paddingHorizontal: 4, paddingVertical: 6 },
  openText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  removeButton: { paddingHorizontal: 4, paddingVertical: 6 },
  removeText: { color: colors.error, fontSize: 12, fontWeight: '700' },
});
