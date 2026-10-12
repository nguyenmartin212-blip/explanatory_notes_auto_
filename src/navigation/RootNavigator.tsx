import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabNavigator } from './MainTabNavigator';
import { PoiDetailScreen } from '@/screens/PoiDetailScreen';
import { QrScannerScreen } from '@/screens/QrScannerScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="MainTabs"
        component={MainTabNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PoiDetail"
        component={PoiDetailScreen}
        options={{ title: 'Chi tiết điểm đến' }}
      />
      <Stack.Screen
        name="QrScanner"
        component={QrScannerScreen}
        options={{ title: 'Quét QR' }}
      />
    </Stack.Navigator>
  );
}
