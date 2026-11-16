import { lazy, Suspense, useCallback, useState } from 'react';
import MapScreen from '../screens/MapScreen.web';
import QrGateScreen, { type GateState } from '../screens/QrGateScreen.web';
import { grantQrAccess, hasQrAccess } from '../features/qr/access';

const AdminDashboardWeb = lazy(() => import('../screens/AdminDashboard.web'));
const QrScannerScreenWeb = lazy(() => import('../screens/QrScannerScreen.web'));

/**
 * Cổng QR: du khách phải quét mã QR hợp lệ mới vào được.
 * - Có ?qr=<mã> trong URL: backend xác thực mã (cần kết nối mạng).
 * - Đã quét hợp lệ trong tab này: tải lại vẫn vào; đóng tab / thoát thì phải quét lại.
 * - Còn lại: hiện màn hình "Quét mã QR để bắt đầu".
 */
function VisitorEntry() {
  const hasCode = new URLSearchParams(window.location.search).get('qr') !== null;
  const [granted, setGranted] = useState(hasQrAccess);
  const [result, setResult] = useState<'invalid' | 'offline' | null>(null);

  const onQrResult = useCallback((valid: boolean | null) => {
    if (valid === true) { grantQrAccess(); setGranted(true); }
    else setResult(valid === false ? 'invalid' : 'offline');
  }, []);

  const state: GateState = !hasCode ? 'idle' : result ?? 'checking';
  // MapScreen luôn nằm cùng một vị trí để không bị mount lại khi xác thực xong.
  // display: contents để lớp bọc không phá bố cục flex/cuộn của #root.
  // (mount lại sẽ tạo thêm phiên và đếm trùng một lượt quét QR).
  const mountMap = granted || (hasCode && result === null);

  return <>
    {!granted && <QrGateScreen state={state} />}
    {mountMap && <div style={{ display: granted ? 'contents' : 'none' }}><MapScreen onQrResult={onQrResult} /></div>}
  </>;
}

export function RootNavigator() {
  const isAdminPath = typeof window !== 'undefined' &&
    (window.location.pathname.replace(/\/+$/, '') === '/admin' ||
      new URLSearchParams(window.location.search).get('admin') === '1');

  const isScanPath = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('scan') === '1';

  if (isScanPath || isAdminPath) return <Suspense fallback={<p role="status">Đang tải…</p>}>
    {isScanPath ? <QrScannerScreenWeb /> : <AdminDashboardWeb />}
  </Suspense>;

  return <VisitorEntry />;
}
