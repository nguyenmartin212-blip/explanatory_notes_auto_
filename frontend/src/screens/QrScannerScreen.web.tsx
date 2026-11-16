import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { getUrlLanguage, HeritageHeader, Icon, interfaceLanguage, LanguageSelect, saveLanguage } from '../design/Heritage';
import { useVisitorOptions } from '@/features/content/web-hooks';
import { parseManagedQr } from '@/features/qr/services/qr-content';

const SCANNER_ELEMENT_ID = 'web-visitor-qr-reader';
const messages = {
  vi: { back: 'Về trang khám phá', title: 'Quét mã QR', instruction: 'Đưa mã QR tại điểm tham quan vào giữa khung hình.', loading: 'Đang tải danh sách điểm đến…', off: 'Camera đang tắt', starting: 'Đang mở camera…', stop: 'Tắt camera', start: 'Bật camera và quét', permission: 'Cho phép trình duyệt dùng camera để quét mã. Trang web cần HTTPS khi truy cập từ thiết bị khác.', invalid: 'Mã QR không hợp lệ hoặc chưa có dữ liệu điểm tham quan.', cameraError: 'Không thể mở camera.' },
  en: { back: 'Back to Explore', title: 'Scan QR code', instruction: 'Position the destination’s QR code in the center of the frame.', loading: 'Loading destinations…', off: 'Camera is off', starting: 'Opening camera…', stop: 'Turn camera off', start: 'Turn on camera and scan', permission: 'Allow camera access to scan the code. HTTPS is required when accessing the site from another device.', invalid: 'The QR code is invalid or the destination is unavailable.', cameraError: 'Unable to open the camera.' },
  zh: { back: '返回探索', title: '扫描二维码', instruction: '将景点二维码放在取景框中央。', loading: '正在加载景点…', off: '摄像头已关闭', starting: '正在开启摄像头…', stop: '关闭摄像头', start: '开启摄像头并扫描', permission: '请允许浏览器访问摄像头。从其他设备访问此网站时需要 HTTPS。', invalid: '二维码无效或该景点不可用。', cameraError: '无法开启摄像头。' },
};

export default function QrScannerScreenWeb() {
  const { languages } = useVisitorOptions();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handlingScanRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [lang, setLang] = useState(getUrlLanguage);
  const [error, setError] = useState<'invalid' | 'cameraError' | null>(null);
  const t = messages[interfaceLanguage(lang)];
  const openImageText = { vi: 'Đọc ảnh QR', en: 'Read a QR image', zh: '读取二维码图片' }[interfaceLanguage(lang)];

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
    setError(null);
    try { await stopScanner(); } catch {
      setError('cameraError');
      handlingScanRef.current = false;
      return;
    }

    const code = parseManagedQr(rawValue);
    if (!code) {
      setError('invalid');
      handlingScanRef.current = false;
      return;
    }

    const destination = new URL('/', window.location.origin);
    destination.searchParams.set('lang', lang);
    destination.searchParams.set('qr', code);
    window.location.replace(destination.toString());
  };

  const startScanner = async () => {
    setError(null);
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
        { fps: 10, qrbox: (width, height) => {
          const size = Math.floor(Math.min(width, height, 320) * 0.72);
          return { width: size, height: size };
        } },
        (decodedText) => { void handleScan(decodedText); },
        () => undefined,
      );
      setIsScanning(true);
    } catch {
      scannerRef.current = null;
      setIsScanning(false);
      setError('cameraError');
      scanner?.clear();
    } finally {
      setIsStarting(false);
    }
  };

  const readImage = async (file: File) => {
    handlingScanRef.current = false;
    setIsStarting(true);
    setError(null);
    try {
      await stopScanner();
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      const decoded = await scanner.scanFile(file, false);
      await handleScan(decoded);
    } catch {
      setError('invalid');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <main className="heritage-scanner" lang={lang}>
      <HeritageHeader><LanguageSelect value={lang} languages={languages} onChange={(value) => {
        saveLanguage(value);
        setLang(value);
      }} /></HeritageHeader>
      <section className="heritage-scan-body">
        <a href={`/?lang=${lang}`}><Icon name="back" />{t.back}</a>
        <h1 className="heritage-title">{t.title}</h1>
        <p>{t.instruction}</p>
        <div className="heritage-camera">
          <div id={SCANNER_ELEMENT_ID} />
          {!isScanning && (
            <div className="heritage-camera-overlay">
              <div className="heritage-camera-guide"><Icon name="camera" />
                <span role="status">{t.off}</span>
              </div>
            </div>
          )}
        </div>
        {error && <p className="heritage-error" role="alert">{t[error]}</p>}
        <button
          className="heritage-button heritage-primary"
          disabled={isStarting}
          onClick={() => void (isScanning ? stopScanner() : startScanner())}
        >
          <Icon name="camera" />{isStarting ? t.starting : isScanning ? t.stop : t.start}
        </button>
        <label className="heritage-qr-file">{openImageText}
          <input type="file" accept="image/*" disabled={isStarting} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void readImage(file);
          }} />
        </label>
        <p className="heritage-scan-note">{t.permission}</p>
      </section>
    </main>
  );
}
