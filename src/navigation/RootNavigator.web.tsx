import React from 'react';
// Chỉ cần trỏ đến MapScreen, Expo sẽ tự chọn đúng bản .web.tsx khi chạy trên web
import MapScreen from '../screens/MapScreen'; 

export function RootNavigator() {
  return <MapScreen />;
}