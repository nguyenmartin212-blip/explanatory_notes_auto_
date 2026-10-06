import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from './types';
import {
  HomeScreen,
  MapScreen,
  ItineraryScreen,
  SavedScreen,
  SettingsScreen,
} from '@/screens';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Khám phá' }} />
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Bản đồ' }} />
      <Tab.Screen
        name="Itinerary"
        component={ItineraryScreen}
        options={{ title: 'Lịch trình' }}
      />
      <Tab.Screen name="Saved" component={SavedScreen} options={{ title: 'Đã lưu' }} />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Cài đặt' }}
      />
    </Tab.Navigator>
  );
}
