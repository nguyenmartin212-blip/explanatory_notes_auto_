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
import { getItineraryPois, moveItineraryPoi, removePoiFromItinerary, clearItinerary } from '@/features/content/database';
import type { Poi } from '@/features/poi';
import type { MainTabParamList, RootStackParamList } from '@/navigation';
import { colors, radius, spacing } from '@/theme';

type TabNavigation = BottomTabNavigationProp<MainTabParamList, 'Itinerary'>;
type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

export function ItineraryScreen() {
  const navigation = useNavigation<TabNavigation>();
  const rootNavigation = navigation.getParent<RootNavigation>();
  const [pois, setPois] = useState<Poi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPois(await getItineraryPois());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lộ trình.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const openPoi = (poiId: string) => {
    rootNavigation?.navigate('PoiDetail', { poiId, origin: 'manual' });
  };

  const confirmClear = () => {
    Alert.alert('Xóa lộ trình?', 'Các điểm đã chọn sẽ bị xóa khỏi lộ trình trên thiết bị này.', [
      { text: 'Giữ lại', style: 'cancel' },
      {
        text: 'Xóa lộ trình',
        style: 'destructive',
        onPress: () => {
          void clearItinerary().then(refresh).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Không thể xóa lộ trình.');
          });
        },
      },
    ]);
  };

  const updateOrder = async (poiId: string, direction: -1 | 1) => {
    try {
      await moveItineraryPoi(poiId, direction);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật thứ tự lộ trình.');
    }
  };

  const removeStop = async (poiId: string) => {
    try {
      await removePoiFromItinerary(poiId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xóa điểm khỏi lộ trình.');
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>HÀNH TRÌNH CỦA BẠN</Text>
        <Text style={styles.title}>Lộ trình cá nhân</Text>
        <Text style={styles.subtitle}>
          Tự chọn điểm đến, sắp xếp thứ tự và mở từng điểm để nghe thuyết minh.
        </Text>

        {pois.length > 0 && (
          <View style={styles.summary}>
            <Text style={styles.summaryNumber}>{pois.length}</Text>
            <Text style={styles.summaryText}>điểm dừng</Text>
          </View>
        )}

        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {isLoading ? (
          <ActivityIndicator color={colors.teal} style={styles.loader} />
        ) : pois.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>⌁</Text>
            <Text style={styles.emptyTitle}>Lộ trình đang chờ bạn</Text>
            <Text style={styles.emptyText}>
              Mở một điểm đến rồi chọn “Thêm vào lộ trình”. Bạn có thể thay đổi thứ tự bất cứ lúc nào.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Map')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Khám phá điểm đến</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {pois.map((poi, index) => (
              <View key={poi.id} style={styles.stopCard}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openPoi(poi.id)}
                  style={styles.stopMain}
                >
                  <View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>
                  <View style={styles.stopCopy}>
                    <Text style={styles.stopTitle}>{poi.name.vi}</Text>
                    <Text numberOfLines={2} style={styles.stopDescription}>{poi.description.vi}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
                <View style={styles.stopActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Di chuyển ${poi.name.vi} lên`}
                    disabled={index === 0}
                    onPress={() => void updateOrder(poi.id, -1)}
                    style={[styles.actionButton, index === 0 && styles.disabled]}
                  >
                    <Text style={styles.actionText}>↑ Lên</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Di chuyển ${poi.name.vi} xuống`}
                    disabled={index === pois.length - 1}
                    onPress={() => void updateOrder(poi.id, 1)}
                    style={[styles.actionButton, index === pois.length - 1 && styles.disabled]}
                  >
                    <Text style={styles.actionText}>↓ Xuống</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void removeStop(poi.id)}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeText}>Xóa</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Map')}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>＋ Thêm điểm đến</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={confirmClear} style={styles.clearButton}>
              <Text style={styles.clearText}>Xóa toàn bộ lộ trình</Text>
            </Pressable>
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
  summary: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, backgroundColor: colors.green, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8 },
  summaryNumber: { color: colors.teal, fontWeight: '800' },
  summaryText: { color: colors.teal, fontSize: 12, fontWeight: '700' },
  loader: { marginTop: 42 },
  error: { color: colors.error, backgroundColor: '#F8E8E3', borderRadius: radius.md, padding: 12, marginTop: 16 },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: 24, padding: spacing.lg },
  emptyIcon: { color: colors.teal, fontSize: 42 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: radius.md, marginTop: 18, paddingHorizontal: spacing.lg, paddingVertical: 13 },
  primaryButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stopCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: 14, padding: 13 },
  stopMain: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  number: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 20, height: 38, justifyContent: 'center', width: 38 },
  numberText: { color: colors.teal, fontWeight: '800' },
  stopCopy: { flex: 1 },
  stopTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  stopDescription: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  chevron: { color: colors.muted, fontSize: 24 },
  stopActions: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 10 },
  actionButton: { backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  actionText: { color: colors.teal, fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  removeButton: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 8 },
  removeText: { color: colors.error, fontSize: 11, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', borderColor: colors.teal, borderRadius: radius.md, borderWidth: 1, marginTop: 16, padding: 13 },
  secondaryButtonText: { color: colors.teal, fontWeight: '800' },
  clearButton: { alignItems: 'center', padding: 14, marginTop: 5 },
  clearText: { color: colors.error, fontSize: 12, fontWeight: '700' },
});
