import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { Poi } from '@/features/poi';
import { useOfflinePois } from '@/features/content';
import {
  createGeofenceRuntimeState,
  evaluatePoi,
  processGeofenceUpdate,
  selectActivePoi,
} from '@/features/geofence';
import type { RootStackParamList } from '@/navigation';
import { colors } from '@/theme';

const VIETNAM_REGION: Region = {
  latitude: 16.4,
  longitude: 106.2,
  latitudeDelta: 15.8,
  longitudeDelta: 13.0,
};

const POI_REGION_DELTA = {
  latitudeDelta: 0.018,
  longitudeDelta: 0.018,
};

const USER_REGION_DELTA = {
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

const FILTERS = ['Tất cả', 'Di sản', 'Tâm linh', 'Văn hóa'] as const;

type Filter = (typeof FILTERS)[number];
type RootNav = NativeStackNavigationProp<RootStackParamList>;
type PermissionState = 'not-requested' | 'granted' | 'denied';

type LiveLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

function formatDistance(meters: number) {
  return meters < 1_000
    ? `${Math.round(meters)} m`
    : `${(meters / 1_000).toFixed(1)} km`;
}

function toLiveLocation(position: Location.LocationObject): LiveLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? 0,
    timestamp: position.timestamp,
  };
}

function categoryForPoi(poi: Poi): Exclude<Filter, 'Tất cả'> {
  const key = `${poi.id} ${poi.name.vi}`.toLocaleLowerCase('vi-VN');

  if (
    key.includes('chùa') ||
    key.includes('thiên mụ') ||
    key.includes('temple') ||
    key.includes('pagoda')
  ) {
    return 'Tâm linh';
  }

  if (
    key.includes('chợ') ||
    key.includes('ben-thanh') ||
    key.includes('bến thành')
  ) {
    return 'Văn hóa';
  }

  return 'Di sản';
}

function metaForPoi(poi: Poi) {
  const category = categoryForPoi(poi);

  if (poi.id.includes('hue')) {
    return {
      category,
      duration: '12 phút thuyết minh',
    };
  }

  if (poi.id.includes('thang-long')) {
    return {
      category,
      duration: '10 phút thuyết minh',
    };
  }

  return {
    category,
    duration: '8 phút thuyết minh',
  };
}

