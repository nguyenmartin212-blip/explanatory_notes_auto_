import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useOfflinePois } from '@/features/content';
import type { Poi } from '@/features/poi';
import type { MainTabParamList, RootStackParamList } from '@/navigation';
import { colors, radius, spacing } from '@/theme';

type HomeTabNavigation = BottomTabNavigationProp<MainTabParamList, 'Home'>;
type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

const DEMO_IMAGES: Record<string, string> = {
  'hue-imperial-city':
    'https://images.unsplash.com/photo-1557750255-c76072a7aad1?auto=format&fit=crop&w=1400&q=85',
  'hanoi-thang-long':
    'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1000&q=85',
  'saigon-ben-thanh':
    'https://images.unsplash.com/photo-1509030450996-dd1a26dda07a?auto=format&fit=crop&w=1000&q=85',
};

const FILTERS = ['Tất cả', 'Di sản', 'Tâm linh', 'Văn hóa'] as const;

function imageForPoi(poi: Poi) {
  return (
    poi.images[0] ??
    DEMO_IMAGES[poi.id] ??
    DEMO_IMAGES['hue-imperial-city']
  );
}

function categoryForPoi(poi: Poi) {
  if (poi.id.includes('hue') || poi.id.includes('thang-long')) return 'Di sản';
  if (poi.id.includes('saigon') || poi.id.includes('ben-thanh')) return 'Văn hóa';
  return 'Di sản';
}

function metaForPoi(poi: Poi) {
  if (poi.id === 'hue-imperial-city') {
    return {
      kicker: 'DI SẢN UNESCO',
      subtitle: 'Dấu son của một triều đại',
      duration: '12 phút',
      distance: '350 m',
    };
  }

  if (poi.id === 'hanoi-thang-long') {
    return {
      kicker: 'DI SẢN LỊCH SỬ',
      subtitle: 'Những lớp ký ức giữa lòng Hà Nội',
      duration: '10 phút',
      distance: '—',
    };
  }

  return {
    kicker: 'VĂN HÓA ĐỊA PHƯƠNG',
    subtitle: 'Một lát cắt của đời sống đô thị',
    duration: '8 phút',
    distance: '—',
  };
}

