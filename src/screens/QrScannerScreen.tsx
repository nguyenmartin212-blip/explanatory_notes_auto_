import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/components';
import { mockPois } from '@/features/poi';
import { parsePoiQr } from '@/features/qr/services/qr-content';
import type { RootStackParamList } from '@/navigation';
import { colors, radius, spacing } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'QrScanner'>;

export function QrScannerScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openPayload = useCallback((rawValue: string) => {
    if (locked) return;
    setLocked(true);
    const payload = parsePoiQr(rawValue);
    if (!payload) {
      setMessage('QR không đúng định dạng Go to Horizon.');
      return;
    }
    const poi = mockPois.find((item) => item.id === payload.poiId);
    if (!poi) {
      setMessage(`Chưa có dữ liệu cho POI: ${payload.poiId}`);
      return;
    }
    navigation.replace('PoiDetail', {
      poiId: poi.id,
      autoplay: true,
      origin: 'qr',
    });
  }, [locked, navigation]);

  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    openPayload(result.data);
  }, [openPayload]);

  if (!permission) {
    return (
      <Screen>
        <Text style={styles.title}>QR Guide</Text>
        <Text style={styles.body}>Đang kiểm tra quyền camera…</Text>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.centerCard}>
          <Text style={styles.symbol}>▦</Text>
          <Text style={styles.title}>Quét QR điểm thuyết minh</Text>
          <Text style={styles.body}>
            QR hoạt động độc lập với GPS. Go to Horizon chỉ cần quyền camera để đọc mã tại điểm tham quan.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => { void requestPermission(); }}>
            <Text style={styles.primaryText}>Cho phép camera</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.page}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={locked ? undefined : onBarcodeScanned}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topCard}>
          <Text style={styles.kicker}>GO TO HORIZON · QR GUIDE</Text>
          <Text style={styles.overlayTitle}>Đưa mã QR vào khung</Text>
          <Text style={styles.overlayBody}>Quét xong sẽ mở POI và bắt đầu thuyết minh. Không cần bật GPS.</Text>
        </View>

        <View style={styles.scanArea} pointerEvents="none">
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
        </View>

        <View style={styles.bottomCard}>
          {!!message && <Text style={styles.error}>{message}</Text>}
          {locked && !!message && (
            <Pressable
              style={styles.retryButton}
              onPress={() => { setMessage(null); setLocked(false); }}
            >
              <Text style={styles.retryText}>Quét lại</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.demoButton}
            onPress={() => openPayload('gotohorizon://poi/hanoi-thang-long')}
          >
            <Text style={styles.demoText}>⚗ Dùng QR demo</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const CORNER = 42;
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#071A18' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.22)' },
  topCard: { marginTop: 18, backgroundColor: 'rgba(7,26,24,0.86)', borderRadius: radius.lg, padding: spacing.md },
  kicker: { color: '#F0D0A2', fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  overlayTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 6 },
  overlayBody: { color: '#D8E7E4', fontSize: 12, lineHeight: 18, marginTop: 6 },
  scanArea: { width: 260, height: 260, alignSelf: 'center', position: 'relative' },
  cornerTL: { position: 'absolute', top: 0, left: 0, width: CORNER, height: CORNER, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#F4C27A', borderTopLeftRadius: 12 },
  cornerTR: { position: 'absolute', top: 0, right: 0, width: CORNER, height: CORNER, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#F4C27A', borderTopRightRadius: 12 },
  cornerBL: { position: 'absolute', bottom: 0, left: 0, width: CORNER, height: CORNER, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#F4C27A', borderBottomLeftRadius: 12 },
  cornerBR: { position: 'absolute', bottom: 0, right: 0, width: CORNER, height: CORNER, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#F4C27A', borderBottomRightRadius: 12 },
  bottomCard: { backgroundColor: 'rgba(255,253,248,0.94)', borderRadius: radius.lg, padding: spacing.md, marginBottom: 10 },
  error: { color: colors.primaryDark, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  retryButton: { backgroundColor: colors.teal, padding: 12, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
  retryText: { color: '#fff', fontWeight: '800' },
  demoButton: { padding: 10, alignItems: 'center' },
  demoText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  centerCard: { marginTop: 80, backgroundColor: '#FFFDF8', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center' },
  symbol: { color: colors.teal, fontSize: 64, fontWeight: '700' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, marginTop: 20 },
  primaryText: { color: '#fff', fontWeight: '800' },
});
