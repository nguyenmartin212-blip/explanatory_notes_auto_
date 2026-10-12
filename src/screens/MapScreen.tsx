import { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { mockPois, type Poi } from '@/features/poi';
import type { RootStackParamList } from '@/navigation';
import { colors, radius, spacing } from '@/theme';

const VIETNAM_REGION: Region = {
  latitude: 16.4,
  longitude: 106.2,
  latitudeDelta: 15.8,
  longitudeDelta: 13.0,
};

const POI_REGION_DELTA = { latitudeDelta: 0.018, longitudeDelta: 0.018 };

type RootNav = NativeStackNavigationProp<RootStackParamList>;

function textFor(poi: Poi) {
  return poi.name.vi;
}

export function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const navigation = useNavigation<RootNav>();
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');

  const filteredPois = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN');
    if (!query) return mockPois;
    return mockPois.filter((poi) =>
      [poi.name.vi, poi.name.en, poi.name.zh]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase('vi-VN').includes(query)),
    );
  }, [search]);

  const activePoi = filteredPois.find((poi) => poi.id === activeId) ?? null;

  function focusPoi(poi: Poi) {
    setActiveId(poi.id);
    mapRef.current?.animateToRegion(
      { latitude: poi.latitude, longitude: poi.longitude, ...POI_REGION_DELTA },
      600,
    );
  }

  function resetMap() {
    setSearch('');
    setActiveId(null);
    mapRef.current?.animateToRegion(VIETNAM_REGION, 600);
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={VIETNAM_REGION}
        mapType={mapType}
        showsCompass
        showsScale={false}
        toolbarEnabled={false}
        accessibilityLabel="Bản đồ các điểm thuyết minh"
      >
        {filteredPois.map((poi) => (
          <Marker
            key={poi.id}
            coordinate={{ latitude: poi.latitude, longitude: poi.longitude }}
            title={textFor(poi)}
            description={poi.description.vi}
            pinColor={poi.id === activeId ? colors.primary : colors.teal}
            onPress={() => focusPoi(poi)}
          />
        ))}
      </MapView>

      <View style={styles.topPanel}>
        <Text style={styles.eyebrow}>GO TO HORIZON · AUDIO GUIDE</Text>
        <Text style={styles.heading}>Khám phá quanh bạn</Text>
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setActiveId(null);
            }}
            placeholder="Tìm địa điểm thuyết minh..."
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            accessibilityLabel="Tìm điểm đến"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Xóa tìm kiếm">
              <Text style={styles.clear}>×</Text>
            </Pressable>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          <Pressable style={styles.chip} onPress={resetMap}>
            <Text style={styles.chipText}>↗ Toàn Việt Nam</Text>
          </Pressable>
          <Pressable
            style={styles.chip}
            onPress={() => setMapType((type) => (type === 'standard' ? 'satellite' : 'standard'))}
          >
            <Text style={styles.chipText}>{mapType === 'standard' ? '◈ Vệ tinh' : '▧ Bản đồ'}</Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.bottomPanel}>
        {activePoi ? (
          <View>
            <View style={styles.topLine}>
              <Text style={styles.overline}>ĐIỂM THUYẾT MINH</Text>
              <Pressable onPress={() => setActiveId(null)} accessibilityLabel="Đóng thông tin">
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.poiTitle}>{activePoi.name.vi}</Text>
            <Text style={styles.poiDescription} numberOfLines={2}>{activePoi.description.vi}</Text>
            <View style={styles.footerRow}>
              <Text style={styles.radius}>◎ Bán kính gợi ý {activePoi.radiusMeters} m</Text>
              <Pressable
                style={styles.cta}
                onPress={() => navigation.navigate('PoiDetail', { poiId: activePoi.id })}
              >
                <Text style={styles.ctaText}>Khám phá →</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.overline}>BẢN ĐỒ TRI THỨC</Text>
            <Text style={styles.poiTitle}>{filteredPois.length} địa điểm thuyết minh</Text>
            <Text style={styles.poiDescription}>
              {filteredPois.length ? 'Chọn một địa điểm bên dưới hoặc chạm marker trên bản đồ.' : 'Không tìm thấy địa điểm phù hợp.'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.poiScroll}>
              {filteredPois.map((poi) => (
                <Pressable key={poi.id} style={styles.poiPill} onPress={() => focusPoi(poi)}>
                  <Text style={styles.poiPillText}>{poi.name.vi} ↗</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topPanel: {
    position: 'absolute', top: 12, left: 12, right: 12,
    backgroundColor: 'rgba(255,253,249,0.98)', borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 14, elevation: 5,
  },
  eyebrow: { fontSize: 10, letterSpacing: 1.7, color: colors.primary, fontWeight: '800' },
  heading: { fontSize: 23, fontWeight: '800', color: colors.text, marginTop: 5, marginBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  searchIcon: { color: colors.teal, fontSize: 25, marginRight: 8 },
  searchInput: { flex: 1, minHeight: 45, color: colors.text, fontSize: 14 },
  clear: { color: colors.muted, fontSize: 24, paddingHorizontal: 4 },
  chipScroll: { marginTop: 11, flexGrow: 0 },
  chip: { backgroundColor: '#F0E8DB', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 99, marginRight: 8 },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  bottomPanel: { position: 'absolute', bottom: 12, left: 12, right: 12, padding: 16, borderRadius: radius.lg, backgroundColor: 'rgba(255,253,249,0.98)', borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  overline: { color: colors.primary, fontWeight: '800', letterSpacing: 1.2, fontSize: 10 },
  close: { color: colors.muted, fontSize: 24, lineHeight: 25 },
  poiTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 5 },
  poiDescription: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 8 },
  radius: { color: colors.teal, fontSize: 11, flexShrink: 1 },
  cta: { backgroundColor: colors.primary, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 15 },
  ctaText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  poiScroll: { marginTop: 12, flexGrow: 0 },
  poiPill: { borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginRight: 8 },
  poiPillText: { color: colors.text, fontSize: 12, fontWeight: '700' },
});
