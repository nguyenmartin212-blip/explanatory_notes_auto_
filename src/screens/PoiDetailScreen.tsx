import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/components';
import { NarrationPlayer } from '@/features/narration/components/NarrationPlayer';
import { useOfflinePoi } from '@/features/content';
import {
  addPoiToItinerary,
  getAppPreferences,
  getItineraryPois,
  isPoiSaved,
  removePoiFromItinerary,
  toggleSavedPoi,
  updateAppPreferences,
  type AppPreferences,
} from '@/features/content/database';
import type { RootStackParamList } from '@/navigation';
import type { SupportedLanguage } from '@/types';
import { colors, radius, spacing } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PoiDetail'>;
const LANGUAGES: { key: SupportedLanguage; label: string }[] = [
  { key: 'vi', label: '🇻🇳 Tiếng Việt' },
  { key: 'en', label: '🇬🇧 English' },
  { key: 'zh', label: '🇨🇳 中文' },
  { key: 'ko', label: '🇰🇷 한국어' },
];

export function PoiDetailScreen({ route }: Props) {
  const { poi, isLoading, error } = useOfflinePoi(route.params.poiId);
  const [language, setLanguage] = useState<SupportedLanguage>('vi');
  const [preferences, setPreferences] = useState<AppPreferences>({
    language: 'vi',
    autoPlayNarration: false,
  });
  const [isSaved, setIsSaved] = useState(false);
  const [isInItinerary, setIsInItinerary] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void Promise.all([
      getAppPreferences(),
      isPoiSaved(route.params.poiId),
      getItineraryPois(),
    ]).then(([savedPreferences, saved, itinerary]) => {
      if (!isCurrent) return;
      setPreferences(savedPreferences);
      setLanguage(savedPreferences.language);
      setIsSaved(saved);
      setIsInItinerary(itinerary.some((item) => item.id === route.params.poiId));
    }).catch((cause: unknown) => {
      if (isCurrent) {
        setActionError(cause instanceof Error ? cause.message : 'Không thể tải cài đặt điểm đến.');
      }
    });
    return () => { isCurrent = false; };
  }, [route.params.poiId]);

  if (isLoading) {
    return (
      <Screen>
        <Text style={styles.notFound}>Đang tải nội dung offline…</Text>
      </Screen>
    );
  }

  if (!poi) {
    return (
      <Screen>
        <Text style={styles.notFound}>{error ?? 'Không tìm thấy điểm thuyết minh.'}</Text>
      </Screen>
    );
  }

  const title = poi.name[language] ?? poi.name.vi;
  const description = poi.description[language] ?? poi.description.vi;
  const script = poi.ttsScript?.[language] ?? poi.ttsScript?.vi;

  const toggleSaved = async () => {
    try {
      setIsSaved(await toggleSavedPoi(poi.id));
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không thể cập nhật điểm đã lưu.');
    }
  };

  const toggleItinerary = async () => {
    try {
      if (isInItinerary) {
        await removePoiFromItinerary(poi.id);
        setIsInItinerary(false);
      } else {
        await addPoiToItinerary(poi.id);
        setIsInItinerary(true);
      }
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không thể cập nhật lộ trình.');
    }
  };

  const changeLanguage = async (nextLanguage: SupportedLanguage) => {
    setLanguage(nextLanguage);
    try {
      const updated = await updateAppPreferences({ language: nextLanguage });
      setPreferences(updated);
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không thể lưu ngôn ngữ.');
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.heroSymbol}>⌖</Text>
          <Text style={styles.heroHint}>GO TO HORIZON · AUDIO GUIDE</Text>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroCaption}>Khám phá câu chuyện phía sau mỗi điểm đến</Text>
        </View>

        <View style={styles.offlineBadge}><Text style={styles.offlineBadgeText}>▣ CONTENT LAYER · SQLITE OFFLINE</Text></View>

        <View style={styles.metaRow}>
          <View style={styles.metaPill}><Text style={styles.metaText}>◎ POI đã xác định</Text></View>
          <View style={styles.metaPill}><Text style={styles.metaText}>◉ Bán kính {poi.radiusMeters} m</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Về địa điểm</Text>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isSaved }}
            onPress={() => void toggleSaved()}
            style={[styles.actionButton, isSaved && styles.actionActive]}
          >
            <Text style={[styles.actionText, isSaved && styles.actionActiveText]}>
              {isSaved ? '♥ Đã lưu' : '♡ Lưu điểm'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isInItinerary }}
            onPress={() => void toggleItinerary()}
            style={[styles.actionButton, isInItinerary && styles.actionActive]}
          >
            <Text style={[styles.actionText, isInItinerary && styles.actionActiveText]}>
              {isInItinerary ? '✓ Trong lộ trình · Gỡ' : '＋ Thêm vào lộ trình'}
            </Text>
          </Pressable>
        </View>
        {actionError && <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text>}

        <Text style={styles.sectionTitle}>Ngôn ngữ thuyết minh</Text>
        <View style={styles.languages}>
          {LANGUAGES.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => void changeLanguage(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: language === item.key }}
              style={[styles.language, language === item.key && styles.languageActive]}
            >
              <Text style={[styles.languageText, language === item.key && styles.languageTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.storyCard}>
          <Text style={styles.storyEyebrow}>✦ LỜI DẪN THUYẾT MINH</Text>
          <Text style={styles.storyText}>{script ?? 'Nội dung đang được cập nhật.'}</Text>
          <Text style={styles.storyNote}>
Nội dung demo được đọc bằng giọng TTS trên thiết bị. Bản thu âm sẽ được ưu tiên nếu POI có đường dẫn audio cho ngôn ngữ đã chọn.
          </Text>
        </View>

        {route.params.origin === 'qr' && (
          <View style={styles.qrActivated}>
            <Text style={styles.qrActivatedText}>▦ Nội dung được kích hoạt bằng QR · không dùng GPS</Text>
          </View>
        )}
        <NarrationPlayer
          poi={poi}
          language={language}
          autoStart={
            route.params.autoplay === true ||
            (route.params.origin !== 'qr' && preferences.autoPlayNarration)
          }
          origin={route.params.origin ?? 'manual'}
        />
        <Text style={styles.disclaimer}>Vị trí và nội dung trong bản demo chỉ mang tính giới thiệu.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  notFound: { color: colors.text, fontSize: 18 },
  hero: { backgroundColor: colors.teal, minHeight: 218, borderRadius: radius.lg, padding: 23, justifyContent: 'flex-end', overflow: 'hidden' },
  heroSymbol: { position: 'absolute', top: 8, right: 22, color: 'rgba(255,255,255,0.16)', fontSize: 110 },
  heroHint: { color: '#F0D0A2', letterSpacing: 1.2, fontSize: 10, fontWeight: '800' },
  heroTitle: { color: '#fff', fontSize: 30, lineHeight: 37, fontWeight: '800', marginTop: 7 },
  heroCaption: { color: '#D8E7E4', fontSize: 12, marginTop: 9 },
  offlineBadge: { alignSelf: 'flex-start', marginTop: 14, backgroundColor: '#E6EFE9', borderRadius: 99, paddingHorizontal: 11, paddingVertical: 7 },
  offlineBadgeText: { color: colors.teal, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 15 },
  metaPill: { backgroundColor: '#E6EFE9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 },
  metaText: { color: colors.teal, fontWeight: '700', fontSize: 11 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 24, marginBottom: 9 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 23 },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  language: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, paddingVertical: 10, backgroundColor: '#fff' },
  languageActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  languageText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  languageTextActive: { color: '#fff' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 },
  actionButton: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  actionActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  actionText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  actionActiveText: { color: '#fff' },
  actionError: { color: colors.error, fontSize: 12, marginTop: 8 },
  storyCard: { marginTop: 20, borderRadius: radius.lg, padding: spacing.md, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: colors.border },
  storyEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  storyText: { color: colors.text, fontSize: 14, lineHeight: 23, marginTop: 10 },
  storyNote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 13 },
  qrActivated: { marginTop: 18, backgroundColor: '#E6EFE9', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  qrActivatedText: { color: colors.teal, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  disclaimer: { marginTop: 14, textAlign: 'center', color: colors.muted, fontSize: 11 },
});
