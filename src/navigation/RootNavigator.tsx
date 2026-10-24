// src/navigation/RootNavigator.tsx
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainTabNavigator } from './MainTabNavigator';
import QrScannerScreenWeb from '../screens/QrScannerScreen.web';
import { QrScannerScreen } from '../screens/QrScannerScreen';

const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const [isWebActivated, setIsWebActivated] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const savedStation = localStorage.getItem('qr_activated_station');
      if (!savedStation) {
        setIsWebActivated(false);
      }
    }
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return null;
  }

  const InitialComponent = (!isWebActivated && Platform.OS === 'web') 
    ? QrScannerScreenWeb 
    : MainTabNavigator;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* Dùng `as any` để bỏ qua kiểm tra xung đột kiểu props ngặt nghèo của TypeScript */}
      <Stack.Screen name="MainTabs" component={InitialComponent as any} />
      <Stack.Screen 
        name="QrScanner" 
        component={(Platform.OS === 'web' ? QrScannerScreenWeb : QrScannerScreen) as any} 
      />
    </Stack.Navigator>
  );
}