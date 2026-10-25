import React from 'react';
import MapScreen from '../screens/MapScreen';
import AdminDashboardWeb from '../screens/AdminDashboard.web';

export function RootNavigator() {
  const isAdminPath = typeof window !== 'undefined' &&
    (window.location.pathname.replace(/\/+$/, '') === '/admin' ||
      new URLSearchParams(window.location.search).get('admin') === '1');

  if (isAdminPath) {
    return <AdminDashboardWeb />;
  }

  return <MapScreen />;
}