export function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const focusOnNextFix = useRef(false);
  const geofenceState = useRef(createGeofenceRuntimeState());

  const navigation = useNavigation<RootNav>();
  const isFocused = useIsFocused();

  const [location, setLocation] = useState<LiveLocation | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionState>('not-requested');
  const [isTracking, setIsTracking] = useState(false);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('Tất cả');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [arrivalPoiId, setArrivalPoiId] = useState<string | null>(null);
  const [demoArrival, setDemoArrival] = useState(false);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');

  const {
    pois,
    isLoading: isContentLoading,
    error: contentError,
  } = useOfflinePois();

  const requestLocationPermission = useCallback(async () => {
    setIsLocationLoading(true);
    setLocationError(null);

    try {
      const result = await Location.requestForegroundPermissionsAsync();

      if (result.status !== 'granted') {
        setPermissionStatus('denied');
        setLocationError(
          'Go to Horizon cần quyền vị trí để hiển thị khoảng cách và kích hoạt vùng thuyết minh.',
        );
        return false;
      }

      setPermissionStatus('granted');

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation(toLiveLocation(current));
      return true;
    } catch {
      setLocationError('Không thể lấy vị trí hiện tại. Vui lòng thử lại.');
      return false;
    } finally {
      setIsLocationLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();

        if (cancelled) return;

        if (permission.status === 'granted') {
          setPermissionStatus('granted');
        } else if (permission.status === 'denied') {
          setPermissionStatus('denied');
        } else {
          setPermissionStatus('not-requested');
        }
      } catch {
        if (!cancelled) {
          setPermissionStatus('not-requested');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isFocused || permissionStatus !== 'granted') {
      setIsTracking(false);
      return;
    }

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 4_000,
          },
          (position: Location.LocationObject) => {
            if (!cancelled) {
              setLocation(toLiveLocation(position));
            }
          },
        );

        if (!cancelled) {
          setIsTracking(true);
        }
      } catch {
        if (!cancelled) {
          setLocationError('Không thể theo dõi vị trí GPS.');
          setIsTracking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [isFocused, permissionStatus]);

  const filteredPois = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN');

    const matching = pois.filter((poi) => {
      const matchesFilter =
        filter === 'Tất cả' || categoryForPoi(poi) === filter;

      if (!matchesFilter) return false;
      if (!query) return true;

      return [poi.name.vi, poi.name.en, poi.name.zh, poi.description.vi]
        .filter((value): value is string => Boolean(value))
        .some((value) =>
          value.toLocaleLowerCase('vi-VN').includes(query),
        );
    });

    if (location) {
      matching.sort(
        (a, b) =>
          evaluatePoi(location, a).distanceMeters -
          evaluatePoi(location, b).distanceMeters,
      );
    }

    return matching;
  }, [filter, location, pois, search]);

  const activePoi =
    filteredPois.find((poi) => poi.id === activeId) ?? null;

  const nearestRelevant =
    location && pois.length ? selectActivePoi(location, pois) : null;

  const selectedPoi =
    activePoi ??
    (nearestRelevant && filteredPois.some((poi) => poi.id === nearestRelevant.poi.id)
      ? nearestRelevant.poi
      : filteredPois[0]) ??
    null;

  const selectedResult =
    selectedPoi && location ? evaluatePoi(location, selectedPoi) : null;

  const arrivalPoi =
    pois.find((poi) => poi.id === arrivalPoiId) ?? null;

  useEffect(() => {
    if (
      !isFocused ||
      !location ||
      permissionStatus !== 'granted'
    ) {
      return;
    }

    const update = processGeofenceUpdate(
      location,
      pois,
      geofenceState.current,
      location.timestamp,
      {
        debounceMs: 1_500,
        cooldownMs: 10 * 60 * 1_000,
        exitMultiplier: 1.25,
      },
    );

    geofenceState.current = update.state;

    if (update.trigger) {
      setDemoArrival(false);
      setArrivalPoiId(update.trigger.poiId);
      setActiveId(update.trigger.poiId);
    }
  }, [isFocused, location, permissionStatus, pois]);

  useEffect(() => {
    if (permissionStatus !== 'granted') {
      geofenceState.current = createGeofenceRuntimeState();
      setArrivalPoiId(null);
    }
  }, [permissionStatus]);

  useEffect(() => {
    if (!location || !focusOnNextFix.current || !isFocused) {
      return;
    }

    focusOnNextFix.current = false;

    mapRef.current?.animateToRegion(
      {
        latitude: location.latitude,
        longitude: location.longitude,
        ...USER_REGION_DELTA,
      },
      650,
    );
  }, [isFocused, location]);

  function focusPoi(poi: Poi) {
    setActiveId(poi.id);
    setSearch('');

    mapRef.current?.animateToRegion(
      {
        latitude: poi.latitude,
        longitude: poi.longitude,
        ...POI_REGION_DELTA,
      },
      600,
    );
  }

  async function locateMe() {
    focusOnNextFix.current = true;

    if (location && permissionStatus === 'granted') {
      mapRef.current?.animateToRegion(
        {
          latitude: location.latitude,
          longitude: location.longitude,
          ...USER_REGION_DELTA,
        },
        600,
      );

      focusOnNextFix.current = false;
      return;
    }

    const granted = await requestLocationPermission();

    if (!granted) {
      focusOnNextFix.current = false;
    }
  }

  function resetMap() {
    setSearch('');
    setFilter('Tất cả');
    setActiveId(null);
    focusOnNextFix.current = false;

    mapRef.current?.animateToRegion(VIETNAM_REGION, 600);
  }

  function openPoi(poi: Poi) {
    navigation.navigate('PoiDetail', {
      poiId: poi.id,
      origin: 'manual',
    });
  }

  function listenToPoi(poi: Poi) {
    navigation.navigate('PoiDetail', {
      poiId: poi.id,
      autoplay: true,
      origin: 'manual',
    });
  }

  const gpsLabel =
    permissionStatus === 'denied'
      ? 'Quyền vị trí bị từ chối'
      : location && isTracking
        ? `Đang theo dõi · ±${Math.round(location.accuracy)} m`
        : permissionStatus === 'granted'
          ? 'Vị trí đã bật'
          : 'Vị trí chưa bật';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.mapLayer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={VIETNAM_REGION}
            mapType={mapType}
            showsCompass={false}
            showsScale={false}
            showsUserLocation={permissionStatus === 'granted'}
            toolbarEnabled={false}
            accessibilityLabel="Bản đồ các điểm thuyết minh"
          >
            {filteredPois.map((poi) => {
              const selected = selectedPoi?.id === poi.id;

              return (
                <Marker
                  key={poi.id}
                  coordinate={{
                    latitude: poi.latitude,
                    longitude: poi.longitude,
                  }}
                  title={poi.name.vi}
                  description={poi.description.vi}
                  onPress={() => focusPoi(poi)}
                  tracksViewChanges={false}
                >
                  <View style={[styles.markerRing, selected && styles.markerRingSelected]}>
                    <View style={[styles.marker, selected && styles.markerSelected]}>
                      <Text style={styles.markerText}>♬</Text>
                    </View>
                  </View>
                </Marker>
              );
            })}
          </MapView>
        </View>

        <View style={styles.topSearchArea}>
          <View style={styles.searchCard}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setActiveId(null);
              }}
              placeholder="Tìm một miền di sản…"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              accessibilityLabel="Tìm địa điểm"
            />

            {search.length > 0 && (
              <Pressable
                onPress={() => setSearch('')}
                accessibilityLabel="Xóa tìm kiếm"
                style={styles.clearButton}
              >
                <Text style={styles.clearText}>×</Text>
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((item) => {
              const selected = filter === item;

              return (
                <Pressable
                  key={item}
                  onPress={() => {
                    setFilter(item);
                    setActiveId(null);
                  }}
                  style={({ pressed }) => [
                    styles.filterChip,
                    selected && styles.filterChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selected && styles.filterChipTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {search.length > 0 && (
            <View style={styles.searchResults}>
              {filteredPois.length > 0 ? (
                filteredPois.slice(0, 4).map((poi) => (
                  <Pressable
                    key={poi.id}
                    onPress={() => focusPoi(poi)}
                    style={({ pressed }) => [
                      styles.searchResult,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.searchResultCopy}>
                      <Text style={styles.searchResultTitle}>{poi.name.vi}</Text>
                      <Text style={styles.searchResultMeta}>
                        {categoryForPoi(poi)}
                        {location
                          ? ` · ${formatDistance(
                              evaluatePoi(location, poi).distanceMeters,
                            )}`
                          : ''}
                      </Text>
                    </View>
                    <Text style={styles.searchResultArrow}>→</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.noResult}>
                  Không tìm thấy địa điểm. Thử từ khóa khác.
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.mapTools}>
          <Pressable
            onPress={resetMap}
            accessibilityLabel="Tổng quan Việt Nam"
            style={({ pressed }) => [
              styles.toolButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.toolIcon}>◎</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              void locateMe();
            }}
            accessibilityLabel="Vị trí của tôi"
            style={({ pressed }) => [
              styles.toolButton,
              permissionStatus === 'granted' && styles.toolButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.toolIcon,
                permissionStatus === 'granted' && styles.toolIconActive,
              ]}
            >
              ⌖
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              setMapType((type) =>
                type === 'standard' ? 'satellite' : 'standard',
              )
            }
            accessibilityLabel="Đổi lớp bản đồ"
            style={({ pressed }) => [
              styles.toolButton,
              mapType === 'satellite' && styles.toolButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.toolIcon,
                mapType === 'satellite' && styles.toolIconActive,
              ]}
            >
              ◫
            </Text>
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('QrScanner')}
            accessibilityLabel="Quét QR"
            style={({ pressed }) => [
              styles.toolButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.toolIcon}>▦</Text>
          </Pressable>
        </View>

        {arrivalPoi && (
          <View style={styles.geofenceAlert}>
            <View style={styles.geofenceCopy}>
              <Text style={styles.geofenceEyebrow}>
                {demoArrival
                  ? 'BẢN XEM TRƯỚC · KHÔNG DÙNG GPS'
                  : 'BẠN ĐANG ĐẾN GẦN MỘT CÂU CHUYỆN'}
              </Text>
              <Text style={styles.geofenceTitle}>{arrivalPoi.name.vi}</Text>
              <Text style={styles.geofenceText}>
                {demoArrival || !location
                  ? 'Giao diện minh họa vùng thuyết minh.'
                  : `Cách bạn ${formatDistance(
                      evaluatePoi(location, arrivalPoi).distanceMeters,
                    )}.`}
              </Text>
            </View>

            <Pressable
              onPress={() => setArrivalPoiId(null)}
              accessibilityLabel="Ẩn thông báo"
              style={styles.alertClose}
            >
              <Text style={styles.alertCloseText}>×</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.bottomCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  permissionStatus === 'denied' && styles.statusDotError,
                ]}
              />
              <Text style={styles.statusText}>{gpsLabel}</Text>
            </View>

            <Text style={styles.offlineText}>
              {isContentLoading
                ? 'Đang tải nội dung…'
                : `Offline · ${pois.length} POI`}
            </Text>
          </View>

          {selectedPoi ? (
            <>
              <View style={styles.placeRow}>
                <View style={styles.placeThumbnail}>
                  <Text style={styles.thumbnailMark}>☼</Text>
                </View>

                <View style={styles.placeCopy}>
                  <Text style={styles.placeEyebrow}>
                    {metaForPoi(selectedPoi).category}
                  </Text>
                  <Text style={styles.placeTitle} numberOfLines={1}>
                    {selectedPoi.name.vi}
                  </Text>
                  <Text style={styles.placeMeta}>
                    {selectedResult
                      ? `${formatDistance(selectedResult.distanceMeters)} · `
                      : ''}
                    {metaForPoi(selectedPoi).duration}
                  </Text>
                </View>
              </View>

              <Text style={styles.placeDescription} numberOfLines={2}>
                {selectedPoi.description.vi}
              </Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => openPoi(selectedPoi)}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Khám phá địa điểm</Text>
                  <Text style={styles.primaryButtonArrow}>→</Text>
                </Pressable>

                <Pressable
                  onPress={() => listenToPoi(selectedPoi)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>▶ Nghe</Text>
                </Pressable>
              </View>

              {__DEV__ && (
                <Pressable
                  onPress={() => {
                    setDemoArrival(true);
                    setArrivalPoiId(selectedPoi.id);
                  }}
                  style={({ pressed }) => [
                    styles.devAction,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.devActionText}>
                    Mô phỏng đi vào vùng thuyết minh
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Chưa có địa điểm phù hợp</Text>
              <Text style={styles.emptyText}>
                Thử đổi bộ lọc hoặc từ khóa tìm kiếm.
              </Text>
            </View>
          )}

          {contentError && (
            <Text style={styles.contentError}>{contentError}</Text>
          )}

          {locationError && (
            <View style={styles.locationErrorRow}>
              <Text style={styles.locationErrorText}>{locationError}</Text>

              {permissionStatus === 'denied' && (
                <Pressable
                  onPress={() => {
                    void Linking.openSettings();
                  }}
                >
                  <Text style={styles.settingsLink}>Mở cài đặt</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        <Text style={styles.disclaimer}>
          Bản đồ thật · Nội dung có sẵn ngoại tuyến
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#E2E4D4',
  },

  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#E2E4D4',
  },

  mapLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },

  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  topSearchArea: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 72,
    zIndex: 20,
  },

  searchCard: {
    height: 46,
    borderRadius: 6,
    backgroundColor: 'rgba(255,253,248,0.97)',
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    shadowColor: '#123C3A',
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
  },

  searchIcon: {
    color: colors.teal,
    fontSize: 22,
    marginRight: 8,
    marginTop: -2,
  },

  searchInput: {
    flex: 1,
    height: '100%',
    color: colors.text,
    fontSize: 11,
  },

  clearButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  clearText: {
    color: colors.muted,
    fontSize: 22,
  },

  filterRow: {
    paddingTop: 9,
    paddingBottom: 2,
    gap: 6,
  },

  filterChip: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,253,248,0.94)',
  },

  filterChipActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },

  filterChipText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '600',
  },

  filterChipTextActive: {
    color: colors.surface,
  },

  searchResults: {
    marginTop: 8,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#123C3A',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },

  searchResult: {
    minHeight: 50,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  searchResultCopy: {
    flex: 1,
  },

  searchResultTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },

  searchResultMeta: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 8,
  },

  searchResultArrow: {
    color: colors.teal,
    fontSize: 17,
    marginLeft: 12,
  },

  noResult: {
    padding: 14,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 15,
  },

  mapTools: {
    position: 'absolute',
    top: 16,
    right: 14,
    zIndex: 21,
    gap: 8,
  },

  toolButton: {
    width: 43,
    height: 43,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,253,248,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#123C3A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },

  toolButtonActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },

  toolIcon: {
    color: colors.teal,
    fontSize: 19,
    fontWeight: '700',
  },

  toolIconActive: {
    color: colors.surface,
  },

  markerRing: {
    width: 43,
    height: 43,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,60,58,0.10)',
  },

  markerRingSelected: {
    backgroundColor: 'rgba(199,101,73,0.20)',
  },

  marker: {
    width: 31,
    height: 31,
    borderRadius: 99,
    backgroundColor: colors.teal,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  markerSelected: {
    backgroundColor: colors.primary,
  },

  markerText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
  },

  geofenceAlert: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 234,
    zIndex: 22,
    padding: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#B7D9CB',
    backgroundColor: '#F3F8F4',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    shadowColor: '#123C3A',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },

  geofenceCopy: {
    flex: 1,
  },

  geofenceEyebrow: {
    color: colors.teal,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  geofenceTitle: {
    marginTop: 5,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },

  geofenceText: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 15,
  },

  alertClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  alertCloseText: {
    color: colors.muted,
    fontSize: 20,
  },

  bottomCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    zIndex: 20,
    padding: 16,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,253,248,0.98)',
    shadowColor: '#123C3A',
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 7,
  },

  statusRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: colors.green,
  },

  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#658B70',
  },

  statusDotError: {
    backgroundColor: colors.error,
  },

  statusText: {
    color: colors.teal,
    fontSize: 8,
    fontWeight: '700',
  },

  offlineText: {
    color: colors.muted,
    fontSize: 7.5,
    fontWeight: '600',
  },

  placeRow: {
    marginTop: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  placeThumbnail: {
    width: 59,
    height: 59,
    borderRadius: 5,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  thumbnailMark: {
    color: colors.teal,
    fontSize: 25,
  },

  placeCopy: {
    flex: 1,
  },

  placeEyebrow: {
    color: colors.primary,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1,
  },

  placeTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.35,
  },

  placeMeta: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 8.5,
  },

  placeDescription: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 15,
  },

  actions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },

  primaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 5,
    paddingHorizontal: 13,
    backgroundColor: colors.teal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  primaryButtonText: {
    color: colors.surface,
    fontSize: 9.5,
    fontWeight: '800',
  },

  primaryButtonArrow: {
    color: colors.surface,
    fontSize: 17,
  },

  secondaryButton: {
    minWidth: 89,
    minHeight: 42,
    borderRadius: 5,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryButtonText: {
    color: colors.teal,
    fontSize: 9.5,
    fontWeight: '800',
  },

  devAction: {
    alignSelf: 'flex-start',
    marginTop: 9,
    paddingVertical: 2,
  },

  devActionText: {
    color: colors.teal,
    fontSize: 7.5,
    textDecorationLine: 'underline',
  },

  emptyState: {
    paddingVertical: 20,
  },

  emptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },

  emptyText: {
    marginTop: 5,
    color: colors.muted,
    fontSize: 9,
  },

  contentError: {
    marginTop: 9,
    color: colors.error,
    fontSize: 8,
    lineHeight: 13,
  },

  locationErrorRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  locationErrorText: {
    flex: 1,
    color: colors.error,
    fontSize: 8,
    lineHeight: 13,
  },

  settingsLink: {
    color: colors.teal,
    fontSize: 8,
    fontWeight: '800',
  },

  disclaimer: {
    position: 'absolute',
    right: 18,
    bottom: 4,
    color: 'rgba(24,48,46,0.55)',
    fontSize: 6.5,
    zIndex: 19,
  },

  pressed: {
    opacity: 0.72,
  },
});
