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
import { colors, radius, spacing } from '@/theme';

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [arrivalPoiId, setArrivalPoiId] = useState<string | null>(null);
  const [demoArrival, setDemoArrival] = useState(false);
  const [mapType, setMapType] =
    useState<'standard' | 'satellite'>('standard');

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

      if (result.status !== Location.PermissionStatus.GRANTED) {
        setPermissionStatus('denied');
        setLocationError(
          'Ứng dụng cần quyền vị trí để hiển thị khoảng cách và kích hoạt geofence.',
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

        if (permission.status === Location.PermissionStatus.GRANTED) {
          setPermissionStatus('granted');
        } else if (permission.status === Location.PermissionStatus.DENIED) {
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
          (position) => {
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
      setIsTracking(false);
      subscription?.remove();
    };
  }, [isFocused, permissionStatus]);

  const filteredPois = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN');

    const matching = !query
      ? [...pois]
      : pois.filter((poi) =>
          [poi.name.vi, poi.name.en, poi.name.zh]
            .filter((value): value is string => Boolean(value))
            .some((value) =>
              value.toLocaleLowerCase('vi-VN').includes(query),
            ),
        );

    if (location) {
      matching.sort(
        (a, b) =>
          evaluatePoi(location, a).distanceMeters -
          evaluatePoi(location, b).distanceMeters,
      );
    }

    return matching;
  }, [search, location, pois]);

  const activePoi =
    filteredPois.find((poi) => poi.id === activeId) ?? null;

  const activeResult =
    activePoi && location ? evaluatePoi(location, activePoi) : null;

  const arrivalPoi =
    pois.find((poi) => poi.id === arrivalPoiId) ?? null;

  const nearestRelevant =
    location && pois.length ? selectActivePoi(location, pois) : null;

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
    }
  }, [location, permissionStatus, isFocused, pois]);

  useEffect(() => {
    if (permissionStatus !== 'granted') {
      geofenceState.current = createGeofenceRuntimeState();
      setArrivalPoiId(null);
    }
  }, [permissionStatus]);

  useEffect(() => {
    if (
      !location ||
      !focusOnNextFix.current ||
      !isFocused
    ) {
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
  }, [location, isFocused]);

  function focusPoi(poi: Poi) {
    setActiveId(poi.id);

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

    if (
      location &&
      permissionStatus === 'granted'
    ) {
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
    setActiveId(null);
    focusOnNextFix.current = false;

    mapRef.current?.animateToRegion(VIETNAM_REGION, 600);
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapLayer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={VIETNAM_REGION}
          mapType={mapType}
          showsCompass
          showsScale={false}
          showsUserLocation={permissionStatus === 'granted'}
          toolbarEnabled={false}
          accessibilityLabel="Bản đồ các điểm thuyết minh"
        >
          {filteredPois.map((poi) => (
            <Marker
              key={poi.id}
              coordinate={{
                latitude: poi.latitude,
                longitude: poi.longitude,
              }}
              title={poi.name.vi}
              description={poi.description.vi}
              pinColor={
                poi.id === activeId
                  ? colors.primary
                  : colors.teal
              }
              onPress={() => focusPoi(poi)}
            />
          ))}
        </MapView>
      </View>

      <View style={styles.topPanel}>
        <Text style={styles.eyebrow}>
          GO TO HORIZON · AUDIO GUIDE
        </Text>

        <Text style={styles.heading}>
          Khám phá quanh bạn
        </Text>

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
            <Pressable
              onPress={() => setSearch('')}
              accessibilityLabel="Xóa tìm kiếm"
            >
              <Text style={styles.clear}>×</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
        >
          <Pressable
            style={styles.chip}
            onPress={resetMap}
          >
            <Text style={styles.chipText}>
              ↗ Toàn Việt Nam
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.chip,
              permissionStatus === 'granted' &&
                styles.locationChip,
            ]}
            onPress={() => {
              void locateMe();
            }}
            accessibilityRole="button"
            accessibilityLabel="Định vị vị trí hiện tại"
          >
            <Text
              style={[
                styles.chipText,
                permissionStatus === 'granted' &&
                  styles.locationChipText,
              ]}
            >
              {isLocationLoading
                ? '◌ Đang xin quyền...'
                : location
                  ? '◎ Vị trí của tôi'
                  : '◎ Bật GPS'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.chip}
            onPress={() =>
              setMapType((type) =>
                type === 'standard'
                  ? 'satellite'
                  : 'standard',
              )
            }
          >
            <Text style={styles.chipText}>
              {mapType === 'standard'
                ? '◈ Vệ tinh'
                : '▧ Bản đồ'}
            </Text>
          </Pressable>

          {__DEV__ && (
            <Pressable
              style={styles.chip}
              onPress={() => {
                setDemoArrival(true);
                setArrivalPoiId(pois[0]?.id ?? null);
              }}
              accessibilityLabel="Thử giao diện gợi ý, không sử dụng GPS thật"
            >
              <Text style={styles.chipText}>
                ⚗ Thử gợi ý
              </Text>
            </Pressable>
          )}
        </ScrollView>

        {permissionStatus === 'granted' && (
          <Text style={styles.gpsStatus}>
            {location
              ? `● GPS ${
                  isTracking
                    ? 'đang cập nhật'
                    : 'đã cấp quyền'
                } · Sai số ±${Math.round(
                  location.accuracy,
                )} m`
              : '◌ Đang xác định vị trí hiện tại...'}
          </Text>
        )}

        <Text style={styles.contentStatus}>
          {isContentLoading
            ? '◌ Đang tải Content Layer…'
            : `▣ SQLite Offline · ${pois.length} POI`}
        </Text>

        {contentError && (
          <Text style={styles.contentError}>
            {contentError}
          </Text>
        )}

        {locationError && (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>
              {locationError}
            </Text>

            {permissionStatus === 'denied' && (
              <Pressable
                onPress={() => {
                  void Linking.openSettings();
                }}
              >
                <Text style={styles.settingsLink}>
                  Cài đặt
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <View style={styles.bottomPanel}>
        {arrivalPoi && (
          <View style={styles.arrivalBanner}>
            <View style={styles.arrivalHeader}>
              <Text style={styles.arrivalLabel}>
                {demoArrival
                  ? '⚗ BẢN XEM TRƯỚC · KHÔNG DÙNG GPS'
                  : '✦ BẠN ĐÃ ĐẾN GẦN MỘT ĐIỂM THUYẾT MINH'}
              </Text>

              <Pressable
                onPress={() =>
                  setArrivalPoiId(null)
                }
                accessibilityLabel="Ẩn gợi ý"
              >
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.arrivalTitle}>
              {arrivalPoi.name.vi}
            </Text>

            <View style={styles.arrivalActions}>
              <Text style={styles.arrivalDistance}>
                {!demoArrival && location
                  ? `Cách bạn ${formatDistance(
                      evaluatePoi(
                        location,
                        arrivalPoi,
                      ).distanceMeters,
                    )}`
                  : 'Giao diện minh họa'}
              </Text>

              <Pressable
                style={styles.arrivalCta}
                onPress={() => {
                  setArrivalPoiId(null);
                  navigation.navigate('PoiDetail', {
                    poiId: arrivalPoi.id,
                  });
                }}
              >
                <Text style={styles.arrivalCtaText}>
                  Xem thuyết minh →
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {activePoi ? (
          <View>
            <View style={styles.topLine}>
              <Text style={styles.overline}>
                ĐIỂM THUYẾT MINH
              </Text>

              <Pressable
                onPress={() => setActiveId(null)}
                accessibilityLabel="Đóng thông tin"
              >
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.poiTitle}>
              {activePoi.name.vi}
            </Text>

            <Text
              style={styles.poiDescription}
              numberOfLines={2}
            >
              {activePoi.description.vi}
            </Text>

            <View style={styles.footerRow}>
              <Text style={styles.radius}>
                {activeResult
                  ? `◎ Cách bạn ${formatDistance(
                      activeResult.distanceMeters,
                    )} · `
                  : ''}
                Bán kính {activePoi.radiusMeters} m
              </Text>

              <Pressable
                style={styles.cta}
                onPress={() =>
                  navigation.navigate('PoiDetail', {
                    poiId: activePoi.id,
                  })
                }
              >
                <Text style={styles.ctaText}>
                  Khám phá →
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.overline}>
              BẢN ĐỒ TRI THỨC
            </Text>

            <Text style={styles.poiTitle}>
              {location && nearestRelevant
                ? `Gần ${nearestRelevant.poi.name.vi}`
                : `${filteredPois.length} địa điểm thuyết minh`}
            </Text>

            <Text style={styles.poiDescription}>
              {location && nearestRelevant
                ? `${
                    nearestRelevant.result.state ===
                    'inside'
                      ? 'Bạn đang trong khu vực'
                      : 'Địa điểm gần bạn'
                  } · ${formatDistance(
                    nearestRelevant.result
                      .distanceMeters,
                  )}`
                : filteredPois.length
                  ? 'Chọn điểm đến hoặc bật GPS để xem khoảng cách thực tế.'
                  : 'Không tìm thấy địa điểm phù hợp.'}
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.poiScroll}
            >
              {filteredPois.map((poi) => (
                <Pressable
                  key={poi.id}
                  style={styles.poiPill}
                  onPress={() => focusPoi(poi)}
                >
                  <Text style={styles.poiPillText}>
                    {poi.name.vi}
                    {location
                      ? ` · ${formatDistance(
                          evaluatePoi(
                            location,
                            poi,
                          ).distanceMeters,
                        )}`
                      : ''}{' '}
                    ↗
                  </Text>
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
    position: 'relative',
  },

  mapLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
    overflow: 'hidden',
  },

  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  topPanel: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(255,253,249,0.98)',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
    zIndex: 20,
  },

  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.7,
    color: colors.primary,
    fontWeight: '800',
  },

  heading: {
    fontSize: 23,
    fontWeight: '800',
    color: colors.text,
    marginTop: 5,
    marginBottom: 12,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },

  searchIcon: {
    color: colors.teal,
    fontSize: 25,
    marginRight: 8,
  },

  searchInput: {
    flex: 1,
    minHeight: 45,
    color: colors.text,
    fontSize: 14,
  },

  clear: {
    color: colors.muted,
    fontSize: 24,
    paddingHorizontal: 4,
  },

  chipScroll: {
    marginTop: 11,
    flexGrow: 0,
  },

  chip: {
    backgroundColor: '#F0E8DB',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 99,
    marginRight: 8,
  },

  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },

  locationChip: {
    backgroundColor: colors.teal,
  },

  locationChipText: {
    color: '#fff',
  },

  gpsStatus: {
    color: colors.teal,
    fontSize: 11,
    marginTop: 10,
    fontWeight: '600',
  },

  contentStatus: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 6,
  },

  contentError: {
    color: '#A84836',
    fontSize: 10,
    marginTop: 4,
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 9,
    gap: 8,
  },

  errorText: {
    flex: 1,
    color: colors.primaryDark,
    fontSize: 11,
    lineHeight: 16,
  },

  settingsLink: {
    color: colors.teal,
    fontWeight: '800',
    fontSize: 11,
  },

  bottomPanel: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,253,249,0.98)',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
    zIndex: 20,
  },

  topLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  overline: {
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontSize: 10,
  },

  close: {
    color: colors.muted,
    fontSize: 24,
    lineHeight: 25,
  },

  poiTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 5,
  },

  poiDescription: {
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 6,
  },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 8,
  },

  radius: {
    color: colors.teal,
    fontSize: 11,
    flexShrink: 1,
  },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 15,
  },

  ctaText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },

  poiScroll: {
    marginTop: 12,
    flexGrow: 0,
  },

  poiPill: {
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginRight: 8,
  },

  poiPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },

  arrivalBanner: {
    borderRadius: 13,
    backgroundColor: '#E8F2EC',
    padding: 11,
    marginBottom: 13,
    borderWidth: 1,
    borderColor: '#B7D9CB',
  },

  arrivalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },

  arrivalLabel: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
    flexShrink: 1,
  },

  arrivalTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 16,
    marginTop: 4,
  },

  arrivalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },

  arrivalDistance: {
    color: colors.muted,
    fontSize: 11,
    flexShrink: 1,
  },

  arrivalCta: {
    backgroundColor: colors.teal,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  arrivalCtaText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
});
