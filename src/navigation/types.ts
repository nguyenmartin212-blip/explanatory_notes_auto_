export type RootStackParamList = {
  MainTabs: undefined;
  PoiDetail: {
    poiId: string;
    autoplay?: boolean;
    origin?: 'manual' | 'geofence' | 'qr';
  };
  QrScanner: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Map: undefined;
  Itinerary: undefined;
  Saved: undefined;
  Settings: undefined;
};