export function HomeScreen() {
  const navigation = useNavigation<HomeTabNavigation>();
  const rootNavigation = navigation.getParent<RootNavigation>();
  const { pois, isLoading, error } = useOfflinePois();

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Tất cả');

  const featuredPoi =
    pois.find((poi) => poi.id === 'hue-imperial-city') ??
    pois[0] ??
    null;

  const filteredPois = useMemo(() => {
    if (filter === 'Tất cả') return pois;
    return pois.filter((poi) => categoryForPoi(poi) === filter);
  }, [filter, pois]);

  function openPoi(poi: Poi) {
    rootNavigation?.navigate('PoiDetail', {
      poiId: poi.id,
      origin: 'manual',
    });
  }

  function openQr() {
    rootNavigation?.navigate('QrScanner');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <Text style={styles.sun}>☼</Text>
          <Text style={styles.brandText}>Go to Horizon</Text>
        </View>

        <View style={styles.topbarRight}>
          <View style={styles.locationStatus}>
            <View style={styles.locationDot} />
            <Text style={styles.locationText}>Huế · bản demo</Text>
          </View>

          <Pressable
            onPress={openQr}
            accessibilityRole="button"
            accessibilityLabel="Mở máy quét QR"
            style={({ pressed }) => [
              styles.qrButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.qrButtonText}>▦</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeading}>
          <Text style={styles.greeting}>CHÀO AN, MỘT NGÀY ĐẸP ĐỂ KHÁM PHÁ</Text>
          <Text style={styles.title}>Lắng nghe những miền di sản.</Text>
          <Text style={styles.subtitle}>
            Mỗi bước chân, một câu chuyện. Khám phá Việt Nam theo cách của bạn.
          </Text>
        </View>

        <Pressable
          disabled={!featuredPoi}
          onPress={() => {
            if (featuredPoi) openPoi(featuredPoi);
          }}
          style={({ pressed }) => [
            styles.heroPressable,
            pressed && styles.pressed,
          ]}
        >
          <ImageBackground
            source={{ uri: featuredPoi ? imageForPoi(featuredPoi) : DEMO_IMAGES['hue-imperial-city'] }}
            resizeMode="cover"
            imageStyle={styles.heroImage}
            style={styles.hero}
          >
            <View style={styles.heroShade} />

            <View style={styles.heroPage}>
              <Text style={styles.heroPageText}>01 / 03</Text>
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.heroKicker}>— HUẾ · MIỀN DI SẢN</Text>
              <Text style={styles.heroTitle}>Có những câu chuyện chỉ Huế mới kể.</Text>
              <Text style={styles.heroDescription}>
                Qua những mái ngói rêu phong, lắng nghe nhịp thở của một kinh đô xưa.
              </Text>

              <View style={styles.heroCta}>
                <Text style={styles.heroCtaText}>Khám phá Đại Nội</Text>
                <Text style={styles.heroCtaArrow}>→</Text>
              </View>
            </View>

            <View style={styles.heroNote}>
              <Text style={styles.heroNoteIcon}>♬</Text>
              <Text style={styles.heroNoteText}>Lắng nghe di sản, chạm vào lịch sử</Text>
            </View>
          </ImageBackground>
        </Pressable>

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionHeadingCopy}>
              <Text style={styles.sectionEyebrow}>GẦN BẠN, NGAY LÚC NÀY</Text>
              <Text style={styles.sectionTitle}>Một vài nơi đáng dừng chân</Text>
            </View>

            <Pressable
              onPress={() => navigation.navigate('Map')}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.textButton}>Xem bản đồ  →</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((item) => {
              const active = item === filter;
              return (
                <Pressable
                  key={item}
                  onPress={() => setFilter(item)}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.teal} />
              <Text style={styles.loadingText}>Đang chuẩn bị những câu chuyện gần bạn...</Text>
            </View>
          ) : error ? (
            <View style={styles.loadingCard}>
              <Text style={styles.errorTitle}>Chưa tải được nội dung offline</Text>
              <Text style={styles.loadingText}>{error}</Text>
            </View>
          ) : filteredPois.length === 0 ? (
            <View style={styles.loadingCard}>
              <Text style={styles.errorTitle}>Chưa có điểm phù hợp</Text>
              <Text style={styles.loadingText}>
                Thử chọn “Tất cả” để xem các điểm thuyết minh đang có.
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cardsRow}
              snapToInterval={251}
              decelerationRate="fast"
            >
              {filteredPois.map((poi) => {
                const meta = metaForPoi(poi);

                return (
                  <Pressable
                    key={poi.id}
                    onPress={() => openPoi(poi)}
                    style={({ pressed }) => [
                      styles.poiCard,
                      pressed && styles.pressed,
                    ]}
                  >
                    <ImageBackground
                      source={{ uri: imageForPoi(poi) }}
                      resizeMode="cover"
                      imageStyle={styles.poiImage}
                      style={styles.poiImageWrap}
                    >
                      <View style={styles.imageShade} />
                      <View style={styles.bookmark}>
                        <Text style={styles.bookmarkText}>⌑</Text>
                      </View>
                    </ImageBackground>

                    <View style={styles.poiBody}>
                      <Text style={styles.cardEyebrow}>{meta.kicker}</Text>
                      <Text style={styles.poiTitle}>{poi.name.vi}</Text>
                      <Text style={styles.poiSubtitle}>{meta.subtitle}</Text>
                      <Text style={styles.poiDescription} numberOfLines={2}>
                        {poi.description.vi}
                      </Text>

                      <View style={styles.poiFooter}>
                        <Text style={styles.poiMeta}>♬ {meta.duration}</Text>
                        <Text style={styles.poiMeta}>◎ {meta.distance}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {featuredPoi && (
          <View style={styles.continueSection}>
            <Text style={styles.sectionEyebrow}>TIẾP TỤC CÂU CHUYỆN</Text>
            <Text style={styles.continueTitle}>Đang nghe dở</Text>

            <Pressable
              onPress={() => openPoi(featuredPoi)}
              style={({ pressed }) => [
                styles.continueCard,
                pressed && styles.pressed,
              ]}
            >
              <ImageBackground
                source={{ uri: imageForPoi(featuredPoi) }}
                style={styles.continueImage}
                imageStyle={styles.continueImageStyle}
              >
                <View style={styles.imageShade} />
                <View style={styles.listenLabel}>
                  <Text style={styles.listenLabelText}>♬ ĐANG NGHE</Text>
                </View>
              </ImageBackground>

              <View style={styles.continueBody}>
                <Text style={styles.cardEyebrow}>ĐẠI NỘI HUẾ · TIẾNG VIỆT</Text>
                <Text style={styles.continuePoiTitle}>{featuredPoi.name.vi}</Text>
                <Text style={styles.continueText}>Chạm để tiếp tục phần thuyết minh đang nghe.</Text>

                <View style={styles.progressTrack}>
                  <View style={styles.progressFill} />
                </View>

                <View style={styles.continueFooter}>
                  <Text style={styles.progressText}>34%</Text>
                  <Text style={styles.continueAction}>Tiếp tục  →</Text>
                </View>
              </View>
            </Pressable>
          </View>
        )}

        <View style={styles.quietNote}>
          <Text style={styles.quietTitle}>Một chuyến đi không cần vội.</Text>
          <Text style={styles.quietText}>
            Go to Horizon chỉ gợi ý đúng lúc. Bạn quyết định khi nào muốn lắng nghe.
          </Text>
          <Pressable onPress={() => navigation.navigate('Map')}>
            <Text style={styles.quietAction}>Mở bản đồ khám phá  →</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>Go to Horizon</Text>
          <Text style={styles.footerMeta}>
            {pois.length > 0 ? `Nội dung offline sẵn sàng · ${pois.length} POI` : 'Audio guide · Vietnam'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const serif =
  Platform.OS === 'ios'
    ? 'Georgia'
    : 'serif';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },

  topbar: {
    height: 58,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  sun: {
    color: colors.primary,
    fontSize: 22,
    lineHeight: 24,
  },

  brandText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  topbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  locationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  locationDot: {
    width: 5,
    height: 5,
    borderRadius: 99,
    backgroundColor: colors.teal,
  },

  locationText: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '600',
  },

  qrButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  qrButtonText: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
  },

  scroll: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 28,
  },

  pageHeading: {
    marginBottom: 20,
  },

  greeting: {
    color: colors.primary,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.15,
  },

  title: {
    marginTop: 9,
    maxWidth: 310,
    color: colors.text,
    fontSize: 26,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -0.9,
  },

  subtitle: {
    marginTop: 7,
    maxWidth: 305,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 19,
  },

  heroPressable: {
    borderRadius: 6,
    overflow: 'hidden',
  },

  hero: {
    minHeight: 340,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 20,
  },

  heroImage: {
    borderRadius: 6,
  },

  heroShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 6,
    backgroundColor: 'rgba(8, 30, 26, 0.53)',
  },

  heroPage: {
    alignSelf: 'flex-end',
  },

  heroPageText: {
    color: '#F7F2E8',
    fontSize: 8,
    fontWeight: '800',
  },

  heroCopy: {
    marginTop: 14,
    maxWidth: 285,
  },

  heroKicker: {
    color: '#FFFDF8',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  heroTitle: {
    marginTop: 20,
    color: '#FFFDF8',
    fontFamily: serif,
    fontSize: 31,
    lineHeight: 40,
    fontWeight: '500',
    letterSpacing: -0.8,
  },

  heroDescription: {
    marginTop: 9,
    maxWidth: 245,
    color: '#F2EEE5',
    fontSize: 9.5,
    lineHeight: 17,
  },

  heroCta: {
    marginTop: 20,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 15,
    borderRadius: 4,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },

  heroCtaText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '700',
  },

  heroCtaArrow: {
    color: colors.teal,
    fontSize: 18,
  },

  heroNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  heroNoteIcon: {
    color: '#F5E2C5',
    fontSize: 12,
  },

  heroNoteText: {
    color: '#FFFDF8',
    fontSize: 7,
    fontWeight: '600',
  },

  section: {
    marginTop: 28,
  },

  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },

  sectionHeadingCopy: {
    flex: 1,
  },

  sectionEyebrow: {
    color: colors.primary,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.05,
  },

  sectionTitle: {
    marginTop: 5,
    color: colors.text,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  textButton: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: '700',
    paddingBottom: 4,
  },

  filterRow: {
    gap: 7,
    paddingTop: 15,
    paddingBottom: 14,
  },

  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  chipActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },

  chipText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '600',
  },

  chipTextActive: {
    color: colors.surface,
  },

  cardsRow: {
    gap: 13,
    paddingBottom: 6,
    paddingRight: 20,
  },

  poiCard: {
    width: 238,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  poiImageWrap: {
    height: 165,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    padding: 10,
  },

  poiImage: {
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },

  imageShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(12, 42, 38, 0.10)',
  },

  bookmark: {
    width: 31,
    height: 31,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.93)',
  },

  bookmarkText: {
    color: colors.teal,
    fontSize: 17,
  },

  poiBody: {
    paddingHorizontal: 14,
    paddingTop: 15,
    paddingBottom: 14,
  },

  cardEyebrow: {
    color: colors.primary,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  poiTitle: {
    marginTop: 6,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.35,
  },

  poiSubtitle: {
    marginTop: 4,
    color: colors.teal,
    fontSize: 9,
    fontWeight: '700',
  },

  poiDescription: {
    marginTop: 9,
    minHeight: 34,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 16,
  },

  poiFooter: {
    marginTop: 14,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  poiMeta: {
    color: colors.muted,
    fontSize: 8.5,
    fontWeight: '600',
  },

  loadingCard: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: 10,
  },

  loadingText: {
    maxWidth: 260,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 17,
    textAlign: 'center',
  },

  errorTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },

  continueSection: {
    marginTop: 27,
  },

  continueTitle: {
    marginTop: 4,
    marginBottom: 12,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },

  continueCard: {
    minHeight: 177,
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  continueImage: {
    width: 111,
    minHeight: 177,
    justifyContent: 'flex-end',
    padding: 9,
  },

  continueImageStyle: {
    borderTopLeftRadius: 5,
    borderBottomLeftRadius: 5,
  },

  listenLabel: {
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: 'rgba(18,60,58,0.88)',
  },

  listenLabelText: {
    color: colors.surface,
    fontSize: 6,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  continueBody: {
    flex: 1,
    padding: 16,
  },

  continuePoiTitle: {
    marginTop: 7,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  continueText: {
    marginTop: 7,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 16,
  },

  progressTrack: {
    height: 3,
    marginTop: 20,
    borderRadius: 99,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },

  progressFill: {
    width: '34%',
    height: '100%',
    backgroundColor: colors.primary,
  },

  continueFooter: {
    marginTop: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  progressText: {
    color: colors.muted,
    fontSize: 8,
  },

  continueAction: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: '800',
  },

  quietNote: {
    marginTop: 18,
    padding: 18,
    borderRadius: 6,
    backgroundColor: colors.sand,
    borderWidth: 1,
    borderColor: colors.border,
  },

  quietTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  quietText: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 9.5,
    lineHeight: 17,
  },

  quietAction: {
    marginTop: 12,
    color: colors.teal,
    fontSize: 9,
    fontWeight: '800',
  },

  footer: {
    marginTop: 24,
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: 'center',
    gap: 5,
  },

  footerBrand: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  footerMeta: {
    color: colors.muted,
    fontSize: 8,
  },

  pressed: {
    opacity: 0.76,
  },
});
