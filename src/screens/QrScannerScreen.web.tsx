import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBrowserPois } from '@/features/content/web-hooks';
import { parsePoiQr } from '@/features/qr/services/qr-content';

const SCANNER_ELEMENT_ID = 'web-visitor-qr-reader';

export default function QrScannerScreenWeb() {
  const { pois, isLoading } = useBrowserPois();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handlingScanRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    const scanner = scannerRef.current;
    if (scanner?.isScanning) {
      void scanner.stop().then(() => scanner.clear());
    }
  }, []);

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    if (scanner?.isScanning) {
      await scanner.stop();
    }
    scanner?.clear();
    scannerRef.current = null;
    setIsScanning(false);
  };

  const handleScan = async (rawValue: string) => {
    if (handlingScanRef.current) return;
    handlingScanRef.current = true;
    setError('');
    await stopScanner();

    const payload = parsePoiQr(rawValue);
    const poi = payload && pois.find((item) => item.id === payload.poiId);
    if (!poi) {
      setError('Mã QR không hợp lệ hoặc chưa có dữ liệu điểm tham quan.');
      handlingScanRef.current = false;
      return;
    }

    window.localStorage.setItem('qr_activated_station', poi.id);
    const destination = new URL(window.location.href);
    destination.searchParams.set('visit', '1');
    destination.searchParams.set('poi', poi.id);
    window.location.replace(destination.toString());
  };

  const startScanner = async () => {
    setError('');
    handlingScanRef.current = false;
    setIsStarting(true);
    let scanner: Html5Qrcode | null = null;

    try {
      scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => { void handleScan(decodedText); },
        () => undefined,
      );
      setIsScanning(true);
    } catch (scanError) {
      scannerRef.current = null;
      setIsScanning(false);
      setError(
        scanError instanceof Error
          ? `Không thể mở camera: ${scanError.message}`
          : 'Không thể mở camera. Hãy cấp quyền camera và dùng HTTPS hoặc localhost.',
      );
      scanner?.clear();
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.brand}>GO TO HORIZON</Text>
        <Text style={styles.title}>Quét QR điểm tham quan</Text>
        <Text style={styles.subtitle}>
          Cho phép camera, sau đó hướng mã QR vào khung. Mã hợp lệ sẽ ghi nhận lượt vào cho điểm tham quan.
        </Text>

        <View style={styles.cameraFrame}>
          <View nativeID={SCANNER_ELEMENT_ID} style={styles.cameraMount} />
          {!isScanning && (
            <View style={styles.cameraOverlay}>
              <Text style={styles.cameraIcon}>▦</Text>
              <Text style={styles.cameraHint}>
                {isLoading ? 'Đang tải danh sách điểm đến…' : 'Camera chưa được bật'}
              </Text>
            </View>
          )}
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={isLoading || isStarting}
          style={[styles.button, (isLoading || isStarting) && styles.buttonDisabled]}
          onPress={() => {
            if (isScanning) {
              void stopScanner();
            } else {
              void startScanner();
            }
          }}
        >
          <Text style={styles.buttonText}>
            {isStarting ? 'Đang mở camera…' : isScanning ? 'Tắt camera' : 'Bật camera và quét'}
          </Text>
        </Pressable>
        <Text style={styles.note}>
          Trình duyệt cần quyền camera. Khi truy cập từ thiết bị khác, trang web phải dùng HTTPS.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: '#F3F7F4',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: '#DDE9E2',
    shadowColor: '#173B2D',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 5,
  },
  brand: {
    color: '#247453',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    textAlign: 'center',
  },
  title: {
    color: '#183A2C',
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 9,
  },
  subtitle: {
    color: '#687B70',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 22,
  },
  cameraFrame: {
    position: 'relative',
    minHeight: 300,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCE8E0',
    borderRadius: 18,
    backgroundColor: '#F5F8F6',
  },
  cameraMount: {
    minHeight: 300,
    width: '100%',
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F8F6',
    pointerEvents: 'none',
  },
  cameraIcon: {
    color: '#78A58D',
    fontSize: 56,
    fontWeight: '700',
  },
  cameraHint: {
    color: '#687B70',
    fontSize: 14,
    marginTop: 8,
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#247453',
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  note: {
    color: '#7B8C82',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 14,
  },
});
