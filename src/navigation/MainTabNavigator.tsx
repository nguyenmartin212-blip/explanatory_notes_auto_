import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import type { MainTabParamList } from './types';
import {
  HomeScreen,
  MapScreen,
  ItineraryScreen,
  SavedScreen,
  SettingsScreen,
} from '@/screens';
import { colors } from '@/theme';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, string> = {
  Home: '◉',
  Map: '⌖',
  Itinerary: '⌁',
  Saved: '⌑',
  Settings: '⚙',
};

export function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerTitleAlign: 'center',
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: 72,
          paddingTop: 8,
          paddingBottom: 10,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '600',
        },
        tabBarIcon: ({ color, focused }) => (
          <Text
            style={{
              color,
              fontSize: focused ? 19 : 18,
              lineHeight: 21,
              fontWeight: focused ? '800' : '500',
            }}
          >
            {TAB_ICONS[route.name]}
          </Text>
        ),
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Khám phá',
          headerShown: false,
        }}
      />

      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          title: 'Bản đồ',
          headerShown: false,
        }}
      />

      <Tab.Screen
        name="Itinerary"
        component={ItineraryScreen}
        options={{ title: 'Lịch trình' }}
      />

      <Tab.Screen
        name="Saved"
        component={SavedScreen}
        options={{ title: 'Đã lưu' }}
      />

      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Cài đặt' }}
      />
    </Tab.Navigator>
  );
}
