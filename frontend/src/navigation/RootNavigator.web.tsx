import React from 'react';
import MapScreen from '../screens/MapScreen.web';
import AdminDashboardWeb from '../screens/AdminDashboard.web';
import QrScannerScreenWeb from '../screens/QrScannerScreen.web';

export function RootNavigator() {
  const isAdminPath = typeof window !== 'undefined' &&
    (window.location.pathname.replace(/\/+$/, '') === '/admin' ||
      new URLSearchParams(window.location.search).get('admin') === '1');

  const isScanPath = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('scan') === '1';

  if (isScanPath) return <QrScannerScreenWeb />;

  if (isAdminPath) {
    return <AdminDashboardWeb />;
  }

  return <MapScreen />;
}